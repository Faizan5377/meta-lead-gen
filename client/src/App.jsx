import * as Tooltip from '@radix-ui/react-tooltip';
import { CheckCircle2, Database, LayoutDashboard, Loader2, Plus, Radar, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import ClearDbButton from './components/ClearDbButton.jsx';
import ExportButton from './components/ExportButton.jsx';
import FilterPanel from './components/FilterPanel.jsx';
import MetricsBar from './components/MetricsBar.jsx';
import ProgressPanel from './components/ProgressPanel.jsx';
import ResultsTable from './components/ResultsTable.jsx';
import { api } from './lib/api.js';
import { initialState, reducer, subscribeToRun } from './lib/eventClient.js';

const DEFAULT_FILTERS = {
  keywords: [], matchType: 'keyword_unordered', countries: ['US'], adType: 'all',
  activeStatus: 'active', mediaType: 'all', platforms: [], languages: [],
  startDateMin: '', startDateMax: '', target: 5000,
};

const LAST_RUN_KEY = 'adharvester:lastRunId';

const PHASE_LABEL = { idle: 'Idle', harvesting: 'Harvesting ads', contacts: 'Fetching contacts', google: 'Finding owners', done: 'Complete' };

export default function App() {
  const [meta, setMeta] = useState(null);
  const [bootError, setBootError] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dbStats, setDbStats] = useState(null);

  const [state, dispatch] = useReducer(reducer, initialState);
  const unsubRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [m, stats] = await Promise.all([api.filters(), api.dbStats().catch(() => null)]);
        setMeta(m);
        setFilters((f) => ({ ...f, target: m.defaultTarget || 5000 }));
        setDbStats(stats);
      } catch (err) { setBootError(err.message); }

      // Restore the last run after a page reload so results (and the export
      // button) aren't lost. Reconnects live if it's still running.
      const lastId = (() => { try { return localStorage.getItem(LAST_RUN_KEY); } catch { return null; } })();
      if (lastId) {
        try {
          const snap = await api.getRun(lastId);
          dispatch({ type: '__snapshot__', snapshot: snap });
          if (snap.filters?.keywords?.length) setFilters((f) => ({ ...f, ...snap.filters }));
          if (snap.status === 'running') {
            unsubRef.current?.();
            unsubRef.current = subscribeToRun(lastId, dispatch);
          }
        } catch (err) {
          // Only forget the run if the server says it's genuinely gone —
          // a transient network blip shouldn't discard the user's results.
          if (/^404/.test(err.message)) {
            try { localStorage.removeItem(LAST_RUN_KEY); } catch {}
          } else {
            console.warn('Could not restore last run:', err.message);
          }
        }
      }
    })();
    return () => unsubRef.current?.();
  }, []);

  useEffect(() => { if (state.dbStats) setDbStats(state.dbStats); }, [state.dbStats]);

  async function onStart() {
    setBusy(true);
    try {
      const res = await api.createRun(filters);
      try { localStorage.setItem(LAST_RUN_KEY, res.runId); } catch {}
      // Seed state from the created run so runId (and therefore Export/Refresh)
      // is available even if an SSE event is missed.
      dispatch({ type: '__snapshot__', snapshot: res.snapshot });
      unsubRef.current?.();
      unsubRef.current = subscribeToRun(res.runId, dispatch);
      await api.startRun(res.runId);
    } catch (err) { alert('Could not start: ' + err.message); }
    finally { setBusy(false); }
  }
  async function onStop() { if (state.runId) { try { await api.stopRun(state.runId); } catch {} } }
  // Clear the finished run from the view and go back to the empty dashboard.
  // (The run itself stays on the server until it restarts — this only resets
  // what's shown, so a reload won't bring the old results back.)
  function onNewSearch() {
    unsubRef.current?.();
    unsubRef.current = null;
    try { localStorage.removeItem(LAST_RUN_KEY); } catch {}
    dispatch({ type: '__reset__' });
  }

  async function onRefresh() {
    if (!state.runId) return;
    setRefreshing(true);
    try { dispatch({ type: '__snapshot__', snapshot: await api.getRun(state.runId) }); }
    catch {} finally { setTimeout(() => setRefreshing(false), 300); }
  }

  const metrics = useMemo(() => {
    const B = state.businesses;
    const n = (f) => B.reduce((a, b) => a + (f(b) ? 1 : 0), 0);
    return {
      businesses: B.length,
      followers: n((b) => b.followers > 0),
      owner: n((b) => b.google_status === 'enriched' && b.owner_name),
      email: n((b) => !!b.contact_email),
      phone: n((b) => !!b.contact_phone),
      website: n((b) => !!b.contact_website),
      skipped: state.counts.skippedKnown || 0,
    };
  }, [state.businesses, state.counts.skippedKnown]);

  const running = state.status === 'running';
  const hasRun = state.status !== 'idle';

  return (
    <Tooltip.Provider delayDuration={120} skipDelayDuration={300}>
      <div className="min-h-screen lg:p-4">
        <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col overflow-hidden bg-white shadow-sm lg:min-h-[calc(100vh-2rem)] lg:flex-row lg:rounded-3xl">

          {/* ── Sidebar ─────────────────────────────────────────────── */}
          <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-100 bg-white lg:flex">
            <div className="flex items-center gap-2.5 px-5 py-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 text-white shadow-sm">
                <Radar size={18} />
              </div>
              <div className="text-[15px] font-semibold text-slate-800">AdHarvester</div>
            </div>

            <nav className="px-3">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Menu</div>
              <div className="mt-1 flex items-center gap-2.5 rounded-xl bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700">
                <LayoutDashboard size={17} /> Harvester
              </div>
            </nav>

            <div className="px-3 pt-5">
              <RunStatusCard state={state} />
            </div>

            <div className="mt-auto p-3">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">
                <div className="text-xs font-medium text-slate-600">How it works</div>
                <div className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                  One ad per business (its longest-running), enriched with followers, contacts &amp; owner — deduped against your local database.
                </div>
              </div>
            </div>
          </aside>

          {/* ── Main ────────────────────────────────────────────────── */}
          <div className="flex min-w-0 flex-1 flex-col bg-slate-50/50">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 lg:px-7">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-800 text-white lg:hidden">
                  <Radar size={16} />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-slate-800">Ad Library Harvester</h1>
                  <p className="text-xs text-slate-400">Search Meta ads, enrich each business, export one clean CSV.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {dbStats?.persisted && (
                  <div className="hidden items-center gap-1.5 sm:flex">
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-500 shadow-sm ring-1 ring-slate-100">
                      <Database size={12} /> {Number(dbStats.businesses || 0).toLocaleString()} in DB
                    </span>
                    <ClearDbButton count={dbStats.businesses} disabled={running} onCleared={(s) => setDbStats(s)} />
                  </div>
                )}
                {state.runId && !running && (
                  <button onClick={onNewSearch}
                    title="Clear these results and start fresh"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-800">
                    <Plus size={13} /> New search
                  </button>
                )}
                {state.runId && (
                  <button onClick={onRefresh} disabled={refreshing}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 disabled:opacity-50">
                    <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
                  </button>
                )}
                <ExportButton runId={state.runId} ready={state.exportReady && !running} />
              </div>
            </header>

            <main className="flex-1 space-y-4 px-5 py-5 lg:px-7">
              {bootError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
                  Can’t reach the backend on :8787 — make sure the server is running. ({bootError})
                </div>
              )}

              {meta && (
                <FilterPanel meta={meta} filters={filters} setFilters={setFilters}
                  onStart={onStart} onStop={onStop} running={running} busy={busy} />
              )}

              {hasRun ? (
                <>
                  <MetricsBar metrics={metrics} />
                  <ProgressPanel state={state} />
                  <ResultsTable businesses={state.businesses} />
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-16 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
                    <Radar size={22} />
                  </div>
                  <div className="text-sm font-semibold text-slate-700">Configure filters and start a search</div>
                  <div className="mx-auto mt-1.5 max-w-lg text-xs leading-relaxed text-slate-400">
                    Every unique business is captured once — its longest-running ad — then enriched with follower counts,
                    Facebook contact details, and an owner lookup. Ads already in your local database are skipped automatically.
                    When everything finishes, export the whole set as a single CSV.
                  </div>
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </Tooltip.Provider>
  );
}

function RunStatusCard({ state }) {
  const running = state.status === 'running';
  const done = state.status === 'finished' || state.status === 'stopped';
  const tone = running ? 'text-brand-600' : done ? 'text-brand-600' : 'text-slate-400';
  const Icon = running ? Loader2 : done ? CheckCircle2 : Radar;
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Run status</div>
      <div className={`mt-1.5 flex items-center gap-2 text-sm font-medium ${tone}`}>
        <Icon size={15} className={running ? 'animate-spin' : ''} />
        {PHASE_LABEL[state.phase] || 'Idle'}
      </div>
      {(running || done) && (
        <div className="mt-2 space-y-1 text-[11px] text-slate-500">
          <div className="flex justify-between"><span>Businesses</span><span className="tabular font-medium text-slate-700">{state.counts.kept}</span></div>
          {state.counts.skippedKnown > 0 && (
            <div className="flex justify-between"><span>Skipped</span><span className="tabular text-slate-500">{state.counts.skippedKnown}</span></div>
          )}
        </div>
      )}
    </div>
  );
}

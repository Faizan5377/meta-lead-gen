import { CheckCircle2, Filter, Loader2, Plus, Radar, RefreshCw, Square } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import ExportButton from '../components/ExportButton.jsx';
import FilterPanel from '../components/FilterPanel.jsx';
import MetricsBar from '../components/MetricsBar.jsx';
import ProgressPanel from '../components/ProgressPanel.jsx';
import ResultsTable from '../components/ResultsTable.jsx';
import { api } from '../lib/api.js';
import { initialState, reducer, subscribeToRun } from '../lib/eventClient.js';

const DEFAULT_FILTERS = {
  keywords: [], matchType: 'keyword_unordered', countries: ['US'], adType: 'all',
  activeStatus: 'active', mediaType: 'all', platforms: [], languages: [],
  startDateMin: '', startDateMax: '', sort: 'impressions', target: 100,
  relevanceEnabled: true, nicheTerms: [], enrichAdvertisers: true,
};

const LAST_RUN_KEY = 'adharvester:lastRunId';

export default function ScraperPage({ meta, stats, onLibraryChanged, onGoToLibrary }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [state, dispatch] = useReducer(reducer, initialState);
  const unsubRef = useRef(null);

  useEffect(() => {
    if (meta?.defaultTarget) setFilters((f) => ({ ...f, target: meta.defaultTarget }));
  }, [meta?.defaultTarget]);

  useEffect(() => {
    // Restore the last run after a reload so results (and the export button)
    // aren't lost. Reconnects live if it's still running.
    const lastId = (() => { try { return localStorage.getItem(LAST_RUN_KEY); } catch { return null; } })();
    if (!lastId) return;
    (async () => {
      try {
        const snap = await api.getRun(lastId);
        dispatch({ type: '__snapshot__', snapshot: snap });
        if (snap.filters?.keywords?.length) setFilters((f) => ({ ...f, ...snap.filters }));
        if (snap.status === 'running') {
          unsubRef.current?.();
          unsubRef.current = subscribeToRun(lastId, dispatch);
        }
      } catch (err) {
        // Only forget the run if the server says it's genuinely gone.
        if (/^404/.test(err.message)) { try { localStorage.removeItem(LAST_RUN_KEY); } catch {} }
      }
    })();
    return () => unsubRef.current?.();
  }, []);

  // Refresh the library counter when a run finishes saving.
  const finished = state.status === 'finished' || state.status === 'stopped' || state.status === 'error';
  useEffect(() => { if (finished) onLibraryChanged?.(); }, [finished, state.saveResult]);

  async function onStart() {
    setBusy(true);
    try {
      const res = await api.createRun(filters);
      try { localStorage.setItem(LAST_RUN_KEY, res.runId); } catch {}
      dispatch({ type: '__snapshot__', snapshot: res.snapshot });
      unsubRef.current?.();
      unsubRef.current = subscribeToRun(res.runId, dispatch);
      await api.startRun(res.runId);
    } catch (err) { alert('Could not start: ' + err.message); }
    finally { setBusy(false); }
  }

  async function onStop() { if (state.runId) { try { await api.stopRun(state.runId); } catch {} } }

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

  // Metrics are derived from the live array so the numbers always equal the rows.
  const metrics = useMemo(() => {
    const B = state.businesses;
    const n = (f) => B.reduce((a, b) => a + (f(b) ? 1 : 0), 0);
    return {
      businesses: B.length,
      active: n((b) => b.is_active),
      followers: B.reduce((a, b) => a + (Number(b.followers_facebook) || 0), 0),
      multiAd: n((b) => (Number(b.ads_running) || 1) > 1),
      longRunning: n((b) => (Number(b.days_running) || 0) >= 365),
      skippedKnown: state.counts.skippedKnown || 0,
      skippedIrrelevant: state.counts.skippedIrrelevant || 0,
    };
  }, [state.businesses, state.counts]);

  const running = state.status === 'running';
  const hasRun = state.status !== 'idle';

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-4 lg:px-7">
        <div>
          <h1 className="text-xl font-semibold">Scraper</h1>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Search the Meta Ad Library, filter to your niche, and collect only advertisers you don’t already have.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.runId && !running && (
            <button onClick={onNewSearch}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 shadow-sm transition hover:border-slate-300 dark:hover:border-slate-600">
              <Plus size={13} /> New search
            </button>
          )}
          {state.runId && (
            <button onClick={onRefresh} disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 shadow-sm transition hover:border-slate-300 dark:hover:border-slate-600 disabled:opacity-50">
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
          )}
          <ExportButton
            href={state.runId ? api.runExportUrl(state.runId) : null}
            ready={state.exportReady && !running}
            label="Export run"
          />
        </div>
      </header>

      <main className="flex-1 space-y-4 px-5 py-5 lg:px-7">
        {meta && (
          <FilterPanel
            meta={meta} filters={filters} setFilters={setFilters}
            onStart={onStart} onStop={onStop} running={running} busy={busy}
          />
        )}

        {hasRun ? (
          <>
            <MetricsBar metrics={metrics} />
            <ProgressPanel state={state} />
            <ResultsTable businesses={state.businesses} />
          </>
        ) : (
          <EmptyState stats={stats} onGoToLibrary={onGoToLibrary} />
        )}
      </main>
    </>
  );
}

function EmptyState({ stats, onGoToLibrary }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 bg-white/60 dark:bg-slate-900/60 px-6 py-16 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-950/40 text-brand-500">
        <Radar size={22} />
      </div>
      <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Add a keyword and start a search</div>
      <div className="mx-auto mt-1.5 max-w-xl text-xs leading-relaxed text-slate-400 dark:text-slate-500">
        Every advertiser is captured once, with its longest-running ad, how many ads it’s running,
        the platforms it runs on and follower counts. Ads outside your niche are filtered out, and
        anything already in your library is skipped — so each run returns only new businesses.
      </div>
      {stats?.total > 0 && (
        <button onClick={onGoToLibrary}
          className="mt-4 text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline">
          You already have {Number(stats.total).toLocaleString()} ads — open your library →
        </button>
      )}
    </div>
  );
}

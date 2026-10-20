import {
  ExternalLink, Globe, Loader2, MapPin, Phone, Play, Plus, RefreshCw,
  Search, Square, Star, Target, SlidersHorizontal, ChevronDown,
} from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import ExportButton from '../components/ExportButton.jsx';
import InfoTip from '../components/InfoTip.jsx';
import KeywordInput from '../components/KeywordInput.jsx';
import LeadsTable from '../components/LeadsTable.jsx';
import { placeLead } from '../lib/lead.js';
import { api } from '../lib/api.js';
import { mapsInitialState, mapsReducer, subscribeToMapsRun } from '../lib/mapsClient.js';

const DEFAULTS = {
  queries: [], locations: [], target: 100,
  language: 'en', region: 'us',
  autoExpand: true, expandRing: 2,
  enrichWithHunter: true, hunterMaxCredits: undefined,
  quality: {
    phone: 'any', website: 'any',
    minRating: 0, maxRating: 5,
    minReviews: 0, maxReviews: 0,
    unratedOk: true, openNow: false,
    excludeNames: '', excludeCategories: '', onlyCategories: '',
  },
};

const LAST_RUN_KEY = 'adharvester:lastMapsRunId';

export default function MapsPage({ onLibraryChanged }) {
  const [limits, setLimits] = useState({ maxTarget: 2500, defaultTarget: 100 });
  const [filters, setFilters] = useState(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [state, dispatch] = useReducer(mapsReducer, mapsInitialState);
  const unsubRef = useRef(null);

  useEffect(() => {
    api.mapsLimits().then((l) => {
      setLimits(l);
      setFilters((f) => ({ ...f, target: l.defaultTarget }));
    }).catch(() => {});

    const last = (() => { try { return localStorage.getItem(LAST_RUN_KEY); } catch { return null; } })();
    if (last) {
      api.mapsRun(last).then((snap) => {
        dispatch({ type: '__snapshot__', snapshot: snap });
        if (snap.filters) setFilters((f) => ({ ...f, ...snap.filters }));
        if (snap.status === 'running') {
          unsubRef.current?.();
          unsubRef.current = subscribeToMapsRun(last, dispatch);
        }
      }).catch((e) => {
        if (/^404/.test(e.message)) { try { localStorage.removeItem(LAST_RUN_KEY); } catch {} }
      });
    }
    return () => unsubRef.current?.();
  }, []);

  const finished = ['finished', 'stopped', 'error'].includes(state.status);
  useEffect(() => { if (finished) onLibraryChanged?.(); }, [finished]);

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));

  async function onStart() {
    setBusy(true);
    try {
      const res = await api.createMapsRun(filters);
      try { localStorage.setItem(LAST_RUN_KEY, res.runId); } catch {}
      dispatch({ type: '__snapshot__', snapshot: res.snapshot });
      unsubRef.current?.();
      unsubRef.current = subscribeToMapsRun(res.runId, dispatch);
      await api.startMapsRun(res.runId);
    } catch (e) { alert('Could not start: ' + e.message); }
    finally { setBusy(false); }
  }
  const onStop = async () => { if (state.runId) { try { await api.stopMapsRun(state.runId); } catch {} } };
  function onNew() {
    unsubRef.current?.(); unsubRef.current = null;
    try { localStorage.removeItem(LAST_RUN_KEY); } catch {}
    dispatch({ type: '__reset__' });
  }

  const running = state.status === 'running';
  const hasRun = state.status !== 'idle';
  const canStart = filters.queries.length > 0 && !busy;

  // Derived from the live array so the numbers always match the table.
  const metrics = useMemo(() => {
    const P = state.places;
    const n = (f) => P.reduce((a, p) => a + (f(p) ? 1 : 0), 0);
    return {
      total: P.length,
      withPhone: n((p) => !!p.phone),
      withSite: n((p) => !!p.website),
      highRated: n((p) => (p.rating ?? 0) >= 4.5),
      noSite: n((p) => !p.website),
    };
  }, [state.places]);

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900 lg:px-7">
        <div>
          <h1 className="text-xl font-semibold">Google Maps</h1>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Find local businesses with phone, website, rating and location — skipping any you already have.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.runId && !running && (
            <button onClick={onNew}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <Plus size={13} /> New search
            </button>
          )}
          <ExportButton
            href={state.runId ? api.mapsRunExportUrl(state.runId) : null}
            ready={state.exportReady && !running}
            label="Export CSV"
          />
        </div>
      </header>

      <main className="flex-1 space-y-4 px-5 py-5 lg:px-7">
        {/* ── Search ── */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-[220px] flex-1">
              <Label>What <InfoTip text="The business type to search for, e.g. dentist, plumber, gym. Add several and each is searched separately." /></Label>
              <KeywordInput value={filters.queries} onChange={(queries) => set({ queries })}
                disabled={running} placeholder="dentist, plumber…" />
            </div>
            <div className="min-w-[220px] flex-1">
              <Label>Where <InfoTip text="Cities or areas. Every term is searched in every location, so 3 terms × 2 cities = 6 searches. Leave empty to search the term as typed." /></Label>
              <KeywordInput value={filters.locations} onChange={(locations) => set({ locations })}
                disabled={running} placeholder="Austin TX, Dallas TX…" />
            </div>

            <Field label={<>Target <InfoTip text={`How many NEW businesses to collect. Maximum ${limits.maxTarget.toLocaleString()}. You get exactly this many, never more.`} /></>} className="w-28">
              <div className="relative">
                <Target size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="number" min={1} max={limits.maxTarget} value={filters.target} disabled={running}
                  onChange={(e) => set({ target: Math.max(1, Math.min(limits.maxTarget, Number(e.target.value) || 1)) })}
                  className="w-full rounded-xl border border-slate-200 py-2 pl-7 pr-2 text-sm tabular shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-brand-900 dark:disabled:bg-slate-800" />
              </div>
            </Field>

            {running ? (
              <button onClick={onStop}
                className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700">
                <Square size={14} /> Stop
              </button>
            ) : (
              <button onClick={onStart} disabled={!canStart}
                title={canStart ? '' : 'Add at least one search term'}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500">
                <Play size={14} /> {busy ? 'Starting…' : 'Start scraping'}
              </button>
            )}
          </div>

          {/* Coverage. Google returns at most ~120 results for one search, so a
              large target needs the surrounding area swept as well. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
            <Check label="Widen the search when the target isn’t reached" checked={filters.autoExpand} disabled={running}
              onChange={(autoExpand) => set({ autoExpand })}
              hint="Google caps ONE search at roughly 120 results however far you scroll — which is why a target of 100 can finish at 9 once quality filters bite. With this on, the same search is re-run across neighbouring parts of the map, closest first, stopping the moment your target is met." />
            {filters.autoExpand && (
              <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                How far out
                <select value={filters.expandRing} disabled={running}
                  onChange={(e) => set({ expandRing: Number(e.target.value) })}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs shadow-sm focus:border-brand-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900">
                  <option value={1}>City — up to 8 areas</option>
                  <option value={2}>Metro — up to 24 areas</option>
                  <option value={3}>Region — up to 48 areas</option>
                </select>
                <InfoTip text="A ceiling, not a plan — nearest areas are searched first and the sweep stops as soon as you have your leads. Each extra area takes about a minute, so only the hardest searches ever use them all." />
              </label>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
            <Check label="Find the decision maker (Hunter.io)" checked={filters.enrichWithHunter !== false} disabled={running}
              onChange={(enrichWithHunter) => set({ enrichWithHunter })}
              hint="Looks each business website up on Hunter and takes ONE contact, the most senior: Owner, then CEO, then President, then Vice President. Businesses with nobody at that level are dropped — your target is how many to collect, not how many survive." />
            {filters.enrichWithHunter !== false && (
              <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                Credit limit
                <input type="number" min={0} step={25} value={filters.hunterMaxCredits ?? ''}
                  placeholder="500" disabled={running}
                  onChange={(e) => set({ hunterMaxCredits: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0) })}
                  className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-xs tabular shadow-sm focus:border-brand-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900" />
                <InfoTip text="Hunter charges one search credit per website that returns people; one that finds nobody is free." />
              </label>
            )}
          </div>

          <QualityPanel
            q={filters.quality} running={running}
            onChange={(patch) => set({ quality: { ...filters.quality, ...patch } })}
          />
        </div>

        {hasRun ? (
          <>
            <Metrics m={metrics} counts={state.counts} target={state.target} />
            <Progress state={state} />
            <LeadsTable leads={state.places.map(placeLead)} />
          </>
        ) : (
          <Empty />
        )}
      </main>
    </>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

function Label({ children }) {
  return <div className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{children}</div>;
}
function Field({ label, children, className = '' }) {
  return <div className={className}><Label>{label}</Label>{children}</div>;
}
function Metrics({ m, counts, target }) {
  const tiles = [
    { label: 'Collected', value: `${m.total} / ${target}`, tone: 'text-brand-600 dark:text-brand-400' },
    { label: 'With phone', value: m.withPhone },
    { label: 'With website', value: m.withSite },
    { label: 'No website', value: m.noSite, hint: 'Prime targets if you sell websites' },
    { label: 'Rated 4.5+', value: m.highRated },
    { label: 'Already had', value: counts.skippedKnown, hint: 'Skipped — collected in an earlier run' },
    { label: 'Filtered out', value: counts.skippedFiltered, hint: "Failed your quality gates; didn't use up the target" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {tiles.map((t) => (
        <div key={t.label} title={t.hint || ''}
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className={`text-2xl font-semibold leading-none tabular ${t.tone || 'text-slate-800 dark:text-slate-100'}`}>{t.value}</div>
          <div className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{t.label}</div>
        </div>
      ))}
    </div>
  );
}

function Progress({ state }) {
  const pct = state.target > 0 ? Math.min(100, Math.round((state.counts.kept / state.target) * 100)) : 0;
  const [showRejects, setShowRejects] = useState(false);

  // Which gate is doing the damage, commonest first.
  const byReason = useMemo(
    () => Object.entries(state.rejectTally).sort((a, b) => b[1] - a[1]),
    [state.rejectTally],
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span className="truncate">{state.ticker || '—'}</span>
        <span className="tabular">{state.counts.kept} / {state.target}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full bg-brand-600 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      {byReason.length > 0 && (
        <div className="mt-2.5 border-t border-slate-100 pt-2 dark:border-slate-800">
          <button onClick={() => setShowRejects((v) => !v)}
            className="flex w-full items-center gap-1.5 text-left text-[11px] text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-300">
            <ChevronDown size={12} className={`transition ${showRejects ? 'rotate-180' : ''}`} />
            {state.counts.skippedFiltered} filtered by your quality gates
            <span className="truncate text-slate-500 dark:text-slate-400">
              — mostly {byReason[0][0]}
            </span>
          </button>
          {showRejects && (
            <>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {byReason.map(([reason, n]) => (
                  <span key={reason} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {reason} <span className="tabular font-semibold">{n}</span>
                  </span>
                ))}
              </div>
              <div className="mt-1.5 max-h-24 overflow-y-auto text-[11px] text-slate-400 dark:text-slate-500">
                {state.rejects.slice(-25).reverse().map((r, i) => (
                  <div key={i} className="truncate">{r.name} — {r.reason}</div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {state.notices.length > 0 && (
        <div className="mt-2 space-y-1 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {state.notices.slice(-3).map((n, i) => <div key={i}>{n.message}</div>)}
        </div>
      )}
      {state.errors.length > 0 && (
        <div className="mt-2 max-h-24 overflow-y-auto rounded-lg bg-red-50/60 p-2 text-xs dark:bg-red-950/30">
          {state.errors.slice(-10).reverse().map((e, i) => (
            <div key={i} className="text-red-700/90 dark:text-red-400">
              <span className="mr-1 text-red-400">[{e.scope}]</span>{e.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-16 text-center dark:border-slate-600 dark:bg-slate-900/60">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950/40">
        <MapPin size={22} />
      </div>
      <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Search a business type and a place</div>
      <div className="mx-auto mt-1.5 max-w-xl text-xs leading-relaxed text-slate-400 dark:text-slate-500">
        Every business comes back with its phone, website, rating, review count, opening hours and
        coordinates. Businesses you already collected are skipped, so each run returns only new ones —
        and filtered-out places never use up your target.
      </div>
    </div>
  );
}

/* ── Lead quality ───────────────────────────────────────────────────────── */

// Filtered-out places never consume the target, so tightening these makes the
// results better without making them fewer.
function QualityPanel({ q, onChange, running }) {
  const [open, setOpen] = useState(false);
  const active = countActiveQuality(q);

  return (
    <div className="border-t border-slate-100 dark:border-slate-800">
      <button onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50">
        <SlidersHorizontal size={15} />
        Lead quality
        {active > 0 && (
          <span className="rounded-md bg-brand-600 px-1.5 text-[10px] font-semibold text-white">{active}</span>
        )}
        <span className="text-[11px] font-normal text-slate-400 dark:text-slate-500">
          — filtered places don’t use up your target
        </span>
        <ChevronDown size={14} className={`ml-auto text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="grid gap-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={<>Phone <InfoTip text="“Must have” keeps only reachable businesses. “Must NOT have” is rarely useful but included for completeness." /></>}>
            <Tri value={q.phone} disabled={running} onChange={(phone) => onChange({ phone })} noun="phone" />
          </Field>

          <Field label={<>Website <InfoTip text="Set to “Must NOT have” to find businesses with no website at all — the strongest prospect list if you sell web design." /></>}>
            <Tri value={q.website} disabled={running} onChange={(website) => onChange({ website })} noun="website" />
          </Field>

          <Field label={<>Rating between <InfoTip text="A range, not just a floor. Looking for businesses with a reputation problem to fix? Try 3.0 – 4.2." /></>}>
            <Pair a={q.minRating} b={q.maxRating} min={0} max={5} step={0.1} disabled={running}
              onA={(minRating) => onChange({ minRating })} onB={(maxRating) => onChange({ maxRating })} />
          </Field>

          <Field label={<>Reviews between <InfoTip text="An upper bound finds smaller, less established businesses — often far more receptive than a chain with 20,000 reviews." /></>}>
            <Pair a={q.minReviews} b={q.maxReviews} min={0} max={100000} step={1} disabled={running}
              onA={(minReviews) => onChange({ minReviews })} onB={(maxReviews) => onChange({ maxReviews })} bPlaceholder="any" />
          </Field>

          <Field label={<>Exclude names <InfoTip text="Drops any business whose name contains one of these — the quickest way to strip national chains out of a local list." /></>}
            className="sm:col-span-2">
            <Text value={q.excludeNames} disabled={running} placeholder="Roto-Rooter, Mr. Rooter, ARS…"
              onChange={(excludeNames) => onChange({ excludeNames })} />
          </Field>

          <Field label={<>Only these categories <InfoTip text="Leave empty for all. Google often mixes adjacent trades into one search; this pins results to the trade you actually want." /></>}>
            <Text value={q.onlyCategories} disabled={running} placeholder="plumber, drain…"
              onChange={(onlyCategories) => onChange({ onlyCategories })} />
          </Field>

          <Field label={<>Exclude categories <InfoTip text="Drops results in these categories, e.g. hardware store, home improvement store." /></>}>
            <Text value={q.excludeCategories} disabled={running} placeholder="hardware store…"
              onChange={(excludeCategories) => onChange({ excludeCategories })} />
          </Field>

          <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap gap-4">
            <Check label="Keep places with no rating yet" checked={q.unratedOk} disabled={running}
              onChange={(unratedOk) => onChange({ unratedOk })}
              hint="New businesses often have no rating. Uncheck to require an established reputation." />
            <Check label="Only open right now" checked={q.openNow} disabled={running}
              onChange={(openNow) => onChange({ openNow })}
              hint="Handy if you plan to call the list immediately." />
          </div>
        </div>
      )}
    </div>
  );
}

function countActiveQuality(q) {
  let n = 0;
  if (q.phone !== 'any') n++;
  if (q.website !== 'any') n++;
  if (Number(q.minRating) > 0 || Number(q.maxRating) < 5) n++;
  if (Number(q.minReviews) > 0 || Number(q.maxReviews) > 0) n++;
  if (!q.unratedOk) n++;
  if (q.openNow) n++;
  if (q.excludeNames?.trim()) n++;
  if (q.excludeCategories?.trim()) n++;
  if (q.onlyCategories?.trim()) n++;
  return n;
}

const INPUT = 'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-brand-900 dark:disabled:bg-slate-800';

function Tri({ value, onChange, disabled, noun }) {
  const opts = [['any', 'Any'], ['required', 'Must have'], ['none', `No ${noun}`]];
  return (
    <div className="flex rounded-xl border border-slate-200 p-0.5 dark:border-slate-700">
      {opts.map(([v, l]) => (
        <button key={v} disabled={disabled} onClick={() => onChange(v)}
          className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
            value === v
              ? 'bg-brand-600 text-white shadow-sm'
              : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
          }`}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Pair({ a, b, onA, onB, min, max, step, disabled, bPlaceholder }) {
  return (
    <div className="flex items-center gap-1.5">
      <input type="number" value={a} min={min} max={max} step={step} disabled={disabled}
        onChange={(e) => onA(Number(e.target.value) || 0)} className={`${INPUT} tabular`} />
      <span className="text-xs text-slate-400">to</span>
      <input type="number" value={b || ''} min={min} max={max} step={step} disabled={disabled}
        placeholder={bPlaceholder} onChange={(e) => onB(Number(e.target.value) || 0)} className={`${INPUT} tabular`} />
    </div>
  );
}

function Text({ value, onChange, disabled, placeholder }) {
  return (
    <input type="text" value={value} disabled={disabled} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} className={INPUT} />
  );
}

function Check({ label, checked, onChange, disabled, hint }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-brand-600 rounded border-slate-300 dark:border-slate-600" />
      {label}
      <InfoTip text={hint} />
    </label>
  );
}

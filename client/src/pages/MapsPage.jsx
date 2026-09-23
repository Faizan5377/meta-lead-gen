import {
  ExternalLink, Globe, Loader2, MapPin, Phone, Play, Plus, RefreshCw,
  Search, Square, Star, Target,
} from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import ExportButton from '../components/ExportButton.jsx';
import InfoTip from '../components/InfoTip.jsx';
import KeywordInput from '../components/KeywordInput.jsx';
import { api } from '../lib/api.js';
import { mapsInitialState, mapsReducer, subscribeToMapsRun } from '../lib/mapsClient.js';

const DEFAULTS = {
  queries: [], locations: [], target: 100,
  language: 'en', region: 'us',
  requirePhone: false, requireWebsite: false, minRating: 0, minReviews: 0,
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
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700">
                <Play size={14} /> {busy ? 'Starting…' : 'Start scraping'}
              </button>
            )}
          </div>

          {/* Quality gates — these never consume the target */}
          <div className="grid gap-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800 sm:grid-cols-2 lg:grid-cols-4">
            <Toggle label="Must have a phone" checked={filters.requirePhone} disabled={running}
              onChange={(v) => set({ requirePhone: v })}
              hint="Skip businesses with no phone number. Filtered-out places don't use up your target." />
            <Toggle label="Must have a website" checked={filters.requireWebsite} disabled={running}
              onChange={(v) => set({ requireWebsite: v })}
              hint="Useful the other way round too: leave OFF and filter for 'no website' afterwards to find businesses to sell one to." />
            <Field label={<>Min rating <InfoTip text="Skip anything rated below this. 0 keeps everything, including unrated places." /></>}>
              <input type="number" min={0} max={5} step={0.1} value={filters.minRating} disabled={running}
                onChange={(e) => set({ minRating: Number(e.target.value) || 0 })}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm tabular shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-brand-900 dark:disabled:bg-slate-800" />
            </Field>
            <Field label={<>Min reviews <InfoTip text="Skip places with fewer reviews than this — a rough proxy for how established a business is." /></>}>
              <input type="number" min={0} value={filters.minReviews} disabled={running}
                onChange={(e) => set({ minReviews: Number(e.target.value) || 0 })}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm tabular shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-brand-900 dark:disabled:bg-slate-800" />
            </Field>
          </div>
        </div>

        {hasRun ? (
          <>
            <Metrics m={metrics} counts={state.counts} target={state.target} />
            <Progress state={state} />
            <PlacesTable places={state.places} />
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
function Toggle({ label, checked, onChange, disabled, hint }) {
  return (
    <div>
      <Label>&nbsp;</Label>
      <label className="flex h-[38px] cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <input type="checkbox" checked={checked} disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400" />
        <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
        <InfoTip text={hint} />
      </label>
    </div>
  );
}

function Metrics({ m, counts, target }) {
  const tiles = [
    { label: 'Collected', value: `${m.total} / ${target}`, tone: 'text-brand-600 dark:text-brand-400' },
    { label: 'With phone', value: m.withPhone },
    { label: 'With website', value: m.withSite },
    { label: 'No website', value: m.noSite, hint: 'Prime targets if you sell websites' },
    { label: 'Rated 4.5+', value: m.highRated },
    { label: 'Already had', value: counts.skippedKnown, hint: 'Skipped — collected in an earlier run' },
    { label: 'Filtered out', value: counts.skippedNoPhone, hint: "Failed your quality gates; didn't use up the target" },
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
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span className="truncate">{state.ticker || '—'}</span>
        <span className="tabular">{state.counts.kept} / {state.target}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full bg-brand-600 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
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

function Stars({ rating, count }) {
  if (rating == null) return <span className="text-slate-300 dark:text-slate-600">—</span>;
  return (
    <div className="flex items-baseline justify-end gap-1">
      <Star size={11} className="translate-y-px fill-amber-400 text-amber-400" />
      <span className="tabular font-medium text-slate-700 dark:text-slate-200">{rating}</span>
      {count != null && <span className="tabular text-[11px] text-slate-400 dark:text-slate-500">({count.toLocaleString()})</span>}
    </div>
  );
}

export function PlacesTable({ places, compact = false }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ col: 'review_count', dir: 'desc' });

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    let arr = places;
    if (s) {
      arr = arr.filter((p) => `${p.name || ''} ${p.category || ''} ${p.address || ''} ${p.city || ''} ${p.website_domain || ''} ${p.phone || ''}`
        .toLowerCase().includes(s));
    }
    return arr.slice().sort((a, b) => {
      let av = a[sort.col], bv = b[sort.col];
      if (av == null) av = sort.dir === 'asc' ? Infinity : -Infinity;
      if (bv == null) bv = sort.dir === 'asc' ? Infinity : -Infinity;
      const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? c : -c;
    });
  }, [places, q, sort]);

  const COLS = [
    { k: 'name', l: 'Business', s: true },
    { k: 'category', l: 'Category', s: true },
    { k: 'rating', l: 'Rating', s: true, r: true },
    { k: 'phone', l: 'Phone' },
    { k: 'website_domain', l: 'Website', s: true },
    { k: 'city', l: 'City', s: true },
    { k: 'open_state', l: 'Hours' },
    { k: 'links', l: 'Open', r: true },
  ];
  const setCol = (c) => setSort((s) => (s.col === c ? { col: c, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: c, dir: 'desc' }));

  return (
    <div className={`overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 ${compact ? '' : 'shadow-sm'}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, category, city, phone…"
            className="w-72 rounded-xl border border-slate-200 py-1.5 pl-8 pr-3 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-brand-900" />
        </div>
        <div className="ml-auto text-xs tabular text-slate-400 dark:text-slate-500">
          {rows.length.toLocaleString()} / {places.length.toLocaleString()} shown
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400 dark:bg-slate-800 dark:text-slate-500">
            <tr>
              {COLS.map((c) => (
                <th key={c.k} onClick={() => c.s && setCol(c.k)}
                  className={`whitespace-nowrap px-3 py-2 font-medium ${c.r ? 'text-right' : 'text-left'} ${c.s ? 'cursor-pointer select-none hover:text-slate-600' : ''}`}>
                  {c.l}{sort.col === c.k && <span className="ml-0.5">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((p) => (
              <tr key={p.feature_id} className="row-in align-top hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                <td className="max-w-[240px] px-3 py-2.5">
                  <div className="truncate font-medium text-slate-800 dark:text-slate-100" title={p.name}>{p.name}</div>
                  <div className="truncate text-[11px] text-slate-400 dark:text-slate-500" title={p.address}>{p.address}</div>
                </td>
                <td className="max-w-[150px] px-3 py-2.5">
                  <span className="truncate text-slate-600 dark:text-slate-300" title={(p.categories || []).join(', ')}>{p.category || '—'}</span>
                </td>
                <td className="px-3 py-2.5 text-right"><Stars rating={p.rating} count={p.review_count} /></td>
                <td className="px-3 py-2.5">
                  {p.phone
                    ? <a href={`tel:${p.phone_e164 || p.phone}`} className="tabular text-slate-700 hover:text-brand-600 dark:text-slate-200">{p.phone}</a>
                    : <span className="text-slate-300 dark:text-slate-600">—</span>}
                </td>
                <td className="max-w-[170px] px-3 py-2.5">
                  {p.website
                    ? <a href={p.website} target="_blank" rel="noreferrer" title={p.website}
                        className="block truncate text-brand-600 hover:underline dark:text-brand-400">{p.website_domain}</a>
                    : <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                        title="No website — a prospect if you sell web design">none</span>}
                </td>
                <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{p.city || '—'}</td>
                <td className="max-w-[150px] px-3 py-2.5">
                  <span className={`truncate text-[11px] ${/^open/i.test(p.open_state || '') ? 'text-green-600 dark:text-green-400' : 'text-slate-400 dark:text-slate-500'}`}
                    title={p.hours ? Object.entries(p.hours).map(([d, h]) => `${d}: ${h}`).join('\n') : ''}>
                    {p.open_state || '—'}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <a href={p.maps_url} target="_blank" rel="noreferrer" title="Open in Google Maps"
                      className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:text-slate-400">
                      Maps <ExternalLink size={9} />
                    </a>
                    {p.latitude != null && (
                      <a href={`https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`}
                        target="_blank" rel="noreferrer" title="Directions"
                        className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:text-slate-400">
                        <MapPin size={9} />
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="px-6 py-12 text-center text-sm text-slate-400 dark:text-slate-500">
            {places.length === 0 ? 'No places yet.' : 'No rows match your search.'}
          </div>
        )}
      </div>
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

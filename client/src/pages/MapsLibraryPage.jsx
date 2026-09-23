import {
  Check, ChevronRight, Download, Layers, Loader2, MapPin, Pencil, Search, Trash2, X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PlacesTable } from './MapsPage.jsx';
import { api } from '../lib/api.js';

// Same execution-based layout as the Ad Library: one collapsible row per search
// so a repeat of the same query is a separate, findable entry.
export default function MapsLibraryPage({ onLibraryChanged }) {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);
  const [places, setPlaces] = useState({});
  const [renaming, setRenaming] = useState(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    api.mapsLibraryRuns().then((r) => setRuns(r.runs || []))
      .catch((e) => { setError(e.message); setRuns([]); });
  }, []);

  const toggle = async (run) => {
    if (openId === run.id) { setOpenId(null); return; }
    setOpenId(run.id);
    if (places[run.id]?.rows) return;
    setPlaces((p) => ({ ...p, [run.id]: { loading: true } }));
    try {
      const res = await api.mapsRunPlaces(run.id);
      setPlaces((p) => ({ ...p, [run.id]: { rows: res.rows } }));
    } catch (e) {
      setPlaces((p) => ({ ...p, [run.id]: { error: e.message } }));
    }
  };

  const rename = async (run) => {
    const name = draft.trim();
    setRenaming(null);
    if (!name || name === run.name) return;
    try {
      await api.renameMapsRun(run.id, name);
      setRuns((rs) => rs.map((r) => (r.id === run.id ? { ...r, name } : r)));
    } catch (e) { alert('Rename failed: ' + e.message); }
  };

  const remove = async (run) => {
    if (!confirm(`Delete “${run.name}” and its ${run.kept || 0} places?\n\nThose businesses become available to collect again.`)) return;
    try {
      await api.deleteMapsRun(run.id);
      setRuns((rs) => rs.filter((r) => r.id !== run.id));
      onLibraryChanged?.();
    } catch (e) { alert('Delete failed: ' + e.message); }
  };

  const shown = useMemo(() => {
    if (!runs) return null;
    const q = search.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter((r) => `${r.name || ''} ${(r.queries || []).join(' ')} ${(r.locations || []).join(' ')}`
      .toLowerCase().includes(q));
  }, [runs, search]);

  const total = runs?.reduce((a, r) => a + (r.kept || 0), 0) || 0;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900 lg:px-7">
        <div>
          <h1 className="text-xl font-semibold">Maps Library</h1>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Every Maps search you’ve run, with the businesses it collected.
          </p>
        </div>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find an execution…"
            className="w-60 rounded-xl border border-slate-200 py-2 pl-8 pr-3 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-brand-900" />
        </div>
      </header>

      <main className="flex-1 space-y-3 px-5 py-5 lg:px-7">
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span><b className="tabular text-slate-800 dark:text-slate-100">{runs?.length ?? '—'}</b> executions</span>
          <span><b className="tabular text-slate-800 dark:text-slate-100">{total.toLocaleString()}</b> businesses collected</span>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">{error}</div>}

        {shown === null && (
          <div className="flex items-center gap-2 px-2 py-10 text-sm text-slate-400 dark:text-slate-500">
            <Loader2 size={15} className="animate-spin" /> Loading executions…
          </div>
        )}

        {shown?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-16 text-center dark:border-slate-600 dark:bg-slate-900/60">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
              <Layers size={22} />
            </div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {search ? 'No executions match that search' : 'No Maps searches yet'}
            </div>
            <div className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
              {search ? 'Try a different term.' : 'Run a search on the Google Maps page and it will appear here.'}
            </div>
          </div>
        )}

        {shown?.map((run) => {
          const open = openId === run.id;
          const bucket = places[run.id] || {};
          return (
            <div key={run.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className={`flex flex-wrap items-center gap-3 px-4 py-3 ${open ? 'border-b border-slate-100 dark:border-slate-800' : ''}`}>
                <button onClick={() => toggle(run)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                  <ChevronRight size={16} className={`shrink-0 text-slate-400 transition ${open ? 'rotate-90' : ''}`} />
                  <div className="min-w-0">
                    {renaming === run.id ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') rename(run); if (e.key === 'Escape') setRenaming(null); }}
                          className="w-64 rounded-lg border border-brand-300 px-2 py-1 text-sm focus:outline-none dark:bg-slate-900" />
                        <button onClick={() => rename(run)} className="rounded p-1 text-brand-600"><Check size={14} /></button>
                        <button onClick={() => setRenaming(null)} className="rounded p-1 text-slate-400"><X size={14} /></button>
                      </div>
                    ) : (
                      <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{run.name || '(unnamed run)'}</div>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
                      <span>{formatWhen(run.created_at)}</span>
                      {(run.locations || []).length > 0 && (
                        <span className="inline-flex items-center gap-1"><MapPin size={10} />{run.locations.join(', ')}</span>
                      )}
                      {run.skipped_known > 0 && <span>{run.skipped_known} already had</span>}
                      {run.skipped_filtered > 0 && <span>{run.skipped_filtered} filtered out</span>}
                    </div>
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold tabular text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {(run.kept || 0).toLocaleString()} places
                  </div>
                  <IconBtn title="Rename" onClick={() => { setRenaming(run.id); setDraft(run.name || ''); }}><Pencil size={14} /></IconBtn>
                  <a href={api.mapsLibraryExportUrl(run.id)} download title="Export this execution as CSV"
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:text-slate-400">
                    <Download size={14} />
                  </a>
                  <IconBtn title="Delete execution" danger onClick={() => remove(run)}><Trash2 size={14} /></IconBtn>
                </div>
              </div>

              {open && (
                <div className="bg-slate-50/50 p-3 dark:bg-slate-950/40">
                  {bucket.loading && (
                    <div className="flex items-center gap-2 px-2 py-6 text-sm text-slate-400">
                      <Loader2 size={14} className="animate-spin" /> Loading places…
                    </div>
                  )}
                  {bucket.error && <div className="px-2 py-4 text-sm text-red-600">{bucket.error}</div>}
                  {bucket.rows && (bucket.rows.length
                    ? <PlacesTable places={bucket.rows} compact />
                    : <div className="px-2 py-6 text-sm text-slate-400">This execution collected no places.</div>)}
                </div>
              )}
            </div>
          );
        })}
      </main>
    </>
  );
}

function IconBtn({ children, title, onClick, danger }) {
  return (
    <button title={title} onClick={onClick}
      className={`rounded-lg border p-1.5 transition dark:border-slate-700 ${
        danger ? 'border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-600 dark:text-slate-400'
               : 'border-slate-200 text-slate-500 hover:border-brand-300 hover:text-brand-600 dark:text-slate-400'}`}>
      {children}
    </button>
  );
}

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

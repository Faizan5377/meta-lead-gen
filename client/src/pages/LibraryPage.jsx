import {
  Check, ChevronRight, Download, Globe, Layers, Loader2, Pencil,
  Search, Trash2, X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import ResultsTable from '../components/ResultsTable.jsx';
import { api } from '../lib/api.js';

// The library is organised by EXECUTION, not as one flat pile of ads. Each run
// is a collapsible row you can expand to see exactly what that search collected,
// so repeating the same keyword later is clearly a separate, findable entry.
export default function LibraryPage({ stats, onLibraryChanged }) {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);
  const [ads, setAds] = useState({});        // runId -> { loading, rows, error }
  const [renaming, setRenaming] = useState(null);
  const [draftName, setDraftName] = useState('');

  const load = async () => {
    setError(null);
    try {
      const res = await api.libraryRuns();
      setRuns(res.runs || []);
    } catch (e) { setError(e.message); setRuns([]); }
  };

  useEffect(() => { load(); }, []);

  const toggle = async (run) => {
    if (openId === run.id) { setOpenId(null); return; }
    setOpenId(run.id);
    if (ads[run.id]?.rows) return;                     // already loaded
    setAds((a) => ({ ...a, [run.id]: { loading: true } }));
    try {
      const res = await api.runAds(run.id);
      setAds((a) => ({ ...a, [run.id]: { rows: res.rows, total: res.total } }));
    } catch (e) {
      setAds((a) => ({ ...a, [run.id]: { error: e.message } }));
    }
  };

  const rename = async (run) => {
    const name = draftName.trim();
    setRenaming(null);
    if (!name || name === run.name) return;
    try {
      await api.renameRun(run.id, name);
      setRuns((rs) => rs.map((r) => (r.id === run.id ? { ...r, name } : r)));
    } catch (e) { alert('Rename failed: ' + e.message); }
  };

  const remove = async (run) => {
    if (!confirm(`Delete “${run.name}” and its ${run.kept || 0} ads?\n\nThose advertisers become available to collect again.`)) return;
    try {
      await api.deleteRun(run.id);
      setRuns((rs) => rs.filter((r) => r.id !== run.id));
      onLibraryChanged?.();
    } catch (e) { alert('Delete failed: ' + e.message); }
  };

  const shown = useMemo(() => {
    if (!runs) return null;
    const q = search.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter((r) =>
      `${r.name || ''} ${(r.keywords || []).join(' ')} ${(r.countries || []).join(' ')}`.toLowerCase().includes(q));
  }, [runs, search]);

  const totalAds = runs?.reduce((a, r) => a + (r.kept || 0), 0) || 0;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 lg:px-7">
        <div>
          <h1 className="text-xl font-semibold">Ad Library</h1>
          <p className="text-xs text-slate-400">
            Every search you’ve run, with the ads it collected. Expand one to view or export it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Find an execution…"
              className="w-60 rounded-xl border border-slate-200 py-2 pl-8 pr-3 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </div>
        </div>
      </header>

      <main className="flex-1 space-y-3 px-5 py-5 lg:px-7">
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
          <span><b className="tabular text-slate-800">{runs?.length ?? '—'}</b> executions</span>
          <span><b className="tabular text-slate-800">{totalAds.toLocaleString()}</b> ads collected</span>
          <span className={stats?.mode === 'supabase' ? 'text-brand-600' : 'text-amber-600'}>
            {stats?.mode === 'supabase' ? 'synced to Supabase' : 'stored locally only'}
          </span>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div>
        )}

        {shown === null && (
          <div className="flex items-center gap-2 px-2 py-10 text-sm text-slate-400">
            <Loader2 size={15} className="animate-spin" /> Loading executions…
          </div>
        )}

        {shown?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-16 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <Layers size={22} />
            </div>
            <div className="text-sm font-semibold text-slate-700">
              {search ? 'No executions match that search' : 'No executions yet'}
            </div>
            <div className="mt-1.5 text-xs text-slate-400">
              {search ? 'Try a different keyword or country.' : 'Run a search on the Scraper page and it will appear here.'}
            </div>
          </div>
        )}

        {shown?.map((run) => {
          const open = openId === run.id;
          const bucket = ads[run.id] || {};
          return (
            <div key={run.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {/* Summary row */}
              <div className={`flex flex-wrap items-center gap-3 px-4 py-3 ${open ? 'border-b border-slate-100' : ''}`}>
                <button onClick={() => toggle(run)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                  <ChevronRight size={16} className={`shrink-0 text-slate-400 transition ${open ? 'rotate-90' : ''}`} />
                  <div className="min-w-0">
                    {renaming === run.id ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          autoFocus value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') rename(run);
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                          className="w-64 rounded-lg border border-brand-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-100"
                        />
                        <button onClick={() => rename(run)} className="rounded p-1 text-brand-600 hover:bg-brand-50"><Check size={14} /></button>
                        <button onClick={() => setRenaming(null)} className="rounded p-1 text-slate-400 hover:bg-slate-50"><X size={14} /></button>
                      </div>
                    ) : (
                      <div className="truncate text-sm font-semibold text-slate-800">{run.name || '(unnamed run)'}</div>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      <span>{formatWhen(run.created_at)}</span>
                      {(run.countries || []).length > 0 && (
                        <span className="inline-flex items-center gap-1"><Globe size={10} />{run.countries.join(', ')}</span>
                      )}
                      <StatusChip status={run.status} />
                      {run.skipped_irrelevant > 0 && (
                        <span title="Ads dropped because they weren't in your niche">
                          {run.skipped_irrelevant} off-niche filtered
                        </span>
                      )}
                      {run.skipped_known > 0 && (
                        <span title="Advertisers already in your library, so they were skipped">
                          {run.skipped_known} already had
                        </span>
                      )}
                    </div>
                  </div>
                </button>

                <div className="flex shrink-0 items-center gap-2">
                  <div className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold tabular text-slate-700">
                    {(run.kept || 0).toLocaleString()} ads
                  </div>
                  <IconBtn title="Rename" onClick={() => { setRenaming(run.id); setDraftName(run.name || ''); }}>
                    <Pencil size={14} />
                  </IconBtn>
                  <a
                    href={api.runExportUrlLibrary(run.id)} download
                    title="Export this execution as CSV"
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:border-brand-300 hover:text-brand-600"
                  >
                    <Download size={14} />
                  </a>
                  <IconBtn title="Delete execution" danger onClick={() => remove(run)}>
                    <Trash2 size={14} />
                  </IconBtn>
                </div>
              </div>

              {/* Expanded ads */}
              {open && (
                <div className="bg-slate-50/50 p-3">
                  {bucket.loading && (
                    <div className="flex items-center gap-2 px-2 py-6 text-sm text-slate-400">
                      <Loader2 size={14} className="animate-spin" /> Loading ads…
                    </div>
                  )}
                  {bucket.error && (
                    <div className="px-2 py-4 text-sm text-red-600">{bucket.error}</div>
                  )}
                  {bucket.rows && (
                    bucket.rows.length
                      ? <ResultsTable businesses={bucket.rows} compact />
                      : <div className="px-2 py-6 text-sm text-slate-400">This execution collected no ads.</div>
                  )}
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
    <button
      title={title} onClick={onClick}
      className={`rounded-lg border p-1.5 transition ${
        danger
          ? 'border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-600'
          : 'border-slate-200 text-slate-500 hover:border-brand-300 hover:text-brand-600'
      }`}
    >
      {children}
    </button>
  );
}

function StatusChip({ status }) {
  if (!status || status === 'finished') return null;
  const tone = status === 'error' ? 'text-red-600' : status === 'stopped' ? 'text-amber-600' : 'text-brand-600';
  return <span className={`font-medium ${tone}`}>{status}</span>;
}

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

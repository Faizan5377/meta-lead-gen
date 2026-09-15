import * as Tooltip from '@radix-ui/react-tooltip';
import { Database, LayoutGrid, Radar, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import LibraryPage from './pages/LibraryPage.jsx';
import ScraperPage from './pages/ScraperPage.jsx';
import { api } from './lib/api.js';

const NAV = [
  { id: 'scraper', label: 'Scraper', icon: Search, hint: 'Search the Ad Library and collect new advertisers' },
  { id: 'library', label: 'Ad Library', icon: LayoutGrid, hint: 'Every ad you have collected, filterable and exportable' },
];

// The hash is the router: shareable, bookmarkable, and no dependency needed for
// two pages.
function useHashRoute(initial = 'scraper') {
  const read = () => (window.location.hash.replace('#/', '') || initial).split('?')[0];
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const go = (id) => { window.location.hash = `/${id}`; setRoute(id); };
  return [NAV.some((n) => n.id === route) ? route : initial, go];
}

export default function App() {
  const [route, go] = useHashRoute();
  const [meta, setMeta] = useState(null);
  const [stats, setStats] = useState(null);
  const [bootError, setBootError] = useState(null);

  const refreshStats = () => api.libraryStats().then(setStats).catch(() => {});

  useEffect(() => {
    api.filters().then(setMeta).catch((e) => setBootError(e.message));
    refreshStats();
  }, []);

  return (
    <Tooltip.Provider delayDuration={120} skipDelayDuration={300}>
      <div className="flex min-h-screen bg-slate-50 text-slate-800">

        {/* ── Sidebar ──────────────────────────────────────────────── */}
        <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
          <div className="flex items-center gap-2.5 px-5 py-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 text-white shadow-sm">
              <Radar size={18} />
            </div>
            <div>
              <div className="text-[15px] font-semibold leading-tight">AdHarvester</div>
              <div className="text-[10px] text-slate-400">Meta Ad Library</div>
            </div>
          </div>

          <nav className="space-y-0.5 px-3">
            {NAV.map(({ id, label, icon: Icon, hint }) => (
              <button
                key={id}
                onClick={() => go(id)}
                title={hint}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  route === id
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`}
              >
                <Icon size={17} /> {label}
              </button>
            ))}
          </nav>

          <div className="mt-auto p-3">
            <button
              onClick={() => go('library')}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 text-left transition hover:border-brand-200"
            >
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <Database size={11} /> Library
              </div>
              <div className="mt-1 text-xl font-semibold tabular text-slate-800">
                {stats ? Number(stats.total).toLocaleString() : '—'}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                ads stored ·{' '}
                <span className={stats?.mode === 'supabase' ? 'text-brand-600' : 'text-amber-600'}>
                  {stats?.mode === 'supabase' ? 'synced' : 'local only'}
                </span>
              </div>
            </button>
          </div>
        </aside>

        {/* ── Main ─────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile nav */}
          <div className="flex gap-1 border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id} onClick={() => go(id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
                  route === id ? 'bg-brand-50 text-brand-700' : 'text-slate-500'
                }`}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>

          {bootError && (
            <div className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
              Can’t reach the backend on :8787 — make sure the server is running. ({bootError})
            </div>
          )}

          {route === 'scraper'
            ? <ScraperPage meta={meta} stats={stats} onLibraryChanged={refreshStats} onGoToLibrary={() => go('library')} />
            : <LibraryPage stats={stats} onLibraryChanged={refreshStats} />}
        </div>
      </div>
    </Tooltip.Provider>
  );
}

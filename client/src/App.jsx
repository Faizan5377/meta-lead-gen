import * as Tooltip from '@radix-ui/react-tooltip';
import { Database, LayoutGrid, MapPin, Moon, Radar, Search, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import LibraryPage from './pages/LibraryPage.jsx';
import MapsLibraryPage from './pages/MapsLibraryPage.jsx';
import MapsPage from './pages/MapsPage.jsx';
import ScraperPage from './pages/ScraperPage.jsx';
import { api } from './lib/api.js';

const NAV = [
  { group: 'Meta Ads' },
  { id: 'scraper', label: 'Ad Scraper', icon: Search, hint: 'Search the Meta Ad Library and collect new advertisers' },
  { id: 'library', label: 'Ad Library', icon: LayoutGrid, hint: 'Every ad you have collected, by execution' },
  { group: 'Google Maps' },
  { id: 'maps', label: 'Maps Scraper', icon: MapPin, hint: 'Find local businesses with phone, website and rating' },
  { id: 'maps-library', label: 'Maps Library', icon: Database, hint: 'Every Maps search you have run' },
];
const PAGES = NAV.filter((n) => n.id);

// The hash is the router: shareable, bookmarkable, no dependency needed.
function useHashRoute(initial = 'scraper') {
  const read = () => (window.location.hash.replace('#/', '') || initial).split('?')[0];
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const go = (id) => { window.location.hash = `/${id}`; setRoute(id); };
  return [PAGES.some((n) => n.id === route) ? route : initial, go];
}

// Theme: remembered per browser, defaulting to the OS preference.
function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('adharvester:theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {}
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem('adharvester:theme', theme); } catch {}
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

export default function App() {
  const [route, go] = useHashRoute();
  const [theme, toggleTheme] = useTheme();
  const [meta, setMeta] = useState(null);
  const [stats, setStats] = useState(null);
  const [mapsStats, setMapsStats] = useState(null);
  const [bootError, setBootError] = useState(null);

  const refreshStats = () => {
    api.libraryStats().then(setStats).catch(() => {});
    api.mapsStats().then(setMapsStats).catch(() => {});
  };

  useEffect(() => {
    api.filters().then(setMeta).catch((e) => setBootError(e.message));
    refreshStats();
  }, []);

  const isMaps = route.startsWith('maps');
  const counter = isMaps ? mapsStats : stats;

  return (
    <Tooltip.Provider delayDuration={120} skipDelayDuration={300}>
      <div className="flex min-h-screen bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-100">

        {/* ── Sidebar ──────────────────────────────────────────────── */}
        <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:flex">
          <div className="flex items-center gap-2.5 px-5 py-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 text-white shadow-sm">
              <Radar size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold leading-tight">LeadHarvester</div>
              <div className="truncate text-[10px] text-slate-400 dark:text-slate-500">Meta Ads · Google Maps</div>
            </div>
          </div>

          <nav className="space-y-0.5 px-3">
            {NAV.map((n, i) => n.group ? (
              <div key={`g${i}`} className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600">
                {n.group}
              </div>
            ) : (
              <button key={n.id} onClick={() => go(n.id)} title={n.hint}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  route === n.id
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                }`}>
                <n.icon size={17} /> {n.label}
              </button>
            ))}
          </nav>

          <div className="mt-auto space-y-2 p-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/50">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                <Database size={11} /> {isMaps ? 'Places' : 'Ads'} stored
              </div>
              <div className="mt-1 text-xl font-semibold tabular text-slate-800 dark:text-slate-100">
                {counter ? Number(counter.total).toLocaleString() : '—'}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                <span className={counter?.mode === 'supabase' ? 'text-brand-600 dark:text-brand-400' : 'text-amber-600 dark:text-amber-400'}>
                  {counter?.mode === 'supabase' ? 'synced' : 'local only'}
                </span>
              </div>
            </div>

            <button onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-700">
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              {theme === 'dark' ? 'Light' : 'Dark'} mode
            </button>
          </div>
        </aside>

        {/* ── Main ─────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile nav */}
          <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900 lg:hidden">
            {PAGES.map((n) => (
              <button key={n.id} onClick={() => go(n.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
                  route === n.id ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'
                }`}>
                <n.icon size={15} /> {n.label}
              </button>
            ))}
            <button onClick={toggleTheme} className="ml-auto shrink-0 rounded-lg p-1.5 text-slate-500 dark:text-slate-400">
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>

          {bootError && (
            <div className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
              Can’t reach the backend on :8787 — make sure the server is running. ({bootError})
            </div>
          )}

          {route === 'scraper' && <ScraperPage meta={meta} stats={stats} onLibraryChanged={refreshStats} onGoToLibrary={() => go('library')} />}
          {route === 'library' && <LibraryPage stats={stats} onLibraryChanged={refreshStats} />}
          {route === 'maps' && <MapsPage onLibraryChanged={refreshStats} />}
          {route === 'maps-library' && <MapsLibraryPage onLibraryChanged={refreshStats} />}
        </div>
      </div>
    </Tooltip.Provider>
  );
}

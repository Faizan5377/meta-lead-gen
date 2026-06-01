import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import ExportButton from './components/ExportButton.jsx';
import ResultsTable from './components/ResultsTable.jsx';
import SetupPanel from './components/SetupPanel.jsx';
import StatusBar from './components/StatusBar.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import { api } from './lib/api.js';
import { initialState, reducer, subscribeToSession } from './lib/eventClient.js';

export default function App() {
  const [locations, setLocations] = useState([]);
  const [adCategories, setAdCategories] = useState([]);
  const [presets, setPresets] = useState([]);
  const [bootError, setBootError] = useState(null);

  const [location, setLocation] = useState(null);
  const [adType, setAdType] = useState('all');
  const [keywords, setKeywords] = useState([]);
  const [mode, setMode] = useState('leadgen');
  const [maxCards, setMaxCards] = useState(200);

  // Auto-fallback: if the picked country doesn't support the currently selected
  // ad category (e.g. PK + Properties), reset to "All ads". Meta would otherwise
  // silently rewrite our URL and the scraper would scrape nothing.
  useEffect(() => {
    if (!location || !adCategories.length) return;
    const cat = adCategories.find(c => c.value === adType);
    if (!cat) return;
    if (cat.restrictedTo && !cat.restrictedTo.includes(location.code)) {
      setAdType('all');
    }
  }, [location?.code, adCategories]);

  const [state, dispatch] = useReducer(reducer, initialState);
  const unsubRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [locs, cats, ps] = await Promise.all([
          api.locations(), api.adCategories(), api.presets(),
        ]);
        setLocations(locs);
        setAdCategories(cats);
        setPresets(ps);
      } catch (err) {
        setBootError(err.message);
      }
    })();
    return () => unsubRef.current?.();
  }, []);

  async function onStart() {
    if (!location || keywords.length === 0) return;
    try {
      const res = await api.createSession({
        location: location.name,
        locationCode: location.code,
        keywords,
        adType,
        mode,
        maxCards,
      });
      // Subscribe BEFORE starting so we don't miss the first events.
      unsubRef.current?.();
      unsubRef.current = subscribeToSession(res.sessionId, (ev) => dispatch(ev));
      await api.startSession(res.sessionId);
    } catch (err) {
      alert('Failed to start session: ' + err.message);
    }
  }

  async function onStop() {
    if (!state.sessionId) return;
    try { await api.stopSession(state.sessionId); } catch {}
  }

  const totalCompanies = useMemo(() => {
    const s = new Set(state.leads.map(l => l.page_slug).filter(Boolean));
    return s.size;
  }, [state.leads]);

  const running = state.status === 'running';
  const hasLeads = state.leads.length > 0;
  const finished = state.status === 'finished' || state.status === 'stopped';

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-ink-800/70 bg-ink-900/40 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-[1400px] mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-7 w-7 rounded-md bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center text-white text-xs font-bold shadow-lg shadow-accent-600/30">V</div>
            <div className="flex flex-col">
              <div className="text-sm font-medium text-ink-100">Ventix · Meta Leads</div>
              <div className="text-[10px] uppercase tracking-widest text-ink-500">Ad Library → ICP-scored leads</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasLeads && (
              <ExportButton sessionId={state.sessionId} disabled={state.leads.length === 0} />
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-5 py-6 space-y-5">
        {bootError && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-200 text-sm px-4 py-2.5">
            Could not reach the backend on :8787. Make sure it's running. ({bootError})
          </div>
        )}

        <SetupPanel
          locations={locations}
          adCategories={adCategories}
          presets={presets}
          location={location}
          setLocation={setLocation}
          adType={adType}
          setAdType={setAdType}
          keywords={keywords}
          setKeywords={setKeywords}
          mode={mode}
          setMode={setMode}
          maxCards={maxCards}
          setMaxCards={setMaxCards}
          onStart={onStart}
          onStop={onStop}
          running={running}
        />

        {state.errors.length > 0 && (
          <ErrorBanner errors={state.errors} />
        )}

        {(state.status !== 'idle' || hasLeads) && (
          <div className="relative z-10"><StatusBar state={state} totalCompanies={totalCompanies} /></div>
        )}

        {hasLeads ? (
          <div className="relative z-10"><ResultsTable leads={state.leads} totalCompanies={totalCompanies} /></div>
        ) : (
          state.status === 'idle' ? (
            <div className="relative z-10"><EmptyState /></div>
          ) : (
            <div className="relative z-10 rounded-2xl border border-ink-800 bg-ink-900/30 backdrop-blur p-8 text-center text-sm text-ink-500">
              Warming up the browser… first cards will appear here.
            </div>
          )
        )}

        {finished && hasLeads && (
          <SessionSummary state={state} totalCompanies={totalCompanies} />
        )}
      </main>
    </div>
  );
}

function ErrorBanner({ errors }) {
  const recent = errors.slice(-3);
  return (
    <div className="relative z-10 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm space-y-1">
      <div className="text-amber-200 font-medium flex items-center gap-2">
        <span>⚠</span>
        <span>{recent.length === 1 ? 'Scraper warning' : `${recent.length} scraper warnings`}</span>
      </div>
      {recent.map((e, i) => (
        <div key={i} className="text-amber-100/90 text-xs pl-6">
          {e.scope && <span className="text-amber-300/70 mr-1.5">[{e.scope}]</span>}
          {e.message}
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-ink-800/80 bg-ink-900/20 backdrop-blur p-10 text-center">
      <div className="mx-auto h-12 w-12 rounded-xl bg-gradient-to-br from-accent-500/30 to-accent-700/30 border border-accent-500/30 flex items-center justify-center mb-4">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-accent-300">
          <circle cx="11" cy="11" r="7" strokeWidth="2" />
          <path d="m20 20-3.5-3.5" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <div className="text-sm font-medium text-ink-100 mb-1">Configure a session above to begin</div>
      <div className="text-xs text-ink-500 max-w-md mx-auto">
        Pick a location, choose <em>Properties</em> for real-estate keywords, and add the keywords you want to harvest. Leads stream into the table as the scraper finds them.
      </div>
    </div>
  );
}

function SessionSummary({ state, totalCompanies }) {
  const totalFollowers = state.leads.reduce((a, l) => a + (l.fb_followers || 0) + (l.ig_followers || 0), 0);
  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 backdrop-blur">
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-300 text-xs">✓</span>
        <div className="text-sm font-medium text-ink-100">
          {state.status === 'stopped' ? 'Session stopped' : 'Session complete'}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
        <SummaryStat label="Total leads" value={state.leads.length} />
        <SummaryStat label="Unique companies" value={totalCompanies} />
        <SummaryStat label="Hot" value={state.tierCounts.hot} accent="text-accent-300" />
        <SummaryStat label="Warm" value={state.tierCounts.warm} accent="text-amber-300" />
        <SummaryStat label="Followers reached" value={totalFollowers.toLocaleString()} />
      </div>
    </div>
  );
}

function SummaryStat({ label, value, accent = 'text-ink-100' }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-ink-500">{label}</div>
      <div className={`text-xl font-semibold tabular ${accent}`}>{value}</div>
    </div>
  );
}

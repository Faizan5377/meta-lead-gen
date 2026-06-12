import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

function CountUp({ value, className = '' }) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (value === display) return;
    const start = display;
    const delta = value - start;
    const duration = 350;
    const t0 = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(start + delta * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <span className={`tabular ${className}`}>{display.toLocaleString()}</span>;
}

function Counter({ label, value, accent }) {
  return (
    <div className="flex flex-col">
      <div className="text-[10px] uppercase tracking-widest text-ink-500">{label}</div>
      <CountUp value={value || 0} className={`text-2xl font-semibold ${accent || 'text-ink-100'}`} />
    </div>
  );
}

function TierPill({ label, count, color, sub }) {
  return (
    <div className={`flex items-baseline gap-1.5 rounded-md border px-2 py-1 text-xs ${color}`}>
      <span className="font-medium">{label}</span>
      <CountUp value={count} className="tabular font-semibold" />
      {sub && <span className="text-[10px] opacity-70">{sub}</span>}
    </div>
  );
}

export default function StatusBar({ state, totalCompanies }) {
  const { status, keywords, currentKeywordIndex, currentKeyword, ticker, tierCounts, leads } = state;
  const isRunning = status === 'running';

  return (
    <div className="rounded-2xl border border-ink-800 bg-ink-900/30 backdrop-blur p-5 shadow-2xl shadow-black/20">
      {/* Top row: keyword pipeline */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm">
            {isRunning ? (
              <span className="relative inline-flex h-2 w-2 mr-1">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-70"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-400"></span>
              </span>
            ) : status === 'finished' ? (
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 mr-1"></span>
            ) : status === 'stopped' ? (
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400 mr-1"></span>
            ) : (
              <span className="inline-block h-2 w-2 rounded-full bg-ink-500 mr-1"></span>
            )}
            <span className="text-ink-300 capitalize">{status}</span>
            {currentKeyword && (
              <>
                <span className="text-ink-700">·</span>
                <span className="text-ink-200">
                  Keyword {currentKeywordIndex + 1} of {keywords.length} — "<span className="text-accent-300">{currentKeyword}</span>"
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {keywords.map((k, i) => {
            const done = i < currentKeywordIndex || status === 'finished';
            const current = i === currentKeywordIndex && isRunning;
            return (
              <div
                key={k + i}
                title={k}
                className={`shrink-0 h-1.5 rounded-full transition-all ${
                  done ? 'bg-emerald-500/60 w-10' :
                  current ? 'bg-accent-500 w-16 animate-pulse-dot' :
                  'bg-ink-700/60 w-10'
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-5 mb-4">
        <Counter label="Ads found" value={leads.length} />
        <Counter label="Enriched" value={state.totalEnriched} />
        <Counter label="Companies" value={totalCompanies} />
        <Counter label="Failed" value={state.totalFailed} accent="text-amber-300" />
        <Counter label="Hot leads" value={tierCounts.hot} accent="text-accent-300" />
      </div>

      {/* Tier breakdown */}
      <div className="flex flex-wrap gap-2 mb-4">
        <TierPill label="Hot" count={tierCounts.hot} color="border-accent-500/40 bg-accent-500/10 text-accent-200" />
        <TierPill label="Warm" count={tierCounts.warm} color="border-amber-500/40 bg-amber-500/10 text-amber-200" />
        <TierPill label="Cool" count={tierCounts.cool} color="border-ink-600 bg-ink-700/40 text-ink-300" />
        <TierPill label="Cold" count={tierCounts.cold} color="border-ink-700/60 bg-ink-800/40 text-ink-500" />
        {tierCounts.pending > 0 && (
          <TierPill label="Scoring" count={tierCounts.pending} color="border-ink-700 bg-ink-800/40 text-ink-400" sub="" />
        )}
      </div>

      {/* Phase progress — which step + which lead we're on */}
      {isRunning && (state.phase === 'enriching' || state.phase === 'discovering') && (
        <div className="mb-3">
          {state.phase === 'discovering' ? (
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-accent-300">① Discovering ads</span>
              <span className="text-ink-400 tabular">{leads.length} found</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-accent-300">
                  ② Enriching advertiser <span className="tabular text-ink-200">{state.enrichDone}/{state.enrichTotal}</span>
                </span>
                <span className="text-ink-400 truncate max-w-[55%]" title={state.enrichCurrent || ''}>
                  {state.enrichCurrent ? `→ ${state.enrichCurrent}` : ''}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden">
                <div
                  className="h-full bg-accent-500 transition-all duration-300"
                  style={{ width: state.enrichTotal ? `${Math.round((state.enrichDone / state.enrichTotal) * 100)}%` : '0%' }}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* Contact enrichment (Phase C) — runs after scraping finishes */}
      {state.contactRunning && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-accent-300">
              ✉ Fetching Facebook contacts <span className="tabular text-ink-200">{state.contactDone}/{state.contactTotal}</span>
            </span>
            <span className="text-ink-400 truncate max-w-[55%]" title={state.contactCurrent || ''}>
              {state.contactCurrent ? `→ ${state.contactCurrent}` : ''}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden">
            <div
              className="h-full bg-accent-500 transition-all duration-300"
              style={{ width: state.contactTotal ? `${Math.round((state.contactDone / state.contactTotal) * 100)}%` : '0%' }}
            />
          </div>
        </div>
      )}

      {/* Ticker */}
      <motion.div
        key={ticker || 'idle'}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="text-xs text-ink-400 flex items-center gap-2 truncate"
      >
        <span className="text-ink-600">›</span>
        <span>{ticker || (status === 'idle' ? 'Configure a session above to begin.' : status === 'finished' ? 'Session complete.' : '')}</span>
      </motion.div>
    </div>
  );
}

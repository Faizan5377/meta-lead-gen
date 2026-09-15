import { useState } from 'react';
import AnimatedNumber from './AnimatedNumber.jsx';

const STEPS = [
  { key: 'harvesting', label: 'Harvest' },
  { key: 'enriching', label: 'Details' },
  { key: 'saving', label: 'Save' },
  { key: 'done', label: 'Done' },
];
const ORDER = { idle: -1, harvesting: 0, enriching: 1, saving: 2, done: 3 };

function Bar({ done, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-full bg-brand-600 transition-all duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function ProgressPanel({ state }) {
  const [tab, setTab] = useState(null);   // 'errors' | 'rejected' | null
  const cur = ORDER[state.phase] ?? -1;
  const done = state.status === 'finished' || state.status === 'stopped' || state.status === 'error';
  const enrichOn = state.filters?.deepEnrich;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* Stepper */}
      <div className="flex items-center">
        {STEPS.map((s, i) => {
          const skipped = s.key === 'enriching' && !enrichOn;
          const isDone = done ? true : i < cur;
          const isActive = !done && i === cur;
          const color = isActive ? 'bg-brand-600 text-white'
            : isDone ? 'bg-brand-500 text-white'
            : 'bg-slate-100 text-slate-400';
          return (
            <div key={s.key} className="flex flex-1 items-center">
              <div className="flex items-center gap-2">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${color}`}>
                  {isDone ? '✓' : i + 1}
                </span>
                <span className={`text-sm font-medium ${isActive ? 'text-brand-700' : isDone ? 'text-brand-600' : 'text-slate-400'}`}>
                  {s.label}{skipped && <span className="ml-1 text-[10px] text-slate-300">(off)</span>}
                </span>
              </div>
              {i < STEPS.length - 1 && <div className={`mx-2 h-0.5 flex-1 rounded ${i < cur || done ? 'bg-brand-200' : 'bg-slate-100'}`} />}
            </div>
          );
        })}
      </div>

      {/* Phase detail */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>Collected</span>
            <span className="tabular text-slate-700"><AnimatedNumber value={state.counts.kept} /> / {state.target}</span>
          </div>
          <Bar done={state.counts.kept} total={state.target} />
        </div>
        <div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>Ads scanned</span>
            <span className="tabular text-slate-700"><AnimatedNumber value={state.counts.rawSeen} /></span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            {state.counts.skippedIrrelevant} off-niche · {state.counts.skippedKnown} already had
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>{enrichOn ? 'Advertiser details' : 'Saved to library'}</span>
            <span className="tabular text-slate-700">
              {enrichOn
                ? <><AnimatedNumber value={state.phaseInfo.enriching.done} /> / {state.phaseInfo.enriching.total}</>
                : (state.saveResult ? `${state.saveResult.saved}${state.saveResult.remote ? '' : ' (local)'}` : '—')}
            </span>
          </div>
          {enrichOn && <Bar done={state.phaseInfo.enriching.done} total={state.phaseInfo.enriching.total} />}
        </div>
      </div>

      {/* Ticker + toggles */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <div className="truncate text-xs text-slate-500">{state.ticker || '—'}</div>
        <div className="flex shrink-0 items-center gap-2">
          {state.notices?.length > 0 && (
            <span title={state.notices.slice(-6).map((n) => n.message).join('\n')}
              className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
              {state.notices.length} keyword{state.notices.length === 1 ? '' : 's'} with no ads
            </span>
          )}
          {state.rejected?.length > 0 && (
            <button onClick={() => setTab(tab === 'rejected' ? null : 'rejected')}
              title="Ads Meta returned that weren't in your niche"
              className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
              {state.counts.skippedIrrelevant} filtered out {tab === 'rejected' ? '▾' : '▸'}
            </button>
          )}
          {state.errors.length > 0 && (
            <button onClick={() => setTab(tab === 'errors' ? null : 'errors')}
              className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100">
              {state.errors.length} warning{state.errors.length === 1 ? '' : 's'} {tab === 'errors' ? '▾' : '▸'}
            </button>
          )}
        </div>
      </div>

      {tab === 'rejected' && (
        <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-2 text-xs">
          <div className="pb-1 text-[11px] text-slate-400">
            These didn’t match your niche, so they didn’t use up your target.
          </div>
          {state.rejected.slice().reverse().map((r, i) => (
            <div key={i} className="flex items-baseline gap-2 text-slate-600">
              <span className="w-7 shrink-0 tabular text-right text-slate-400">{r.score ?? '—'}</span>
              <span className="truncate font-medium">{r.name || '(unnamed)'}</span>
              <span className="truncate text-slate-400">{r.reason}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'errors' && (
        <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-red-50/60 p-2 text-xs">
          {state.errors.slice(-40).reverse().map((e, i) => (
            <div key={i} className="text-red-700/90">
              <span className="mr-1 text-red-400">[{e.scope}]</span>{e.message}
            </div>
          ))}
        </div>
      )}

      {/* What the niche gate learned — makes the filtering explainable. */}
      {state.nicheProfile && Object.keys(state.nicheProfile).length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">Niche learned:</span>
          {Object.entries(state.nicheProfile).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => (
            <span key={c} className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] text-brand-700">
              {c} <span className="text-brand-400">×{n}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

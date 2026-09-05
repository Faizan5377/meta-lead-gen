import { useState } from 'react';
import AnimatedNumber from './AnimatedNumber.jsx';

const STEPS = [
  { key: 'harvesting', label: 'Harvest' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'owners', label: 'Owners' },
  { key: 'done', label: 'Done' },
];
const ORDER = { idle: -1, harvesting: 0, contacts: 1, owners: 2, done: 3 };

function Bar({ done, total, tone = 'brand' }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const bg = tone === 'green' ? 'bg-brand-500' : 'bg-brand-600';
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full ${bg} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// Live Hunter credit state. Credits are metered monthly, so the run makes this
// visible rather than silently degrading to scrape-only lookups.
function HunterChip({ hunter }) {
  if (!hunter) return null;
  if (!hunter.enabled) {
    const restricted = hunter.disabledReason === 'restricted_account';
    const badKey = hunter.disabledReason === 'bad_key';
    return (
      <span
        title={
          restricted
            ? 'Hunter has restricted this account — log in at hunter.io to resolve. This is not a credit problem. Owners are coming from search engines and company websites.'
            : badKey
              ? 'Hunter rejected the API key — check HUNTER_API_KEY in server/.env'
              : 'No Hunter API key — owners come from search engines and company websites only'
        }
        className={`shrink-0 rounded-md border px-2 py-1 text-xs font-medium ${
          restricted || badKey
            ? 'border-amber-200 bg-amber-50 text-amber-700'
            : 'border-slate-200 bg-slate-50 text-slate-500'
        }`}
      >
        {restricted ? 'Hunter restricted' : badKey ? 'Hunter key invalid' : 'Hunter off'}
      </span>
    );
  }
  const out = hunter.quotaExhausted
    || (hunter.creditsRemaining != null && hunter.creditsRemaining <= hunter.reserve);
  const tone = out
    ? 'border-amber-200 bg-amber-50 text-amber-700'
    : 'border-brand-200 bg-brand-50 text-brand-700';
  const remaining = hunter.creditsRemaining != null ? hunter.creditsRemaining : '—';
  return (
    <span
      title={[
        hunter.plan ? `${hunter.plan} plan` : null,
        `${remaining} search credits left`,
        `${hunter.spentThisRun} spent this run (cap ${hunter.budget})`,
        hunter.resetDate ? `resets ${hunter.resetDate}` : null,
        out ? 'Paid lookups paused — falling back to search engines and company websites' : null,
      ].filter(Boolean).join('\n')}
      className={`shrink-0 rounded-md border px-2 py-1 text-xs font-medium tabular ${tone}`}
    >
      Hunter {hunter.spentThisRun}/{hunter.budget} · {remaining} left
    </span>
  );
}

export default function ProgressPanel({ state }) {
  const [showErrors, setShowErrors] = useState(false);
  const cur = ORDER[state.phase] ?? -1;
  const done = state.status === 'finished' || state.status === 'stopped' || state.status === 'error';

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
      {/* Stepper */}
      <div className="flex items-center">
        {STEPS.map((s, i) => {
          const isDone = done ? true : i < cur;
          const isActive = !done && i === cur;
          const color = isActive ? 'bg-brand-600 text-white' : isDone ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-400';
          return (
            <div key={s.key} className="flex flex-1 items-center">
              <div className="flex items-center gap-2">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${color}`}>
                  {isDone ? '✓' : i + 1}
                </span>
                <span className={`text-sm font-medium ${isActive ? 'text-brand-700' : isDone ? 'text-brand-600' : 'text-slate-400'}`}>{s.label}</span>
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
            <span>Harvested</span>
            <span className="tabular text-slate-700"><AnimatedNumber value={state.counts.kept} /> / {state.target}</span>
          </div>
          <Bar done={state.counts.kept} total={state.target} />
        </div>
        <div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>Facebook contacts</span>
            <span className="tabular text-slate-700"><AnimatedNumber value={state.phaseInfo.contacts.done} /> / {state.phaseInfo.contacts.total}</span>
          </div>
          <Bar done={state.phaseInfo.contacts.done} total={state.phaseInfo.contacts.total} tone="green" />
        </div>
        <div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>Owner lookup</span>
            <span className="tabular text-slate-700"><AnimatedNumber value={state.phaseInfo.owners.done} /> / {state.phaseInfo.owners.total}</span>
          </div>
          <Bar done={state.phaseInfo.owners.done} total={state.phaseInfo.owners.total} tone="green" />
        </div>
      </div>

      {/* Ticker + Hunter credits + errors */}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <div className="truncate text-xs text-slate-500">{state.ticker || '—'}</div>
        <HunterChip hunter={state.hunter} />
        {state.notices?.length > 0 && (
          <span
            title={state.notices.slice(-6).map((n) => n.message).join('\n')}
            className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
          >
            {state.notices.length} keyword{state.notices.length === 1 ? '' : 's'} with no ads
          </span>
        )}
        {state.errors.length > 0 && (
          <button onClick={() => setShowErrors(v => !v)} className="shrink-0 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100">
            {state.errors.length} warning{state.errors.length === 1 ? '' : 's'} {showErrors ? '▾' : '▸'}
          </button>
        )}
      </div>
      {showErrors && state.errors.length > 0 && (
        <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-red-50/60 p-2 text-xs">
          {state.errors.slice(-40).reverse().map((e, i) => (
            <div key={i} className="text-red-700/90">
              <span className="mr-1 text-red-400">[{e.scope}]</span>{e.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { Mail, Play, Square, Target } from 'lucide-react';
import InfoTip from './InfoTip.jsx';
import KeywordInput from './KeywordInput.jsx';
import MultiSelect from './MultiSelect.jsx';

// Four controls, all visible, no accordion.
//
// This used to mirror the Ad Library's whole filter bar — match type, active
// status, media type, platforms, languages, date range, sort — plus relevance
// and business-lookup settings. Almost none of it changed the answer, and one
// of the collapsed toggles silently carried "business lookup off" over from an
// older run, which is how an Amazon product listing reached the export as a
// plumber with an Amazon employee as its owner.
//
// The settings that decide whether a lead is real are no longer settings. They
// always run.
export default function FilterPanel({ meta, filters, setFilters, onStart, onStop, running, busy }) {
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const canStart = filters.keywords.length > 0 && filters.countries.length > 0 && !busy;
  const customerCtas = (meta.ctas || []).filter((c) => c.group === 'Customer').map((c) => c.value);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[260px] flex-1">
          <Label>Keywords <InfoTip text={meta.help.keyword} /></Label>
          <KeywordInput
            value={filters.keywords}
            onChange={(keywords) => set({ keywords })}
            disabled={running}
          />
        </div>

        <Field label={<>Countries <InfoTip text={meta.help.countries} /></>} className="w-52">
          <MultiSelect
            options={meta.countries.map((c) => ({ value: c.code, label: c.name }))}
            value={filters.countries} onChange={(countries) => set({ countries })}
            disabled={running} placeholder="Select countries"
          />
        </Field>

        <Field
          label={<>Leads to collect <InfoTip text={`How many FINISHED leads you want — confirmed on Google Maps and carrying a decision maker's email. The run keeps digging through the Ad Library until it has that many, so asking for 150 may scan several thousand ads. Maximum ${meta.maxTarget.toLocaleString()}.`} /></>}
          className="w-36"
        >
          <div className="relative">
            <Target size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="number" min={1} max={meta.maxTarget} value={filters.target}
              disabled={running}
              onChange={(e) => set({ target: clamp(e.target.value, 1, meta.maxTarget) })}
              className={`${INPUT} pl-7 tabular`}
            />
          </div>
        </Field>

        {running ? (
          <button onClick={onStop}
            className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700">
            <Square size={14} /> Stop
          </button>
        ) : (
          <button onClick={onStart} disabled={!canStart}
            title={canStart ? '' : 'Add at least one keyword and country'}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500">
            <Play size={14} /> {busy ? 'Starting…' : 'Start scraping'}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
        <Field label={<>Ad button <InfoTip text={meta.help.ctas} /></>} className="min-w-[280px] flex-1">
          <MultiSelect
            options={meta.ctas || []} value={filters.ctas || []}
            onChange={(ctas) => set({ ctas })} disabled={running}
            placeholder="Any button"
          />
          <button
            type="button" disabled={running}
            onClick={() => set({ ctas: customerCtas })}
            className="mt-1.5 text-[11px] font-medium text-brand-600 hover:underline disabled:text-slate-400 dark:text-brand-400"
          >
            Customer-intent buttons only
          </button>
        </Field>

        {/* A spend control rather than a filter: Hunter credits are finite and billable. */}
        <Field
          label={<>Contact lookups <InfoTip text="Hunter.io charges one search credit per website that returns people; a search that finds nobody is free. The run stops looking once it reaches this number and tells you. Check your balance with: npm run hunter:account" /></>}
          className="w-44"
        >
          <div className="relative">
            <Mail size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="number" min={0} step={25} value={filters.hunterMaxCredits ?? ''}
              placeholder="500 max" disabled={running}
              onChange={(e) => set({
                hunterMaxCredits: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0),
              })}
              className={`${INPUT} pl-7 tabular`}
            />
          </div>
        </Field>
      </div>
    </div>
  );
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || lo));

const INPUT = 'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-brand-900 dark:disabled:bg-slate-800';

function Label({ children }) {
  return <div className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{children}</div>;
}
function Field({ label, children, className = '' }) {
  return <div className={className}><Label>{label}</Label>{children}</div>;
}

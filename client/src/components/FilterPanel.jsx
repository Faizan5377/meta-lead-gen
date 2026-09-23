import { ChevronDown, Play, SlidersHorizontal, Square, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import InfoTip from './InfoTip.jsx';
import KeywordInput from './KeywordInput.jsx';
import MultiSelect from './MultiSelect.jsx';
import Select from './Select.jsx';

// Mirrors the Meta Ad Library's own filter bar, including which options it
// greys out and when. The rules come from the server (`meta.conditional`) so
// they are defined once rather than duplicated here.
export default function FilterPanel({ meta, filters, setFilters, onStart, onStop, running, busy }) {
  const [open, setOpen] = useState(false);
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));

  const restricted = meta.conditional?.adCategoryRestrictedTo || {};
  const mediaBlocked = (meta.conditional?.mediaTypeUnavailableFor || []).includes(filters.adType);

  // Meta only offers the transparency categories in specific countries.
  const adCategories = useMemo(() => meta.adCategories.map((c) => {
    const allow = restricted[c.value];
    if (!allow) return c;
    const ok = filters.countries.some((x) => allow.includes(x) || x === 'ALL');
    return { ...c, disabled: !ok, note: ok ? null : `Only in ${allow.join(', ')}` };
  }), [meta.adCategories, filters.countries]);

  // If the country changes so the chosen category is no longer legal, fall back
  // to "All ads" rather than silently sending an invalid search.
  const onCountries = (countries) => {
    const allow = restricted[filters.adType];
    const stillOk = !allow || countries.some((x) => allow.includes(x) || x === 'ALL');
    set({ countries, adType: stillOk ? filters.adType : 'all' });
  };

  const canStart = filters.keywords.length > 0 && filters.countries.length > 0 && !busy;
  const activeCount = countActive(filters, meta);

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
      {/* Primary row — what Meta shows without opening Filters */}
      <div className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[260px] flex-1">
          <Label>Keywords <InfoTip text={meta.help.keyword} /></Label>
          <KeywordInput
            value={filters.keywords}
            onChange={(keywords) => set({ keywords })}
            disabled={running}
          />
        </div>

        <Field label={<>Countries <InfoTip text={meta.help.countries} /></>} className="w-56">
          <MultiSelect
            options={meta.countries.map((c) => ({ value: c.code, label: c.name }))}
            value={filters.countries} onChange={onCountries}
            disabled={running} placeholder="Select countries"
          />
        </Field>

        <Field label={<>Ad category <InfoTip text={meta.help.adType} /></>} className="w-52">
          <Select
            options={adCategories} value={filters.adType}
            onChange={(adType) => set({ adType })} disabled={running}
          />
        </Field>

        <Field label={<>Target <InfoTip text={`${meta.help.target} Maximum ${meta.maxTarget.toLocaleString()}.`} /></>} className="w-32">
          <div className="relative">
            <Target size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              type="number" min={1} max={meta.maxTarget} value={filters.target}
              disabled={running}
              onChange={(e) => set({ target: clamp(e.target.value, 1, meta.maxTarget) })}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 py-2 pl-7 pr-2 text-sm tabular shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900 disabled:bg-slate-50 dark:disabled:bg-slate-800"
            />
          </div>
        </Field>

        <button
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium shadow-sm transition ${
            activeCount ? 'border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
          }`}
        >
          <SlidersHorizontal size={15} /> Filters
          {activeCount > 0 && <span className="rounded-md bg-brand-600 px-1.5 text-[10px] font-semibold text-white">{activeCount}</span>}
          <ChevronDown size={14} className={open ? 'rotate-180 transition' : 'transition'} />
        </button>

        {running ? (
          <button onClick={onStop}
            className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700">
            <Square size={14} /> Stop
          </button>
        ) : (
          <button onClick={onStart} disabled={!canStart}
            title={canStart ? '' : 'Add at least one keyword and country'}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700">
            <Play size={14} /> {busy ? 'Starting…' : 'Start scraping'}
          </button>
        )}
      </div>

      {/* Expanded — matches Meta's Filters modal, plus our niche controls */}
      {open && (
        <div className="grid gap-4 border-t border-slate-100 dark:border-slate-800 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={<>Match type <InfoTip text={meta.help.matchType} /></>}>
            <Select options={meta.matchTypes} value={filters.matchType}
              onChange={(matchType) => set({ matchType })} disabled={running} />
          </Field>

          <Field label={<>Active status <InfoTip text={meta.help.activeStatus} /></>}>
            <Select options={meta.activeStatuses} value={filters.activeStatus}
              onChange={(activeStatus) => set({ activeStatus })} disabled={running} />
          </Field>

          <Field
            label={<>Media type <InfoTip text={mediaBlocked ? 'Meta does not apply media type to the issues/elections/politics category.' : meta.help.mediaType} /></>}
          >
            <Select
              options={meta.mediaTypes} value={mediaBlocked ? 'all' : filters.mediaType}
              onChange={(mediaType) => set({ mediaType })}
              disabled={running || mediaBlocked}
            />
            {mediaBlocked && <Hint>Not available for this ad category</Hint>}
          </Field>

          <Field label={<>Sort by <InfoTip text="Matches the Ad Library's own ordering." /></>}>
            <Select options={meta.sorts} value={filters.sort}
              onChange={(sort) => set({ sort })} disabled={running} />
          </Field>

          <Field label={<>Platforms <InfoTip text={meta.help.platforms} /></>}>
            <MultiSelect options={meta.platforms} value={filters.platforms}
              onChange={(platforms) => set({ platforms })} disabled={running} placeholder="All platforms" />
          </Field>

          <Field label={<>Languages <InfoTip text={meta.help.languages} /></>}>
            <MultiSelect options={meta.languages} value={filters.languages}
              onChange={(languages) => set({ languages })} disabled={running} placeholder="All languages" />
          </Field>

          <Field label={<>Started after <InfoTip text={meta.help.dateRange} /></>}>
            <input type="date" value={filters.startDateMin} disabled={running}
              max={filters.startDateMax || undefined}
              onChange={(e) => set({ startDateMin: e.target.value })}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900 disabled:bg-slate-50 dark:disabled:bg-slate-800" />
          </Field>

          <Field label="Started before">
            <input type="date" value={filters.startDateMax} disabled={running}
              min={filters.startDateMin || undefined}
              onChange={(e) => set({ startDateMax: e.target.value })}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900 disabled:bg-slate-50 dark:disabled:bg-slate-800" />
          </Field>

          {/* ── Niche relevance ── */}
          <div className="sm:col-span-2 lg:col-span-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/50 p-3.5">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox" checked={filters.relevanceEnabled} disabled={running}
                  onChange={(e) => set({ relevanceEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-brand-600 dark:text-brand-400 focus:ring-brand-400"
                />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Only keep ads in my niche</span>
                <InfoTip text="Meta's keyword search is loose — a plumbing search returns supplements and gadgets too. This scores every ad against your keyword using its text, destination and Meta's own page category, and drops the ones that don't belong." />
              </label>
              <div className="mt-1 pl-6 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                Filtered-out ads don’t count toward your target, so you still get the exact number you asked for.
              </div>

              {filters.relevanceEnabled && (
                <div className="mt-3 grid gap-3 pl-6 sm:grid-cols-2">
                  <Field label={<>Also count as my niche <InfoTip text="Optional related terms, e.g. searching “plumbing” you might add: drain, water heater, HVAC. Widens what counts as relevant." /></>}>
                    <KeywordInput
                      value={filters.nicheTerms} onChange={(nicheTerms) => set({ nicheTerms })}
                      disabled={running} placeholder="Add related terms…"
                    />
                  </Field>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || lo));

function countActive(f, meta) {
  let n = 0;
  if (f.matchType !== 'keyword_unordered') n++;
  if (f.activeStatus !== 'active') n++;
  if (f.mediaType !== 'all') n++;
  if (f.sort !== (meta.sorts?.[0]?.value || 'impressions')) n++;
  if (f.platforms.length) n++;
  if (f.languages.length) n++;
  if (f.startDateMin || f.startDateMax) n++;
  if (f.nicheTerms?.length) n++;
  if (!f.relevanceEnabled) n++;
  return n;
}

function Label({ children }) {
  return <div className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{children}</div>;
}
function Field({ label, children, className = '' }) {
  return <div className={className}><Label>{label}</Label>{children}</div>;
}
function Hint({ children }) {
  return <div className="mt-1 text-[10px] text-amber-600">{children}</div>;
}

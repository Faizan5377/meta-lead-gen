import { ChevronDown, Play, Search, SlidersHorizontal, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import InfoTip from './InfoTip.jsx';
import MultiSelect from './MultiSelect.jsx';
import Select from './Select.jsx';

const inputCls =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';

function Label({ children, help }) {
  return (
    <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-slate-600">
      {children}
      {help && <InfoTip text={help} />}
    </span>
  );
}

export default function FilterPanel({ meta, filters, setFilters, onStart, onStop, running, busy }) {
  const [advanced, setAdvanced] = useState(false);
  const help = meta.help || {};
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));

  // Dynamic behavior — mirror Meta: restricted ad categories (Properties /
  // Employment / Financial) only exist in the US & Canada. Grey them out and
  // auto-reset to "All ads" if the supporting country is removed.
  const adCategoryOptions = useMemo(() => {
    const countries = filters.countries || [];
    return (meta.adCategories || []).map((c) => ({
      ...c,
      disabled: c.restrictedTo && !countries.includes('ALL') && !countries.some((cc) => c.restrictedTo.includes(cc)),
    }));
  }, [meta.adCategories, filters.countries]);

  useEffect(() => {
    const cur = adCategoryOptions.find((c) => c.value === filters.adType);
    if (cur?.disabled) set({ adType: 'all' });
  }, [adCategoryOptions]); // eslint-disable-line

  const advancedCount =
    (filters.matchType !== 'keyword_unordered' ? 1 : 0) +
    (filters.activeStatus !== 'active' ? 1 : 0) +
    (filters.mediaType !== 'all' ? 1 : 0) +
    (filters.platforms?.length ? 1 : 0) +
    (filters.languages?.length ? 1 : 0) +
    (filters.startDateMin || filters.startDateMax ? 1 : 0);

  const ready = filters.keyword?.trim() && filters.countries?.length > 0;

  // Compact running banner.
  if (running) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white px-5 py-3.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span className="inline-flex items-center gap-2 font-medium text-emerald-600">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            Running
          </span>
          <span className="text-slate-300">·</span>
          <span className="font-medium text-slate-800">“{filters.keyword}”</span>
          <span className="text-slate-300">·</span>
          <span>{(filters.countries || []).join(', ')}</span>
          <span className="text-slate-300">·</span>
          <span>target {filters.target.toLocaleString()}</span>
        </div>
        <button onClick={onStop} className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-sm font-medium text-red-600 transition hover:bg-red-100">
          <Square size={14} /> Stop
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
      {/* Primary row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
        <div className="md:col-span-3">
          <Label help={help.countries}>Countries</Label>
          <MultiSelect
            options={(meta.countries || []).map((c) => ({ value: c.code, label: c.name }))}
            value={filters.countries}
            onChange={(v) => set({ countries: v })}
            placeholder="Pick countries…"
          />
        </div>
        <div className="md:col-span-3">
          <Label help={help.adType}>Ad category</Label>
          <Select
            value={filters.adType}
            onChange={(v) => set({ adType: v })}
            options={adCategoryOptions.map((c) => ({ value: c.value, label: c.label, disabled: c.disabled, disabledHint: 'US/CA only' }))}
          />
        </div>
        <div className="md:col-span-4">
          <Label help={help.keyword}>Keyword</Label>
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={filters.keyword}
              onChange={(e) => set({ keyword: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && ready && !busy) onStart(); }}
              placeholder="real estate, dentist, fitness coaching…"
              className={`${inputCls} pl-9`}
            />
          </div>
        </div>
        <div className="md:col-span-2">
          <Label help={help.target}>Target</Label>
          <input
            type="number" min={1} max={20000}
            value={filters.target}
            onChange={(e) => set({ target: Math.max(1, Math.min(20000, parseInt(e.target.value) || 1)) })}
            className={`${inputCls} tabular`}
          />
        </div>
      </div>

      {/* Advanced filters toggle */}
      <button
        onClick={() => setAdvanced((a) => !a)}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-1 text-xs font-medium text-brand-600 transition hover:text-brand-700"
      >
        <SlidersHorizontal size={13} /> Filters
        {advancedCount > 0 && <span className="rounded-full bg-brand-100 px-1.5 text-[10px] text-brand-700">{advancedCount}</span>}
        <ChevronDown size={13} className={`transition-transform ${advanced ? 'rotate-180' : ''}`} />
      </button>

      {advanced && (
        <div className="mt-3 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label help={help.matchType}>Keyword match</Label>
            <Select value={filters.matchType} onChange={(v) => set({ matchType: v })}
              options={(meta.matchTypes || []).map((m) => ({ value: m.value, label: m.label }))} />
          </div>
          <div>
            <Label help={help.activeStatus}>Active status</Label>
            <Select value={filters.activeStatus} onChange={(v) => set({ activeStatus: v })}
              options={(meta.activeStatuses || []).map((s) => ({ value: s.value, label: s.label }))} />
          </div>
          <div>
            <Label help={help.mediaType}>Media type</Label>
            <Select value={filters.mediaType} onChange={(v) => set({ mediaType: v })}
              options={(meta.mediaTypes || []).map((m) => ({ value: m.value, label: m.label }))} />
          </div>
          <div>
            <Label help={help.platforms}>Platforms</Label>
            <MultiSelect
              options={(meta.platforms || []).map((p) => ({ value: p.value, label: p.label }))}
              value={filters.platforms} onChange={(v) => set({ platforms: v })}
              placeholder="All platforms" searchable={false}
            />
          </div>
          <div>
            <Label help={help.languages}>Languages</Label>
            <MultiSelect
              options={(meta.languages || []).map((l) => ({ value: l.value, label: l.label }))}
              value={filters.languages} onChange={(v) => set({ languages: v })}
              placeholder="Any language"
            />
          </div>
          <div>
            <Label help={help.dateRange}>Started running — date range</Label>
            <div className="flex items-center gap-2">
              <input type="date" className={inputCls} value={filters.startDateMin || ''} onChange={(e) => set({ startDateMin: e.target.value })} />
              <span className="text-xs text-slate-400">to</span>
              <input type="date" className={inputCls} value={filters.startDateMax || ''} onChange={(e) => set({ startDateMax: e.target.value })} />
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between">
        <div className="text-xs text-slate-400">
          {ready ? `Ready · up to ${filters.target.toLocaleString()} unique businesses` : 'Enter a keyword and pick at least one country.'}
        </div>
        <button
          onClick={onStart}
          disabled={!ready || busy}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Play size={15} fill="currentColor" /> {busy ? 'Starting…' : 'Start scraping'}
        </button>
      </div>
    </div>
  );
}

import AdCategorySelect from './AdCategorySelect.jsx';
import KeywordChips from './KeywordChips.jsx';
import LocationAutocomplete from './LocationAutocomplete.jsx';

const MODES = [
  { v: 'leadgen', label: 'Lead-gen leads', hint: 'Ventix ICP — real estate, mortgage, home services, legal' },
  { v: 'ecom', label: 'Ecom brands', hint: 'Shopify-style ecommerce brands running video ads' },
];

const CAP_OPTIONS = [100, 200, 500];

export default function SetupPanel({
  locations, adCategories, presets,
  location, setLocation,
  adType, setAdType,
  keywords, setKeywords,
  mode, setMode,
  maxCards, setMaxCards,
  onStart, running, onStop,
}) {
  const ready = location && keywords.length > 0;
  const modePresets = presets.filter(p => (p.mode || 'leadgen') === mode);

  if (running) {
    return (
      <div className="relative z-10 flex items-center justify-between gap-4 rounded-xl border border-ink-800 bg-ink-900/40 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3 text-sm flex-wrap">
          <span className="inline-flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"></span>
            </span>
            <span className="text-ink-300">Running</span>
          </span>
          <span className="text-ink-600">·</span>
          <span className="text-accent-300">{MODES.find(m => m.v === mode)?.label}</span>
          <span className="text-ink-600">·</span>
          <span className="text-ink-300">{location?.name}</span>
          <span className="text-ink-600">·</span>
          <span className="text-ink-300">{adCategories.find(c => c.value === adType)?.label}</span>
          <span className="text-ink-600">·</span>
          <span className="text-ink-300">{keywords.length} keywords</span>
          <span className="text-ink-600">·</span>
          <span className="text-ink-300">cap {maxCards}/kw</span>
        </div>
        <button
          onClick={onStop}
          className="text-xs rounded-md border border-red-500/30 text-red-300 hover:text-red-200 hover:border-red-500/60 hover:bg-red-500/10 px-3 py-1.5 transition-colors"
        >
          Stop
        </button>
      </div>
    );
  }

  return (
    <div className="relative z-30 isolate rounded-2xl border border-ink-800 bg-ink-900/30 backdrop-blur p-5 md:p-6 shadow-2xl shadow-black/30">
      {/* Mode toggle */}
      <div className="mb-5">
        <label className="block text-xs uppercase tracking-wider text-ink-400 mb-1.5">Search mode</label>
        <div className="inline-flex rounded-lg border border-ink-700 bg-ink-900/60 p-1">
          {MODES.map(m => (
            <button
              key={m.v}
              onClick={() => setMode(m.v)}
              title={m.hint}
              className={`px-4 py-1.5 text-sm rounded-md transition-all ${
                mode === m.v
                  ? 'bg-accent-600 text-white shadow-lg shadow-accent-600/30'
                  : 'text-ink-400 hover:text-ink-100'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="text-xs text-ink-500 mt-1.5">{MODES.find(m => m.v === mode)?.hint}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <LocationAutocomplete
          locations={locations}
          value={location}
          onChange={setLocation}
        />
        <AdCategorySelect
          categories={adCategories}
          value={adType}
          onChange={setAdType}
          locationCode={location?.code}
        />
      </div>

      {/* Ad cap */}
      <div className="mb-4">
        <label className="block text-xs uppercase tracking-wider text-ink-400 mb-1.5">
          Max ads to scan <span className="text-ink-500 normal-case font-normal">· per keyword</span>
        </label>
        <div className="flex items-center gap-2">
          {CAP_OPTIONS.map(n => (
            <button
              key={n}
              onClick={() => setMaxCards(n)}
              className={`px-3.5 py-1.5 text-sm rounded-md border transition-colors ${
                maxCards === n
                  ? 'bg-accent-500/20 border-accent-500/50 text-accent-100'
                  : 'border-ink-700 text-ink-400 hover:text-ink-200 hover:border-ink-600'
              }`}
            >
              {n}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={500}
            value={maxCards}
            onChange={(e) => {
              const v = Math.max(1, Math.min(500, parseInt(e.target.value) || 1));
              setMaxCards(v);
            }}
            className="w-24 rounded-md bg-ink-900/70 border border-ink-700 px-3 py-1.5 text-sm tabular focus:border-accent-500 focus:outline-none"
          />
          <span className="text-xs text-ink-500">max 500</span>
        </div>
      </div>

      <KeywordChips keywords={keywords} onChange={setKeywords} presets={modePresets} />

      <div className="mt-5 flex items-center justify-between">
        <div className="text-xs text-ink-500">
          {ready
            ? `Ready · ${keywords.length} keyword${keywords.length === 1 ? '' : 's'} in ${location?.name} · up to ${maxCards} ads each`
            : 'Pick a location and add at least one keyword.'}
        </div>
        <button
          onClick={onStart}
          disabled={!ready}
          className="group relative inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-accent-600/30 hover:bg-accent-500 disabled:bg-ink-700 disabled:text-ink-500 disabled:shadow-none transition-all"
        >
          <span>Start scraping</span>
          <span className="opacity-80 group-hover:translate-x-0.5 transition-transform">→</span>
        </button>
      </div>
    </div>
  );
}

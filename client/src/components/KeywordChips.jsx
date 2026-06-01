import { useState } from 'react';

export default function KeywordChips({ keywords, onChange, presets }) {
  const [input, setInput] = useState('');
  const [showPresets, setShowPresets] = useState(false);

  function add(values) {
    const next = keywords.slice();
    for (const v of values) {
      const k = v.trim();
      if (k && !next.includes(k)) next.push(k);
    }
    onChange(next);
  }

  function remove(k) {
    onChange(keywords.filter(x => x !== k));
  }

  function move(i, dir) {
    const next = keywords.slice();
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  function onKey(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (input.trim()) {
        add([input]);
        setInput('');
      }
    } else if (e.key === 'Backspace' && input === '' && keywords.length) {
      onChange(keywords.slice(0, -1));
    }
  }

  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-ink-400 mb-1.5">
        Keywords <span className="text-ink-500 normal-case font-normal">· order = scrape order</span>
      </label>
      <div className="rounded-lg bg-ink-900/70 border border-ink-700 px-2.5 py-2 focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/30 transition-colors min-h-[3rem]">
        <div className="flex flex-wrap gap-1.5">
          {keywords.map((k, i) => (
            <span
              key={k}
              className="group inline-flex items-center gap-1.5 rounded-md bg-ink-800/80 border border-ink-700 pl-2.5 pr-1 py-1 text-xs"
            >
              <span className="tabular text-ink-500 mr-0.5">{i + 1}</span>
              <span className="text-ink-100">{k}</span>
              <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="text-ink-500 hover:text-ink-200 disabled:opacity-30 px-0.5">↑</button>
                <button onClick={() => move(i, 1)} disabled={i === keywords.length - 1} className="text-ink-500 hover:text-ink-200 disabled:opacity-30 px-0.5">↓</button>
              </span>
              <button onClick={() => remove(k)} className="text-ink-500 hover:text-red-400 ml-0.5 px-1">×</button>
            </span>
          ))}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={keywords.length === 0 ? 'Type a keyword and press Enter…' : 'Add another…'}
            className="flex-1 min-w-[140px] bg-transparent text-sm placeholder-ink-500 outline-none px-1.5 py-1"
          />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-xs text-ink-500">
          {keywords.length} keyword{keywords.length === 1 ? '' : 's'} queued
        </div>
        <button
          type="button"
          onClick={() => setShowPresets(p => !p)}
          className="text-xs text-accent-300 hover:text-accent-200 transition-colors"
        >
          {showPresets ? 'Hide' : 'Browse'} curated presets →
        </button>
      </div>

      {showPresets && (
        <div className="mt-3 space-y-2.5 rounded-lg border border-ink-800/80 bg-ink-900/40 p-3">
          {presets.map(p => (
            <div key={p.id} className="text-sm">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-accent-300 mr-2">Tier {p.tier}</span>
                  <span className="font-medium text-ink-100">{p.label}</span>
                </div>
                <button
                  onClick={() => add(p.keywords)}
                  className="text-xs px-2 py-0.5 rounded-md border border-accent-500/40 text-accent-200 hover:bg-accent-500/15 transition-colors"
                >
                  Add all ({p.keywords.length})
                </button>
              </div>
              <div className="text-xs text-ink-500 mb-1.5">{p.description}</div>
              <div className="flex flex-wrap gap-1">
                {p.keywords.map(k => (
                  <button
                    key={k}
                    onClick={() => add([k])}
                    className={`text-[11px] px-2 py-0.5 rounded-md border transition-colors ${
                      keywords.includes(k)
                        ? 'bg-accent-600/25 border-accent-500/50 text-accent-100'
                        : 'border-ink-700/80 text-ink-300 hover:border-ink-600 hover:text-ink-100'
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

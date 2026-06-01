import { useState } from 'react';
import { api } from '../lib/api.js';

const SCOPES = [
  { v: 'hot_warm',   label: 'Hot + Warm',   desc: 'Outreach-ready' },
  { v: 'all',        label: 'All scored',   desc: 'Excludes cold' },
  { v: 'everything', label: 'Everything',   desc: 'Including cold' },
];

const MODES = [
  { v: 'ad',      label: 'One row per ad' },
  { v: 'company', label: 'One row per company' },
];

export default function ExportButton({ sessionId, disabled }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState('hot_warm');
  const [mode, setMode] = useState('ad');

  function download() {
    if (!sessionId) return;
    const url = api.exportUrl(sessionId, mode, scope);
    window.location.assign(url);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-ink-700 disabled:text-ink-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 disabled:shadow-none transition-all"
      >
        <span>Export leads</span>
        <span className="opacity-80">↓</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-ink-700 bg-ink-900/95 backdrop-blur-md p-3 shadow-2xl shadow-black/50">
          <div className="text-[10px] uppercase tracking-widest text-ink-500 mb-1.5">Tier scope</div>
          <div className="space-y-1 mb-3">
            {SCOPES.map(s => (
              <label key={s.v} className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-xs ${scope === s.v ? 'bg-accent-500/15 text-accent-100' : 'text-ink-300 hover:bg-ink-800/60'}`}>
                <input type="radio" name="scope" checked={scope === s.v} onChange={() => setScope(s.v)} className="accent-accent-500" />
                <span className="flex-1">{s.label}</span>
                <span className="text-[10px] text-ink-500">{s.desc}</span>
              </label>
            ))}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-ink-500 mb-1.5">Row mode</div>
          <div className="space-y-1 mb-3">
            {MODES.map(m => (
              <label key={m.v} className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-xs ${mode === m.v ? 'bg-accent-500/15 text-accent-100' : 'text-ink-300 hover:bg-ink-800/60'}`}>
                <input type="radio" name="mode" checked={mode === m.v} onChange={() => setMode(m.v)} className="accent-accent-500" />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
          <button
            onClick={download}
            className="w-full rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-3 py-2 transition-colors"
          >
            Download CSV
          </button>
        </div>
      )}
    </div>
  );
}

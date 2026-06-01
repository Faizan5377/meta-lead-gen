import { useEffect, useMemo, useRef, useState } from 'react';

export default function LocationAutocomplete({ locations, value, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);

  useEffect(() => {
    if (value) setQuery(`${value.name}`);
  }, [value?.code]);

  useEffect(() => {
    const onClick = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return locations.slice(0, 12);
    return locations
      .map(l => {
        const i = l.name.toLowerCase().indexOf(q);
        const codeMatch = l.code.toLowerCase() === q;
        return { ...l, score: codeMatch ? -1 : i === -1 ? 999 : i };
      })
      .filter(l => l.score < 999)
      .sort((a, b) => a.score - b.score)
      .slice(0, 12);
  }, [query, locations]);

  function commit(loc) {
    onChange(loc);
    setQuery(loc.name);
    setOpen(false);
  }

  function onKey(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) commit(filtered[active]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div className="relative" ref={rootRef}>
      <label className="block text-xs uppercase tracking-wider text-ink-400 mb-1.5">Location</label>
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder="Type a country…"
        className="w-full rounded-lg bg-ink-900/70 border border-ink-700 px-3.5 py-2.5 text-sm placeholder-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 focus:outline-none transition-colors"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1.5 w-full rounded-lg border border-ink-700 bg-ink-900/95 backdrop-blur-md shadow-2xl shadow-black/50 max-h-72 overflow-auto">
          {filtered.map((l, i) => (
            <button
              key={l.code}
              onClick={() => commit(l)}
              onMouseEnter={() => setActive(i)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                i === active ? 'bg-accent-600/20 text-ink-50' : 'text-ink-200 hover:bg-ink-800/60'
              }`}
            >
              <span>{l.name}</span>
              <span className="text-[10px] tabular tracking-widest text-ink-500">{l.code}</span>
            </button>
          ))}
        </div>
      )}
      {!value && query && filtered.length === 0 && (
        <div className="absolute z-30 mt-1.5 w-full rounded-lg border border-ink-700 bg-ink-900/95 px-3 py-2 text-xs text-ink-500">
          No match. Only canonical Meta locations are accepted.
        </div>
      )}
    </div>
  );
}

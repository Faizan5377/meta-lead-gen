import { useEffect, useRef, useState } from 'react';

export default function AdCategorySelect({ categories, value, onChange, locationCode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function isAvailable(cat) {
    if (!cat || !cat.restrictedTo) return true;
    if (!locationCode) return true; // Don't pre-judge before location is picked
    return cat.restrictedTo.includes(locationCode);
  }

  const current = categories.find(c => c.value === value) || categories[0] || null;
  const currentAvailable = isAvailable(current);

  if (!current) {
    // Categories haven't loaded yet — render a stable placeholder so we don't
    // crash on missing fields.
    return (
      <div className="relative">
        <label className="block text-xs uppercase tracking-wider text-ink-400 mb-1.5">Ad category</label>
        <div className="w-full rounded-lg bg-ink-900/70 border border-ink-700 px-3.5 py-2.5 text-sm text-ink-500">Loading…</div>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <label className="block text-xs uppercase tracking-wider text-ink-400 mb-1.5">Ad category</label>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full rounded-lg bg-ink-900/70 border px-3.5 py-2.5 text-sm text-left flex items-center justify-between focus:ring-2 focus:ring-accent-500/30 focus:outline-none transition-colors ${
          !currentAvailable
            ? 'border-amber-500/50 text-amber-200'
            : 'border-ink-700 focus:border-accent-500'
        }`}
      >
        <span>{current?.label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {!currentAvailable && (
        <div className="absolute -bottom-5 left-0 text-[10px] text-amber-300/90">
          ⚠ "{current.label}" is not supported in this country — Meta will rewrite the URL. Pick "All ads" instead.
        </div>
      )}
      {open && (
        <div className="absolute z-50 mt-1.5 w-full rounded-lg border border-ink-700 bg-ink-900/95 backdrop-blur-md shadow-2xl shadow-black/50 overflow-hidden">
          {categories.map(c => {
            const avail = isAvailable(c);
            const handle = () => { if (avail) { onChange(c.value); setOpen(false); } };
            return (
              <button
                key={c.value}
                onClick={handle}
                disabled={!avail}
                className={`w-full px-3 py-2.5 text-left text-sm transition-colors ${
                  !avail
                    ? 'opacity-40 cursor-not-allowed text-ink-500'
                    : c.value === value
                      ? 'bg-accent-600/20 text-ink-50'
                      : 'text-ink-200 hover:bg-ink-800/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span>{c.label}</span>
                  {!avail
                    ? <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300/90 border border-amber-500/30">N/A here</span>
                    : c.recommended && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent-500/15 text-accent-300 border border-accent-500/30">
                        Recommended
                      </span>
                    )
                  }
                </div>
                {c.hint && <div className="text-xs text-ink-500 mt-0.5">{c.hint}</div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

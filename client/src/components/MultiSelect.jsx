import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

// Compact searchable multi-select with chips. `options` = [{value,label,disabled?}].
export default function MultiSelect({ options, value, onChange, placeholder = 'Select…', searchable = true }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const selected = new Set(value);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter(o => o.label.toLowerCase().includes(s) || o.value.toLowerCase().includes(s)) : options;
  }, [options, q]);

  const toggle = (v) => {
    const next = new Set(value);
    next.has(v) ? next.delete(v) : next.add(v);
    onChange(Array.from(next));
  };

  const labelFor = (v) => options.find(o => o.value === v)?.label || v;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex min-h-[40px] w-full flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-left text-sm shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
      >
        {value.length === 0 && <span className="px-1 text-slate-400">{placeholder}</span>}
        {value.slice(0, 6).map(v => (
          <span key={v} className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700">
            {labelFor(v)}
            <span onClick={(e) => { e.stopPropagation(); toggle(v); }} className="cursor-pointer text-brand-400 hover:text-brand-700">×</span>
          </span>
        ))}
        {value.length > 6 && <span className="text-xs text-slate-500">+{value.length - 6} more</span>}
        <ChevronDown size={15} className="ml-auto shrink-0 text-slate-400" />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          {searchable && (
            <div className="border-b border-slate-100 p-2">
              <input
                type="text" aria-label="Filter options"
                autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">No matches</div>}
            {filtered.map(o => (
              <label
                key={o.value}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm ${o.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-slate-50'}`}
              >
                <input
                  type="checkbox" disabled={o.disabled}
                  checked={selected.has(o.value)}
                  onChange={() => !o.disabled && toggle(o.value)}
                  className="accent-brand-600"
                />
                <span className="flex-1">{o.label}</span>
                {o.hint && <span className="text-[10px] text-slate-400">{o.hint}</span>}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

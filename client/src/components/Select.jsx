import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// Single-select dropdown in our own style (matches MultiSelect), so no native
// OS dropdowns appear anywhere. `options` = [{ value, label, disabled? }].
export default function Select({ options, value, onChange, placeholder = 'Select…', disabled = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const current = options.find((o) => o.value === value);

  const pick = (o) => {
    if (o.disabled) return;
    onChange(o.value);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[40px] w-full items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-left text-sm text-slate-800 dark:text-slate-100 shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900"
      >
        <span className={`truncate ${current ? '' : 'text-slate-400 dark:text-slate-500'}`}>{current ? current.label : placeholder}</span>
        <ChevronDown size={15} className={`shrink-0 text-slate-400 dark:text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1 shadow-xl">
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                disabled={o.disabled}
                onClick={() => pick(o)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm ${
                  o.disabled
                    ? 'cursor-not-allowed text-slate-300 dark:text-slate-600'
                    : active
                      ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <span className="truncate">{o.label}{o.disabled && o.disabledHint ? ` — ${o.disabledHint}` : ''}</span>
                {active && <Check size={14} className="shrink-0 text-brand-600 dark:text-brand-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

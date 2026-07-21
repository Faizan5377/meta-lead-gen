import { AlertTriangle, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

// Small trash button next to the DB badge. Asks for a one-tap confirmation
// before wiping the local database so nobody clears it by accident.
export default function ClearDbButton({ count, onCleared, disabled }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const doClear = async () => {
    setBusy(true);
    try {
      const stats = await api.clearDb();
      onCleared?.(stats);
      setOpen(false);
    } catch (err) {
      alert('Could not clear the database: ' + err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        title={disabled ? 'Finish the current run first' : 'Clear the local database'}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Trash2 size={14} />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xl">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-500">
              <AlertTriangle size={15} />
            </div>
            <div>
              <div className="text-sm font-medium text-slate-800">Clear local database?</div>
              <div className="mt-0.5 text-xs leading-relaxed text-slate-500">
                Deletes all {Number(count || 0).toLocaleString()} saved record{count === 1 ? '' : 's'}. Future searches will no longer skip previously-found ads. This can’t be undone.
              </div>
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">Cancel</button>
            <button onClick={doClear} disabled={busy}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60">
              {busy ? 'Clearing…' : 'Clear it'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

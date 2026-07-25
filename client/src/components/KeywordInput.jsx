import { Search, X } from 'lucide-react';
import { useRef, useState } from 'react';

// Multi-keyword input. Each keyword becomes a chip and is searched separately
// on Meta (a combined "a, b, c" string would be treated as one literal phrase
// and match nothing). Add with Enter, comma, semicolon, or Tab; paste a list to
// add them all at once; Backspace on an empty field removes the last chip.
export default function KeywordInput({ value = [], onChange, max = 50 }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const add = (raw) => {
    const parts = String(raw)
      .split(/[,;\n\t]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = value.slice();
    for (const p of parts) {
      if (next.length >= max) break;
      if (!next.some((k) => k.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    if (next.length !== value.length) onChange(next);
    setDraft('');
  };

  const remove = (kw) => onChange(value.filter((k) => k !== kw));

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === 'Tab') {
      if (draft.trim()) { e.preventDefault(); add(draft); }
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className="flex min-h-[40px] w-full cursor-text flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm transition focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100"
    >
      <Search size={15} className="shrink-0 text-slate-400" />
      {value.map((kw) => (
        <span key={kw} className="inline-flex items-center gap-1 rounded-lg bg-brand-50 py-0.5 pl-2 pr-1 text-xs font-medium text-brand-700">
          {kw}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); remove(kw); }}
            className="rounded p-0.5 text-brand-400 transition hover:bg-brand-100 hover:text-brand-700"
            aria-label={`Remove ${kw}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        aria-label="Add a keyword"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && add(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (/[,;\n\t]/.test(text)) { e.preventDefault(); add(text); }
        }}
        placeholder={value.length ? 'Add another…' : 'dentist, plumber, real estate…'}
        className="min-w-[140px] flex-1 border-0 bg-transparent py-0.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-0"
      />
      {value.length > 1 && (
        <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
          {value.length} keywords
        </span>
      )}
    </div>
  );
}

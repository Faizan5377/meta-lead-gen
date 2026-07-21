// Odometer-style number: each digit is a vertical strip (0–9) that rolls to the
// current value. The displayed value is always exactly `value` — the animation
// is purely visual, so metrics stay 100% accurate.

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function Digit({ d }) {
  return (
    <span className="odo-col">
      <span className="odo-strip" style={{ transform: `translateY(-${d}em)` }}>
        {DIGITS.map((n) => (
          <span className="odo-digit" key={n}>{n}</span>
        ))}
      </span>
    </span>
  );
}

export default function AnimatedNumber({ value = 0, className = '' }) {
  const safe = Math.max(0, Math.round(Number(value) || 0));
  const chars = safe.toLocaleString().split('');
  return (
    <span className={`odo tabular ${className}`} aria-label={String(safe)}>
      {chars.map((ch, i) =>
        /\d/.test(ch) ? <Digit key={i} d={Number(ch)} /> : <span key={i} className="odo-digit" style={{ width: '0.28em' }}>{ch}</span>
      )}
    </span>
  );
}

import { useState } from 'react';

const TIER_STYLES = {
  hot:  'border-accent-500/60 bg-accent-500/15 text-accent-100',
  warm: 'border-amber-500/50  bg-amber-500/15  text-amber-100',
  cool: 'border-ink-600       bg-ink-700/40    text-ink-300',
  cold: 'border-ink-700/60    bg-ink-800/30    text-ink-500',
};

const TIER_LABEL = { hot: 'Hot', warm: 'Warm', cool: 'Cool', cold: 'Cold' };

export default function RelevanceBadge({ lead }) {
  const [hover, setHover] = useState(false);
  const tier = lead.relevance_tier;
  const score = lead.relevance_score;
  const status = lead.relevance_status;

  if (!tier || status === 'pending') {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-md border border-ink-700/60 bg-ink-800/30 px-2 py-1 text-xs text-ink-500">
        <span className="h-1.5 w-1.5 rounded-full bg-ink-500 animate-pulse"></span>
        <span>Scoring…</span>
      </div>
    );
  }

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${TIER_STYLES[tier] || TIER_STYLES.cool}`}>
        <span className="font-medium">{TIER_LABEL[tier]}</span>
        <span className="tabular opacity-75">{score}</span>
      </div>
      {hover && lead.relevance_reasons?.length > 0 && (
        <div className="absolute z-30 top-full left-0 mt-1.5 w-72 rounded-lg border border-ink-700 bg-ink-900/95 backdrop-blur-md p-2.5 shadow-2xl shadow-black/50">
          <div className="text-[10px] uppercase tracking-wider text-ink-500 mb-1">Why this score</div>
          <ul className="space-y-1 text-xs text-ink-200">
            {lead.relevance_reasons.map((r, i) => (
              <li key={i} className="leading-snug">{r}</li>
            ))}
          </ul>
          {lead.search_match === false && (
            <div className="mt-2 text-[10px] text-amber-300/80">⚠ off-topic for this keyword</div>
          )}
        </div>
      )}
    </div>
  );
}

import * as Tooltip from '@radix-ui/react-tooltip';
import { Info } from 'lucide-react';

// Small "i" marker with a glitch-free Radix tooltip. Explains what a filter does.
export default function InfoTip({ text, side = 'top' }) {
  if (!text) return null;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label="More information"
          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-brand-500"
        >
          <Info size={13} strokeWidth={2.4} />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className="z-50 max-w-[260px] select-none rounded-lg bg-slate-800 px-3 py-2 text-xs leading-relaxed text-white shadow-lg data-[state=delayed-open]:animate-in"
        >
          {text}
          <Tooltip.Arrow className="fill-slate-800" width={11} height={5} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

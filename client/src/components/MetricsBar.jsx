import { ArrowUpRight, Building2, CalendarClock, CheckCircle2, Copy, Filter, Users } from 'lucide-react';
import AnimatedNumber from './AnimatedNumber.jsx';
import { formatFollowers } from '../lib/format.js';

function HeroTile({ label, value, sub, icon: Icon }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-950 p-4 text-white shadow-sm">
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-white/70">{label}</span>
        <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 dark:bg-white/10">
          <ArrowUpRight size={14} />
        </span>
      </div>
      <div className="mt-3 text-3xl font-semibold leading-none"><AnimatedNumber value={value} /></div>
      <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-white/75">
        <Icon size={12} /> {sub}
      </div>
    </div>
  );
}

function Tile({ label, value, raw, icon: Icon, tint, title }) {
  return (
    <div className="card-lift relative rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-sm" title={title}>
      <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${tint}`}>
        <Icon size={16} strokeWidth={2} />
      </div>
      <div className="mt-3 text-2xl font-semibold leading-none text-slate-800 dark:text-slate-100">
        {raw ?? <AnimatedNumber value={value} />}
      </div>
      <div className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
    </div>
  );
}

export default function MetricsBar({ metrics }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      <HeroTile label="Advertisers" value={metrics.businesses} sub="collected this run" icon={Building2} />
      <Tile label="Active now" value={metrics.active} icon={CheckCircle2} tint="bg-brand-50 text-brand-600" />
      <Tile label="Running 1y+" value={metrics.longRunning} icon={CalendarClock} tint="bg-brand-50 text-brand-600"
        title="Ads running a year or more — proven, profitable creatives" />
      <Tile label="Multi-ad" value={metrics.multiAd} icon={Copy} tint="bg-brand-50 text-brand-600"
        title="Advertisers running more than one ad on this creative" />
      <Tile label="Total followers" raw={formatFollowers(metrics.followers) || '0'} icon={Users}
        tint="bg-emerald-50 text-emerald-600" title="Combined Facebook followers across this run" />
      <Tile label="Off-niche filtered" value={metrics.skippedIrrelevant} icon={Filter} tint="bg-amber-50 text-amber-600"
        title="Ads Meta returned that weren't actually in your niche, so they were dropped" />
      <Tile label="Already had" value={metrics.skippedKnown} icon={Building2} tint="bg-slate-100 text-slate-500"
        title="Advertisers already in your library, so they were skipped" />
    </div>
  );
}

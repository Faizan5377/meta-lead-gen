import { ArrowUpRight, Building2, Database, Globe, Mail, Phone, UserRound, Users } from 'lucide-react';
import AnimatedNumber from './AnimatedNumber.jsx';

// Featured "hero" tile — deep-green gradient, like the reference's highlighted card.
function HeroTile({ label, value, icon: Icon }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-950 p-4 text-white shadow-sm">
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-white/70">{label}</span>
        <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-white">
          <ArrowUpRight size={14} />
        </span>
      </div>
      <div className="mt-3 text-3xl font-semibold leading-none"><AnimatedNumber value={value} /></div>
      <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-white/75">
        <Icon size={12} /> unique businesses
      </div>
    </div>
  );
}

function Tile({ label, value, icon: Icon, tint }) {
  return (
    <div className="card-lift relative rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${tint}`}>
          <Icon size={16} strokeWidth={2} />
        </div>
        <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 text-slate-300">
          <ArrowUpRight size={12} />
        </span>
      </div>
      <div className="mt-3 text-2xl font-semibold leading-none text-slate-800"><AnimatedNumber value={value} /></div>
      <div className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

export default function MetricsBar({ metrics }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      <HeroTile label="Businesses" value={metrics.businesses} icon={Building2} />
      <Tile label="With followers" value={metrics.followers} icon={Users} tint="bg-brand-50 text-brand-600" />
      <Tile label="Owner found" value={metrics.owner} icon={UserRound} tint="bg-brand-50 text-brand-600" />
      <Tile label="Email" value={metrics.email} icon={Mail} tint="bg-emerald-50 text-emerald-600" />
      <Tile label="Phone" value={metrics.phone} icon={Phone} tint="bg-emerald-50 text-emerald-600" />
      <Tile label="Website" value={metrics.website} icon={Globe} tint="bg-emerald-50 text-emerald-600" />
      <Tile label="Skipped" value={metrics.skipped} icon={Database} tint="bg-slate-100 text-slate-500" />
    </div>
  );
}

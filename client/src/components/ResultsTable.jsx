import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { formatFollowers, safeHost } from '../lib/format.js';
import RelevanceBadge from './RelevanceBadge.jsx';

const TIER_ORDER = { hot: 0, warm: 1, cool: 2, cold: 3 };

const PLATFORM_GLYPH = {
  Facebook: 'F',
  Instagram: 'IG',
  Messenger: 'M',
  'Audience Network': 'AN',
  Threads: 'T',
};

function CellEnrichable({ value, status, children }) {
  if (status === 'pending') {
    return <div className="h-3 w-14 rounded shimmer" />;
  }
  if (status === 'failed' && !value) {
    return <span className="text-ink-600">—</span>;
  }
  return children;
}

export default function ResultsTable({ leads, totalCompanies }) {
  const [tierFilter, setTierFilter] = useState('all'); // all | hot | warm | cool | cold
  const [showCold, setShowCold] = useState(false);
  const [search, setSearch] = useState('');
  const [keywordFilter, setKeywordFilter] = useState('');
  const [sort, setSort] = useState({ col: 'relevance_score', dir: 'desc' });

  const keywords = useMemo(() => {
    const s = new Set(leads.map(l => l.keyword).filter(Boolean));
    return Array.from(s);
  }, [leads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = leads.filter(l => {
      if (tierFilter === 'all') {
        if (!showCold && l.relevance_tier === 'cold') return false;
      } else if (l.relevance_tier !== tierFilter) {
        return false;
      }
      if (keywordFilter && l.keyword !== keywordFilter) return false;
      if (q) {
        const hay = `${l.page_name || ''} ${l.headline || ''} ${l.ad_text_snippet || ''} ${l.advertiser_category || ''} ${l.display_domain || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    arr.sort((a, b) => {
      let av = a[sort.col];
      let bv = b[sort.col];
      if (sort.col === 'relevance_tier') {
        av = TIER_ORDER[a.relevance_tier] ?? 4;
        bv = TIER_ORDER[b.relevance_tier] ?? 4;
      }
      if (av == null) av = sort.dir === 'asc' ? Infinity : -Infinity;
      if (bv == null) bv = sort.dir === 'asc' ? Infinity : -Infinity;
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });

    return arr;
  }, [leads, tierFilter, showCold, search, keywordFilter, sort]);

  function sortBy(col) {
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' });
  }

  return (
    <div className="rounded-2xl border border-ink-800 bg-ink-900/30 backdrop-blur overflow-hidden shadow-2xl shadow-black/20">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-ink-800/80">
        <div className="flex items-center gap-1">
          {[
            { v: 'all', label: 'All' },
            { v: 'hot', label: 'Hot' },
            { v: 'warm', label: 'Warm' },
            { v: 'cool', label: 'Cool' },
            { v: 'cold', label: 'Cold' },
          ].map(t => (
            <button
              key={t.v}
              onClick={() => setTierFilter(t.v)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                tierFilter === t.v
                  ? 'bg-accent-500/20 border-accent-500/50 text-accent-100'
                  : 'border-ink-700/70 text-ink-400 hover:text-ink-200 hover:border-ink-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tierFilter === 'all' && (
          <label className="flex items-center gap-1.5 text-xs text-ink-500 ml-1">
            <input
              type="checkbox"
              checked={showCold}
              onChange={(e) => setShowCold(e.target.checked)}
              className="accent-accent-500"
            />
            Show cold
          </label>
        )}
        {keywords.length > 1 && (
          <select
            value={keywordFilter}
            onChange={(e) => setKeywordFilter(e.target.value)}
            className="ml-2 text-xs rounded-md bg-ink-800/70 border border-ink-700 px-2 py-1 text-ink-200"
          >
            <option value="">All keywords</option>
            {keywords.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, copy, domain…"
          className="ml-auto text-xs rounded-md bg-ink-800/70 border border-ink-700 px-2.5 py-1 placeholder-ink-500 text-ink-100 focus:border-accent-500 focus:outline-none w-56"
        />
        <div className="text-xs text-ink-500 tabular">
          {filtered.length.toLocaleString()} / {leads.length.toLocaleString()} shown
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ink-900/60 backdrop-blur sticky top-0 z-10">
            <tr className="text-left text-[10px] uppercase tracking-widest text-ink-500">
              <Th col="relevance_score" sort={sort} onSort={sortBy}>Relevance</Th>
              <Th col="page_name" sort={sort} onSort={sortBy}>Page</Th>
              <Th col="keyword" sort={sort} onSort={sortBy}>Keyword</Th>
              <Th col="advertiser_category" sort={sort} onSort={sortBy}>Category</Th>
              <Th col="company_total_ads" sort={sort} onSort={sortBy} className="text-right">Ads</Th>
              <Th col="days_running" sort={sort} onSort={sortBy} className="text-right">Days</Th>
              <Th col="fb_followers" sort={sort} onSort={sortBy} className="text-right">FB</Th>
              <Th col="ig_followers" sort={sort} onSort={sortBy} className="text-right">IG</Th>
              <th className="px-3 py-2 font-medium">Platforms</th>
              <th className="px-3 py-2 font-medium">CTA · Headline</th>
              <th className="px-3 py-2 font-medium">Domain</th>
              <th className="px-3 py-2 font-medium text-right">Links</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {filtered.map(lead => (
                <motion.tr
                  key={lead.library_id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="border-t border-ink-800/60 hover:bg-ink-800/30 transition-colors"
                >
                  <td className="px-3 py-2.5"><RelevanceBadge lead={lead} /></td>
                  <td className="px-3 py-2.5 max-w-[220px]">
                    <div className="font-medium text-ink-100 truncate">{lead.page_name || '—'}</div>
                    {lead.partner_name && (
                      <div className="text-[11px] text-ink-500 truncate">with {lead.partner_name}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-ink-800/80 text-ink-300">{lead.keyword}</span>
                  </td>
                  <td className="px-3 py-2.5 text-ink-300 max-w-[150px] truncate">
                    <CellEnrichable value={lead.advertiser_category} status={lead.enrichment_status}>
                      {lead.advertiser_category || <span className="text-ink-600">—</span>}
                    </CellEnrichable>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular text-ink-200">
                    {lead.company_total_ads || 1}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular text-ink-300">
                    {lead.days_running ?? <span className="text-ink-600">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular" title={lead.fb_followers ? lead.fb_followers.toLocaleString() : ''}>
                    <CellEnrichable value={lead.fb_followers} status={lead.enrichment_status}>
                      {lead.fb_followers != null ? formatFollowers(lead.fb_followers) : <span className="text-ink-600">—</span>}
                    </CellEnrichable>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular" title={lead.ig_followers ? lead.ig_followers.toLocaleString() : ''}>
                    <CellEnrichable value={lead.ig_followers} status={lead.enrichment_status}>
                      {lead.ig_followers != null ? formatFollowers(lead.ig_followers) : <span className="text-ink-600">—</span>}
                    </CellEnrichable>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1">
                      {(lead.platforms || []).map(p => (
                        <span
                          key={p}
                          title={p}
                          className="text-[10px] tabular w-6 h-5 rounded bg-ink-800/80 border border-ink-700 text-ink-300 inline-flex items-center justify-center"
                        >
                          {PLATFORM_GLYPH[p] || p[0]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 max-w-[280px]">
                    <div className="text-xs text-accent-300/90">{lead.cta || '—'}</div>
                    <div className="text-xs text-ink-400 truncate" title={lead.headline}>
                      {lead.headline || lead.ad_text_snippet?.slice(0, 80) || ''}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 max-w-[160px]">
                    <div className="text-xs text-ink-300 truncate" title={lead.destination_url}>
                      {lead.display_domain || (lead.destination_url ? safeHost(lead.destination_url) : '—')}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {lead.ad_snapshot_url && (
                        <LinkBtn href={lead.ad_snapshot_url} title="Ad snapshot">⎘</LinkBtn>
                      )}
                      {lead.page_url && (
                        <LinkBtn href={lead.page_url} title="Page">FB</LinkBtn>
                      )}
                      {lead.destination_url && (
                        <LinkBtn href={lead.destination_url} title="Destination">↗</LinkBtn>
                      )}
                    </div>
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="px-6 py-16 text-center text-ink-500 text-sm">
            {leads.length === 0 ? 'No leads yet — Start a session to populate the table.' : 'No leads match the current filters.'}
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children, col, sort, onSort, className = '' }) {
  const active = sort.col === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-3 py-2 font-medium cursor-pointer select-none whitespace-nowrap ${className} ${active ? 'text-ink-200' : 'hover:text-ink-300'}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active && <span className="text-[10px]">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
      </span>
    </th>
  );
}

function LinkBtn({ href, title, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-ink-700 text-[10px] text-ink-400 hover:text-accent-200 hover:border-accent-500/50 hover:bg-accent-500/10 transition-colors"
    >
      {children}
    </a>
  );
}

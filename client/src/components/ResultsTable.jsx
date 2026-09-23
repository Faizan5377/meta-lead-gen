import { ExternalLink, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatFollowers, safeHost } from '../lib/format.js';

const PLATFORM_ICON = {
  Facebook: 'f', Instagram: 'ig', Messenger: 'm', Threads: '@',
  'Audience Network': 'an', WhatsApp: 'wa',
};

function Platforms({ list }) {
  const arr = Array.isArray(list) ? list : [];
  if (!arr.length) return <span className="text-slate-300 dark:text-slate-600">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {arr.map((p) => (
        <span key={p} title={p}
          className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-1 py-px text-[9px] font-semibold uppercase text-slate-500 dark:text-slate-400">
          {PLATFORM_ICON[p] || p.slice(0, 2)}
        </span>
      ))}
    </div>
  );
}

// Both platforms in one column, each ALWAYS shown with a dash when missing.
// Two separate columns wasted horizontal space, and hiding a missing value made
// it look like the figure didn't exist rather than simply not being fetched —
// Instagram counts aren't in Meta's feed, so they're blank unless the optional
// advertiser-details enrichment ran.
function Followers({ fb, ig }) {
  const Row = ({ label, value, tone, hint }) => (
    <div className="flex items-baseline justify-end gap-1.5 leading-tight" title={hint}>
      <span className={`text-[9px] font-semibold uppercase ${tone}`}>{label}</span>
      {value != null
        ? <span className="tabular text-slate-700 dark:text-slate-200">{formatFollowers(value)}</span>
        : <span className="text-slate-300 dark:text-slate-600">—</span>}
    </div>
  );
  return (
    <div className="space-y-0.5 text-right text-xs">
      <Row label="fb" value={fb} tone="text-blue-500"
        hint={fb != null ? `Facebook: ${Number(fb).toLocaleString()} followers` : 'No Facebook follower count for this page'} />
      <Row label="ig" value={ig} tone="text-pink-500"
        hint={ig != null ? `Instagram: ${Number(ig).toLocaleString()} followers` : 'This advertiser has no linked Instagram account'} />
    </div>
  );
}

// Days running is the headline signal: a long-running ad is a proven ad.
function Duration({ days }) {
  if (days == null) return <span className="text-slate-300 dark:text-slate-600">—</span>;
  const n = Number(days);
  const tone = n >= 365 ? 'text-brand-700 dark:text-brand-300 font-semibold'
    : n >= 90 ? 'text-brand-600 dark:text-brand-400 font-medium' : 'text-slate-600 dark:text-slate-300';
  const label = n >= 365 ? `${(n / 365).toFixed(1)}y` : n >= 30 ? `${Math.round(n / 30)}mo` : `${n}d`;
  return <span className={`tabular ${tone}`} title={`${n} days`}>{label}</span>;
}

const COLS = [
  { key: 'page_name', label: 'Business', sortable: true },
  { key: 'days_running', label: 'Running', sortable: true, align: 'right' },
  { key: 'ads_running', label: 'Ads', sortable: true, align: 'right' },
  { key: 'platforms', label: 'Platforms' },
  { key: 'followers_facebook', label: 'Followers', sortable: true, align: 'right' },
  { key: 'page_categories', label: 'Category' },
  { key: 'is_active', label: 'Status' },
  { key: 'keyword', label: 'Keyword', sortable: true },
  { key: 'country', label: 'Country' },
  { key: 'relevance_score', label: 'Match', sortable: true, align: 'right' },
  { key: 'links', label: 'Open', align: 'right' },
];

export default function ResultsTable({ businesses, compact = false }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ col: 'days_running', dir: 'desc' });

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    let arr = businesses;
    if (s) {
      arr = arr.filter((b) =>
        `${b.page_name || ''} ${(b.page_categories || []).join(' ')} ${b.display_domain || ''} ${b.country || ''} ${(b.keywords || [b.keyword]).join(' ')} ${b.title || ''}`
          .toLowerCase().includes(s));
    }
    return arr.slice().sort((a, b) => {
      let av = a[sort.col], bv = b[sort.col];
      if (Array.isArray(av)) av = av.length;
      if (Array.isArray(bv)) bv = bv.length;
      if (av == null) av = sort.dir === 'asc' ? Infinity : -Infinity;
      if (bv == null) bv = sort.dir === 'asc' ? Infinity : -Infinity;
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [businesses, q, sort]);

  const setSortCol = (col) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' }));

  return (
    <div className={`overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ${compact ? '' : 'shadow-sm'}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 dark:border-slate-800 px-4 py-3">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search business, category, domain…"
            className="w-72 rounded-xl border border-slate-200 dark:border-slate-700 py-1.5 pl-8 pr-3 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900"
          />
        </div>
        <div className="ml-auto text-xs tabular text-slate-400 dark:text-slate-500">
          {rows.length.toLocaleString()} / {businesses.length.toLocaleString()} shown
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
            <tr>
              {COLS.map((c) => (
                <th key={c.key}
                  onClick={() => c.sortable && setSortCol(c.key)}
                  className={`whitespace-nowrap px-3 py-2 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.sortable ? 'cursor-pointer select-none hover:text-slate-600' : ''}`}>
                  {c.label}{sort.col === c.key && <span className="ml-0.5">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((b) => (
              <tr key={b.library_id} className="row-in align-top hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                <td className="max-w-[230px] px-3 py-2.5">
                  <div className="truncate font-medium text-slate-800 dark:text-slate-100" title={b.page_name}>{b.page_name || '—'}</div>
                  {b.display_domain && <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">{b.display_domain}</div>}
                </td>
                <td className="px-3 py-2.5 text-right"><Duration days={b.days_running} /></td>
                <td className="px-3 py-2.5 text-right tabular text-slate-600 dark:text-slate-300">
                  {Number(b.ads_running) > 1
                    ? <span className="rounded bg-brand-50 dark:bg-brand-950/40 px-1.5 py-0.5 font-medium text-brand-700 dark:text-brand-300">{b.ads_running}</span>
                    : (b.ads_running ?? 1)}
                </td>
                <td className="px-3 py-2.5"><Platforms list={b.platforms} /></td>
                <td className="px-3 py-2.5"><Followers fb={b.followers_facebook} ig={b.followers_instagram} /></td>
                <td className="max-w-[150px] px-3 py-2.5">
                  <span className="truncate text-slate-600 dark:text-slate-300" title={(b.page_categories || []).join(', ')}>
                    {(b.page_categories || [])[0] || <span className="text-slate-300 dark:text-slate-600">—</span>}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  {b.is_active
                    ? <span className="rounded-full bg-green-100 dark:bg-green-950/50 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:text-green-400">Active</span>
                    : <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">Inactive</span>}
                </td>
                <td className="max-w-[120px] px-3 py-2.5">
                  {b.keyword ? (
                    <span className="inline-block max-w-full truncate rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-600 dark:text-slate-300"
                      title={(b.keywords || [b.keyword]).join(', ')}>
                      {b.keyword}
                      {b.keywords?.length > 1 && <span className="text-slate-400 dark:text-slate-500"> +{b.keywords.length - 1}</span>}
                    </span>
                  ) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                </td>
                <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{b.country || '—'}</td>
                <td className="px-3 py-2.5 text-right">
                  {b.relevance_score != null ? (
                    <span className="tabular text-[11px] text-slate-500 dark:text-slate-400" title={b.relevance_reason || ''}>
                      {b.relevance_score}
                    </span>
                  ) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    {(b.ad_url || b.library_id) && (
                      <a href={b.ad_url || `https://www.facebook.com/ads/library/?id=${b.library_id}`}
                        target="_blank" rel="noreferrer" title="Open this ad in the Meta Ad Library"
                        className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400 hover:border-brand-300 hover:text-brand-600">
                        Ad <ExternalLink size={9} />
                      </a>
                    )}
                    {b.page_url && (
                      <a href={b.page_url} target="_blank" rel="noreferrer" title="Facebook page"
                        className="rounded border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400 hover:border-brand-300 hover:text-brand-600">
                        FB
                      </a>
                    )}
                    {b.link_url && (
                      <a href={b.link_url} target="_blank" rel="noreferrer" title={`Destination: ${safeHost(b.link_url)}`}
                        className="rounded border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400 hover:border-brand-300 hover:text-brand-600">
                        ↗
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="px-6 py-12 text-center text-sm text-slate-400 dark:text-slate-500">
            {businesses.length === 0 ? 'No ads yet.' : 'No rows match your search.'}
          </div>
        )}
      </div>
    </div>
  );
}

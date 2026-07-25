import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatFollowers, safeHost } from '../lib/format.js';

function ActiveBadge({ active }) {
  return active
    ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">Active</span>
    : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Inactive</span>;
}

function Contact({ status, value, kind }) {
  if (status === 'pending') return <span className="inline-block h-3 w-16 shimmer" />;
  if (!value) return <span className="text-slate-300">—</span>;
  if (kind === 'email') return <a href={`mailto:${value}`} className="text-brand-600 hover:underline" title={value}>{value}</a>;
  if (kind === 'phone') return <a href={`tel:${value}`} className="tabular text-slate-700 hover:text-brand-600" title={value}>{value}</a>;
  return <a href={value} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline" title={value}>{safeHost(value)}</a>;
}

function Owner({ b }) {
  if (b.google_status === 'pending') return <span className="inline-block h-3 w-20 shimmer" />;
  if (b.owner_name) {
    return (
      <div>
        <div className="font-medium text-slate-800">{b.owner_name}</div>
        {b.owner_title && <div className="text-[11px] text-slate-400">{b.owner_title}</div>}
      </div>
    );
  }
  if (b.google_status === 'blocked') return <span className="text-[11px] text-amber-500" title="Search engine blocked the lookup">blocked</span>;
  return <span className="text-slate-300">—</span>;
}

const COLS = [
  { key: 'page_name', label: 'Business', sortable: true },
  { key: 'followers', label: 'Followers', sortable: true, align: 'right' },
  { key: 'page_categories', label: 'Category' },
  { key: 'keyword', label: 'Keyword', sortable: true },
  { key: 'country', label: 'Country' },
  { key: 'is_active', label: 'Status' },
  { key: 'days_running', label: 'Days', sortable: true, align: 'right' },
  { key: 'owner', label: 'Owner' },
  { key: 'contact_email', label: 'Email' },
  { key: 'contact_phone', label: 'Phone' },
  { key: 'contact_website', label: 'Website' },
  { key: 'cta_text', label: 'CTA' },
  { key: 'display_format', label: 'Format' },
  { key: 'links', label: 'Links', align: 'right' },
];

export default function ResultsTable({ businesses }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ col: 'followers', dir: 'desc' });

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    let arr = businesses;
    if (s) {
      arr = arr.filter(b =>
        `${b.page_name || ''} ${b.owner_name || ''} ${(b.page_categories || []).join(' ')} ${b.contact_email || ''} ${b.display_domain || ''} ${b.country || ''} ${(b.keywords || [b.keyword]).join(' ')}`
          .toLowerCase().includes(s));
    }
    arr = arr.slice().sort((a, b) => {
      let av = a[sort.col], bv = b[sort.col];
      if (av == null) av = sort.dir === 'asc' ? Infinity : -Infinity;
      if (bv == null) bv = sort.dir === 'asc' ? Infinity : -Infinity;
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [businesses, q, sort]);

  const setSortCol = (col) => setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' });

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search business, owner, category, email…"
            className="w-72 rounded-xl border border-slate-200 py-1.5 pl-8 pr-3 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </div>
        <div className="ml-auto text-xs tabular text-slate-400">{rows.length.toLocaleString()} / {businesses.length.toLocaleString()} shown</div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              {COLS.map(c => (
                <th
                  key={c.key}
                  onClick={() => c.sortable && setSortCol(c.key)}
                  className={`whitespace-nowrap px-3 py-2 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.sortable ? 'cursor-pointer select-none hover:text-slate-600' : ''}`}
                >
                  {c.label}{sort.col === c.key && <span className="ml-0.5">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(b => (
              <tr key={b.library_id} className="row-in align-top hover:bg-slate-50/70">
                <td className="max-w-[200px] px-3 py-2.5">
                  <div className="truncate font-medium text-slate-800" title={b.page_name}>{b.page_name || '—'}</div>
                  {b.display_domain && <div className="truncate text-[11px] text-slate-400">{b.display_domain}</div>}
                </td>
                <td className="px-3 py-2.5 text-right tabular text-slate-700" title={b.followers?.toLocaleString()}>
                  {b.followers != null ? formatFollowers(b.followers) : <span className="text-slate-300">—</span>}
                </td>
                <td className="max-w-[140px] px-3 py-2.5">
                  <span className="truncate text-slate-600" title={(b.page_categories || []).join(', ')}>{(b.page_categories || [])[0] || <span className="text-slate-300">—</span>}</span>
                </td>
                <td className="max-w-[130px] px-3 py-2.5">
                  {b.keyword ? (
                    <span
                      className="inline-block max-w-full truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
                      title={(b.keywords || [b.keyword]).join(', ')}
                    >
                      {b.keyword}
                      {b.keywords?.length > 1 && <span className="text-slate-400"> +{b.keywords.length - 1}</span>}
                    </span>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-slate-600">{b.country || '—'}</td>
                <td className="px-3 py-2.5"><ActiveBadge active={b.is_active} /></td>
                <td className="px-3 py-2.5 text-right tabular text-slate-600">{b.days_running ?? <span className="text-slate-300">—</span>}</td>
                <td className="max-w-[160px] px-3 py-2.5"><Owner b={b} /></td>
                <td className="max-w-[190px] truncate px-3 py-2.5"><Contact status={b.contact_status} value={b.contact_email} kind="email" /></td>
                <td className="max-w-[140px] truncate px-3 py-2.5"><Contact status={b.contact_status} value={b.contact_phone} kind="phone" /></td>
                <td className="max-w-[150px] truncate px-3 py-2.5"><Contact status={b.contact_status} value={b.contact_website} kind="website" /></td>
                <td className="max-w-[120px] truncate px-3 py-2.5 text-slate-600" title={b.cta_text}>{b.cta_text || <span className="text-slate-300">—</span>}</td>
                <td className="px-3 py-2.5 text-[11px] text-slate-500">{b.display_format || '—'}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    {b.ad_snapshot_url || b.library_id ? (
                      <a href={b.ad_snapshot_url || `https://www.facebook.com/ads/library/?id=${b.library_id}`} target="_blank" rel="noreferrer" title="Ad in Library" className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-brand-300 hover:text-brand-600">Ad</a>
                    ) : null}
                    {b.page_url && <a href={b.page_url} target="_blank" rel="noreferrer" title="Facebook page" className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-brand-300 hover:text-brand-600">FB</a>}
                    {b.link_url && <a href={b.link_url} target="_blank" rel="noreferrer" title="Destination" className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-brand-300 hover:text-brand-600">↗</a>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="px-6 py-14 text-center text-sm text-slate-400">
            {businesses.length === 0 ? 'No businesses yet — start a search to populate the table.' : 'No rows match your search.'}
          </div>
        )}
      </div>
    </div>
  );
}

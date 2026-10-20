import { ExternalLink, Mail, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isComplete } from '../lib/lead.js';

// One table for both scrapers.
//
// The two used to have their own tables with their own columns, which made the
// lists impossible to compare and easy to drift apart. The columns here are
// exactly the CSV's, so what you see is what you export.

const COLS = [
  { key: 'business_name', label: 'Business', sortable: true },
  { key: 'website', label: 'Website' },
  { key: 'business_phone', label: 'Business Phone' },
  { key: 'contact', label: 'Decision Maker', sortable: true, sortKey: 'last_name' },
  { key: 'designation', label: 'Designation', sortable: true },
  { key: 'owner_email', label: 'Owner Email', sortable: true },
  { key: 'owner_phone', label: 'Owner Phone' },
  { key: 'category', label: 'Category' },
  { key: 'city', label: 'City', sortable: true },
  { key: 'links', label: '', align: 'right' },
];

const Dash = () => <span className="text-slate-300 dark:text-slate-600">—</span>;

// Owner outranks CEO outranks President outranks VP — colour follows seniority
// so a list can be skimmed for the best contacts.
const TIER_STYLE = {
  Owner: 'bg-brand-100 text-brand-800 dark:bg-brand-950/60 dark:text-brand-300',
  CEO: 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400',
  President: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  'Vice President': 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

const host = (url) => String(url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

export default function LeadsTable({ leads, compact = false }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ col: 'business_name', dir: 'asc' });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let arr = leads;
    if (needle) {
      arr = arr.filter((l) => `${l.business_name} ${l.website} ${l.owner_email} ${l.first_name} ${l.last_name} ${l.category} ${l.city}`
        .toLowerCase().includes(needle));
    }
    const key = COLS.find((c) => c.key === sort.col)?.sortKey || sort.col;
    return arr.slice().sort((a, b) => {
      // Contactable leads always float above incomplete ones.
      const done = Number(isComplete(b)) - Number(isComplete(a));
      if (done) return done;
      const av = a[key] ?? '';
      const bv = b[key] ?? '';
      const c = typeof av === 'number' && typeof bv === 'number'
        ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? c : -c;
    });
  }, [leads, q, sort]);

  const withEmail = leads.filter(isComplete).length;

  return (
    <div className={`overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 ${compact ? '' : 'shadow-sm'}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search business, email, city…"
            className="w-72 rounded-xl border border-slate-200 py-1.5 pl-8 pr-3 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-brand-900"
          />
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs tabular text-slate-400 dark:text-slate-500">
          <span className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400">
            <Mail size={12} /> {withEmail.toLocaleString()} contactable
          </span>
          <span>{rows.length.toLocaleString()} / {leads.length.toLocaleString()} shown</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400 dark:bg-slate-800 dark:text-slate-500">
            <tr>
              {COLS.map((c) => (
                <th key={c.key}
                  onClick={() => c.sortable && setSort((s) => (s.col === c.key
                    ? { col: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                    : { col: c.key, dir: 'asc' }))}
                  className={`whitespace-nowrap px-3 py-2 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.sortable ? 'cursor-pointer select-none hover:text-slate-600' : ''}`}>
                  {c.label}{sort.col === c.key && <span className="ml-0.5">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((l) => (
              <tr key={l._key || l.owner_email || l.business_name}
                className="row-in align-top hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                <td className="max-w-[220px] px-3 py-2.5">
                  <div className="truncate font-medium text-slate-800 dark:text-slate-100" title={l.business_name}>
                    {l.business_name || <Dash />}
                  </div>
                  <div className="text-[11px] text-slate-400 dark:text-slate-500">{l.source}</div>
                </td>
                <td className="max-w-[160px] px-3 py-2.5">
                  {l.website ? (
                    <a href={l.website.startsWith('http') ? l.website : `https://${l.website}`}
                      target="_blank" rel="noreferrer"
                      className="block truncate text-[12px] text-slate-600 hover:text-brand-600 dark:text-slate-300"
                      title={l.website}>{host(l.website)}</a>
                  ) : <Dash />}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular text-[12px] text-slate-600 dark:text-slate-300">
                  {l.business_phone || <Dash />}
                </td>
                <td className="max-w-[160px] px-3 py-2.5">
                  {l.first_name || l.last_name ? (
                    <>
                      <div className="truncate font-medium text-slate-700 dark:text-slate-200">
                        {`${l.first_name} ${l.last_name}`.trim()}
                      </div>
                      {l.position && (
                        <div className="truncate text-[11px] text-slate-400 dark:text-slate-500" title={l.position}>
                          {l.position}
                        </div>
                      )}
                    </>
                  ) : <Dash />}
                </td>
                <td className="px-3 py-2.5">
                  {l.designation ? (
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${TIER_STYLE[l.designation] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                      {l.designation}
                    </span>
                  ) : <Dash />}
                </td>
                <td className="max-w-[210px] px-3 py-2.5">
                  {l.owner_email ? (
                    <a href={`mailto:${l.owner_email}`}
                      className="block truncate text-[12px] font-medium text-brand-700 hover:underline dark:text-brand-400"
                      title={l.email_confidence ? `Hunter confidence ${l.email_confidence}%` : l.owner_email}>
                      {l.owner_email}
                    </a>
                  ) : <Dash />}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular text-[12px] text-slate-600 dark:text-slate-300">
                  {l.owner_phone || <Dash />}
                </td>
                <td className="max-w-[140px] px-3 py-2.5">
                  <span className="block truncate text-[12px] text-slate-600 dark:text-slate-300" title={l.category}>
                    {l.category || <Dash />}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-[12px] text-slate-600 dark:text-slate-300">
                  {l.city || <Dash />}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    {l._maps_url && (
                      <a href={l._maps_url} target="_blank" rel="noreferrer" title="Google Maps listing"
                        className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:text-slate-400">
                        Maps
                      </a>
                    )}
                    {l._ad_url && (
                      <a href={l._ad_url} target="_blank" rel="noreferrer" title="Open this ad in the Meta Ad Library"
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:text-slate-400">
                        Ad <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
            No leads yet.
          </div>
        )}
      </div>
    </div>
  );
}

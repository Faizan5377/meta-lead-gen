// Single CSV export — every business from this run with all its data. One row
// per business (which is already one ad per business).

import { adSnapshotUrl } from './urlBuilder.js';

const COLUMNS = [
  'page_name', 'owner_name', 'owner_title', 'owner_details', 'google_status',
  'contact_email', 'contact_phone', 'contact_website', 'contact_status',
  'followers', 'page_categories', 'country', 'keyword',
  'library_id', 'page_id', 'page_url', 'ad_snapshot_url',
  'is_active', 'start_date', 'end_date', 'days_running', 'collation_count',
  'display_format', 'cta_text', 'cta_type', 'title', 'body_text',
  'link_url', 'display_domain', 'image_url', 'video_url',
];

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) v = v.join('; ');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportRun(run) {
  const keyword = run.filters?.keyword || '';
  const rows = run.businesses.slice().sort((a, b) => (b.days_running || 0) - (a.days_running || 0));
  const lines = [COLUMNS.join(',')];
  for (const b of rows) {
    const rec = { ...b, keyword: b.keyword || keyword, ad_snapshot_url: adSnapshotUrl(b.library_id) };
    lines.push(COLUMNS.map(c => csvEscape(rec[c])).join(','));
  }
  return '﻿' + lines.join('\n'); // BOM so Excel/Sheets read UTF-8 cleanly
}

export function csvFilename(run) {
  const stamp = (run.finishedAt || run.createdAt || '').replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const kw = (run.filters?.keyword || 'leads').replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
  return `meta-ads_${kw}_${stamp || 'export'}.csv`;
}

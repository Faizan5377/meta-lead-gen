// Single CSV export — every business from the run with all its data.
// One row per business (which is already one ad per business).
//
// Formatting rules (so the file opens cleanly in Excel / Sheets / pandas):
//   • UTF-8 with a BOM
//   • CRLF line endings (RFC 4180)
//   • every field is sanitised to a single line — embedded newlines/tabs become
//     spaces, so one record is always exactly one line
//   • quotes only where needed, doubled inside quoted fields
//   • a leading ' is prefixed to values Excel would otherwise treat as a formula

import { adSnapshotUrl } from './urlBuilder.js';

const COLUMNS = [
  'page_name', 'owner_name', 'owner_title', 'owner_source', 'google_status',
  'contact_email', 'contact_phone', 'contact_website', 'contact_status',
  'followers', 'page_categories', 'country', 'keyword', 'keywords_matched',
  'library_id', 'page_id', 'page_url', 'ad_snapshot_url',
  'is_active', 'start_date', 'end_date', 'days_running', 'collation_count',
  'display_format', 'cta_text', 'cta_type', 'title', 'body_text',
  'link_url', 'display_domain', 'image_url', 'video_url',
];

// Human-friendly headers for the first row.
const HEADERS = {
  page_name: 'Business', owner_name: 'Owner', owner_title: 'Owner Title',
  owner_source: 'Owner Source', google_status: 'Owner Lookup',
  contact_email: 'Email', contact_phone: 'Phone', contact_website: 'Website',
  contact_status: 'Contact Lookup', followers: 'Followers',
  page_categories: 'Categories', country: 'Country', keyword: 'Keyword',
  keywords_matched: 'All Keywords', library_id: 'Ad Library ID', page_id: 'Page ID',
  page_url: 'Facebook Page', ad_snapshot_url: 'Ad Link', is_active: 'Active',
  start_date: 'Started', end_date: 'Ended', days_running: 'Days Running',
  collation_count: 'Ad Variants', display_format: 'Format', cta_text: 'CTA',
  cta_type: 'CTA Type', title: 'Headline', body_text: 'Ad Text',
  link_url: 'Destination URL', display_domain: 'Domain',
  image_url: 'Image URL', video_url: 'Video URL',
};

// Built from strings so no literal control characters live in this source file.
// Line/paragraph separators and every C0/C1 control char collapse to a space.
const WHITESPACE_RE = new RegExp('[\\r\\n\\t\\v\\f\\u0085\\u2028\\u2029]+', 'g');
const CONTROL_RE = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g');
const BOM = '﻿';

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) v = v.filter(Boolean).join('; ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';

  // Collapse anything that would push a record onto a second line.
  let s = String(v)
    .replace(WHITESPACE_RE, ' ')
    .replace(CONTROL_RE, '')
    .replace(/ {2,}/g, ' ')
    .trim();

  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@]/.test(s)) s = "'" + s;

  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportRun(run) {
  const fallbackKeyword = (run.filters?.keywords || []).join('; ') || run.filters?.keyword || '';
  const rows = run.businesses
    .slice()
    .sort((a, b) => (b.days_running || 0) - (a.days_running || 0));

  const lines = [COLUMNS.map((c) => csvEscape(HEADERS[c] || c)).join(',')];
  for (const b of rows) {
    const rec = {
      ...b,
      keyword: b.keyword || fallbackKeyword,
      keywords_matched: Array.isArray(b.keywords) && b.keywords.length
        ? b.keywords
        : (b.keyword || fallbackKeyword),
      ad_snapshot_url: b.library_id ? adSnapshotUrl(b.library_id) : null,
    };
    lines.push(COLUMNS.map((c) => csvEscape(rec[c])).join(','));
  }
  // BOM + CRLF so Excel detects UTF-8 and every record stays on one line.
  return BOM + lines.join('\r\n') + '\r\n';
}

export function csvFilename(run) {
  const stamp = (run.finishedAt || run.createdAt || '')
    .replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const kws = run.filters?.keywords?.length ? run.filters.keywords : [run.filters?.keyword || 'leads'];
  const kw = kws.join('-').replace(/[^a-z0-9]+/gi, '_').slice(0, 40).replace(/^_|_$/g, '');
  return `meta-ads_${kw || 'leads'}_${stamp || 'export'}.csv`;
}

// CSV export — for a single run, or for any filtered slice of the library.
//
// Formatting rules (so the file opens cleanly in Excel / Sheets / pandas):
//   • UTF-8 with a BOM
//   • CRLF line endings (RFC 4180)
//   • every field sanitised to a single line — embedded newlines/tabs become
//     spaces, so one record is always exactly one row
//   • quotes only where needed, doubled inside quoted fields
//   • a leading ' on values Excel would otherwise treat as a formula

const COLUMNS = [
  'page_name', 'ad_url', 'page_url', 'days_running', 'start_date', 'is_active',
  'ads_running', 'platforms', 'followers_facebook', 'followers_instagram',
  'instagram_handle', 'page_categories', 'country', 'keyword', 'keywords_matched',
  'relevance_score', 'relevance_reason',
  'title', 'body_text', 'cta_text', 'link_url', 'display_domain', 'display_format',
  'end_date', 'image_url', 'video_url', 'library_id', 'page_id',
];

const HEADERS = {
  page_name: 'Business', ad_url: 'Ad URL', page_url: 'Facebook Page',
  days_running: 'Days Running', start_date: 'Started', is_active: 'Active',
  ads_running: 'Ads Running', platforms: 'Platforms',
  followers_facebook: 'Facebook Followers', followers_instagram: 'Instagram Followers',
  instagram_handle: 'Instagram Handle', page_categories: 'Categories',
  country: 'Country', keyword: 'Keyword', keywords_matched: 'All Keywords',
  relevance_score: 'Relevance', relevance_reason: 'Relevance Reason',
  title: 'Headline', body_text: 'Ad Text', cta_text: 'CTA',
  link_url: 'Destination URL', display_domain: 'Domain', display_format: 'Format',
  end_date: 'Ended', image_url: 'Image URL', video_url: 'Video URL',
  library_id: 'Ad Library ID', page_id: 'Page ID',
};

// Built from strings so no literal control characters live in this source file.
const WHITESPACE_RE = new RegExp('[\\r\\n\\t\\v\\f\\u0085\\u2028\\u2029]+', 'g');
const CONTROL_RE = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g');
const BOM = '﻿';

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) v = v.filter(Boolean).join('; ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';

  let s = String(v)
    .replace(WHITESPACE_RE, ' ')
    .replace(CONTROL_RE, '')
    .replace(/ {2,}/g, ' ')
    .trim();

  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toRows(businesses, fallbackKeyword = '') {
  return businesses.slice().sort((a, b) => (b.days_running || 0) - (a.days_running || 0))
    .map((b) => ({
      ...b,
      keyword: b.keyword || fallbackKeyword,
      keywords_matched: Array.isArray(b.keywords) && b.keywords.length
        ? b.keywords
        : (b.keyword || fallbackKeyword),
      is_active: b.is_active === true || b.is_active === '1' || b.is_active === 1,
    }));
}

function render(rows) {
  const lines = [COLUMNS.map((c) => csvEscape(HEADERS[c] || c)).join(',')];
  for (const rec of rows) lines.push(COLUMNS.map((c) => csvEscape(rec[c])).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}

export function exportRun(run) {
  const fallback = (run.filters?.keywords || []).join('; ') || run.filters?.keyword || '';
  return render(toRows(run.businesses, fallback));
}

// Any filtered slice of the library, straight from a query result.
export function exportRows(rows) {
  return render(toRows(rows));
}

function stamp(iso) {
  return String(iso || '').replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

export function csvFilename(run) {
  const kws = run.filters?.keywords?.length ? run.filters.keywords : [run.filters?.keyword || 'ads'];
  const kw = kws.join('-').replace(/[^a-z0-9]+/gi, '_').slice(0, 40).replace(/^_|_$/g, '');
  return `meta-ads_${kw || 'ads'}_${stamp(run.finishedAt || run.createdAt) || 'export'}.csv`;
}

export function libraryFilename() {
  return `meta-ads_library_${stamp(new Date().toISOString())}.csv`;
}

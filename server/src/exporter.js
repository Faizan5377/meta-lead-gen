// CSV export.
//
// One column set for everything — Ad Library leads, Maps leads, a single run or
// a whole library slice — defined once in leadSchema.js. Two scrapers that
// exported different columns could not be stacked into one outreach list, and
// the headers here are the ones the Ventix Outreach importer auto-detects, so a
// file from this app loads into a campaign with no mapping step.
//
// Formatting rules (so the file opens cleanly in Excel / Sheets / pandas):
//   • UTF-8 with a BOM
//   • CRLF line endings (RFC 4180)
//   • every field sanitised to a single line — embedded newlines/tabs become
//     spaces, so one record is always exactly one row
//   • quotes only where needed, doubled inside quoted fields
//   • a leading ' on values Excel would otherwise treat as a formula

import { LEAD_COLUMNS, LEAD_HEADERS, fromMetaBusiness, fromPlace, isComplete, withDecisionMaker } from './leadSchema.js';
import { store } from './store.js';

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

  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function render(leads) {
  const lines = [LEAD_COLUMNS.map((c) => csvEscape(LEAD_HEADERS[c])).join(',')];
  for (const l of leads) lines.push(LEAD_COLUMNS.map((c) => csvEscape(l[c])).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}

// A stored record already carries the enrichment fields; a live one may carry
// them under the same names. Either way the decision maker is folded back on so
// a library export matches what the run produced.
const contactOf = (r) => (r.owner_email ? {
  email: r.owner_email,
  first_name: r.first_name,
  last_name: r.last_name,
  position: r.position,
  confidence: r.email_confidence,
  tier_label: r.designation,
} : null);

export const metaLead = (b) => withDecisionMaker(fromMetaBusiness(b), contactOf(b));
export const placeLead = (p) => withDecisionMaker(fromPlace(p), contactOf(p));

// Contactable leads first, then by business name, so the useful rows are at the
// top of the file even when incomplete ones are included.
const order = (leads) => leads.slice().sort((a, b) =>
  Number(isComplete(b)) - Number(isComplete(a))
  || String(a.business_name).localeCompare(String(b.business_name)));

export function exportRun(run) {
  // store.keptBusinesses, not run.businesses: the array also holds candidates
  // that were never confirmed, and a CSV is exactly where one must not appear.
  return render(order(store.keptBusinesses(run).map(metaLead)));
}

// Any filtered slice of the library, straight from a query result.
export const exportRows = (rows) => render(order(rows.map(metaLead)));
export const exportPlaces = (rows) => render(order(rows.map(placeLead)));

function stamp(iso) {
  return String(iso || '').replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

export function csvFilename(run) {
  const kws = run.filters?.keywords?.length ? run.filters.keywords : [run.filters?.keyword || 'ads'];
  const kw = kws.join('-').replace(/[^a-z0-9]+/gi, '_').slice(0, 40).replace(/^_|_$/g, '');
  return `leads_meta_${kw || 'ads'}_${stamp(run.finishedAt || run.createdAt) || 'export'}.csv`;
}

export function libraryFilename() {
  return `leads_library_${stamp(new Date().toISOString())}.csv`;
}

export function placesFilename(run) {
  const q = (run?.filters?.queries || ['places']).join('-').replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
  return `leads_maps_${q || 'places'}_${stamp(run?.finishedAt || new Date().toISOString())}.csv`;
}

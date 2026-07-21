// Pure helpers — followers/dates/link decoding/slug extraction.

export function parseFollowers(raw) {
  if (!raw) return null;
  const m = String(raw).replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  const suffix = (m[2] || '').toUpperCase();
  const mult = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[suffix] || 1;
  return Math.round(n * mult);
}

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

export function parseStartDate(raw) {
  if (!raw) return null;
  // "Started running on 24 Apr 2025" or "Started running on Apr 24, 2025"
  const cleaned = raw.replace(/^Started running on\s*/i, '').trim();
  // Try "DD MMM YYYY"
  let m = cleaned.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo !== undefined) return iso(parseInt(m[3]), mo, parseInt(m[1]));
  }
  // Try "MMM DD, YYYY"
  m = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo !== undefined) return iso(parseInt(m[3]), mo, parseInt(m[2]));
  }
  const d = new Date(cleaned);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function iso(y, m0, d) {
  const dt = new Date(Date.UTC(y, m0, d));
  return dt.toISOString().slice(0, 10);
}

export function daysSince(isoDate) {
  if (!isoDate) return null;
  const then = new Date(isoDate + 'T00:00:00Z').getTime();
  if (Number.isNaN(then)) return null;
  const now = Date.now();
  return Math.max(0, Math.round((now - then) / 86400000));
}

const TRACKING_PARAMS = new Set([
  'fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'mc_cid', 'mc_eid', '_branch_match_id', '_branch_referrer',
]);

export function decodeFacebookLink(href) {
  if (!href) return null;
  try {
    const u = new URL(href, 'https://www.facebook.com');
    if (u.hostname.endsWith('facebook.com') && u.pathname.endsWith('/l.php')) {
      const target = u.searchParams.get('u');
      if (target) {
        const out = new URL(decodeURIComponent(target));
        for (const k of [...out.searchParams.keys()]) {
          if (TRACKING_PARAMS.has(k)) out.searchParams.delete(k);
        }
        return out.toString();
      }
    }
    return href;
  } catch {
    return href;
  }
}

export function pageSlugFromUrl(href) {
  if (!href) return null;
  try {
    const u = new URL(href, 'https://web.facebook.com');
    if (!/facebook\.com$/.test(u.hostname) && !/^.*\.facebook\.com$/.test(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    if (parts[0] === 'profile.php') return u.searchParams.get('id');
    return parts[0];
  } catch {
    return null;
  }
}

export function snippet(text, max = 300) {
  if (!text) return '';
  const cleaned = String(text).replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? cleaned.slice(0, max - 1) + '…' : cleaned;
}

// Unix seconds (as used by the Ad Library GraphQL feed) → ISO date (YYYY-MM-DD).
export function isoFromUnix(secs) {
  const n = Number(secs);
  if (!n || Number.isNaN(n)) return null;
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function hostFromUrl(url) {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

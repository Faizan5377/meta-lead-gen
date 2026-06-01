// CSV export — both row-per-ad and row-per-company modes, with tier scope filtering.

const PER_AD_COLUMNS = [
  'keyword', 'location', 'location_code', 'scraped_at',
  'relevance_score', 'relevance_tier', 'relevance_reasons', 'is_lead_gen_ad',
  'library_id', 'ad_snapshot_url', 'active_status',
  'page_name', 'page_slug', 'page_url', 'partner_name',
  'started_running', 'days_running',
  'platforms', 'categories', 'media_type',
  'creative_ad_count', 'company_total_ads',
  'ad_text_snippet', 'headline', 'cta', 'display_domain', 'destination_url',
  'fb_handle', 'fb_followers_raw', 'fb_followers',
  'ig_handle', 'ig_followers_raw', 'ig_followers',
  'advertiser_category', 'advertiser_about',
  'enrichment_status', 'relevance_status',
];

const TIER_ORDER = { hot: 0, warm: 1, cool: 2, cold: 3, undefined: 4 };

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) v = v.join('; ');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function row(record, cols) {
  return cols.map(c => csvEscape(record[c])).join(',');
}

function filterByScope(leads, scope) {
  if (scope === 'all') return leads.filter(l => l.relevance_tier !== 'cold');
  if (scope === 'everything') return leads;
  // default: hot + warm
  return leads.filter(l => l.relevance_tier === 'hot' || l.relevance_tier === 'warm');
}

export function exportPerAd(session, { scope = 'hot_warm' } = {}) {
  const leads = filterByScope(session.leads, scope)
    .slice()
    .sort((a, b) => {
      const ta = TIER_ORDER[a.relevance_tier] ?? 4;
      const tb = TIER_ORDER[b.relevance_tier] ?? 4;
      if (ta !== tb) return ta - tb;
      return (b.relevance_score || 0) - (a.relevance_score || 0);
    });
  const lines = [PER_AD_COLUMNS.join(',')];
  for (const lead of leads) lines.push(row(lead, PER_AD_COLUMNS));
  return '﻿' + lines.join('\n');
}

export function exportPerCompany(session, { scope = 'hot_warm' } = {}) {
  const leads = filterByScope(session.leads, scope);
  const byCompany = new Map();
  for (const lead of leads) {
    const key = lead.page_slug || lead.page_name || lead.library_id;
    if (!byCompany.has(key)) {
      byCompany.set(key, {
        page_slug: lead.page_slug,
        page_name: lead.page_name,
        page_url: lead.page_url,
        advertiser_category: lead.advertiser_category,
        advertiser_about: lead.advertiser_about,
        fb_handle: lead.fb_handle,
        ig_handle: lead.ig_handle,
        fb_followers: lead.fb_followers,
        ig_followers: lead.ig_followers,
        relevance_score: lead.relevance_score,
        relevance_tier: lead.relevance_tier,
        relevance_reasons: lead.relevance_reasons,
        location: lead.location,
        location_code: lead.location_code,
        company_total_ads: 0,
        keywords_matched: new Set(),
        library_ids: [],
        destination_urls: new Set(),
        display_domains: new Set(),
        first_seen: lead.scraped_at,
        days_running_max: lead.days_running || 0,
      });
    }
    const c = byCompany.get(key);
    c.company_total_ads += 1;
    c.keywords_matched.add(lead.keyword);
    c.library_ids.push(lead.library_id);
    if (lead.destination_url) c.destination_urls.add(lead.destination_url);
    if (lead.display_domain) c.display_domains.add(lead.display_domain);
    if ((lead.days_running || 0) > c.days_running_max) c.days_running_max = lead.days_running;
    if ((lead.relevance_score || 0) > (c.relevance_score || 0)) {
      c.relevance_score = lead.relevance_score;
      c.relevance_tier = lead.relevance_tier;
    }
  }

  const cols = [
    'page_name', 'page_slug', 'page_url',
    'relevance_score', 'relevance_tier', 'relevance_reasons',
    'advertiser_category',
    'fb_handle', 'fb_followers', 'ig_handle', 'ig_followers',
    'company_total_ads', 'keywords_matched', 'days_running_max',
    'display_domains', 'destination_urls',
    'library_ids', 'location', 'location_code', 'first_seen', 'advertiser_about',
  ];

  const lines = [cols.join(',')];
  const rows = Array.from(byCompany.values()).sort((a, b) => {
    const ta = TIER_ORDER[a.relevance_tier] ?? 4;
    const tb = TIER_ORDER[b.relevance_tier] ?? 4;
    if (ta !== tb) return ta - tb;
    return (b.relevance_score || 0) - (a.relevance_score || 0);
  });
  for (const r of rows) {
    lines.push(cols.map(c => {
      let v = r[c];
      if (v instanceof Set) v = Array.from(v);
      return csvEscape(v);
    }).join(','));
  }
  return '﻿' + lines.join('\n');
}

export function csvFilename(session, mode) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const loc = (session.location || 'leads').replace(/\s+/g, '_');
  return `ventix-meta-leads_${mode}_${loc}_${stamp}.csv`;
}

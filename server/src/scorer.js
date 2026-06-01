// Deterministic, rules-based relevance scorer. No external API calls, no
// external HTTP fetches — scores purely from Meta Ad Library card data.
//
// TWO MODES (selected per search from the UI):
//   'leadgen' — Ventix AI ICP: real estate / mortgage / high-ticket lead-gen
//               advertisers who close on calls. Pure ecom is a NEGATIVE signal.
//   'ecom'    — Shopify-style ecommerce brand finder (the reference brief's ICP).
//
// Scoring layers (both modes):
//   Layer 0: hard excludes (immediate Cold)
//   Layer 1: weighted ICP feature matching (mode-specific dictionary)
//   Layer 2: shared behavioural boosts (volume / age / variants / followers / video)

// ──────────────────────────────────────────────────────────────────────────────
// Lead-gen ICP (Ventix)

const ICP = {
  primary: {
    categories: [
      'estate agent', 'real estate', 'real estate company', 'real estate agency',
      'real estate developer', 'real estate service', 'property', 'property management',
      'property developer', 'mortgage broker', 'mortgage lender', 'mortgage company',
      'home loan', 'realtor',
    ],
    pageNameTokens: [
      'realty', 'realtor', 'realtors', 'real estate', 'realestate', 'homes', 'properties',
      'property', 'estate', 'estates', 'mortgage', 'lending', 'loans', 'capital',
      'investors', 'investments', 'brokers', 'broker', 'home buyers', 'house buyers',
      'we buy houses',
    ],
    domainTokens: [
      'realty', 'realtor', 'realestate', 'homes', 'properties', 'property', 'mortgage',
      'sellmyhouse', 'webuyhouses', 'sellfast', 'cashforhomes', 'cashoffer', 'estate',
      'brokers', 'houseflip',
    ],
    textPatterns: [
      'real estate', 'realtor', 'sell your house', 'sell your home', 'we buy houses',
      'cash for houses', 'cash offer', 'cash buyer', 'home valuation', 'free valuation',
      'home appraisal', 'mortgage', 'home loan', 'pre-approved', 'pre approved',
      'investment property', 'house flipping', 'fix and flip', 'list your home',
      'list your house', 'first time home buyer', 'luxury home', 'luxury real estate',
      'off plan', 'off-plan', 'new construction', 'new homes', 'property for sale',
      'home for sale', 'house for sale', 'apartment for sale', 'villa for sale',
      'penthouse', 'dream home',
    ],
  },
  adjacent: {
    categories: [
      'solar energy', 'solar company', 'roofer', 'roofing', 'home improvement', 'hvac',
      'contractor', 'insurance', 'insurance broker', 'insurance agency', 'lawyer',
      'law firm', 'attorney', 'legal services', 'dentist', 'dental', 'cosmetic surgeon',
      'plastic surgeon', 'med spa', 'medical spa', 'health & medical', 'loan service',
      'business loan', 'financial planner', 'financial advisor', 'business consultant',
      'coach', 'coaching',
    ],
    pageNameTokens: [
      'solar', 'roofing', 'hvac', 'plumbing', 'remodeling', 'insurance', 'coverage',
      'protect', 'law', 'legal', 'attorney', 'injury', 'dental', 'dentist', 'smile',
      'orthodontic', 'cosmetic', 'aesthetic', 'medspa', 'funding', 'finance', 'wealth',
      'coaching', 'mastermind',
    ],
    domainTokens: [
      'solar', 'roofing', 'hvac', 'insurance', 'law', 'legal', 'dental', 'cosmetic',
      'funding', 'wealth', 'coaching',
    ],
    textPatterns: [
      'solar panels', 'solar quote', 'solar installation', 'new roof', 'roof replacement',
      'hvac installation', 'window replacement', 'insurance quote', 'life insurance',
      'final expense', 'medicare advantage', 'personal injury', 'car accident',
      'truck accident', 'mesothelioma', 'dental implants', 'cosmetic dentistry',
      'invisalign', 'cosmetic surgery', 'plastic surgery', 'med spa', 'hair transplant',
      'business loan', 'merchant cash advance', 'sba loan', 'financial advisor',
      'wealth management', 'business coach', 'executive coaching', 'mastermind',
    ],
  },
};

// Generic lead-gen positive signals (boost regardless of vertical)
const LEADGEN = {
  ctas: [
    'learn more', 'sign up', 'get quote', 'get offer', 'book now', 'apply now',
    'contact us', 'send message', 'get directions', 'request time', 'schedule',
    'subscribe', 'download',
  ],
  textPatterns: [
    'free consultation', 'free quote', 'free estimate', 'pre-approved', 'cash offer',
    'book a call', 'schedule a viewing', 'schedule a tour', 'no obligation',
    'appointment', 'speak with', 'callback', 'qualify', 'get pre-qualified',
    'limited spots', 'register now', 'claim your', 'free guide',
  ],
};

// ──────────────────────────────────────────────────────────────────────────────
// Ecom ICP (Shopify-style brand finder)

const ECOM = {
  categories: [
    'clothing brand', 'clothing store', 'clothing company', 'apparel', 'fashion',
    'fashion designer', 'shopping & retail', 'retail company', 'e-commerce',
    'product/service', 'furniture store', 'furniture', 'home decor', 'home goods',
    'beauty', 'cosmetics', 'beauty supply store', 'skin care', 'skincare',
    'health/beauty', 'health & beauty', 'jewelry', 'jewelry/watches', 'watch',
    'footwear', 'shoe store', 'accessories', 'baby goods', 'pet supplies',
    'sporting goods', 'electronics', 'consumer electronics', 'gadget',
    'supplements', 'food & beverage', 'grocery store', 'outdoor',
  ],
  // Strong Shopify/ecom domain markers we CAN detect without fetching HTML.
  domainStrong: ['myshopify.com'],
  domainTokens: ['shop', 'store', 'boutique', 'thelabel', 'collective', 'apparel', 'wear', 'co'],
  ctas: ['shop now', 'buy now', 'order now', 'get yours', 'shop the'],
  textPatterns: [
    'free shipping', 'new collection', 'best seller', 'bestseller', 'add to cart',
    'restock', 'back in stock', 'limited edition', 'shop the look', 'use code',
    '% off', 'new arrivals', 'sold out', 'order yours', 'free returns', 'sale ends',
  ],
};

// Page categories that always indicate a person / non-business — reject in both modes.
const REJECT_CATEGORIES = [
  'personal blog', 'public figure', 'just for fun', 'community',
  'blogger', 'digital creator', 'gamer', 'video creator',
];

// Destination junk — links that are NOT a real funnel/site.
const JUNK = {
  // Pure social profiles (driving page likes, no funnel/site).
  bareSocialHosts: [
    'instagram.com', 'www.instagram.com', 'facebook.com', 'www.facebook.com',
    'fb.com', 'm.me', 'tiktok.com', 'www.tiktok.com', 'youtube.com', 'youtu.be',
    'twitter.com', 'x.com', 't.me', 'snapchat.com',
  ],
  // Link-in-bio / form aggregators.
  aggregatorHosts: [
    'linktr.ee', 'linktree.com', 'beacons.ai', 'lnk.bio', 'taplink.cc',
    'bio.link', 'msha.ke', 'campsite.bio',
  ],
  // Chat funnels — GOOD for lead-gen (esp. MENA real estate), junk for ecom.
  chatHosts: ['wa.me', 'api.whatsapp.com', 'whatsapp.com', 'chat.whatsapp.com'],
  // Form funnels — fine for lead-gen, junk for ecom.
  formHosts: ['forms.gle', 'docs.google.com', 'typeform.com', 'jotform.com'],
};

const SYNONYMS = {
  'real estate': ['realtor', 'property', 'home', 'house', 'listings', 'broker', 'agent', 'realty'],
  'we buy houses': ['cash offer', 'sell your house fast', 'cash for homes', 'buy your home', 'i buy houses'],
  'mortgage': ['home loan', 'refinance', 'pre-approved', 'lender', 'mortgage broker'],
  'solar': ['solar panels', 'solar quote', 'solar installation'],
  'insurance': ['coverage', 'policy', 'quote', 'premium'],
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers

function tierFromScore(score) {
  if (score >= 81) return 'hot';
  if (score >= 61) return 'warm';
  if (score >= 31) return 'cool';
  return 'cold';
}

function countMatches(haystack, needles) {
  const hits = [];
  for (const n of needles) if (haystack.includes(n)) hits.push(n);
  return hits;
}

function destHost(lead) {
  const url = lead.destination_url || '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Classify the destination link. Returns { kind, host } where kind ∈
// 'site' | 'social' | 'aggregator' | 'chat' | 'form' | 'none'.
function classifyDestination(lead) {
  const url = lead.destination_url || '';
  if (!url) return { kind: 'none', host: '' };
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return { kind: 'none', host: '' }; }
  const path = (() => { try { return new URL(url).pathname; } catch { return ''; } })();

  if (JUNK.chatHosts.some(h => host === h || host.endsWith('.' + h))) return { kind: 'chat', host };
  if (JUNK.aggregatorHosts.some(h => host === h || host.endsWith('.' + h))) return { kind: 'aggregator', host };
  if (JUNK.formHosts.some(h => host === h || host.endsWith('.' + h))) return { kind: 'form', host };
  // Bare social profile (no meaningful path beyond the handle)
  if (JUNK.bareSocialHosts.includes(host)) return { kind: 'social', host };
  return { kind: 'site', host };
}

function looksEcom(lead, text, category, cta, domain) {
  const ecomCat = ECOM.categories.some(c => category.includes(c));
  const ecomCta = ECOM.ctas.some(c => cta === c || cta.includes(c));
  const ecomDomainStrong = ECOM.domainStrong.some(d => domain.includes(d));
  const ecomText = countMatches(text, ECOM.textPatterns).length >= 2;
  return { ecomCat, ecomCta, ecomDomainStrong, ecomText,
    any: ecomCat || ecomCta || ecomDomainStrong || ecomText };
}

function behaviouralBoosts(lead, reasons) {
  let score = 0;
  const totalAds = lead.company_total_ads || 0;
  if (totalAds >= 15) { score += 12; reasons.push({ w: 12, t: `Heavy advertiser (${totalAds} ads)` }); }
  else if (totalAds >= 5) { score += 8; reasons.push({ w: 8, t: `Active advertiser (${totalAds} ads)` }); }
  else if (totalAds >= 3) { score += 4; reasons.push({ w: 4, t: `${totalAds} active ads` }); }

  if ((lead.creative_ad_count || 0) >= 2) { score += 3; reasons.push({ w: 3, t: `${lead.creative_ad_count} creative variants` }); }
  if ((lead.platforms?.length || 0) >= 3) { score += 3; reasons.push({ w: 3, t: `${lead.platforms.length}-platform spread` }); }

  const followers = (lead.fb_followers || 0) + (lead.ig_followers || 0);
  if (followers >= 50000) { score += 6; reasons.push({ w: 6, t: `Large audience (${followers.toLocaleString()} followers)` }); }
  else if (followers >= 5000) { score += 4; reasons.push({ w: 4, t: `Established audience (${followers.toLocaleString()} followers)` }); }
  else if (followers >= 2000) { score += 2; reasons.push({ w: 2, t: `${followers.toLocaleString()} followers` }); }

  if ((lead.days_running || 0) >= 30) { score += 5; reasons.push({ w: 5, t: `Ad running ${lead.days_running} days (proven funnel)` }); }
  return score;
}

function keywordMatch(keyword, ...fields) {
  if (!keyword) return true;
  const hay = fields.filter(Boolean).join(' ');
  if (hay.includes(keyword)) return true;
  const syns = SYNONYMS[keyword] || [];
  for (const s of syns) if (hay.includes(s.toLowerCase())) return true;
  const words = keyword.split(/\s+/).filter(w => w.length > 2);
  if (words.length > 1 && words.every(w => hay.includes(w))) return true;
  return false;
}

function finalize(score, reasons, extra) {
  score = Math.max(0, Math.min(100, score));
  reasons.sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  return {
    score,
    tier: tierFromScore(score),
    reasons: reasons.slice(0, 4).map(r => r.t),
    relevance_status: 'scored',
    ...extra,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Mode: lead-gen (Ventix ICP)

function scoreLeadGen(lead) {
  const text = `${lead.ad_text_snippet || ''} ${lead.headline || ''}`.toLowerCase();
  const pageName = (lead.page_name || '').toLowerCase();
  const domain = `${lead.display_domain || ''} ${lead.destination_url || ''}`.toLowerCase();
  const category = (lead.advertiser_category || '').toLowerCase();
  const cta = (lead.cta || '').toLowerCase();
  const keyword = (lead.keyword || '').toLowerCase();
  const dest = classifyDestination(lead);
  const reasons = [];

  // Layer 0 — hard excludes
  if (REJECT_CATEGORIES.some(c => category.includes(c))) {
    return finalize(8, [{ t: `Non-business page: ${lead.advertiser_category}` }],
      { is_lead_gen_ad: false, search_match: keywordMatch(keyword, text, pageName, domain, category) });
  }

  let score = 30; // baseline → "cool"

  // Category
  let primaryCategoryHit = false;
  if (category) {
    if (ICP.primary.categories.find(c => category.includes(c))) {
      score += 40; primaryCategoryHit = true;
      reasons.push({ w: 40, t: `Primary category: ${lead.advertiser_category}` });
    } else if (ICP.adjacent.categories.find(c => category.includes(c))) {
      score += 28;
      reasons.push({ w: 28, t: `Adjacent category: ${lead.advertiser_category}` });
    }
  }

  // Page name
  if (!primaryCategoryHit) {
    const ph = countMatches(pageName, ICP.primary.pageNameTokens);
    if (ph.length) { const a = Math.min(20, ph.length * 8); score += a; reasons.push({ w: a, t: `Primary page-name: ${ph.slice(0, 2).join(', ')}` }); }
    else {
      const ah = countMatches(pageName, ICP.adjacent.pageNameTokens);
      if (ah.length) { const a = Math.min(14, ah.length * 6); score += a; reasons.push({ w: a, t: `Adjacent page-name: ${ah.slice(0, 2).join(', ')}` }); }
    }
  }

  // Domain
  if (ICP.primary.domainTokens.some(t => domain.includes(t))) { score += 12; reasons.push({ w: 12, t: 'Primary domain match' }); }
  else if (ICP.adjacent.domainTokens.some(t => domain.includes(t))) { score += 8; reasons.push({ w: 8, t: 'Adjacent domain match' }); }

  // Ad text / headline
  const pt = countMatches(text, ICP.primary.textPatterns);
  if (pt.length) { const a = Math.min(15, pt.length * 5); score += a; reasons.push({ w: a, t: `Primary text: "${pt.slice(0, 2).join('", "')}"` }); }
  else {
    const at = countMatches(text, ICP.adjacent.textPatterns);
    if (at.length) { const a = Math.min(10, at.length * 4); score += a; reasons.push({ w: a, t: `Adjacent text: "${at.slice(0, 2).join('", "')}"` }); }
  }

  // Lead-gen intent signals
  let isLeadGen = false;
  if (LEADGEN.ctas.find(c => cta === c || cta.includes(c))) { score += 5; isLeadGen = true; reasons.push({ w: 5, t: `Lead-gen CTA: ${lead.cta}` }); }
  const lt = countMatches(text, LEADGEN.textPatterns);
  if (lt.length) { const a = Math.min(10, lt.length * 4); score += a; isLeadGen = true; reasons.push({ w: a, t: `Intent: "${lt.slice(0, 2).join('", "')}"` }); }

  // Page-level: has a real website (Page transparency proxy)
  if (lead.display_domain || dest.kind === 'site') { score += 4; reasons.push({ w: 4, t: 'Has linked website' }); }

  // Destination quality (lead-gen perspective)
  if (dest.kind === 'site') { score += 3; reasons.push({ w: 3, t: `Landing page (${dest.host})` }); }
  else if (dest.kind === 'chat') { score += 4; reasons.push({ w: 4, t: 'WhatsApp lead funnel' }); }  // valid funnel, esp. MENA
  else if (dest.kind === 'form') { score += 3; reasons.push({ w: 3, t: 'Lead form funnel' }); }
  else if (dest.kind === 'aggregator') { score -= 6; reasons.push({ w: -6, t: 'Link-in-bio (weak funnel)' }); }
  else if (dest.kind === 'social') { score -= 12; reasons.push({ w: -12, t: 'Drives to social profile, no funnel' }); }

  // ECOM EXCLUSION — pure ecommerce brands don't buy voice AI for lead calls.
  const ec = looksEcom(lead, text, category, cta, domain);
  if (ec.ecomDomainStrong || (ec.ecomCta && (ec.ecomCat || ec.ecomText))) {
    score -= 30; reasons.push({ w: -30, t: 'Ecommerce store (not a call-driven funnel)' });
  } else if (ec.ecomCta || ec.ecomCat) {
    score -= 12; reasons.push({ w: -12, t: 'Ecom signals — likely not Ventix ICP' });
  }

  // Behavioural boosts
  score += behaviouralBoosts(lead, reasons);

  // search_match soft penalty
  const searchMatch = keywordMatch(keyword, text, pageName, domain, category);
  if (!searchMatch) { score -= 15; reasons.push({ w: -15, t: `Off-topic for "${lead.keyword}"` }); }

  return finalize(score, reasons, { is_lead_gen_ad: isLeadGen || primaryCategoryHit, search_match: searchMatch });
}

// ──────────────────────────────────────────────────────────────────────────────
// Mode: ecom (Shopify-style brand finder)

function scoreEcom(lead) {
  const text = `${lead.ad_text_snippet || ''} ${lead.headline || ''}`.toLowerCase();
  const pageName = (lead.page_name || '').toLowerCase();
  const domain = `${lead.display_domain || ''} ${lead.destination_url || ''}`.toLowerCase();
  const category = (lead.advertiser_category || '').toLowerCase();
  const cta = (lead.cta || '').toLowerCase();
  const keyword = (lead.keyword || '').toLowerCase();
  const dest = classifyDestination(lead);
  const reasons = [];
  const searchMatch = keywordMatch(keyword, text, pageName, domain, category);

  // Layer 0 — hard excludes: non-business pages, junk destinations.
  if (REJECT_CATEGORIES.some(c => category.includes(c))) {
    return finalize(6, [{ t: `Non-business page: ${lead.advertiser_category}` }], { is_lead_gen_ad: false, search_match: searchMatch });
  }
  if (['chat', 'aggregator', 'form', 'social'].includes(dest.kind)) {
    return finalize(10, [{ t: `No real store — destination is ${dest.kind} (${dest.host})` }], { is_lead_gen_ad: false, search_match: searchMatch });
  }
  if (dest.kind === 'none' && !lead.display_domain) {
    return finalize(15, [{ t: 'No website / store link on the ad' }], { is_lead_gen_ad: false, search_match: searchMatch });
  }

  let score = 25; // baseline lower — ecom must EARN its score
  const ec = looksEcom(lead, text, category, cta, domain);

  // Strongest possible signal: Shopify domain marker.
  if (ec.ecomDomainStrong) { score += 35; reasons.push({ w: 35, t: 'Shopify store (myshopify.com)' }); }

  if (ec.ecomCat) { score += 22; reasons.push({ w: 22, t: `Ecom category: ${lead.advertiser_category}` }); }
  if (ec.ecomCta) { score += 14; reasons.push({ w: 14, t: `Storefront CTA: ${lead.cta}` }); }

  const et = countMatches(text, ECOM.textPatterns);
  if (et.length) { const a = Math.min(14, et.length * 5); score += a; reasons.push({ w: a, t: `Ecom copy: "${et.slice(0, 2).join('", "')}"` }); }

  if (!ec.ecomDomainStrong && ECOM.domainTokens.some(t => domain.includes(t))) { score += 6; reasons.push({ w: 6, t: 'Store-like domain' }); }

  // Has a real website (not just a Meta page)
  if (dest.kind === 'site' || lead.display_domain) { score += 6; reasons.push({ w: 6, t: `Linked website (${dest.host || lead.display_domain})` }); }

  // Video ad preference (the brief wants video brands)
  if (lead.media_type === 'video') { score += 6; reasons.push({ w: 6, t: 'Video creative' }); }
  else if (lead.media_type === 'carousel') { score += 2; reasons.push({ w: 2, t: 'Carousel creative' }); }

  // Behavioural boosts (ecom brands run many ads for a long time)
  score += behaviouralBoosts(lead, reasons);

  // If there is NO ecom signal at all, this almost certainly isn't a brand.
  if (!ec.any && !ec.ecomDomainStrong) { score -= 18; reasons.push({ w: -18, t: 'No ecommerce signals detected' }); }

  if (!searchMatch) { score -= 12; reasons.push({ w: -12, t: `Off-topic for "${lead.keyword}"` }); }

  return finalize(score, reasons, { is_lead_gen_ad: false, search_match: searchMatch });
}

// ──────────────────────────────────────────────────────────────────────────────

export function scoreLead(lead, mode = 'leadgen') {
  return mode === 'ecom' ? scoreEcom(lead) : scoreLeadGen(lead);
}

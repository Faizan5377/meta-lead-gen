// The browser's copy of server/src/leadSchema.js.
//
// The server decides the lead shape; this mirrors it so the table can render a
// record arriving live over SSE, which is still in the scraper's own shape,
// identically to one loaded from the library. Keep the two in step — the column
// list below is what the CSV contains.

const s = (v) => (v == null || v === '' ? '' : String(v).trim());

function cityFrom(address, fallback) {
  if (fallback) return s(fallback);
  const parts = s(address).split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

const contact = (r) => ({
  first_name: s(r.first_name),
  last_name: s(r.last_name),
  designation: s(r.designation),
  position: s(r.position),
  owner_email: s(r.owner_email),
  email_confidence: r.email_confidence ?? '',
  owner_phone: s(r.owner_phone),
});

export const metaLead = (b = {}) => ({
  business_name: s(b.maps_name) || s(b.page_name),
  // Resolved listing only — never the ad's destination or Facebook's
  // self-declared category. Mirrors server/src/leadSchema.js; letting these
  // drift means the table shows a website the CSV does not have, which is how
  // an Amazon product URL looked like a plumber's site.
  website: s(b.maps_website),
  business_phone: s(b.maps_phone),
  category: s(b.maps_category),
  city: cityFrom(b.maps_address, b.maps_city),
  source: 'Meta Ads',
  ...contact(b),
  // Kept off the CSV, but the table links to them so a lead can be checked.
  _ad_url: s(b.ad_url) || (b.library_id ? `https://www.facebook.com/ads/library/?id=${b.library_id}` : ''),
  _maps_url: s(b.maps_url),
  _key: b.business_key || b.library_id || b.page_id,
});

export const placeLead = (p = {}) => ({
  business_name: s(p.name),
  website: s(p.website) || s(p.website_domain),
  business_phone: s(p.phone_e164) || s(p.phone),
  category: s(p.category),
  city: cityFrom(p.address, p.city),
  source: 'Google Maps',
  ...contact(p),
  _ad_url: '',
  _maps_url: s(p.maps_url),
  _key: p.feature_id || p.place_id,
});

export const isComplete = (lead) => !!s(lead?.owner_email);

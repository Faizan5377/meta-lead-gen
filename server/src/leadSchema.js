// The one shape a lead has, whichever scraper found it.
//
// Both scrapers used to export their own columns — 38 for the Ad Library, 24
// for Maps, and only two of them (`country`, `maps_url`) shared a name. That
// made the two lists impossible to stack and impossible to hand to anything
// downstream without a mapping step.
//
// This is the whole export now. The headers are deliberately the ones the
// Ventix Outreach importer already auto-detects, so a CSV from here loads into
// a campaign with no column mapping at all:
//
//   Business Name -> company   Website -> domain   First Name -> first_name
//   Last Name -> last_name     Position -> position
//   Owner Email -> email       Owner Phone / Business Phone -> phone

export const LEAD_COLUMNS = [
  'business_name',
  'website',
  'business_phone',
  'first_name',
  'last_name',
  'designation',        // normalized rung: Owner / CEO / President / Vice President
  'position',           // Hunter's exact title, e.g. "Co-Founder & President"
  'owner_email',
  'email_confidence',
  'owner_phone',        // filled by Apollo later; blank for now
  'category',
  'city',
  'source',
];

export const LEAD_HEADERS = {
  business_name: 'Business Name',
  website: 'Website',
  business_phone: 'Business Phone',
  first_name: 'First Name',
  last_name: 'Last Name',
  designation: 'Designation',
  position: 'Position',
  owner_email: 'Owner Email',
  email_confidence: 'Email Confidence',
  owner_phone: 'Owner Phone',
  category: 'Category',
  city: 'City',
  source: 'Source',
};

const s = (v) => (v == null || v === '' ? '' : String(v).trim());

// City is not a field either scraper stores on its own, but both carry an
// address that ends "…, Austin, TX 78704".
function cityFrom(address, fallback) {
  if (fallback) return s(fallback);
  const parts = s(address).split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

// An Ad Library advertiser, after Maps verification, as a lead.
//
// The website comes from the Maps listing first: the ad's own destination is a
// tracking link or an fb.me redirect about 40% of the time, while the listing
// carries the real company site.
export function fromMetaBusiness(b = {}) {
  return {
    business_name: s(b.maps_name) || s(b.page_name),
    website: s(b.maps_website) || s(b.link_url) || s(b.display_domain),
    business_phone: s(b.maps_phone),
    category: s(b.maps_category) || s((b.page_categories || [])[0]),
    city: cityFrom(b.maps_address, b.maps_city),
    source: 'Meta Ads',
    ...emptyContact(),
  };
}

export function fromPlace(p = {}) {
  return {
    business_name: s(p.name),
    website: s(p.website) || s(p.website_domain),
    business_phone: s(p.phone_e164) || s(p.phone),
    category: s(p.category),
    city: cityFrom(p.address, p.city),
    source: 'Google Maps',
    ...emptyContact(),
  };
}

const emptyContact = () => ({
  first_name: '', last_name: '', designation: '', position: '',
  owner_email: '', email_confidence: '', owner_phone: '',
});

// Fold the chosen decision maker onto a lead. `person` is what
// enrich/hierarchy.js picked — exactly one, or null.
export function withDecisionMaker(lead, person) {
  if (!person) return lead;
  return {
    ...lead,
    first_name: s(person.first_name),
    last_name: s(person.last_name),
    designation: s(person.tier_label),
    position: s(person.position),
    owner_email: s(person.email),
    email_confidence: person.confidence ?? '',
  };
}

// A lead is only worth exporting once it has someone to email.
export const isComplete = (lead) => !!s(lead?.owner_email);

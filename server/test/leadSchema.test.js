// One shape for a lead, whichever scraper found it.
//
// The headers are load-bearing: they are the ones the Ventix Outreach importer
// auto-detects, so renaming one silently breaks the hand-off to a campaign.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LEAD_COLUMNS, LEAD_HEADERS, fromMetaBusiness, fromPlace, isComplete, withDecisionMaker,
} from '../src/leadSchema.js';

describe('the schema itself', () => {
  it('gives every column a header', () => {
    for (const c of LEAD_COLUMNS) assert.ok(LEAD_HEADERS[c], `no header for ${c}`);
    assert.equal(Object.keys(LEAD_HEADERS).length, LEAD_COLUMNS.length);
  });

  it('keeps the header names the outreach importer recognises', () => {
    // outreach/leads.py matches on lowercase alphanumerics: "owneremail",
    // "businessphone", "firstname"… Changing these breaks CSV import.
    const norm = (v) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
    assert.equal(norm(LEAD_HEADERS.business_name), 'businessname');
    assert.equal(norm(LEAD_HEADERS.owner_email), 'owneremail');
    assert.equal(norm(LEAD_HEADERS.owner_phone), 'ownerphone');
    assert.equal(norm(LEAD_HEADERS.business_phone), 'businessphone');
    assert.equal(norm(LEAD_HEADERS.first_name), 'firstname');
    assert.equal(norm(LEAD_HEADERS.last_name), 'lastname');
    assert.equal(norm(LEAD_HEADERS.website), 'website');
    assert.equal(norm(LEAD_HEADERS.position), 'position');
  });
});

describe('both scrapers produce the same shape', () => {
  const meta = fromMetaBusiness({
    page_name: 'Bourque Heating & Cooling LLC',
    maps_name: 'Bourque Heating & Cooling',
    maps_website: 'https://bourqueheating.com',
    link_url: 'http://fb.me/',
    maps_phone: '(508) 992-3406',
    maps_category: 'HVAC contractor',
    maps_address: '1199 Pitchers Way, Hyannis, MA 02601',
  });
  const place = fromPlace({
    name: 'Trust Rooter Plumbing',
    website: 'https://trustrooter.com',
    phone: '(305) 555-0100', phone_e164: '+13055550100',
    category: 'Plumber',
    address: '880 NW 2nd Ave, Miami, FL 33136',
  });

  it('fills the same keys from either source', () => {
    assert.deepEqual(Object.keys(meta).sort(), Object.keys(place).sort());
  });

  it('takes the website only from the resolved listing', () => {
    // The ad pointed at fb.me; the listing has the real company site.
    assert.equal(meta.website, 'https://bourqueheating.com');
  });

  it('NEVER falls back to the ad destination — this produced an Amazon owner', () => {
    // "Hose Bib Buddy": an Amazon product ad whose Facebook page claims the
    // category "Plumber". Falling back to its destination handed Hunter
    // amazon.com, which returned an Amazon employee as the business owner.
    const unresolved = fromMetaBusiness({
      page_name: 'Hose Bib Buddy',
      link_url: 'https://www.amazon.com/Hose-Bib-Buddy/dp/B087J3LKYD',
      display_domain: 'amazon.com',
      page_categories: ['Plumber'],
    });
    assert.equal(unresolved.website, '');
    // And Facebook's self-declared category is not evidence either.
    assert.equal(unresolved.category, '');
    assert.equal(isComplete(unresolved), false);
  });

  it('prefers the listing name, which is the trading name', () => {
    assert.equal(meta.business_name, 'Bourque Heating & Cooling');
  });

  it('pulls the city out of the address', () => {
    assert.equal(meta.city, 'Hyannis');
    assert.equal(place.city, 'Miami');
  });

  it('uses the listing city when the business hides its address', () => {
    // Service-area trades — pest control, plumbing — publish no street
    // address, so the address is empty and only Google's city field is set.
    const hidden = fromMetaBusiness({
      page_name: 'Clear Pest Pros', maps_city: 'Southfield, MI', maps_address: null,
    });
    assert.equal(hidden.city, 'Southfield, MI');
  });

  it('prefers a dialable phone format when there is one', () => {
    assert.equal(place.business_phone, '+13055550100');
  });

  it('labels where the lead came from', () => {
    assert.equal(meta.source, 'Meta Ads');
    assert.equal(place.source, 'Google Maps');
  });

  it('starts with no contact and is therefore incomplete', () => {
    for (const lead of [meta, place]) {
      assert.equal(lead.owner_email, '');
      assert.equal(isComplete(lead), false);
    }
  });

  it('keeps the advertiser name when the listing has none', () => {
    const bare = fromMetaBusiness({ page_name: 'Acme Air' });
    assert.equal(bare.business_name, 'Acme Air');
  });
});

describe('withDecisionMaker', () => {
  const lead = fromPlace({ name: 'Pike Plumbing' });

  it('records the rung and the exact title separately', () => {
    const got = withDecisionMaker(lead, {
      email: 'dan@pike.com', first_name: 'Dan', last_name: 'Pike',
      position: 'Co-Founder & President', confidence: 93,
      tier: 1, tier_label: 'Owner',
    });
    assert.equal(got.designation, 'Owner');            // what you filter on
    assert.equal(got.position, 'Co-Founder & President'); // what the template says
    assert.equal(got.owner_email, 'dan@pike.com');
    assert.equal(got.email_confidence, 93);
    assert.equal(isComplete(got), true);
  });

  it('leaves the lead untouched, and incomplete, when nobody was found', () => {
    assert.deepEqual(withDecisionMaker(lead, null), lead);
    assert.equal(isComplete(withDecisionMaker(lead, null)), false);
  });

  it('leaves Owner Phone for Apollo to fill later', () => {
    const got = withDecisionMaker(lead, { email: 'a@b.com', tier_label: 'CEO' });
    assert.equal(got.owner_phone, '');
  });
});

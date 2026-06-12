// Phase C — Facebook Page contact enrichment.
//
// After scraping, we visit each unique advertiser's Facebook Page
// "Contact and basic info" tab. Facebook throws a login modal, but it has a
// Close (X) button — we dismiss it and the public contact block is readable:
//
//   Contact info
//   22 Canada Hill Street, Belmopan, Belize     ← value
//   Address                                      ← label
//   +501 613-7663
//   Mobile
//   info@livenaturallybelize.com
//   Email address
//   Websites and social links
//   https://thebelizecollection.com/residences/
//   Website
//
// Values appear on the line BEFORE their label, so we parse label-anchored.
// Facebook-only by design.

import { decodeFacebookLink } from './parsers.js';
import { jitter } from './humanize.js';

export function aboutContactUrl(pageUrl) {
  try {
    const u = new URL(pageUrl);
    if (!/facebook\.com$/.test(u.hostname) && !u.hostname.endsWith('.facebook.com')) return null;
    if (u.pathname.includes('profile.php')) {
      u.hostname = 'www.facebook.com';
      u.searchParams.set('sk', 'about_contact_and_basic_info');
      return u.toString();
    }
    const slug = u.pathname.split('/').filter(Boolean)[0];
    if (!slug) return null;
    return `https://www.facebook.com/${slug}/about_contact_and_basic_info`;
  } catch {
    return null;
  }
}

const GRAB_CONTACT = `
(() => {
  const text = (document.body.innerText || '').replace(/\\u00a0/g, ' ');
  const mailto = Array.from(document.querySelectorAll('a[href^="mailto:"]'))
    .map(a => decodeURIComponent(a.getAttribute('href').slice(7)));
  const tel = Array.from(document.querySelectorAll('a[href^="tel:"]'))
    .map(a => a.getAttribute('href').slice(4));
  const extRedirect = Array.from(document.querySelectorAll('a[href*="l.facebook.com/l.php"]'))
    .map(a => a.href);
  const extDirect = Array.from(document.querySelectorAll('a[href^="http"]'))
    .map(a => a.href)
    .filter(h => !/facebook\\.com|fbcdn\\.net|messenger\\.com|fb\\.com/.test(h));
  return { text, mailto, tel, extRedirect, extDirect };
})()
`;

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /^[+(]?\d[\d\s().\-]{6,}\d$/;

function valueBeforeLabel(lines, labelRe) {
  for (let i = 0; i < lines.length; i++) {
    if (labelRe.test(lines[i])) {
      for (let j = i - 1; j >= 0; j--) {
        if (lines[j]) return lines[j];
      }
    }
  }
  return null;
}

export function parseContact(raw) {
  if (!raw) return { contact_status: 'failed' };
  const lines = raw.text.split('\n').map(l => l.trim());

  // Email — prefer a real mailto link, then the labelled value, then any in-text match.
  let email = raw.mailto.find(e => EMAIL_RE.test(e)) || null;
  if (!email) {
    const v = valueBeforeLabel(lines, /^Email( address)?$/i);
    if (v && EMAIL_RE.test(v)) email = v.match(EMAIL_RE)[0];
  }
  if (!email) {
    const m = raw.text.match(EMAIL_RE);
    if (m && !/facebook\.com$/.test(m[0])) email = m[0];
  }

  // Phone — labelled value or tel: link (avoids stray numbers like follower counts).
  let phone = valueBeforeLabel(lines, /^(Mobile|Phone|Phone number|Telephone|WhatsApp)$/i);
  if (!phone || !PHONE_RE.test(phone)) {
    phone = raw.tel.find(p => /\d{7,}/.test(p.replace(/\D/g, ''))) || (PHONE_RE.test(phone || '') ? phone : null);
  }
  if (phone && phone.replace(/\D/g, '').length < 7) phone = null;

  // Website — labelled value, else first external/redirect link.
  let website = valueBeforeLabel(lines, /^Website$/i);
  if (website && !/^https?:\/\//i.test(website)) {
    website = /^[\w.-]+\.[a-z]{2,}/i.test(website) ? 'https://' + website : null;
  }
  if (!website && raw.extDirect.length) website = raw.extDirect[0];
  if (!website && raw.extRedirect.length) website = decodeFacebookLink(raw.extRedirect[0]);
  if (website) website = decodeFacebookLink(website);

  const found = !!(email || phone || website);
  return {
    contact_email: email || null,
    contact_phone: phone || null,
    contact_website: website || null,
    contact_status: found ? 'enriched' : 'failed',
  };
}

export async function scrapeFacebookContact(page, pageUrl) {
  const url = aboutContactUrl(pageUrl);
  if (!url) return { contact_status: 'failed' };

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await jitter(2500, 3800);

  // Dismiss the login modal (the X / Close button). Try a few strategies.
  for (const sel of ['div[role="dialog"] [aria-label="Close"]', '[aria-label="Close"]', 'div[aria-label="Close"]']) {
    const btn = page.locator(sel).first();
    if (await btn.count().then(c => c > 0).catch(() => false)) {
      try { await btn.click({ timeout: 1500 }); break; } catch {}
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
  await jitter(1200, 2000);

  const raw = await page.evaluate(GRAB_CONTACT).catch(() => null);
  return parseContact(raw);
}

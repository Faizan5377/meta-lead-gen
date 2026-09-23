// Screenshot every page in both themes so the UI can actually be looked at,
// and report any element whose computed colours would make it unreadable.
//
//   node scripts/shoot-ui.js

import fs from 'node:fs';
import { newPage, shutdown } from '../src/scraper/engine.js';

const OUT = process.argv[2] || '/tmp/ui';
const BASE = 'http://localhost:5173';
const ROUTES = [
  ['scraper', 'Ad Scraper'],
  ['library', 'Ad Library'],
  ['maps', 'Maps Scraper'],
  ['maps-library', 'Maps Library'],
];

fs.mkdirSync(OUT, { recursive: true });
const page = await newPage();
await page.setViewportSize({ width: 1500, height: 1000 });

const problems = [];

// Flag text that is effectively invisible against what's behind it.
const CONTRAST_AUDIT = `
(() => {
  const lum = (c) => {
    const m = c.match(/[\\d.]+/g); if (!m) return null;
    const [r, g, b, a] = m.map(Number);
    if (a === 0) return null;                       // fully transparent
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      const m = c.match(/[\\d.]+/g);
      if (m && (m.length < 4 || Number(m[3]) > 0.5)) return c;
      n = n.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const out = [];
  for (const el of document.querySelectorAll('h1,h2,h3,p,span,div,button,a,label,th,td')) {
    if (!el.childNodes.length) continue;
    const txt = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
    if (txt.length < 2) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.15) continue;
    const lf = lum(st.color), lb = lum(bgOf(el));
    if (lf == null || lb == null) continue;
    const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
    if (ratio < 2.2) out.push({ text: txt.slice(0, 44), ratio: Number(ratio.toFixed(2)), color: st.color, bg: bgOf(el) });
  }
  // De-duplicate by text so one repeated component isn't reported 40 times.
  const seen = new Set();
  return out.filter(o => !seen.has(o.text) && seen.add(o.text)).slice(0, 12);
})()
`;

for (const theme of ['light', 'dark']) {
  for (const [route, label] of ROUTES) {
    await page.goto(`${BASE}/#/${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Force the theme deterministically rather than depending on the OS.
    await page.evaluate((t) => {
      localStorage.setItem('adharvester:theme', t);
      document.documentElement.classList.toggle('dark', t === 'dark');
    }, theme);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);

    const file = `${OUT}/${theme}-${route}.png`;
    await page.screenshot({ path: file });

    const bad = await page.evaluate(CONTRAST_AUDIT).catch(() => []);
    const htmlClass = await page.evaluate(() => document.documentElement.className);
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    console.log(`${theme.padEnd(5)} ${label.padEnd(14)} html="${htmlClass}"  body=${bodyBg}  low-contrast=${bad.length}`);
    for (const b of bad) {
      problems.push({ theme, route, ...b });
      console.log(`        ⚠ "${b.text}"  ratio ${b.ratio}  ${b.color} on ${b.bg}`);
    }
  }
}

console.log(`\nscreenshots -> ${OUT}`);
console.log(problems.length ? `${problems.length} contrast problems found` : 'no contrast problems found');

await page.close();
await shutdown();

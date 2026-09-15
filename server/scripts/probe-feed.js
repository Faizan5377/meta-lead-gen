// Dump one raw GraphQL feed node so we can see exactly which fields Meta gives
// us for free, before deciding what needs an extra page visit.
//
//   node --experimental-sqlite scripts/probe-feed.js [keyword] [country]

import fs from 'node:fs';
import { newPage, shutdown } from '../src/scraper/engine.js';
import { buildSearchUrl } from '../src/urlBuilder.js';
import { humanScroll, jitter } from '../src/scraper/humanize.js';

const keyword = process.argv[2] || 'plumbing';
const country = process.argv[3] || 'US';

const page = await newPage();
const bodies = [];

page.on('response', async (res) => {
  try {
    if (!/\/api\/graphql/i.test(res.url())) return;
    const text = await res.text().catch(() => '');
    if (!/collated_results|ad_archive_id/.test(text)) return;
    bodies.push(text);
  } catch {}
});

const url = buildSearchUrl(
  { activeStatus: 'active', adType: 'all', mediaType: 'all', matchType: 'keyword_unordered', keywords: [keyword] },
  country, keyword,
);
console.log('navigating:', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

const deadline = Date.now() + 45000;
while (Date.now() < deadline && bodies.length < 3) {
  await humanScroll(page, 900);
  await jitter(1200, 1800);
}

console.log(`captured ${bodies.length} graphql bodies`);
if (!bodies.length) { await page.close(); await shutdown(); process.exit(1); }

function parse(text) {
  const t = text.replace(/^for\s*\(;;\);/, '').trim();
  try { return [JSON.parse(t)]; } catch {}
  return t.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function findEdges(json) {
  const direct = json?.data?.ad_library_main?.search_results_connection?.edges;
  if (Array.isArray(direct)) return direct;
  const q = [json]; let g = 0;
  while (q.length && g++ < 5000) {
    const cur = q.shift();
    if (!cur || typeof cur !== 'object') continue;
    if (Array.isArray(cur.edges) && cur.edges.some((e) => e?.node?.collated_results || e?.node?.ad_archive_id)) return cur.edges;
    for (const v of Object.values(cur)) if (v && typeof v === 'object') q.push(v);
  }
  return [];
}

let node = null;
for (const b of bodies) {
  for (const j of parse(b)) {
    const e = findEdges(j);
    if (e.length) { node = e.find((x) => x?.node?.collated_results?.length) || e[0]; break; }
  }
  if (node) break;
}

if (!node) { console.log('no node found'); await page.close(); await shutdown(); process.exit(1); }

fs.writeFileSync('/tmp/feed-node.json', JSON.stringify(node, null, 2));
console.log('full node written to /tmp/feed-node.json\n');

const rep = node.node.collated_results?.[0] || node.node;
console.log('── NODE-level keys ──');
console.log(Object.keys(node.node).join(', '));
console.log('\n── AD-level keys ──');
console.log(Object.keys(rep).join(', '));
console.log('\n── snapshot keys ──');
console.log(Object.keys(rep.snapshot || {}).join(', '));

const s = rep.snapshot || {};
console.log('\n── fields we care about ──');
for (const [label, val] of Object.entries({
  page_name: s.page_name,
  page_id: rep.page_id ?? s.page_id,
  page_profile_uri: s.page_profile_uri,
  page_categories: s.page_categories,
  page_like_count: s.page_like_count,
  instagram_actor_name: s.instagram_actor_name,
  instagram_handle: s.instagram_handle,
  instagram_url: s.instagram_url,
  ig_username: s.ig_username,
  ig_followers: s.ig_followers,
  publisher_platform: rep.publisher_platform ?? node.node.publisher_platform,
  collation_count: node.node.collation_count ?? rep.collation_count,
  collation_id: rep.collation_id,
  is_active: rep.is_active,
  start_date: rep.start_date,
  end_date: rep.end_date,
  total_active_time: rep.total_active_time,
  impressions: rep.impressions ?? rep.impressions_with_index,
  cta_type: s.cta_type,
  link_url: s.link_url,
  caption: s.caption,
  body: (s.body?.text || '').slice(0, 80),
})) {
  console.log(`  ${label.padEnd(22)} ${JSON.stringify(val)?.slice(0, 120)}`);
}

// Hunt for anything follower-ish or instagram-ish anywhere in the node.
const hits = [];
(function walk(o, path) {
  if (!o || typeof o !== 'object' || path.length > 6) return;
  for (const [k, v] of Object.entries(o)) {
    if (/follow|like_count|instagram|ig_|profile/i.test(k) && (typeof v !== 'object' || v === null)) {
      hits.push(`${[...path, k].join('.')} = ${JSON.stringify(v)?.slice(0, 80)}`);
    }
    if (v && typeof v === 'object') walk(v, [...path, k]);
  }
})(node, []);
console.log('\n── every follower/instagram-ish field in the node ──');
console.log(hits.length ? [...new Set(hits)].join('\n') : '  (none)');

await page.close();
await shutdown();

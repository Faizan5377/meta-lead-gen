// Save a run's leads to the shared library from a snapshot taken over the API.
//
//   node --experimental-sqlite scripts/save-snapshot.js <snapshot.json>
//
// A run holds its results in memory and writes them in one batch at the end, so
// a run that never reaches its save phase leaves finished leads stranded: real
// contacts, already paid for in Hunter credits, that the library does not know
// about and a later run would therefore collect all over again.
//
// That happened once, to a run wedged inside a hung browser call (watchdog.js
// is the fix). This is the recovery path, and it is idempotent — the upsert is
// keyed on business_key, so running it twice changes nothing.
//
// The snapshot is whatever `GET /api/runs/:id` returns; its `businesses` array
// already holds only finished leads, because the API serves store.keptBusinesses.

import fs from 'node:fs';
import { library } from '../src/library.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: node --experimental-sqlite scripts/save-snapshot.js <snapshot.json>');
  process.exit(1);
}

const snap = JSON.parse(fs.readFileSync(path, 'utf8'));
const leads = snap.businesses || [];
const runId = snap.id || null;

if (!leads.length) {
  console.error(`${path} holds no leads — nothing to save.`);
  process.exit(1);
}

// Refuse to save a half-finished lead: the whole point of the library is that
// what is in it is what you would export.
const incomplete = leads.filter((b) => !b.owner_email);
if (incomplete.length) {
  console.error(`${incomplete.length} of ${leads.length} rows have no decision maker — refusing.`);
  process.exit(1);
}

console.log(`${snap.name || runId}`);
console.log(`  ${leads.length} leads, ${new Set(leads.map((b) => b.owner_email)).size} unique emails`);

await library.init();

const res = await library.save(leads, runId);
console.log(`  saved ${res.saved}${res.remote ? ' to Supabase' : ' locally only'}`
  + `${res.error ? ` — ${res.error}` : ''}`);

// Marks the advertisers as collected, which is what stops the next run
// returning them again.
for (const b of leads) library.note(b.library_id, b.business_key);
console.log(`  ${leads.length} advertisers marked as collected`);

if (snap.counts) {
  await library.saveRun({
    id: runId, name: snap.name, seq: snap.seq, filters: snap.filters,
    target: snap.target, counts: snap.counts, status: 'stopped',
    startedAt: snap.startedAt, finishedAt: new Date().toISOString(),
    errors: snap.errors || [],
  }).catch((err) => console.warn(`  run record not written: ${err.message}`));
}

process.exit(0);

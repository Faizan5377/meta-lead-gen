// Prove the area sweep works: search once, read the viewport Maps settled on,
// then re-run the same query pinned to one neighbouring cell and check the
// second cell returns businesses the first one never had.
//
//   node scripts/probe-sweep.js "Plumbers" "Dallas TX"

import { gridAround, harvestQuery } from '../src/maps/engine.js';
import { shutdown } from '../src/scraper/engine.js';

const query = process.argv[2] || 'Plumbers';
const location = process.argv[3] || 'Dallas TX';

async function sweepOne(at, label) {
  const names = new Map();
  let viewport = null;
  await harvestQuery({
    query, location, language: 'en', region: 'us', at,
    shouldStop: () => names.size >= 200,
    onPlace: (p) => { names.set(p.feature_id, p.name); return true; },
    onViewport: (v) => { viewport = v; },
    onError: (e) => console.log(`  ! ${e.scope}: ${e.message}`),
  });
  console.log(`${label}: ${names.size} places`);
  return { names, viewport };
}

const centre = await sweepOne(null, 'centre');
if (!centre.viewport) {
  console.log('no viewport read — the sweep would be skipped');
} else {
  console.log('viewport:', centre.viewport);
  const cells = gridAround(centre.viewport, 1);
  console.log(`${cells.length} cells; probing the first two`);

  let fresh = 0;
  for (const cell of cells.slice(0, 2)) {
    const r = await sweepOne(cell, `cell @${cell.lat},${cell.lng},${cell.zoom}z`);
    const newOnes = [...r.names.keys()].filter((id) => !centre.names.has(id));
    newOnes.forEach((id) => centre.names.set(id, r.names.get(id)));
    fresh += newOnes.length;
    console.log(`  ${newOnes.length} NOT in the centre search`);
  }
  console.log(`\ntotal unique after 2 of ${cells.length} cells: ${centre.names.size} (+${fresh})`);
}

await shutdown();

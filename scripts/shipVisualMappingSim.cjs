/** Static contract: tactical composition labels must resolve to usable 3D profiles. */
const fs = require('node:fs');
const modelSource = fs.readFileSync('./frontend/src/game/three/shipModels.ts', 'utf8');
const overlaySource = fs.readFileSync('./frontend/src/game/three/Battle3DOverlay.ts', 'utf8');

let passed = 0;
let failed = 0;
function check(name, condition) {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}\n`);
  if (condition) passed++;
  else failed++;
}

console.log('\n=== Tactical ship visual mappings ===');
check('carrier composition label maps to carrier model key', modelSource.includes("'空母': 'carrier'"));
check('fighter composition label maps to fighter model key', modelSource.includes("'舰载': 'fighter'"));
check('electronic warfare ships have a cruiser fallback when dedicated GLB is absent', overlaySource.includes("${factionKey}_cruiser.glb"));
check('electronic warfare ships keep cruiser-scale dimensions during the fallback', overlaySource.includes('electronic:       { L: 0.556'));

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;

/** Static contract: new ship GLBs receive generated LODs before dev/build starts. */
const fs = require('node:fs');
const pkg = JSON.parse(fs.readFileSync('./frontend/package.json', 'utf8'));
const generator = './frontend/scripts/generateShipLods.mjs';
const source = fs.existsSync(generator) ? fs.readFileSync(generator, 'utf8') : '';
const vite = fs.readFileSync('./frontend/vite.config.ts', 'utf8');

let passed = 0;
let failed = 0;
function check(name, condition) {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}\n`);
  if (condition) passed++; else failed++;
}

console.log('\n=== Ship LOD generation pipeline ===');
check('dev starts with an incremental ship LOD generation pass', String(pkg.scripts?.predev || '').includes('generateShipLods'));
check('production build starts with the same LOD generation pass', String(pkg.scripts?.prebuild || '').includes('generateShipLods'));
check('dev server watches source GLBs and refreshes after automatic generation', vite.includes('shipLodWatchPlugin'));
check('generator ignores already-generated lod files', source.includes("/\\.lod[12]\\.glb$/i"));
check('generator uses meshopt simplification at both required ratios', source.includes('ratio: 0.20') && source.includes('ratio: 0.05'));
check('generator writes the runtime LOD manifest', source.includes('shipLodManifest.json'));

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;

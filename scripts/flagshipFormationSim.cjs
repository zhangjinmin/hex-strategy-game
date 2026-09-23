/** Static contract: flagship identity is independent from formation slot and starts at the rear. */
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const layout = fs.readFileSync('./frontend/src/config/formationLayout.ts', 'utf8');
const scene = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
const overlay = fs.readFileSync('./frontend/src/game/three/Battle3DOverlay.ts', 'utf8');

let passed = 0;
let failed = 0;
function check(name, condition) {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}\n`);
  if (condition) passed++;
  else failed++;
}

console.log('\n=== Flagship rear command position ===');
const compiled = ts.transpileModule(layout, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleBox = { exports: {} };
vm.runInNewContext(compiled, { module: moduleBox, exports: moduleBox.exports, require });
const wedge = moduleBox.exports.formationOffsets('wedge', 49);
const commandSlot = moduleBox.exports.rearCommandSlot(wedge);
const [commandGx, commandGy] = wedge[commandSlot];
const rearMostGx = Math.min(...wedge.map(([gx]) => gx));
check('formation layout exports a deterministic rear-centre slot selector', layout.includes('export function rearCommandSlot'));
check('flagship command slot stays in the protected rear-middle instead of the outer rear row', commandGx > rearMostGx && Math.abs(commandGy) <= 0.5,
  `slot=${commandSlot}, gx=${commandGx}, gy=${commandGy}, rear=${rearMostGx}`);
check('battle deployment assigns the flagship to that rear command slot', scene.includes('placeFlagshipAtRear') && scene.includes('rearCommandSlot('));
check('flagship loss checks identity instead of the mutable units[0] index', scene.includes('u.isFlagship === true'));
check('3D flagship effects consume the persistent flagship identity', overlay.includes('u.isFlagship === true'));

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;

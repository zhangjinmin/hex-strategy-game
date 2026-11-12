const { formationOffsets } = require('../frontend/src/config/formationLayout.ts');
for (let n = 18; n <= 48; n++) {
  const offs = formationOffsets('wedge', n);
  const rows = new Map();
  for (const [gx] of offs) rows.set(gx, (rows.get(gx) || 0) + 1);
  const keys = [...rows.keys()].sort((a, b) => b - a);
  const w = keys.map((k) => rows.get(k));
  const jump = w.length > 1 ? w[w.length - 1] - w[w.length - 2] : 0;
  console.log(`n=${String(n).padStart(3)} rows=${w.length} widths=[${w.join(',')}]  末排跳变=+${jump}`);
}

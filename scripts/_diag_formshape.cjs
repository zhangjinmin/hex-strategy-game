/** 临时诊断：各阵型几何是否有"洞"（不进 git） */
const { formationOffsets, rearCommandSlot, formationSpacing } = require('../frontend/src/config/formationLayout.ts');

for (const f of ['wedge', 'line', 'spindle', 'circle', 'square']) {
  for (const n of [7, 33, 60]) {
    const offs = formationOffsets(f, n);
    const seen = new Set();
    let dupN = 0;
    for (const [x, y] of offs) { const k = x + ',' + y; if (seen.has(k)) dupN++; seen.add(k); }
    let maxNN = 0;
    let holeAt = null;
    for (const a of offs) {
      let best = Infinity;
      for (const b of offs) {
        if (a === b) continue;
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (d < best) best = d;
      }
      if (Number.isFinite(best) && best > maxNN) { maxNN = best; holeAt = a; }
    }
    const sp = formationSpacing(offs, 30);
    console.log(
      `${f.padEnd(8)} n=${String(n).padStart(3)} cells=${String(offs.length).padStart(3)} dup=${dupN}` +
      ` maxNN=${maxNN.toFixed(2)}格@${JSON.stringify(holeAt)} spacing=${sp.toFixed(2)}px cmd=${rearCommandSlot(offs)}`,
    );
  }
}

// 楔形各排宽度与排间距（检查排头是否有空档）
const offs = formationOffsets('wedge', 33);
const rows = new Map();
for (const [gx, gy] of offs) { if (!rows.has(gx)) rows.set(gx, []); rows.get(gx).push(gy); }
console.log('\nwedge n=33 按排（gx 从 0 向负方向 = 由前到后）:');
for (const gx of [...rows.keys()].sort((a, b) => b - a)) {
  const gys = rows.get(gx).sort((a, b) => a - b);
  console.log(`  gx=${String(gx).padStart(3)} 宽=${gys.length} gy=[${gys.join(',')}]`);
}

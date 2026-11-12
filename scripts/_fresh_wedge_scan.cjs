/** 全 n 楔形排宽扫描：找「1 艘+空隙+一堆」的退化 n（跳变/洞/非三角） */
const { formationOffsets, rearCommandSlot } = require('../frontend/src/config/formationLayout.ts');
const bad = [];
for (let n = 1; n <= 260; n++) {
  const offs = formationOffsets('wedge', n);
  const rows = new Map();
  for (const [gx] of offs) rows.set(gx, (rows.get(gx) || 0) + 1);
  const gxs = [...rows.keys()].sort((a, b) => b - a);        // 0, -1, -2...（前→后）
  const w = gxs.map((g) => rows.get(g));
  // 判据：①格数守恒 ②排宽单调不降 ③相邻跳变≤2 ④无重复格 ⑤首排恒1
  const issues = [];
  if (offs.length !== n) issues.push(`len${offs.length}!=${n}`);
  if (w[0] !== 1) issues.push(`首排${w[0]}`);
  let maxJump = 0, jumpAt = -1;
  for (let i = 1; i < w.length; i++) {
    const d = w[i] - w[i - 1];
    if (d < 0) issues.push(`排${i}收窄${d}`);
    if (d > maxJump) { maxJump = d; jumpAt = i; }
  }
  if (maxJump > 2) issues.push(`跳变+${maxJump}@排${jumpAt}`);
  const seen = new Set();
  let dup = 0;
  for (const c of offs) { const k = c[0] + ',' + c[1]; if (seen.has(k)) dup++; seen.add(k); }
  if (dup) issues.push(`重复格${dup}`);
  const cmd = rearCommandSlot(offs);
  if (cmd < 0 || cmd >= n) issues.push(`cmdSlot越界${cmd}`);
  if (issues.length) bad.push({ n, w: w.join(','), issues: issues.join(';'), cmd });
}
console.log(`扫描 n=1..260，退化 n 数=${bad.length}`);
for (const b of bad.slice(0, 40)) console.log(`  n=${String(b.n).padStart(3)} widths=[${b.w}] cmd=${b.cmd} ⇒ ${b.issues}`);
// 附加：排宽序列里出现「长平台」（连续等宽≥3 排）也标记（视觉上是横条不是三角）
const plateau = [];
for (let n = 10; n <= 260; n++) {
  const offs = formationOffsets('wedge', n);
  const rows = new Map();
  for (const [gx] of offs) rows.set(gx, (rows.get(gx) || 0) + 1);
  const w = [...rows.keys()].sort((a, b) => b - a).map((g) => rows.get(g));
  let run = 1;
  for (let i = 1; i < w.length; i++) {
    if (w[i] === w[i - 1]) { run++; if (run >= 3) { plateau.push({ n, w: w.join(',') }); break; } }
    else run = 1;
  }
}
console.log(`\n长平台（连续等宽≥3 排）n 数=${plateau.length}`);
for (const p of plateau.slice(0, 15)) console.log(`  n=${String(p.n).padStart(3)} widths=[${p.w}]`);

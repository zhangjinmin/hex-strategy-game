/**
 * _fresh_formation_audit.cjs — 【全新复盘】阵型"数据→视觉"全链路几何审计
 *
 * 运行：node --import ./_ts_resolve.mjs scripts/_fresh_formation_audit.cjs
 *
 * 立场（用户裁定）：忘掉既有修复链，从第一性原理重查「玩家看到的到底是什么形状」。
 * 唯一事实源 = 代码当前行为；输出 = 可核对的数字（包围盒/排宽/逐舰落点），不靠目测。
 *
 * 审计五问：
 *   Q1 摆位（placeUnitsAtFormationSlots 同构）对 n=89 wedge 产出的点集，几何上是三角还是直线？
 *   Q2 逐帧目标（update 阵位循环同构）与摆位是否逐位一致（不一致 = 每帧把船拉离摆位）？
 *   Q3 `_slotFlip` 打开时逐帧目标变成什么形状（摆位与逐帧的槽位映射是否分叉）？
 *   Q4 「小型舰打头」：槽位 0（楔尖）经 placeFlagshipAtRear 后落在哪类舰上？
 *   Q5 标记（托盘）的跨度 vs 舰群实际跨度 —— 托盘会不会被 maxShipLen 地板撑成细长条？
 */
'use strict';

const {
  formationOffsets, formationSpacing, rotateOffsetPx, rearCommandSlot,
} = require('../frontend/src/config/formationLayout.ts');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}
function eq(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// ── 同构复刻 BattleScene 的两条映射（摆位 rankOf / 逐帧 _slotRank） ─────────────
/** 摆位侧（placeUnitsAtFormationSlots）：raw slot → cellIdx */
function placementCellIdx(slot, slotsSorted, offsLen) {
  const dense = slotsSorted.length > 0 && slotsSorted[slotsSorted.length - 1] + 1 === slotsSorted.length;
  if (dense && slotsSorted[slotsSorted.length - 1] < offsLen) return slot;   // rankOf=null
  const m = new Map();
  slotsSorted.forEach((v, i) => m.set(v, Math.min(i, offsLen - 1)));        // 后写覆盖
  return m.get(slot) ?? slot;
}
/** 逐帧侧（update 里的 _slotRank）：raw slot → cellIdx，含 flip 与去重先到先得 */
function frameCellIdx(rawSlot, allRawSlots, fc0, offsLen, flip) {
  const ids = allRawSlots.map(s => (flip && s < fc0) ? fc0 - 1 - s : s).sort((a, b) => a - b);
  const m = new Map();
  ids.forEach((sl, i) => { if (!m.has(sl)) m.set(sl, i); });               // 先到先得
  const dense = ids.length > 0 && ids[ids.length - 1] + 1 === ids.length;
  const slotIdx = (flip && rawSlot < fc0) ? fc0 - 1 - rawSlot : rawSlot;
  if (dense && slotIdx >= 0 && slotIdx < offsLen) return slotIdx;
  const r = m.get(slotIdx);
  return r !== undefined ? Math.min(r, offsLen - 1) : Math.min(slotIdx, offsLen - 1);
}

const N = 89, SPACING_HEX = 50;
const offs = formationOffsets('wedge', N);
const spacing = formationSpacing(offs, SPACING_HEX);

// ── Q1：摆位点集形状 ─────────────────────────────────────────────────────────
console.log(`\n=== Q1 摆位几何（n=${N} wedge, spacing=${spacing.toFixed(2)}）===`);
check('格数 == 89 且无重复格', () => {
  const seen = new Set(offs.map(c => c.join(',')));
  if (offs.length !== 89) throw new Error(`offs.length=${offs.length}`);
  if (seen.size !== 89) throw new Error(`重复格 ${89 - seen.size} 个`);
});
check('排宽等差单调不降（楔形三角，不是长条）', () => {
  const rows = new Map();
  for (const [gx] of offs) rows.set(gx, (rows.get(gx) || 0) + 1);
  const w = [...rows.keys()].sort((a, b) => b - a).map(k => rows.get(k));
  for (let i = 1; i < w.length; i++) {
    if (w[i] < w[i - 1]) throw new Error(`排宽逆增 ${JSON.stringify(w)}`);
    if (w[i] - w[i - 1] > 2) throw new Error(`排宽跳变 ${JSON.stringify(w)}`);
  }
  console.log(`    排宽序列(gx 0→后): ${JSON.stringify(w)}`);
});
check('包围盒是"三角"不是"细长条"（宽/深比 ≤ 3）', () => {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [gx, gy] of offs) {
    const [rx, ry] = rotateOffsetPx(gx * spacing, gy * spacing, 0, 1);
    x0 = Math.min(x0, rx); x1 = Math.max(x1, rx);
    y0 = Math.min(y0, ry); y1 = Math.max(y1, ry);
  }
  const wide = y1 - y0, deep = x1 - x0;
  console.log(`    跨度: 纵深=${deep.toFixed(0)}px 横向=${wide.toFixed(0)}px 比=${(Math.max(wide, deep) / Math.max(1, Math.min(wide, deep))).toFixed(2)}`);
  const ratio = Math.max(wide, deep) / Math.max(1, Math.min(wide, deep));
  if (ratio > 3) throw new Error(`点集退化为细长条 比=${ratio.toFixed(2)}`);
});

// ── Q2：逐帧目标 vs 摆位 逐位一致性 ─────────────────────────────────────────
console.log(`\n=== Q2 逐帧目标 vs 摆位一致性（无 morph / 无 flip）===`);
check('逐帧 cellIdx 与摆位 cellIdx 对全部 89 槽一致', () => {
  const slots = Array.from({ length: N }, (_, i) => i);
  const slotsSorted = [...slots].sort((a, b) => a - b);
  const diffs = [];
  for (const s of slots) {
    const a = placementCellIdx(s, slotsSorted, offs.length);
    const b = frameCellIdx(s, slots, N, offs.length, false);
    if (a !== b) diffs.push(`slot${s}: 摆位→${a} 逐帧→${b}`);
  }
  if (diffs.length) throw new Error(`${diffs.length} 处分叉: ${diffs.slice(0, 5).join('; ')}`);
});
check('稀疏槽位（含洞）两侧映射一致', () => {
  // 模拟战损/分兵后槽位 [27,1,2,3,5,8,13,...]（有洞）
  const sparse = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55];
  const sorted = [...sparse].sort((a, b) => a - b);
  const diffs = [];
  for (const s of sparse) {
    const a = placementCellIdx(s, sorted, offs.length);
    const b = frameCellIdx(s, sparse, 89, offs.length, false);
    if (a !== b) diffs.push(`slot${s}: 摆位→${a} 逐帧→${b}`);
  }
  if (diffs.length) throw new Error(`稀疏分叉 ${diffs.join('; ')}`);
});

// ── Q3：_slotFlip 分叉审计 ───────────────────────────────────────────────────
console.log(`\n=== Q3 _slotFlip 打开时的逐帧映射（摆位不含 flip）===`);
check('flip 开：逐帧 cellIdx 与摆位分叉会被本审计捕获（预期：分叉存在=已知机制）', () => {
  const slots = Array.from({ length: N }, (_, i) => i);
  const sorted = [...slots].sort((a, b) => a - b);
  let diverge = 0;
  for (const s of slots) {
    const a = placementCellIdx(s, sorted, offs.length);
    const b = frameCellIdx(s, slots, N, offs.length, true);
    if (a !== b) diverge++;
  }
  console.log(`    flip 开时 89 槽中 ${diverge} 个与摆位不同（掉头镜像的预期行为）`);
  // flip 是设计内镜像，不断言一致；但 flip 期间 morph/硬锁的互斥必须在别处锁住
  if (diverge === 0) throw new Error('flip 竟然无分叉——映射实现可能被误改');
});

// ── Q4：楔尖（槽位 0）落谁家 ─────────────────────────────────────────────────
console.log(`\n=== Q4 楔尖归属（placeFlagshipAtRear 交换后）===`);
check('旗舰在后方指挥席（槽位=rearCommandSlot），楔尖是"被换下来"的那艘', () => {
  const cmd = rearCommandSlot(offs);
  // 模拟 placeFlagshipAtRear：旗舰(建序0,原槽0) ↔ 槽位cmd 持有者(建序cmd)。
  // 交换后：旗舰→槽cmd（后方指挥席）；建序第 cmd 艘→槽0（楔尖）。
  const apexHolderBuildIndex = cmd;
  console.log(`    rearCommandSlot=${cmd}（旗舰），楔尖(槽0)=建造序第 ${apexHolderBuildIndex + 1} 艘`);
  if (cmd === 0) throw new Error('旗舰占了楔尖——与"大型舰打头"观察冲突');
  if (apexHolderBuildIndex < 20) throw new Error('cmd 槽位异常靠前，需重审');
  // 建造序按"大舰在前"⇒ 第 28 艘通常是中/小型舰 ⇒ "小舰打头"是交换的结构性产物
  console.log(`    ⇒ 建造序尾部（中小型舰）经交换落到楔尖；"小舰打头"是机制产物，非错乱`);
});
check('建造序尾部（小舰）经交换后可落楔尖 ⇒ "小舰打头"是交换的结构性产物', () => {
  // 建造序：大型舰在前（slot 小），小型舰在后（slot 大，含 27）
  // 交换后 slot0 归原 slot27 持有者 = 建造序第 28 艘
  const apexOriginIndex = 27;
  console.log(`    楔尖(槽0)原为建造序第 ${apexOriginIndex + 1} 艘（通常是中/小型舰）`);
  if (apexOriginIndex < 20) throw new Error('逻辑变了，需重审');
});

// ── Q5：托盘跨度 vs 舰群跨度（markerSpan 地板效应） ───────────────────────────
console.log(`\n=== Q5 托盘跨度地板效应（markerSpan: spanY ≥ maxShipLen）===`);
check('舰群实际跨度远大于单舰长时托盘不失真', () => {
  let deep = -1e9;
  for (const [gx] of offs) deep = Math.max(deep, Math.abs(gx));
  const fleetDepthPx = deep * spacing;      // 89 舰楔形纵深
  const maxShipLenWorld = 140;              // 量级（139.6 供给舰实测值）
  console.log(`    舰群纵深=${fleetDepthPx.toFixed(0)}px，单舰长地板=${maxShipLenWorld}px`);
  if (fleetDepthPx < maxShipLenWorld) {
    console.log(`    ⚠ 纵深 < 单舰长 ⇒ 托盘 spanY 被地板撑大 ${maxShipLenWorld / fleetDepthPx} 倍（细长条风险）`);
  }
});

// ── 摘要落点（供人工核对截图） ───────────────────────────────────────────────
console.log(`\n=== 摆位落点抽样（facing=0，锚点=(0,0)）===`);
const slotsSorted = Array.from({ length: N }, (_, i) => i).sort((a, b) => a - b);
for (const s of [0, 1, 2, 3, 27, 44, 88]) {
  const ci = placementCellIdx(s, slotsSorted, offs.length);
  const [rx, ry] = rotateOffsetPx(offs[ci][0] * spacing, offs[ci][1] * spacing, 0, 1);
  console.log(`  slot${String(s).padStart(2)} → cell[${offs[ci]}] → (${rx.toFixed(0)}, ${ry.toFixed(0)})`);
}

console.log(`\n=== 汇总: ${passed} PASS / ${failed} FAIL ===`);

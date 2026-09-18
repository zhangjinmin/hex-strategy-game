/**
 * 战术层「阵型排布」单一真源。
 *
 * 为什么需要它：原实现（BattleScene 内联的 `positions` 表）每种阵型只有 8 个硬编码坐标，
 * 用 `coords[index]?.[0] || 0` 取值 —— index ≥ 8 时全部塌到 [0,0]（一堆单位叠在旗舰上），
 * 而 `square` / `line` 的分支用 index 直接乘格距，index 一大会把单位送出地图。
 * 兵力折算层落地后单场实体数可达 30~200，阵型必须能随 n 缩放。
 *
 * 轴约定（沿用 BattleScene 既有约定，勿在此模块内做 fAngle 旋转）：
 *   gx = 舰队前进轴（+ = 朝敌），gy = 横向；相邻格中心距 1.0。
 *   调用方负责 `ox = gx * spacing`、`oy = gy * spacing` 再按 fAngle 旋转。
 *
 * 锚点约定（与改动前一致）：index 0 = 旗舰位，恒为 [0,0]；其余格相对它展开。
 *   各阵型的舰队主体都在 gx ≤ 0 一侧（即舰队本体朝向由调用方的 fAngle 决定），
 *   只有 circle / square 因「中心向外」而天然向两侧对称铺开。
 *
 * 形状词汇与 battle-dot-demo 的 layoutSlots 同源（楔=三角阵列 / 横=宽正面 /
 * 纺=细长透镜 / 圆=同心环 / 方=中心向外网格）。
 */
import type { FormationType } from './formations';

/** 单元格偏移：[gx（前进轴）, gy（横向）] */
export type FormationCell = [number, number];

/**
 * 相邻格中心距（像素）。
 *
 * 28 → 26（【大军团】缩舰同步）：格距的硬约束是"同排相邻舰不互穿"，即 ≥ 舰宽；
 * 而"读起来是不是一支密集军团"取决于 **舰长 ≈ 格距**（否则一艘舰横跨 2~3 个格位，
 * 整支舰队糊成一条连续船带）。缩舰前战列舰长 63.5 ⇒ 28 只能勉强容纳舰宽，
 * 舰长远超格距；缩到 `SHIP_VISUAL_SCALE = 0.40` 后战列舰长 25.4 ⇒ 格距取 26
 * 使"一格一舰"成立，同时整队足迹比缩舰前小 ~7%，军团更紧凑。
 * 不互穿仍满足：最宽舰 carrier W = 0.311×√3×hexR×0.40 = 10.77 < 26 ✓（hexR=50）。
 */
export const FORMATION_SPACING = 26;

/**
 * 阵型半跨上限的相对系数：半跨 ≤ hexRadius × FORMATION_FOOTPRINT_LIMIT。
 *
 * 本系数唯一的硬约束是"压缩后的格距不得小于舰宽"，否则同排相邻舰互穿。
 *
 * ⚠ 舰宽已随 `SHIP_VISUAL_SCALE = 0.42` 缩到 0.42 倍（Battle3DOverlay.ts，【大军团】缩舰）：
 *   最宽舰 carrier W = 0.311×√3×hexR×0.42 = **0.2263×hexR**（hexR=50 ⇒ 11.31，缩舰前是 26.93）。
 *   ⇒ 不互穿约束放松约 2.4 倍：
 *     未压缩：28 ≥ 0.2263×hexR ⇒ hexR ≤ 123（会战期 50 ✓，余量很大）
 *     压缩  ：FL×hexR/halfExtent ≥ 0.2263×hexR ⇒ halfExtent ≤ FL/0.2263 = 4.42×FL
 *     与"保持 28 不压缩"的条件 halfExtent ≤ FL×hexR/28 = 1.786×FL 合并 ⇒ halfExtent ≤ 1.786×FL
 *     （**与缩舰无关**——该边界只由 FORMATION_SPACING/hexR 决定）
 *   FL=4 ⇒ halfExtent ≤ 7.14 ⇒ 楔形 R ≤ 8 ⇒ n ≤ 64（旧的 N_MAX_PER_FLEET，正是这个来由）
 *   FL=6 ⇒ halfExtent ≤ 10.7 ⇒ R ≤ 11 ⇒ n ≤ 121 ⇒ 支持 N_MAX_PER_FLEET=120 而格距仍为 28（不互穿）
 * 代价：足迹上限从 4×hexR 抬到 6×hexR。hexR=50 时半跨上限 200px → 300px（整跨 600px），
 * 是棋盘（会战地图 ~1900~2500px）的 ~1/4，仍留得下多舰队战场，可接受。
 */
export const FORMATION_FOOTPRINT_LIMIT = 6;

/** 把宽度序列的中心对齐成 gy 偏移（even 宽度会落在半整数上，仍互不重复） */
function centeredGy(width: number, k: number): number {
  return k - (width - 1) / 2;
}

/**
 * 楔形（突破）：等腰三角，顶点朝前（gx 最大 = 0），逐排加宽向后方展开。
 * 第 r 排 gx = -r，宽度沿排号线性增长（r=0 为顶点、宽 1）。
 * 行宽总和恰好为 n：先按理想比例取整，再从末排往回收，保持宽度单调不降（形状仍是三角）。
 */
function wedgeCells(n: number): FormationCell[] {
  const R = Math.max(1, Math.ceil(Math.sqrt(n)));
  // 理想宽度：w_r ∝ (r+1)，由 Σ w = n 定标 → Wmax = 2n/(R+1)
  const Wmax = (2 * n) / (R + 1);
  const w: number[] = [];
  for (let r = 0; r < R; r++) w.push(Math.max(1, Math.round((Wmax * (r + 1)) / R)));

  // 顶点排恒宽 1：锚点（index 0）必须落在 [0,0]，且楔形本就该是一个尖
  w[0] = 1;
  let sum = w.reduce((a, b) => a + b, 0);
  // 取整后总量可能偏差：先试着从末排往回收（不低于前一排，维持三角的单调性）
  while (sum > n) {
    let trimmed = false;
    for (let r = R - 1; r >= 1 && sum > n; r--) {
      while (sum > n && w[r] > w[r - 1]) { w[r] -= 1; sum -= 1; trimmed = true; }
    }
    if (!trimmed) {
      // 已单调仍超量（罕见）：从末排硬削，仅作兜底
      for (let r = R - 1; r >= 1 && sum > n; r--) {
        while (sum > n && w[r] > 1) { w[r] -= 1; sum -= 1; trimmed = true; }
      }
      if (!trimmed) break;
    }
  }
  // 欠量：补到末排（末排最宽，补上仍是三角）
  if (sum < n) w[R - 1] += n - sum;

  const out: FormationCell[] = [];
  for (let r = 0; r < R; r++) {
    for (let k = 0; k < w[r]; k++) out.push([-r, centeredGy(w[r], k)]);
  }
  return out;
}

/**
 * 横阵（宽正面）：宽沿 gy、浅纵深沿 gx。纵横比 A≈8:1。
 * W = ceil(sqrt(n*A)) 列、R = ceil(n/W) 行；旗舰在**前排中央**，
 * 每排自中央向两侧交替展开（保证 index 0 落在 gy≈0 的中央格）。
 * 排宽由 n 均分到 R 排（floor/余数），使最宽排与最窄排只差 1 —— 与 demo 的三排 [17,16,16] 一致；
 * 贪心填满会让末排只剩残排（n=49 时 [20,20,9]），视觉上是一个缺角的梯形块。
 */
function lineCells(n: number): FormationCell[] {
  const A = 8;
  const W = Math.max(1, Math.ceil(Math.sqrt(n * A)));
  const R = Math.max(1, Math.ceil(n / W));
  const out: FormationCell[] = [];
  const baseW = Math.floor(n / R); const remW = n % R;
  for (let r = 0; r < R; r++) {
    const width = baseW + (r < remW ? 1 : 0);
    // 中央向外：|gy| 升序，同距先取小 gy（确定性）
    const order = Array.from({ length: width }, (_, k) => k)
      .sort((a, b) => Math.abs(centeredGy(width, a)) - Math.abs(centeredGy(width, b))
        || centeredGy(width, a) - centeredGy(width, b));
    for (const k of order) { out.push([-r, centeredGy(width, k)]); }
  }
  return out;
}

/**
 * 纺锤（细长、长轴对敌）：长轴 = gx，纵横比 A=2.6 取自 battle-dot-demo 的 layoutSlots
 *   （其 SPINDLE_K = [0,1,1,2,2,2,2,2,2,2,1,1,0] → L=13 排 / maxW=5 → L/maxW = 2.6）。
 * 余量补 / 超出削都只在**内部排**里挑（i ∈ [1, L-2]）：两端是锥尖，
 * 恒由 `w[0] = w[L-1] = 1` 钉住 —— 否则余量会被补到端排，把锥尖从 1 抬到 2（钝头）。
 * 逐排宽度按透镜剖面 w(i) = max(1, round(Wmax * sin(π(i+0.5)/L)))，Σw = n；
 * 两端为锥尖（宽度强制 1）→ index 0 = 前方锥尖。
 * 小 n 时透镜展不开，会退化成单列（仍是「细长」，纵横比最接近 2.6）。
 */
function spindleCells(n: number): FormationCell[] {
  const A = 2.6;
  let best: { L: number; w: number[]; maxW: number; score: number } | null = null;

  for (let L = 3; L <= n; L++) {
    const prof: number[] = [];
    for (let i = 0; i < L; i++) prof.push(Math.sin((Math.PI * (i + 0.5)) / L));
    const sumP = prof.reduce((a, b) => a + b, 0);
    if (sumP <= 0) continue;

    const W0 = Math.round(n / sumP);
    for (const cand of [W0, W0 + 1, W0 - 1, W0 + 2, W0 - 2]) {
      const Wmax = Math.max(1, cand);
      const w = prof.map((p) => Math.max(1, Math.round(Wmax * p)));
      w[0] = 1; w[L - 1] = 1; // 锥尖恒为 1 → index 0 落在 [0,0]
      let sum = w.reduce((a, b) => a + b, 0);
      if (sum < n) {
        // 余量补到剖面最宽处（按 (Wmax*p - w) 余数降序）
        const idx = Array.from({ length: L }, (_, i) => i)
          .filter((i) => i > 0 && i < L - 1)
          .sort((a, b) => (Wmax * prof[b] - w[b]) - (Wmax * prof[a] - w[a]));
        let need = n - sum; let t = 0;
        const guard = Math.max(idx.length * 8 + 16, n * 4 + 64);
        while (need > 0 && t < guard) { w[idx[t % idx.length]] += 1; need -= 1; t += 1; }
        sum = w.reduce((a, b) => a + b, 0);
      } else if (sum > n) {
        // 超出：从剖面最窄处（两端）先削，但不削到 1 以下
        const idx = Array.from({ length: L }, (_, i) => i)
          .filter((i) => i > 0 && i < L - 1)
          .sort((a, b) => (Wmax * prof[a] - w[a]) - (Wmax * prof[b] - w[b]));
        let over = sum - n; let t = 0;
        const guard = Math.max(idx.length * 8 + 16, n * 4 + 64);
        while (over > 0 && t < guard) {
          const i = idx[t % idx.length];
          if (w[i] > 1) { w[i] -= 1; over -= 1; }
          t += 1;
        }
        sum = w.reduce((a, b) => a + b, 0);
      }
      if (sum !== n) continue;
      const maxW = Math.max(...w);
      const score = Math.abs(L / maxW - A);
      if (!best || score < best.score - 1e-9
        || (Math.abs(score - best.score) < 1e-9 && (maxW > best.maxW || (maxW === best.maxW && L < best.L)))) {
        best = { L, w, maxW, score };
      }
    }
  }

  // 理论上必有解（L = n 时全宽 1、总和 = n）；兜底用单列
  if (!best) return Array.from({ length: n }, (_, i) => [-i, 0] as FormationCell);

  const out: FormationCell[] = [];
  for (let i = 0; i < best.L; i++) {
    for (let k = 0; k < best.w[i]; k++) out.push([-i, centeredGy(best.w[i], k)]);
  }
  return out.slice(0, n);
}

/**
 * 圆阵（环）：整数格点按到原点距离升序取前 n 个（中心 + 同心环），天然近似圆。
 * 同半径按极角排序，使同一环按圆周顺序产出。
 */
function circleCells(n: number): FormationCell[] {
  const R = Math.ceil(Math.sqrt(n)) + 1;
  const pts: { a: number; b: number; d2: number; ang: number }[] = [];
  for (let a = -R; a <= R; a++) {
    for (let b = -R; b <= R; b++) {
      pts.push({ a, b, d2: a * a + b * b, ang: Math.atan2(b, a) });
    }
  }
  pts.sort((p, q) => p.d2 - q.d2 || p.ang - q.ang || p.a - q.a || p.b - q.b);
  return pts.slice(0, n).map((p) => [p.a, p.b] as FormationCell);
}

/**
 * 方阵（网格）：cols = ceil(sqrt(n))、rows = ceil(n/cols) 的紧凑网格，
 * 按**中心向外的螺旋序**产出（index 0 = 中心格），取前 n 个。
 */
function squareCells(n: number): FormationCell[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const i0 = Math.floor((cols - 1) / 2);
  const j0 = Math.floor((rows - 1) / 2);
  const inBox = (i: number, j: number) => i >= 0 && i < cols && j >= 0 && j < rows;

  const box: FormationCell[] = [];
  const seen = new Set<string>();
  let i = i0; let j = j0; let dir = 0; let len = 1;
  const DIR: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const total = cols * rows;
  const guard = total * 4 + 64;
  let steps = 0;
  const push = () => {
    if (!inBox(i, j)) return;
    const key = `${i},${j}`;
    if (seen.has(key)) return;
    seen.add(key);
    box.push([i - (cols - 1) / 2, j - (rows - 1) / 2]);
  };
  push();
  while (box.length < total && steps < guard) {
    for (let rep = 0; rep < 2 && box.length < total; rep++) {
      for (let s = 0; s < len && box.length < total; s++) {
        i += DIR[dir][0]; j += DIR[dir][1];
        push();
      }
      dir = (dir + 1) % 4;
    }
    len += 1;
    steps += 1;
  }
  return box.slice(0, n);
}

/**
 * 阵型格位偏移（单位 = 格位）。长度恒等于 n、格位互不重复、index 0 = 旗舰位 = [0,0]。
 * @param formation 阵型 id；未知值退化为 wedge
 * @param n         本舰队参与阵型定位的实体数（不含运输舰）；<= 0 → []
 */
export function formationOffsets(formation: FormationType | string, n: number): FormationCell[] {
  if (!(n > 0)) return [];
  if (n === 1) return [[0, 0]];
  let cells: FormationCell[];
  switch (formation) {
    case 'line': cells = lineCells(n); break;
    case 'spindle': cells = spindleCells(n); break;
    case 'circle': cells = circleCells(n); break;
    case 'square': cells = squareCells(n); break;
    case 'wedge':
    default: cells = wedgeCells(n); break;
  }
  // 归一化：把 index 0（旗舰位）平移到原点。
  // 偶数宽度的排没有真正的中心格（中心落在半格上），此处整体平移半格让旗舰恰好落在 [0,0]，
  // 代价是编队相对 gy=0 有半格不对称（28px 格距下 = 14px），换取锚点语义与改动前一致。
  const [x0, y0] = cells[0];
  if (x0 !== 0 || y0 !== 0) cells = cells.map(([gx, gy]) => [gx - x0, gy - y0] as FormationCell);
  return cells;
}

/**
 * 队内垂直分层**偏移**：单位 = 1 个层距（gap）的乘数，按实际用到的层号极值居中。
 *
 * ── 为什么不用 `rank % Leff`（旧实现，已废）────────────────────────────────
 * 旧实现按排序键 `(gx, gy)` 取名次 rank 再 `rank % Leff`。同一排（同 gx）内 gy 连续
 * ⇒ rank 连续 ⇒ **层号沿排单调递增** ⇒ 每一排从侧面看都是一条斜线。
 * 独立台架实测：**73.3% 的多格排层号单调**（96/131）；`line n=6/8` 在 10 个视角
 * PCA 各向异性 = 1.0000（投影退化成一条线）。旧判据 `staircaseIndex == 0`
 * 对此**结构性失明**：`rank % L` 让相邻名次必然换层，故它恒为 0（历史 QA 一直 PASS），
 * 从未检测"排内单调"这个真正的缺陷维度。
 *
 * ── 主算法：R2 低差异序列 ─────────────────────────────────────────────────
 * `li = floor(frac(k·α + r·β) · L)`，α = 1/φ、β = 1/φ²。
 *   · k = 该排内的格位序号（按 gy 升序，从 0 起）
 *   · r = 排号（按 gx 升序，从 0 起）
 * 两个无理基使"排内相邻格"与"相邻排"的层号都去相关，同时层号分布仍是低差异的。
 *
 * ── 单调修复（必须保留，别删）──────────────────────────────────────────────
 * R2 对**宽度 3 的排**存在固有残差：k = 0,1,2 的三个点把圆周分成 0.236/0.382/0.382
 * 三段，当且仅当 `c = frac(r·β) ≥ 0.764` 时三点按 k 序单调 ⇒ 概率 **23.6%**。
 * 实测 30 组合留 9 个单调排（全为宽度 3）；`circle n=8`（L=7）里 3 舰 = 全队 3/8，
 * 下落 5 个层距，肉眼读作一道阶梯 ⇒ 必须修，不能靠放宽判据绕过。
 *
 * 修复规则（逐排、纯函数、确定性；只动本来就单调的排，不动 R2 的铺展性）：
 *   1. 取该排按 gy 升序的层号序列 vals；`vals.length < 3 || L <= 1` 时跳过。
 *   2. 判定是否单调（非严格）：不减 或 不增。
 *   3. 若单调：在全部相邻对 (k−1, k) 里取 `|vals[k] − vals[k−1]|` **最大**者
 *      （并列取最小 k），交换这两个元素。
 *      正确性：设该排不减且存在严格上升（最大差 > 0），交换的是 `v_i < v_{i+1}`：
 *        · 对 (i−1, i) 仍是上升（v_{i−1} ≤ v_i ≤ v_{i+1}）；
 *        · 对 (i, i+1) 变成严格下降 ⇒ 排除"不减"；
 *        · 若 i ≥ 1，则 (i−1, i) 已给出一个上升步 ⇒ 排除"不增"；
 *          若 i = 0，则 (1, 2) 给出上升步（v_0 < v_1 ≤ v_2，需 W ≥ 3 成立）⇒ 同样排除。
 *        ⇒ 修复后该排必不可单调。（不增的情形对称。）
 *   4. 退化兜底：若整排层号**全相等**（最大差 = 0），交换无效，改为动**中间**那个元素
 *      `vals[mid]`：`> 0` 则减 1，否则加 1（`mid = floor(W/2)`）。
 *      ⚠ 不能改成"动最后一个元素"：`[v,v,v] → [v,v,v−1]` 仍是不增，修复无效。
 *      （注：α = 1/φ 时该退化在 L ≥ 5 下不可达——三点最小圆周间隔 0.236 > 1/L；
 *        但兜底必须留着，且行为必须如上。）
 *
 * ⚠ 选点规则是**规格的一部分**，不是实现自由度：独立台架已证"换哪一对"会改变侧向剪影
 *   （`spindle n=40` 上两条合法置换路径的 minBand 相差 0.125%）。必须严格用"差最大、
 *   并列取最小 k、全等排动中间元素"。
 *
 * ── 居中为什么必须在这里做 ────────────────────────────────────────────────
 * 消费侧只做 `y += off[slot] * gap`。此处按**实际用到的层号极值** `(lo+hi)/2` 居中，
 * 而不是 `(L−1)/2`：n < L 时 R2 不会铺满 [0, L)，用 (L−1)/2 会让整队系统性偏心；
 * n = 1 时更会被压到 −(L−1)/2·gap。按极值居中后 `(max+min)/2 ≡ 0` 恒成立，
 * 且 n ≥ L 且铺满时等价于按 (L−1)/2 居中（只差一个平移）。
 *
 * ⚠ 返回的是**乘数**，调用方只做 `y += off[slot] * gap`。
 */
const R2_ALPHA = 0.6180339887498949;   // 1/φ
const R2_BETA = 0.3819660112501051;    // 1/φ²
export function formationLayerOffsets(offsets: FormationCell[], layers: number): number[] {
  const n = offsets.length;
  const out = new Array<number>(n).fill(0);
  const L = Math.max(1, Math.floor(layers));
  if (L <= 1 || n === 0) return out;

  // 按 gx 分行（gx 升序），行内按 gy 升序
  const byGx = new Map<number, { i: number; gy: number }[]>();
  for (let i = 0; i < n; i++) {
    const gx = offsets[i][0];
    let a = byGx.get(gx);
    if (!a) { a = []; byGx.set(gx, a); }
    a.push({ i, gy: offsets[i][1] });
  }
  const rows = [...byGx.entries()].sort((a, b) => a[0] - b[0])
    .map(([, cells]) => cells.sort((a, b) => a.gy - b.gy));

  const raw = new Array<number>(n).fill(0);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const vals: number[] = [];
    for (let k = 0; k < row.length; k++) {
      const u = ((k * R2_ALPHA + r * R2_BETA) % 1 + 1) % 1;
      vals.push(Math.min(L - 1, Math.floor(u * L)));
    }
    if (vals.length >= 3) {
      let inc = true; let dec = true;
      for (let k = 1; k < vals.length; k++) {
        if (vals[k] < vals[k - 1]) inc = false;
        if (vals[k] > vals[k - 1]) dec = false;
      }
      if (inc || dec) {
        let bi = 0; let bd = -1;
        for (let k = 1; k < vals.length; k++) {
          const d = Math.abs(vals[k] - vals[k - 1]);
          if (d > bd) { bd = d; bi = k - 1; }
        }
        if (bd > 0) {
          const t = vals[bi]; vals[bi] = vals[bi + 1]; vals[bi + 1] = t;
        } else {
          const m = Math.floor(vals.length / 2);
          vals[m] = vals[m] > 0 ? vals[m] - 1 : vals[m] + 1;
        }
      }
    }
    for (let k = 0; k < row.length; k++) raw[row[k].i] = vals[k];
  }

  let lo = Infinity; let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (raw[i] < lo) lo = raw[i];
    if (raw[i] > hi) hi = raw[i];
  }
  const mid = (lo + hi) / 2;
  for (let i = 0; i < n; i++) out[i] = raw[i] - mid;
  return out;
}

/** 阵型的**平面足迹**（单位 = 格位数，不含格距）：最宽排的格数 − 1、排数 − 1。 */
export interface FormationFootprint {
  /** 最宽排包含的格位数 − 1（即横向 gy 方向的格跨） */
  widCells: number;
  /** 排数 − 1（即纵深 gx 方向的格跨） */
  depCells: number;
}

/**
 * 平面足迹。**两个方向各自减 1 再取下限 1**：单排阵型（如 line n≤8）在 gx 方向
 * 只有 1 排 ⇒ 0 会把层数压到 1，故用 1 格兜底（语义 = "至少按一个格距算厚度"）。
 * 与 `layerCountForFootprint` 一起决定舰队纵向厚度，见 config/fleetTierLayout.ts。
 *
 * ⚠ 消费者在算 `thinRatio` 一类比例时，分母必须带 1e-6 下限：本函数两个方向都下限为 1，
 *   但"格位数"在单排阵型上确实是 0 跨，任何除法都要防零。
 */
export function formationFootprint(offsets: FormationCell[]): FormationFootprint {
  if (offsets.length === 0) return { widCells: 1, depCells: 1 };
  const cnt = new Map<number, number>();
  for (const [gx] of offsets) cnt.set(gx, (cnt.get(gx) || 0) + 1);
  let wid = 1;
  cnt.forEach((c) => { if (c > wid) wid = c; });
  return { widCells: Math.max(1, wid - 1), depCells: Math.max(1, cnt.size - 1) };
}

/** 格位集合的最大半跨：max(|gx|, |gy|)（单位 = 格位） */
export function halfExtentOf(offsets: FormationCell[]): number {
  let he = 0;
  for (const [gx, gy] of offsets) {
    he = Math.max(he, Math.abs(gx), Math.abs(gy));
  }
  return he;
}

/**
 * 实际格距（像素）：默认 FORMATION_SPACING，只有足迹超预算时才压缩。
 *   R_BUDGET = hexRadius × FORMATION_FOOTPRINT_LIMIT（半跨上限）
 *   spacingEff = min(FORMATION_SPACING, R_BUDGET / max(halfExtent, 1))
 * 压缩后密度上升 = 密集编队；不压缩则保持 28px（同排相邻舰不互穿）。
 */
export function formationSpacing(offsets: FormationCell[], hexRadius: number): number {
  const budget = Math.max(1, hexRadius) * FORMATION_FOOTPRINT_LIMIT;
  const he = Math.max(halfExtentOf(offsets), 1);
  return Math.min(FORMATION_SPACING, budget / he);
}

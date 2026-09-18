/**
 * SupplyChainSystem — 补给链系统（后勤战核心）
 *
 * 解决的问题：
 *   1. 原补给靠"地块连通"，运输舰在战斗中零逻辑 → 后勤战不存在
 *   2. 指挥制无格子 → 地块驱动补给失效
 *   3. 玩家看不到补给状态（不知道部队在不在补给线内）
 *
 * 补给链模型（v3 独立往返制）：
 *   己方补给源（基地/星球） → [AUX 运输舰独立出航] → 前线舰队 → 返航补给源 → 装货 → 再出航
 *
 *   状态机：loading（泊港装货）→ outbound（出航）→ supplying（补给）→ returning（返航）→ loading …
 *   - 运输舰拥有独立坐标（x/y），不再跟随舰队阵型
 *   - 装货耗时形成"舰队先出发、运输船后出发"的自然节奏
 *   - 运输舰可被击沉 → 该链路断裂（斩链玩法的核心目标）
 *
 * 设计要点：
 *   - 纯计算模块，不碰 Phaser 渲染；updateSupplyChain 每 1s 逻辑 Tick 调用（状态迁移+卸货），
 *     moveAuxShips 每帧调用（独立坐标推进）；可视化由调用方绘制
 */
/** 补给源作用半径（基地/星球直接覆盖） */
export const SUPPLY_SOURCE_RADIUS = 420;
/** v6.3：中继补给站（relay）作用半径——1.19× 基准。
 *  v6.1 曾取 1.5×(630)，叠加"星球全量转中继"后满屏大圈（用户实报"越设计越丑"）；
 *  v6.3 中继限量（≤6 个）+ 半径收敛到 500，占领收益仍可见但不至于铺满地图。 */
export const SUPPLY_RELAY_RADIUS = 500;
/** 运输舰补给半径（运输舰抵达后覆盖的友军范围） */
export const SUPPLY_AUX_RADIUS = 260;
/** 运输舰返航泊港半径（回到补给源此范围内开始装货） */
export const AUX_RESUPPLY_RADIUS = 300;
/** v6.1：运输舰换港滞后（最近补给源距离优势超过此值才换港，防其在两源间抖动） */
export const AUX_HOME_SWITCH_HYSTERESIS = 120;
/** 运输舰载货量（可补给的总量单位） */
export const AUX_CAPACITY = 100;
/** 运输舰泊港装货速率（每逻辑 Tick，100 载量 ≈ 10 Tick 装满 → 首航自然延迟约 10 秒） */
export const AUX_LOAD_RATE = 10;
/** 运输舰补给输出速率（每逻辑 Tick）。
 *  v3 调参：原 1.2 < 断粮流失率 2 → 运输舰追上舰队后补给仍入不敷出，
 *  补给度永远回不到 80（撤退重组线），观感就是"运输舰白来了"。现取 8。 */
export const AUX_SUPPLY_RATE = 8;
/** 运输舰目标**获取**阈值：只有补给度低于此值的友军才会被纳入候选目标（保持历史值 70）。
 *  R10-A1/B2：与下面的释放阈值构成迟滞带，避免"获取/释放"用同一阈值导致抖动。 */
export const AUX_TARGET_ACQUIRE_SUPPLY = 70;
/** 运输舰目标**释放**阈值（R10-A1/B2 修复「70↔80 死区」）：
 *  已承诺的补给目标不补到此值就不放手。**必须 > 舰队撤退退出阈值**
 *  （BattleScene.ts 撤退退出线 80），否则运输舰会在 70 就放弃目标 → 舰队仍 <80、仍在撤退
 *  → 恢复直线飞回基地（用户实报「碰到补给船补了、经常性还是要直线飞回去」）。
 *  取 85 = 80 + 5 余量（覆盖一次逻辑 Tick 的结算粒度）。 */
export const AUX_TARGET_RELEASE_SUPPLY = 85;
/** 运输舰航速（px/帧 × 速度系数；略低于舰队基础速度，体现"慢速补给船"）。
 *  v4 调参：1.4 约为战舰巡航(0.30)的 4.7 倍，运输舰全程"飙船"、与主力运动规律割裂。
 *  降到 0.7：仍快于常规巡航可追上驻留/慢速舰队，但不再横穿全场飙船。
 *  （运输舰本就不该去追撤退中的高速舰队——等其停下再补给即可。） */
export const AUX_SPEED = 0.7;

export type AuxState = 'loading' | 'outbound' | 'supplying' | 'returning';

export interface SupplyNode {
  x: number;
  y: number;
  team: number;
  kind: 'castle' | 'planet' | 'relay';
}

export interface AuxShip {
  unit: any;         // 战斗单位引用（sprite 由 BattleScene 按独立坐标同步）
  fleet: any;        // 所属舰队（母队，用于阵营/斩链判定）
  x: number;         // 独立坐标（不再依赖舰队位置 + 偏移）
  y: number;
  heading: number;   // 当前航向（rad，用于 sprite 朝向）
  cargo: number;     // 剩余载货
  state: AuxState;
  targetFleet: any;  // outbound/supplying 的目标舰队（null = 无）
  /** 母港（补给源）坐标：返航/装货的目的地。
   *  v6.1：不再恒为司令部——每 Tick 重算为"距运输舰最近的己方补给源（含已占中继）"，
   *  运输舰就近装货/周转，中继占领真正生效。 */
  homeX: number;
  homeY: number;
}

export interface FleetSupplyInfo {
  fleet: any;
  /** 是否在任何补给覆盖内 */
  inSupply: boolean;
  /** 补给来源：'source' 基地/星球 | 'aux' 运输舰 | null 断链 */
  via: 'source' | 'aux' | null;
  /** 到最近补给源的距离（无则 Infinity） */
  distToSource: number;
  /** 补给它的运输舰（via==='aux' 时有值） */
  aux: AuxShip | null;
}

/** team 解析函数：由调用方传入（舰队本身无 team 字段，需经 factionMap 查） */
export type TeamOf = (fleet: any) => number | undefined;

/**
 * v6.1：为运输舰解析当前最优母港——距其最近的己方补给源（司令部/已占星球/已占中继）。
 * 带滞后（AUX_HOME_SWITCH_HYSTERESIS）：新港比现港近 120+ 才切换，防止运输舰在两个
 * 等距补给源之间来回抖。占领中继后，前线运输舰自然改挂中继 → 占领立刻产生后勤收益。
 */
export function resolveAuxHome(
  aux: AuxShip,
  sources: SupplyNode[],
  myTeam: number,
): { x: number; y: number } {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  sources.forEach(s => {
    if (s.team !== myTeam) return;
    const d = Math.hypot(aux.x - s.x, aux.y - s.y);
    if (d < bestD) { bestD = d; best = { x: s.x, y: s.y }; }
  });
  if (!best) return { x: aux.homeX, y: aux.homeY };
  const curD = Math.hypot(aux.x - aux.homeX, aux.y - aux.homeY);
  // 现港仍是"最近之一"（差距 < 滞后值）→ 保持现港
  if (curD <= bestD + AUX_HOME_SWITCH_HYSTERESIS) return { x: aux.homeX, y: aux.homeY };
  return best;
}

/**
 * 计算所有舰队的补给状态，并驱动运输舰状态机（每 1s 逻辑 Tick 调用）。
 * 位移由 moveAuxShips 每帧推进；本函数只做状态迁移与卸货结算。
 */
export function updateSupplyChain(
  fleets: any[],
  sources: SupplyNode[],
  auxShips: AuxShip[],
  dt: number,
  teamOf: TeamOf,
): Map<any, FleetSupplyInfo> {
  const result = new Map<any, FleetSupplyInfo>();

  // 1. 先算每个舰队到最近己方补给源的距离（v6.1：中继补给站覆盖半径 1.5 倍，
  //    占领中继 = 补给圈实际扩大，玩家能看到占领收益。best = 到补给圈边沿的距离，圈内为 0）
  fleets.forEach(fl => {
    let best = Infinity;
    sources.forEach(s => {
      const ft = teamOf(fl);
      if (s.team !== undefined && ft !== undefined && s.team !== ft) return;
      const d = Math.hypot(fl.x - s.x, fl.y - s.y);
      const effR = s.kind === 'relay' ? SUPPLY_RELAY_RADIUS : SUPPLY_SOURCE_RADIUS;
      const eff = Math.max(0, d - effR);
      if (eff < best) best = eff;
    });
    result.set(fl, {
      fleet: fl,
      inSupply: best <= 0,
      via: best <= 0 ? 'source' : null,
      distToSource: best,
      aux: null,
    });
  });

  // 2. 运输舰状态机：loading → outbound → supplying → returning → loading …
  auxShips.forEach(aux => {
    if (!aux.unit || aux.unit.hp <= 0) return;
    const myTeam = teamOf(aux.fleet);
    if (myTeam === undefined) return;

    // v6.1：每 Tick 重算最近母港（含已占中继）——中继占领后运输舰就地改挂新港
    const home = resolveAuxHome(aux, sources, myTeam);
    aux.homeX = home.x; aux.homeY = home.y;

    // 找需要补给的友军舰队：同阵营 + 在补给源圈外 + 补给度 < AUX_TARGET_ACQUIRE_SUPPLY，取距运输舰最近者。
    // v6.1：目标优先级改为"运输舰到目标的路程"，而非直线距离——在中继装货的运输舰
    //   会自然倾向补给中继附近的舰队（用户要求：往返于补给源/已占中继/前线舰队）。
    // R10-A1/B2：这里是**获取**门槛（70）；一旦承诺（targetFleet），改由释放门槛（85）放手，
    //   二者构成迟滞带 → 不再"补到 70 就撒手"。
    let target: any = null;
    let bestD = Infinity;
    fleets.forEach(other => {
      if (teamOf(other) !== myTeam) return;
      const oi = result.get(other);
      if (!oi || oi.inSupply) return;                       // 源圈内的不缺
      if ((other.units?.[0]?.supply ?? 100) >= AUX_TARGET_ACQUIRE_SUPPLY) return;  // 补给度尚可
      const d = Math.hypot(aux.x - other.x, aux.y - other.y);
      if (d < bestD) { bestD = d; target = other; }
    });

    switch (aux.state) {
      case 'loading': {
        // 泊港装货：装满且存在缺补目标 → 出航（装货耗时 = "舰队先出发、运输船后出发"）
        aux.targetFleet = target;
        if (aux.cargo < AUX_CAPACITY) {
          aux.cargo = Math.min(AUX_CAPACITY, aux.cargo + AUX_LOAD_RATE * dt);
        }
        if (aux.cargo >= AUX_CAPACITY && target) aux.state = 'outbound';
        break;
      }
      case 'outbound':
      case 'supplying': {
        // R10-A1/B3：已承诺目标优先——只要它仍缺补给（< 释放门槛 85）、且尚未回到补给源圈，
        //   就继续跟随/补给它，不因本 Tick 全局重扫的瞬时结果而「失目标即返航」。
        //   原实现 `!target → returning`（配 :163 的 70 门槛）正是"卸到 70 就撒手"的直接来源。
        if (aux.targetFleet && aux.cargo > 0) {
          const committed = aux.targetFleet;
          const ci = result.get(committed);
          const stillNeed = (committed.units?.[0]?.supply ?? 100) < AUX_TARGET_RELEASE_SUPPLY;
          const inSourceCircle = !!(ci && ci.inSupply && ci.via === 'source');
          if (teamOf(committed) === myTeam && stillNeed && !inSourceCircle) target = committed;
        }
        if (!target) { aux.state = 'returning'; aux.targetFleet = null; break; }
        aux.targetFleet = target;
        const d = Math.hypot(aux.x - target.x, aux.y - target.y);
        aux.state = d <= SUPPLY_AUX_RADIUS ? 'supplying' : 'outbound';
        if (aux.state === 'supplying' && aux.cargo > 0) {
          // 对半径内所有同阵营舰队卸货
          fleets.forEach(other => {
            if (teamOf(other) !== myTeam) return;
            const d2 = Math.hypot(aux.x - other.x, aux.y - other.y);
            if (d2 > SUPPLY_AUX_RADIUS) return;
            other.units?.forEach((u: any) => {
              u.supply = Math.min(100, (u.supply ?? 100) + AUX_SUPPLY_RATE * dt);
            });
            aux.cargo = Math.max(0, aux.cargo - AUX_SUPPLY_RATE * dt);
            const oi = result.get(other);
            if (oi && !oi.inSupply) { oi.inSupply = true; oi.via = 'aux'; oi.aux = aux; }
          });
          if (aux.cargo <= 0) { aux.state = 'returning'; aux.targetFleet = null; }
        }
        break;
      }
      case 'returning': {
        const hd = Math.hypot(aux.x - aux.homeX, aux.y - aux.homeY);
        if (hd <= AUX_RESUPPLY_RADIUS) { aux.state = 'loading'; aux.targetFleet = null; }
        break;
      }
    }
  });

  return result;
}

/**
 * 运输舰独立航行（每帧调用）：朝当前状态目的地的独立坐标推进。
 *   outbound/supplying → 目标舰队实时坐标；returning → 母港；loading → 泊港不动
 */
export function moveAuxShips(auxShips: AuxShip[], dt: number): void {
  auxShips.forEach(aux => {
    if (!aux.unit || aux.unit.hp <= 0) return;
    let gx: number | null = null, gy = 0;
    if ((aux.state === 'outbound' || aux.state === 'supplying') && aux.targetFleet) {
      gx = aux.targetFleet.x; gy = aux.targetFleet.y;
    } else if (aux.state === 'returning') {
      gx = aux.homeX; gy = aux.homeY;
    }
    if (gx === null) return;
    const dx = gx - aux.x, dy = gy - aux.y;
    const d = Math.hypot(dx, dy);
    // [v21 JIT-1] 抵达死区 4px → 0.05px（仅保留 atan2 的除零保护）。
    //   原 4px 死区 + 固定步长 AUX_SPEED×dt(=0.7) 构成"停-走"极限环：母队每帧移 ~0.5px，
    //   d 越过 4px 才推进、推进 0.7px 又落回死区 ⇒ 运输舰在母队后方逐帧抽动（放大后可见）。
    //   状态结算**不依赖此阈值**（装/卸货用 AUX_RESUPPLY_RADIUS=300 / SUPPLY_AUX_RADIUS=260），
    //   故收小阈值不改变任何补给语义。
    if (d < 0.05) return;
    // 朝向按最短角限速转向（消除目标锚点抖动导致的 180° 瞬转掉头）
    const targetHeading = Math.atan2(dy, dx);
    let diff = targetHeading - aux.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const MAX_TURN = 0.12 * dt;   // 每帧最大转向弧度
    aux.heading += Math.max(-MAX_TURN, Math.min(MAX_TURN, diff));
    // [v21 JIT-1] 单帧位移不越过目标：旧式固定步长在 d 略大于死区时会越过目标点 ⇒ 下一帧
    //   方向 180° 反相（掉头）⇒ 逐帧往复。`min(步长, d)` 保证单调趋近、无越冲折返。
    const step = Math.min(AUX_SPEED * dt, d);
    aux.x += (dx / d) * step;
    aux.y += (dy / d) * step;
  });
}

/** 判断是否为补给运输舰（舰种 supply / 中文 classType '补给'） */
export function isSupplyUnit(u: any): boolean {
  return u?.classType === 'supply' || u?.classType === '补给';
}

/** 从所有舰队中收集运输舰，初始化/复用 AuxShip 结构（独立往返制）。
 *  @param prev 上一轮的 unit → AuxShip 映射：包装对象每 Tick 重建，但坐标/货量/状态
 *              按 unit 引用跨 Tick 保留（独立航行的连续性依赖于此）
 *  @param homeOf 舰队 → 初始母港（补给源）坐标（仅新建时使用；后续由 resolveAuxHome 每 Tick 重算） */
export function collectAuxShips(
  fleets: any[],
  homeOf?: (fleet: any) => { x: number; y: number } | null,
  prev?: Map<any, AuxShip>,
): AuxShip[] {
  const out: AuxShip[] = [];
  fleets.forEach(fl => {
    const home = homeOf ? homeOf(fl) : null;
    fl.units?.forEach((u: any) => {
      if (!isSupplyUnit(u) || u.hp <= 0) return;
      const old = prev?.get(u);
      if (old) {
        // 母队引用可能随舰队容器重建而变化，刷新引用。
        // R10-A1/B6：**不再每 Tick 用 homeOf(castlePos) 覆写母港**——母港由 resolveAuxHome
        //   （:151-152）带 120px 换港迟滞维护；此处的覆写会让迟滞失去"上一次母港"参照，
        //   使"就近装货/改挂已占中继"的防抖保护实际失效（运输舰在两源间抖动）。
        old.fleet = fl;
        out.push(old);
      } else {
        // 新运输舰：泊在母港，空载装货（装满后才出航 → 天然的首航延迟）
        out.push({
          unit: u, fleet: fl,
          x: home?.x ?? fl.x, y: home?.y ?? fl.y,
          heading: 0, cargo: 0, state: 'loading', targetFleet: null,
          homeX: home?.x ?? fl.x, homeY: home?.y ?? fl.y,
        });
      }
    });
  });
  return out;
}

/**
 * SupplyChainSystem — 补给链系统（后勤战核心）
 *
 * 解决的问题：
 *   1. 原补给靠"地块连通"，运输舰在战斗中零逻辑 → 后勤战不存在
 *   2. 指挥制无格子 → 地块驱动补给失效
 *   3. 玩家看不到补给状态（不知道部队在不在补给线内）
 *
 * 补给链模型（v3 独立往返制；v7 归属基地）：
 *   己方补给源（基地/星球） → [AUX 运输舰独立出航] → 前线舰队 → 返航补给源 → 装货 → 再出航
 *
 *   状态机：loading（泊港装货）→ outbound（出航）→ supplying（补给）→ returning（返航）→ loading …
 *   - 运输舰拥有独立坐标（x/y），不再跟随舰队阵型
 *   - 装货耗时形成"舰队先出发、运输船后出发"的自然节奏
 *   - 运输舰可被击沉 → 该链路断裂（斩链玩法的核心目标）
 *
 *   ★ v7（B 档）**归属基地，不归属舰队**：
 *     · `AuxShip.factionId` 是归属真源；`AuxShip.fleet` 降级为**承载/服务引用**（容器随时可换）。
 *     · `collectAuxShips` 只消费**基地侧资产池 `AuxAsset[]`**，不再扫舰队 ⇒ 收集不依赖舰队容器。
 *     · 母队被歼时由 BattleScene 把编队转为「后勤支队」（`_logisticsOnly`）⇒ 运输舰独立存活并返航。
 *     这样做同时保住"切断补给链"这一核心玩法：运输舰必须**真的被打掉**才算断链。
 *
 * 设计要点：
 *   - 纯计算模块，不碰 Phaser 渲染；updateSupplyChain 每 1s 逻辑 Tick 调用（状态迁移+卸货），
 *     moveAuxShips 每帧调用（独立坐标推进）；可视化由调用方绘制。
 *   - 例外：`syncAuxVisual` 是运输舰**唯一**的逐帧视觉写入点（sprite 位置/朝向/贴图补偿），
 *     与 moveAuxShips 同帧调用。之所以放在本模块而不是 BattleScene：运输舰被舰队列循环跳过，
 *     逐舰视觉在这里才唯一可控，且能被台架真跑断言（见函数注释）。
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
  /** **归属阵营 id（基地侧资产的真正归属）** —— 存活/斩链/AI/迷雾等一切"这是谁家的"判定
   *  一律用它，**不再用 `fleet.factionId`**。
   *  [A 档] 旧实现把「阵营归属」寄存在 `fleet` 上；`fleet` 只是**承载容器**（会随分兵/并队
   *  被换、随战损被移除）⇒ 容器一变归属就丢。归属上移到运输舰自身后，容器换不换都无影响。 */
  factionId: number;
  /** **承载/服务引用（不是归属）** —— 当前为它提供 3D 实体渲染容器、阵位枚举、
   *  迷雾情报(`_intelDisplayMode`) 的那支舰队；`updateSupplyChain` 的 `targetFleet` 亦是"被服务的对象"。
   *  [B 档] 母队被歼后本引用指向**后勤支队容器**（`_logisticsOnly`），运输舰因此**独立于
   *  原舰队容器而存活**；`factionId` 才是归属真源（见上）。 */
  fleet: any;
  x: number;         // 独立坐标（不再依赖舰队位置 + 偏移）
  y: number;
  heading: number;   // 当前航向（rad，用于 sprite 朝向）
  cargo: number;     // 剩余载货
  state: AuxState;
  /** 被**服务**的目标舰队（outbound/supplying 的补给对象；null = 无）。
   *  ⚠ 与 `fleet` 无关：这不是"归属"，只是"这一趟去补给谁"。 */
  targetFleet: any;
  /** 母港（补给源）坐标：返航/装货的目的地。
   *  v6.1：不再恒为司令部——每 Tick 重算为"距运输舰最近的己方补给源（含已占中继）"，
   *  运输舰就近装货/周转，中继占领真正生效。 */
  homeX: number;
  homeY: number;
}

/** [B 档] 基地侧运输舰资产项：**以 unit 为主体**（不再以舰队为主体）。
 *  池由 BattleScene 从"己方补给源/编制"侧登记，`collectAuxShips` 只认这个池 ——
 *  因此运输舰的收集**不依赖任何舰队容器是否存在**。 */
export interface AuxAsset {
  unit: any;
  /** 归属阵营 id（真源） */
  factionId: number;
  /** 当前承载容器（渲染/阵位/情报）；可为 null（此时仍被收集，视觉由 syncAuxVisual 独立驱动） */
  fleet: any;
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

/** team 解析函数：由调用方传入。
 *  [A 档] 入参放宽为「舰队 **或** 阵营 id」——
 *    · 传 fleet ⇒ 解析该舰队所属阵营（舰队本身无 team 字段，需经 factionMap 查）；
 *    · 传 number（factionId）⇒ 直接解析阵营 —— 运输舰的归属判定走这条（不再借 `aux.fleet`）。 */
export type TeamOf = (ref: any) => number | undefined;

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
    // [A 档] 阵营归属取运输舰自身的 `factionId`（真源）；旧数据/旧调用缺该字段时回退承载容器。
    const myTeam = aux.factionId != null ? teamOf(aux.factionId) : teamOf(aux.fleet);
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
    // 位置必须由舰首航向消费，而不是由目标方向直接消费。此前 heading 已限速，
    // 但 x/y 仍按 dx/dy 直线推进，目标在侧面时就会出现“舰身朝 A、横向滑向 B”。
    // 对齐不足时先转向；对齐后只沿当前舰首推进，故航迹和船体方向始终一致。
    const alignment = Math.max(0, Math.cos(diff));
    if (alignment <= 0.01) return;
    const step = Math.min(AUX_SPEED * dt * alignment, d);
    aux.x += Math.cos(aux.heading) * step;
    aux.y += Math.sin(aux.heading) * step;
  });
}

/**
 * 运输舰「显示层」同步（每帧调用，必须在 `moveAuxShips` 之后）。
 *
 * 为什么要独立成函数（而不是内联在 BattleScene）：
 *   **运输舰在舰队列循环里被提前 return 跳过**（BattleScene `if (isSupplyUnit(u)) return;`），
 *   凡是"逐舰视觉设定"都不会作用于它 —— 舰首贴图补偿、文字反向补偿、朝向全缺。
 *   本函数是运输舰**唯一**的逐帧视觉写入点；抽出来才能被台架真跑逻辑断言（反之只能读源码字符串）。
 *
 * ★ 朝向真源（`visHeading` / `sprite.rotation`）**无条件写入**，不受 sprite 是否存在 / active 影响：
 *   3D 层（Battle3DOverlay `fa = u.visHeading ?? fleet.facingSmooth`）以 `visHeading` 为舰首真源，
 *   缺失即回退「舰队朝向」⇒ 位置随运输舰航向走、舰首却跟舰队摆 ⇒ 用户实报「横着飞」。
 *   （实机探针观测到 `sprite.visible === false` 的运输舰：sprite 在、3D 却不为它建实体；
 *     若把赋值放在 sprite 守卫之后，这类舰的 visHeading 就会永久缺失 —— 该分支必须无条件覆盖。）
 *
 * @param dt 帧步进（速度倍率口径）。⚠ 位置已是硬同步、不再依赖 dt；
 *           形参保留是为了**调用口径统一**（每帧调用点与 `moveAuxShips` 同参），
 *           且将来若真需要平滑可直接在函数内消费，不必改所有调用点。
 * @returns 是否写入了朝向（= `aux.unit` 存在）
 */
export function syncAuxVisual(aux: AuxShip, dt: number): boolean {
  const u: any = (aux as any).unit;
  if (!u) return false;

  // ① 朝向真源：**先写、无条件写**（不依赖 sprite 的存在 / active / visible）
  u.visHeading = aux.heading;

  const sp: any = u.sprite;
  if (!sp || sp.active === false) return true;

  // ② 位置 = 独立坐标（**硬同步、零滞后**）
  //   v21 起这里曾是「沿直线以固定步长追向 aux」（moveTowardsAtSpeed 语义）。那条路径的
  //   位移方向是**指向 aux 的直线**，而 `moveAuxShips` 的位移方向是 `aux.heading`（舰首消费航向）：
  //   两者只在 gap≈0 时相同。一旦 sprite 与 aux 有偏差（新建运输舰坐标取母港、中途并入编制、
  //   母港切换…），舰体就会"舰首朝 A、沿 B 方向平移" = 用户实报的「横着飞 / 飘着走」。
  //   ⚠ 真机实测（_probe_auxgap.mjs，3D 战场 / 双阵营 / loading·outbound·supplying·returning
  //     全状态、26k+ 帧）：正常帧 `|sprite-aux| ≡ 0`（p99=0，max 0.7px 单帧），即"追赶"
  //     在稳态**不产生任何平滑收益**，却把上述错位留成唯一可达路径 ⇒ 直接取真值。
  //   ⚠ 运输舰不是阵型单位，sprite 只是它的**位置载体**，没有理由落后于逻辑坐标；
  //     运动连续性由 `moveAuxShips` 每帧 ≤ AUX_SPEED*dt 的推进保证（跨 Tick 由 prev 映射保号），
  //     故硬同步不会引入跳变。
  sp.x = aux.x;
  sp.y = aux.y;

  // ③ 2D 降级路径的舰首贴图补偿：舰头贴图是「竖向、舰头朝上(-Y)」，而容器 +X = 前进方向
  //    ⇒ 必须给 border 子件 +π/2（与舰队列 `borderShape.rotation = Math.PI / 2` 同口径）。
  //    ⚠ 运输舰被舰队列跳过 ⇒ 此前该补偿恒不生效（border.rotation 恒 0）
  //      ⇒ 2D 降级路径下舰身与航向差 90° = 用户实报「舰首朝 A、船身横着沿航向飞」。
  const border = sp.getByName ? sp.getByName('border') : null;
  if (border && Math.abs(border.rotation - Math.PI / 2) > 1e-6) border.rotation = Math.PI / 2;

  // ④ 舰体朝向 = 航向（hp ≤ 0 的运输舰由 collectAuxShips 在下一逻辑 Tick 摘除，无需清朝向）
  if (u.hp > 0) sp.rotation = aux.heading;

  // ⑤ 文字永远正向可读（与舰队列同式）
  const textObj = sp.getByName ? sp.getByName('text') : null;
  if (textObj) textObj.rotation = -aux.heading;

  return true;
}

/** 判断是否为补给运输舰（舰种 supply / 中文 classType '补给'） */
export function isSupplyUnit(u: any): boolean {
  return u?.classType === 'supply' || u?.classType === '补给';
}

/** [B 档] 从**基地侧资产池**收集运输舰，初始化/复用 AuxShip 结构（独立往返制）。
 *  ⚠ 入参是 `AuxAsset[]`（以 unit 为主体的池）而**不是舰队列表** —— 这是 B 档的核心：
 *    运输舰的收集/存活**不依赖任何舰队容器**（母队被拆/并/歼都不影响）。
 *
 *  @param assets 基地侧资产池（BattleScene 维护：编制侧登记 ∪ 上一次池内容，见 collectAuxAssets）
 *  @param homeOf 阵营 id → 初始母港（补给源）坐标（仅新建时使用；后续由 resolveAuxHome 每 Tick 重算）
 *  @param prev  上一轮的 unit → AuxShip 映射：包装对象每 Tick 重建，但坐标/货量/状态
 *               按 unit 引用跨 Tick 保留（独立航行的连续性依赖于此）
 */
export function collectAuxShips(
  assets: AuxAsset[],
  homeOf?: (factionId: number) => { x: number; y: number } | null,
  prev?: Map<any, AuxShip>,
): AuxShip[] {
  const out: AuxShip[] = [];
  assets.forEach(a => {
    const u = a.unit;
    if (!u || !isSupplyUnit(u) || u.hp <= 0) return;
    const factionId = a.factionId;
    const home = homeOf ? homeOf(factionId) : null;
    const old = prev?.get(u);
    if (old) {
      // [A 档] 归属阵营是**真源**：每 Tick 校正（阵营不会变，但保证首次由旧结构升上来时有值）。
      old.factionId = factionId;
      // 承载容器引用可能随舰队重建/后勤支队转移而变化 → 刷新引用（**仅供渲染/情报**，不参与归属判定）。
      // R10-A1/B6：**不再每 Tick 用 homeOf(castlePos) 覆写母港**——母港由 resolveAuxHome
      //   （:151-152）带 120px 换港迟滞维护；此处的覆写会让迟滞失去"上一次母港"参照，
      //   使"就近装货/改挂已占中继"的防抖保护实际失效（运输舰在两源间抖动）。
      old.fleet = a.fleet;
      out.push(old);
    } else {
      // 新运输舰：泊在母港，空载装货（装满后才出航 → 天然的首航延迟）
      out.push({
        unit: u, factionId, fleet: a.fleet,
        x: home?.x ?? a.fleet?.x ?? 0, y: home?.y ?? a.fleet?.y ?? 0,
        heading: 0, cargo: 0, state: 'loading', targetFleet: null,
        homeX: home?.x ?? a.fleet?.x ?? 0, homeY: home?.y ?? a.fleet?.y ?? 0,
      });
    }
  });
  return out;
}

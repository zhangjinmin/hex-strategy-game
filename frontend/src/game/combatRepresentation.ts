/**
 * Fleet combat state → renderable attrition projection.
 *
 * Combat units remain the sole authority for damage, firing, and campaign
 * persistence. This module only answers how much of that aggregate force is
 * still visibly present, so a fleet at 30% structural strength cannot look
 * like an untouched full formation.
 */
export interface RepresentationUnit {
  hp: number;
  maxHp: number;
  /** Real ships represented by this aggregate visual/combat unit. */
  shipCount?: number;
}

export interface FleetRepresentation {
  hpPct: number;
  effectiveShips: number;
  visibleCount: number;
  /** Stable indexes of the surviving visual representatives. */
  visibleIndexes: number[];
}

/**
 * Produces a deterministic render projection from authoritative combat HP.
 * Models are selected by remaining structural integrity, then deployment
 * order; no randomness is permitted here because that would make the visual
 * formation flicker while no combat event occurred.
 */
export function projectFleetRepresentation(
  units: readonly RepresentationUnit[],
  visualCapacity: number = units.length,
): FleetRepresentation {
  const live = units
    .map((u, index) => ({ u, index, ratio: u.maxHp > 0 ? Math.max(0, Math.min(1, u.hp / u.maxHp)) : 0 }))
    .filter((x) => x.ratio > 0);
  const maxHp = units.reduce((sum, u) => sum + Math.max(0, u.maxHp || 0), 0);
  const hp = units.reduce((sum, u) => sum + Math.max(0, Math.min(u.hp || 0, u.maxHp || 0)), 0);
  const hpPct = maxHp > 0 ? hp / maxHp : 0;
  const effectiveShips = Math.round(units.reduce((sum, u) => {
    const ratio = u.maxHp > 0 ? Math.max(0, Math.min(1, u.hp / u.maxHp)) : 0;
    return sum + (u.shipCount ?? 1) * ratio;
  }, 0));
  const requested = hpPct > 0 ? Math.max(1, Math.round(Math.max(0, visualCapacity) * hpPct)) : 0;
  const visibleCount = Math.min(live.length, requested);
  // [v72] 裁剪必须**均匀散布在编队中**，不能取前 N 个（用户实报近景阵型变长条）。
  //   旧实现 `slice(0, visibleCount)` 取的是数组前段 ⇒ 大编队被裁剪时
  //   近景只渲染**连续一段**单位 ⇒ 等腰三角形被砍成**长条形**。
  //   而远景光点层用全部 DOT_SLOTS 不受裁剪 ⇒ 远景是完整三角、近景是长条，
  //   同一支舰队在两个距离呈现**两种阵型**（用户实报「搞不懂为什么」）。
  //
  //   正解：按 index 等间隔取样（保留原序 ⇒ 视觉阵型与原阵型同形，只是变稀）。
  //   · 确定性：同一 hpPct 恒定产出同一 visibleIndexes ⇒ 不闪。
  //   · 形状保真：等间隔抽稀后，单位的**相对位置关系**不变 ⇒ 三角形仍是三角形。
  // 排序口径：**健康度优先、伤害同率按格位序**（决定"优先显示谁"）。
  // ⚠ 这一步取代了旧实现的 `slice(0, visibleCount)`：旧实现对 healthy 取前 N，
  //   在全员同伤时会退化成 index 前段 ⇒ 又变回长条裁剪（v72 台架实测回归）。
  const ranked = live.slice().sort((a, b) => b.ratio - a.ratio || a.index - b.index);
  // 抽样口径：在 ranked 上**等间隔取样**（决定"取哪些格位"）。
  //   健康优先与分布保真在此同时成立：伤重的排在 ranked 前段因而优先入选，
  //   等间隔抽样又保证入选集合散布在整个编队中。
  const picked: typeof live = [];
  if (visibleCount >= ranked.length) {
    picked.push(...ranked);
  } else if (visibleCount > 0) {
    for (let k = 0; k < visibleCount; k++) {
      const pos = Math.floor(((k + 0.5) * ranked.length) / visibleCount);
      picked.push(ranked[Math.min(ranked.length - 1, pos)]);
    }
  }
  const visibleIndexes = picked.map((x) => x.index).sort((a, b) => a - b);
  return { hpPct, effectiveShips, visibleCount, visibleIndexes };
}

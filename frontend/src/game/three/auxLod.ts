/**
 * auxLod — 运输舰 LOD 判定（**纯逻辑，零 three 依赖**，可被离线台架真跑）
 *
 * 为什么单独成模块（而不是内联在 Battle3DOverlay）：
 *   LOD 的输入输出是"这艘舰在屏幕上有多大 / 要不要建实体"，是纯数值判定；
 *   但历史上它被舰队级量 `fleetPx`（母队成员 px 均值）驱动 ⇒ **运输舰独航时母队可能在千里之外**，
 *   相机贴到运输舰脸上也只画一个光点（实测约 12% 帧退化）。本模块把"运输舰的代表 px"
 *   钉死为**它自己的 px**，从而让"贴脸必有模型"成为结构性结论，并被台架逐条守住。
 *
 * 三条契约：
 *   1. `auxLodPx(selfPx)` 恒等于 `selfPx` —— 运输舰的 LOD 只看相机到**它自己**的距离。
 *   2. `auxLodVerdict` 的滞回与舰队同口径（keep/drop 两个阈值），但输入是自身 px。
 *   3. 任何"用母队/编队成员均值"的输入都**不会被本模块接受**（签名里没有这个参数）。
 */

/** 运输舰的 LOD 代表 px：**自身 px**（= 相机到它自己的投影长度）。
 *  该值同时被 `grow`（点↔模型浓淡）与实体预算排序消费，故"代表 px 用错"= 贴脸也只剩光点。 */
export function auxLodPx(selfPx: number): number {
  return Number.isFinite(selfPx) ? selfPx : 0;
}

/** 运输舰的实体档判定（与舰队 LOD 同滞回口径，但输入是自身 px）。
 *  @param hasMesh 当前是否已持实体
 *  @param lodKeep 无实体时"建实体"的门槛（近景档 = 0）
 *  @param lodDrop 有实体时"归还实体"的门槛
 *  @returns 'mesh' 继续/开始持有实体 | 'drop' 归还实体 | 'none' 保持现状（未达门槛） */
export function auxLodVerdict(i: {
  selfPx: number;
  hasMesh: boolean;
  lodKeep: number;
  lodDrop: number;
  entryActive?: boolean;
}): 'mesh' | 'drop' | 'none' {
  const px = auxLodPx(i.selfPx);
  if (i.entryActive) return 'mesh';
  if (i.hasMesh) return px >= i.lodDrop ? 'mesh' : 'drop';
  return px >= i.lodKeep ? 'mesh' : 'none';
}

/** 运输舰的 `grow`（点↔模型浓淡，0 = 纯光点 / 1 = 纯模型）。
 *  与 Battle3DOverlay 的 `sstep` **逐位同式**（GLSL smoothstep）。
 *  ⚠ 这是"贴脸只剩光点"的直接病灶：旧实现喂的是**母队均值**，运输舰独航时该值极小 ⇒ grow≈0
 *     ⇒ 模型被压成近透明、光点层仍画出 ⇒ 观感就是"只有一个光点"。 */
export function auxGrowK(selfPx: number, lodLo: number, lodHi: number): number {
  const x = auxLodPx(selfPx);
  const t = Math.min(1, Math.max(0, (x - lodLo) / Math.max(1e-6, lodHi - lodLo)));
  return t * t * (3 - 2 * t);
}


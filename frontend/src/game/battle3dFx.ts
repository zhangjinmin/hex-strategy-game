/**
 * battle3dFx — BattleScene（Phaser 2D 逻辑层）→ Battle3DOverlay（Three.js 渲染层）的特效事件桥。
 * 模块级单例，风格对齐 services/CommandBridge.ts：无状态依赖、纯函数进出。
 * 坐标约定：BattleScene 像素坐标（tile.x/y、sprite.x/y 同源）。
 * 3D 侧换算：世界坐标 = (x, 地形高度 + 巡航余量, -y)。
 * BattleScene 只在原特效触发点 push 事件（每处 ≤5 行），2D 逻辑零改动。
 */

/** 3D 特效事件（kind 决定可选字段的含义，消费逻辑见 Battle3DOverlay.handleFx） */
export interface Fx3dEvent {
  kind: 'laser' | 'shield' | 'hit' | 'capture' | 'strike' | 'missiles' | 'fortress_charge' | 'fortress_beam';
  /** laser / strike / missiles：发射端像素坐标 */
  from?: { x: number; y: number };
  /** laser：目标端像素坐标 */
  to?: { x: number; y: number };
  /** shield / hit / capture：命中点/星球中心像素坐标 */
  at?: { x: number; y: number };
  /** shield：来袭方向（2D 平面单位向量，激光传播方向） */
  dir?: { x: number; y: number };
  /** 阵营色（0xRRGGBB，来源 fac.color） */
  color: number;
  /** 阵营 id（capture 用；strike 用：3D 侧按敌我选择舰载机模型） */
  factionId?: number;
  /** laser 附加标记：>=2 表示导弹/鱼雷齐射（视觉上更细更慢） */
  power?: number;
  /** shield：受击舰舰种（中英文均可，dimsOf 可解）→ 3D 护盾尺寸与舰长挂钩（v6：
   *  废弃"舰队展开半径"口径——护盾是单舰偏导盾，尺寸应与舰艇相关，用户定案） */
  shipClass?: string;
  /** 兼容保留：未传 shipClass 时的回退尺寸（世界像素单位） */
  size?: number;
  /** strike / missiles：弹数（舰载机架数 / 导弹枚数） */
  count?: number;
  /** strike：每架舰载机命中结算伤害 */
  dmg?: number;
  /** fortress_charge：充能时长（ms）；fortress_beam：三层光束中的层宽（px 口径，3D 侧按 hexR 折算） */
  width?: number;
  /** fortress_charge / fortress_beam：持续时间（ms），3D 侧换算动画寿命 */
  duration?: number;
}

const MAX_QUEUE = 200;
const queue: Fx3dEvent[] = [];

/** 入队（上限 200，满了丢最旧的）——BattleScene 特效触发点调用 */
export function pushFx3d(e: Fx3dEvent): void {
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push(e);
}

/** 一次性取出并清空（3D 渲染层每帧调用） */
export function drainFx3d(): Fx3dEvent[] {
  if (queue.length === 0) return [];
  const out = queue.slice();
  queue.length = 0;
  return out;
}

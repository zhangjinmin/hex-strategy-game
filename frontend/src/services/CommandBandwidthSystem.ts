/**
 * CommandBandwidthSystem — 指挥带宽引擎（指挥链延迟机制）
 *
 * 纯计算层，不依赖 Phaser 或 Vue。
 *
 * 设计来源：《银英旧案单机化梳理与融合方案》——把旧多人案的"指挥延迟/通信截断"
 * 转译为单机"命令带宽"：玩家旗舰通信阵列容量有限，超出中继范围的舰队无法接收新命令，
 * 只能依据既有姿态命令（stance AI）自主行动——把"杨威利式指挥官困境"变成机制而非演出。
 *
 * 三级链路状态（按舰队与玩家主舰队的距离判定）：
 *   direct  — 直连范围（relayRange）内：命令即时送达
 *   delayed — 中继范围（relayRange × 2）内：命令入队，经中继延迟送达（战术上可被"时间差"利用）
 *   silent  — 中继范围外：拒收一切新命令，舰队按既有 stance 自主行动（AI 照常运转）
 *
 * 频道（channel）容量：maxChannels 支舰队可同时持有直连频道。
 * 频道只在舰队进入 direct 区时自动建立（v1 简化：不占满也可对 delayed 区下单，
 * 但 delayed 命令走中继有延迟；silent 区一律拒收）。
 *
 * 旗舰损毁降级：flagshipDown → 容量-1、中继范围收缩、清空全部频道（副舰长接管的混乱窗口）。
 */

// ── 公开状态 ──

export type LinkStatus = 'direct' | 'delayed' | 'silent';

/** 延迟订单：命令已发出，正在中继传输途中 */
export interface PendingOrder {
  fleetId: number;
  /** 'order' = W1 直接指令（move/attack；旧复用 'flare' 的改名）；'flare' = 旧 {x,y} 战术信标；'stance' = 变阵 */
  kind: 'order' | 'flare' | 'stance';
  payload: any;              // order → {x,y,direct:'move'|'attack',targetFleetId?}；flare → {x,y}；stance → 姿态字符串
  remainingMs: number;       // 剩余传输时间
  totalMs: number;           // 总延迟（用于进度提示）
}

export interface BandwidthState {
  maxChannels: number;          // 旗舰通信阵列容量（可同时直连的舰队数）
  relayRange: number;           // 直连半径（px）
  channels: Set<number>;        // 当前持有直连频道的舰队ID
  delayedOrders: PendingOrder[]; // 传输途中的命令队列
  flagshipDown: boolean;        // 旗舰损毁降级标记
}

// ── 实例化 ──

/**
 * @param command  玩家提督统帅值（与 CP 系统同源）
 * @param relayRange 直连半径，单位 px（随地图缩放由场景层决定）
 */
export function createBandwidthState(command: number, relayRange: number): BandwidthState {
  return {
    maxChannels: 1 + Math.floor(command / 30),  // 统帅50→2，统帅100→4
    relayRange,
    channels: new Set<number>(),
    delayedOrders: [],
    flagshipDown: false,
  };
}

// ── 链路判定 ──

/** 按距离判定链路状态 */
export function getLinkStatus(state: BandwidthState, distToFlagship: number): LinkStatus {
  if (distToFlagship <= state.relayRange) return 'direct';
  if (distToFlagship <= state.relayRange * 2) return 'delayed';
  return 'silent';
}

/** 舰队是否持有直连频道 */
export function hasChannel(state: BandwidthState, fleetId: number): boolean {
  return state.channels.has(fleetId);
}

/** 尝试为舰队建立直连频道（成功=true） */
export function establishChannel(state: BandwidthState, fleetId: number): boolean {
  if (state.channels.has(fleetId)) return true;
  if (state.channels.size >= state.maxChannels) return false;
  state.channels.add(fleetId);
  return true;
}

/** 释放舰队频道（舰队被歼灭 / 主舰队更换时调用） */
export function releaseChannel(state: BandwidthState, fleetId: number) {
  state.channels.delete(fleetId);
  // 该舰队的传输途中订单作废（收件人已失联）
  state.delayedOrders = state.delayedOrders.filter(o => o.fleetId !== fleetId);
}

/** 命令是否可以即时下达（direct 区且频道可用） */
export function canOrderInstantly(state: BandwidthState, status: LinkStatus, fleetId: number): boolean {
  if (status === 'silent') return false;
  if (status === 'delayed') return false;
  return hasChannel(state, fleetId) || establishChannel(state, fleetId);
}

/** 命令是否走中继延迟（delayed 区） */
export function isRelayOrder(state: BandwidthState, status: LinkStatus): boolean {
  return status === 'delayed';
}

/** 计算中继延迟：距离越远延迟越长（1.5×relayRange 处约 4 秒，上限 8 秒） */
export function relayDelayMs(state: BandwidthState, distToFlagship: number): number {
  const t = Math.min(1, Math.max(0, (distToFlagship - state.relayRange) / state.relayRange));
  return 1500 + t * 6500;
}

// ── 延迟订单队列 ──

export function queueDelayedOrder(
  state: BandwidthState,
  kind: 'order' | 'flare' | 'stance',
  fleetId: number,
  payload: any,
  delayMs: number
): PendingOrder {
  // 同舰队同类型订单：新命令覆盖旧命令（最后一次通讯为准）
  state.delayedOrders = state.delayedOrders.filter(o => !(o.fleetId === fleetId && o.kind === kind));
  const order: PendingOrder = { fleetId, kind, payload, remainingMs: delayMs, totalMs: delayMs };
  state.delayedOrders.push(order);
  return order;
}

// ── 每帧更新（在 BattleScene.update / applyCommandEffects 中调用）──

/**
 * 推进延迟订单倒计时。
 * @returns 本帧送达的订单数组，由场景层执行（场景层知道怎么执行 flare/stance）
 */
export function updateBandwidthState(state: BandwidthState, dtMs: number): PendingOrder[] {
  const arrived: PendingOrder[] = [];
  for (let i = state.delayedOrders.length - 1; i >= 0; i--) {
    const o = state.delayedOrders[i];
    o.remainingMs -= dtMs;
    if (o.remainingMs <= 0) {
      arrived.push(o);
      state.delayedOrders.splice(i, 1);
    }
  }
  return arrived;
}

// ── 旗舰损毁降级 ──

/** 旗舰被击沉：容量-1、中继范围收缩至60%、清空全部频道与在途订单 */
export function degradeForFlagshipLoss(state: BandwidthState) {
  if (state.flagshipDown) return;
  state.flagshipDown = true;
  state.maxChannels = Math.max(1, state.maxChannels - 1);
  state.relayRange = Math.round(state.relayRange * 0.6);
  state.channels.clear();
  state.delayedOrders = [];
}

// ── UI 辅助 ──

export const LINK_COLORS: Record<LinkStatus, number> = {
  direct: 0x00ff88,   // 绿
  delayed: 0xf59e0b,  // 黄
  silent: 0xef4444,   // 红
};

export const LINK_CN: Record<LinkStatus, string> = {
  direct: '直连',
  delayed: '中继',
  silent: '失联',
};

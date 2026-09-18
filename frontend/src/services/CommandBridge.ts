/**
 * CommandBridge — 指挥点系统在 BattleScene (Phaser) 和 CommandPanel (Vue) 之间的共享状态桥
 */
import { reactive } from 'vue';
import type { CPState } from './CommandPointSystem';
import type { BandwidthState } from './CommandBandwidthSystem';

interface CommandBridgeState {
  visible: boolean;               // 命令面板是否显示
  cpState: CPState | null;        // 当前CP状态
  bwState: BandwidthState | null; // 指挥带宽状态（链路/频道）
  fleetAdmiralId: number;         // 当前玩家舰队的提督ID
  battleAdmiralIds: number[];     // 战场上所有提督ID
  selectedAbilityId: string | null; // 选中的命令ID
  pendingCallback: ((targetFleetId: number | null) => void) | null; // 完成选目标后的回调
  staffBriefing: string;          // 参谋敌情摘要（面板顶部一行；空串=无情报）
  hasVisibleTargets: boolean;     // [2a] 面板打开时"是否有可见敌方舰队" —— 4 个目标命令卡片置灰依据（07 §6）
}

export const commandBridge = reactive<CommandBridgeState>({
  visible: false,
  cpState: null,
  bwState: null,
  fleetAdmiralId: -1,
  battleAdmiralIds: [],
  selectedAbilityId: null,
  pendingCallback: null,
  staffBriefing: '',
  hasVisibleTargets: true,
});

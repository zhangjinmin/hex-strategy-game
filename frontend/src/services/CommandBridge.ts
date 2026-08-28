/**
 * CommandBridge — 指挥点系统在 BattleScene (Phaser) 和 CommandPanel (Vue) 之间的共享状态桥
 */
import { reactive } from 'vue';
import type { CPState } from './CommandPointSystem';

interface CommandBridgeState {
  visible: boolean;               // 命令面板是否显示
  cpState: CPState | null;        // 当前CP状态
  fleetAdmiralId: number;         // 当前玩家舰队的提督ID
  battleAdmiralIds: number[];     // 战场上所有提督ID
  selectedAbilityId: string | null; // 选中的命令ID
  pendingCallback: ((targetFleetId: number | null) => void) | null; // 完成选目标后的回调
}

export const commandBridge = reactive<CommandBridgeState>({
  visible: false,
  cpState: null,
  fleetAdmiralId: -1,
  battleAdmiralIds: [],
  selectedAbilityId: null,
  pendingCallback: null,
});

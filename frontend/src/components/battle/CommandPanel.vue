<template>
  <div class="command-panel-overlay">
    <div class="command-panel neo-card">
      <div class="cp-header">
        <div class="cp-title">⚡ 指挥面板</div>
        <div class="cp-bar-wrapper">
          <div class="cp-bar">
            <div class="cp-fill" :style="{ width: cpPct + '%' }"></div>
          </div>
          <span class="cp-text">{{ Math.floor(currentCP) }} / {{ maxCP }} CP</span>
        </div>
        <button class="cp-close" @click="close" title="关闭(空格键)">✕</button>
      </div>

      <div v-if="staffBriefing" class="staff-briefing">🎖 {{ staffBriefing }}</div>
      <div v-if="bwState" class="bw-briefing" :class="{ degraded: bwState.flagshipDown }">
        ⌁ 通信频道 {{ bwState.channels.size }}/{{ bwState.maxChannels }}
        <template v-if="bwState.delayedOrders.length > 0">｜中继传输中 ×{{ bwState.delayedOrders.length }}</template>
        <template v-if="bwState.flagshipDown">｜⌁ 旗舰降级：指挥半径 -40%</template>
      </div>

      <div class="cp-body">
        <div class="cp-section">
          <div class="cp-section-title">■ 通用命令</div>
          <div
            v-for="cmd in genericCommands"
            :key="cmd.id"
            class="cp-command"
            :class="{ disabled: !cmd.available || !cmd.implemented || cmd.noTarget, unimplemented: !cmd.implemented, selected: cmd.id === selectedId }"
            @click="selectCommand(cmd)"
          >
            <div class="cmd-row">
              <span class="cmd-name">{{ cmd.name }}</span>
              <span class="cmd-cost">{{ cmd.cpCost }}CP</span>
            </div>
            <div class="cmd-desc">{{ cmd.description }}</div>
            <div v-if="!cmd.implemented" class="cmd-unimplemented">⚠ 效果尚未实现</div>
            <div v-else-if="cmd.partialNote" class="cmd-partial">⚠ {{ cmd.partialNote }}</div>
            <div v-if="cmd.noTarget" class="cmd-no-target">⚠ 当前无可见敌方舰队</div>
            <div v-if="cmd.cooldown > 0" class="cmd-cd">冷却 {{ (cmd.cooldown / 1000).toFixed(0) }}s</div>
          </div>
        </div>

        <div class="cp-section" v-if="admiralCommands.length > 0">
          <div class="cp-section-title">★ 提督专属</div>
          <div
            v-for="cmd in admiralCommands"
            :key="cmd.id"
            class="cp-command admiral"
            :class="{ disabled: !cmd.available || !cmd.implemented || cmd.noTarget, unimplemented: !cmd.implemented, selected: cmd.id === selectedId }"
            @click="selectCommand(cmd)"
          >
            <div class="cmd-row">
              <span class="cmd-name">{{ cmd.name }}</span>
              <span class="cmd-cost">{{ cmd.cpCost }}CP</span>
            </div>
            <div class="cmd-desc">{{ cmd.description }}</div>
            <div v-if="!cmd.implemented" class="cmd-unimplemented">⚠ 效果尚未实现</div>
            <div v-else-if="cmd.partialNote" class="cmd-partial">⚠ {{ cmd.partialNote }}</div>
            <div v-if="cmd.noTarget" class="cmd-no-target">⚠ 当前无可见敌方舰队</div>
            <div v-if="cmd.cooldown > 0" class="cmd-cd">冷却 {{ (cmd.cooldown / 1000).toFixed(0) }}s</div>
          </div>
        </div>
      </div>

      <div class="cp-footer">
        <span v-if="selectedId" class="selected-hint">
          已选: {{ selectedName }} — 点击战场选择目标(Esc 取消)
        </span>
        <span v-else class="selected-hint dim">选择命令后点击战场目标</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { getAvailableCommands, type CommandAbility } from '../../config/commandAbilities';
import type { CPState } from '../../services/CommandPointSystem';
import { commandBridge } from '../../services/CommandBridge';

const props = defineProps<{
  cpState: CPState;
  fleetAdmiralId: number;
  battleAdmiralIds: number[];
}>();

const emit = defineEmits<{
  // [2a] 事件语义分离：
  //   execute       = 非目标命令 → 直接执行（扣 CP + 生效）
  //   select-target = 目标命令 → 进入选目标态（面板保持打开，不执行、不扣 CP）
  //   cancel-target = 退选目标态回列表（面板不关、暂停不解除，不扣 CP）
  //   cancel        = 关闭面板并取消一切未确认操作（绝不执行、绝不扣 CP）
  (e: 'execute', abilityId: string): void;
  (e: 'select-target', abilityId: string): void;
  (e: 'cancel-target'): void;
  (e: 'cancel'): void;
}>();

const selectedId = ref<string | null>(null);
const staffBriefing = computed(() => commandBridge.staffBriefing);
const bwState = computed(() => commandBridge.bwState);
// [2a] 面板打开时是否有可见敌方舰队（BattleScene 打开面板时写入 bridge）—— 07 §6 置灰依据
const hasVisibleTargets = computed(() => commandBridge.hasVisibleTargets);

const currentCP = computed(() => props.cpState.currentCP);
const maxCP = computed(() => props.cpState.maxCP);
const cpPct = computed(() => props.cpState.maxCP > 0 ? (props.cpState.currentCP / props.cpState.maxCP) * 100 : 0);

const allCommands = computed(() => {
  const cmds = getAvailableCommands(props.fleetAdmiralId, props.battleAdmiralIds);
  return cmds.map(c => ({
    ...c,
    // available 仅表示「CP 足够 + 冷却结束」，仍驱动冷却提示与置灰
    available: props.cpState.currentCP >= c.cpCost && (props.cpState.cooldowns[c.id] || 0) <= 0,
    cooldown: props.cpState.cooldowns[c.id] || 0,
    implemented: c.implemented !== false,
    partialNote: c.partialNote,
    // [2a] 目标命令 + 无可见敌方舰队 → 置灰（07 §6：从源头禁用，避免"点了没反应"）
    noTarget: c.requiresTarget && !hasVisibleTargets.value,
  }));
});

const genericCommands = computed(() => allCommands.value.filter(c => !c.admiralId));
const admiralCommands = computed(() => allCommands.value.filter(c => c.admiralId));
const selectedName = computed(() => {
  const cmd = allCommands.value.find(c => c.id === selectedId.value);
  return cmd?.name || '';
});

function selectCommand(cmd: CommandAbility & { available: boolean; cooldown: number; implemented: boolean; noTarget: boolean }) {
  // 未实现的命令 costs CP 但无任何效果 —— 必须在入口挡住，不能只靠 CSS 置灰
  if (!cmd.available || !cmd.implemented || cmd.noTarget) return;
  // [2a] 再次点击已选中的卡片 = 取消该选择（07 §5.1）
  if (cmd.id === selectedId.value) {
    selectedId.value = null;
    commandBridge.selectedAbilityId = null;
    if (cmd.requiresTarget) emit('cancel-target');
    else emit('cancel');
    return;
  }
  // [2a] 统一先写 bridge（非目标命令的执行路径依赖它）
  selectedId.value = cmd.id;
  commandBridge.selectedAbilityId = cmd.id;
  if (cmd.requiresTarget) {
    // 目标命令 → 进入选目标态（面板保持打开，由 App.handleCommandSelectTarget 通知 BattleScene）
    emit('select-target', cmd.id);
  } else {
    // 非目标命令 → 直接执行
    emit('execute', cmd.id);
  }
}

function close() {
  // [2a] ✕ / 列表态 Esc → 取消（绝不执行）
  emit('cancel');
}

// 键盘控制（仅 Esc，Space 由 BattleScene 统一管理）
// [2a] Esc：已进入选目标态 → 退选回列表（cancel-target）；否则 → 关闭面板取消（cancel）
function onKey(e: KeyboardEvent) {
  if (e.code === 'Escape') {
    if (selectedId.value) {
      selectedId.value = null;
      commandBridge.selectedAbilityId = null;
      emit('cancel-target');
    } else {
      close();
    }
  }
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<style scoped>
/* [2a] 非模态：overlay 不再全屏拦截（07 §5.1「点击战场是选择操作，不是取消」）。
   pointer-events:none ⇒ 点击穿透到 3D/2D 战场用于选目标；仅面板本体可点。
   右侧停靠（03-command-flow-3d.md §2：宽 320px，不遮挡战场中心），z-index 保持盖住 3D canvas。 */
.command-panel-overlay {
  position: fixed; inset: 0; z-index: 1200;
  pointer-events: none;
  display: flex; align-items: flex-start; justify-content: flex-end;
  padding: 88px 16px 16px 0;
}
.command-panel {
  pointer-events: auto;
  width: 320px; max-height: calc(100vh - 120px); overflow-y: auto;
  padding: 0;
  background: rgba(10,20,40,0.95); border: 1px solid rgba(6,182,212,0.3);
  border-radius: 8px; display: flex; flex-direction: column;
}
.cp-header {
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgba(6,182,212,0.15);
  display: flex; align-items: center; gap: 10px;
}
.cp-title { font-size: 15px; font-weight: 800; color: var(--color-gold, #f59e0b); }
.cp-bar-wrapper { flex: 1; display: flex; align-items: center; gap: 6px; }
.cp-bar { flex: 1; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; }
.cp-fill { height: 100%; background: var(--color-cyan, #06b6d4); border-radius: 3px; transition: width 0.3s; }
.cp-text { font-size: 11px; font-weight: 700; color: var(--color-text-secondary); white-space: nowrap; }
.cp-close { background: none; border: none; color: var(--color-text-disabled); font-size: 16px; cursor: pointer; }

.staff-briefing {
  margin: 8px 16px 0; padding: 6px 10px;
  font-size: 11px; font-weight: 600; color: var(--color-gold, #f59e0b);
  background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.2);
  border-radius: 4px; line-height: 1.5;
}

.bw-briefing {
  margin: 6px 16px 0; padding: 5px 10px;
  font-size: 11px; font-weight: 600; color: #00ccff;
  background: rgba(0,204,255,0.05); border: 1px solid rgba(0,204,255,0.18);
  border-radius: 4px; line-height: 1.5;
}
.bw-briefing.degraded { color: #ef4444; border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.05); }

.cp-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
.cp-section { display: flex; flex-direction: column; gap: 6px; }
.cp-section-title { font-size: 11px; font-weight: 700; color: var(--color-text-disabled); text-transform: uppercase; letter-spacing: 0.05em; }

.cp-command {
  padding: 10px 12px; border: 1px solid rgba(6,182,212,0.12); border-radius: 5px;
  cursor: pointer; transition: all 0.15s; background: rgba(0,0,0,0.2);
}
.cp-command:hover:not(.disabled) { border-color: rgba(6,182,212,0.4); background: rgba(6,182,212,0.06); }
.cp-command.selected { border-color: var(--color-cyan); background: rgba(6,182,212,0.1); }
.cp-command.disabled { opacity: 0.4; cursor: not-allowed; }
.cp-command.admiral { border-color: rgba(245,158,11,0.2); }
.cp-command.admiral.selected { border-color: var(--color-gold, #f59e0b); background: rgba(245,158,11,0.08); }

.cmd-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; }
.cmd-name { font-size: 13px; font-weight: 700; color: var(--color-text-primary); }
.cmd-cost { font-size: 11px; font-weight: 700; color: var(--color-cyan); }
.cmd-desc { font-size: 11px; color: var(--color-text-secondary); }
.cmd-cd { font-size: 10px; color: var(--color-warning); margin-top: 2px; }

/* 未实现命令：同样置灰，但 opacity 高于普通 disabled —— 0.4 会让警示徽章难以辨认，
   而这些命令的置灰理由是"永久性"的（效果层不存在），玩家需要看清原因。 */
.cp-command.unimplemented { opacity: 0.62; }
.cmd-unimplemented { font-size: 10px; font-weight: 700; color: var(--color-warning); margin-top: 2px; }
.cmd-partial { font-size: 10px; color: var(--color-text-secondary); margin-top: 2px; font-style: italic; }
/* [2a] 无可见敌方舰队：目标命令置灰原因（07 §6 显式原因文字） */
.cmd-no-target { font-size: 10px; font-weight: 700; color: var(--color-warning); margin-top: 2px; }

.cp-footer {
  padding: 10px 16px; border-top: 1px solid rgba(6,182,212,0.15);
}
.selected-hint { font-size: 12px; color: var(--color-text-primary); font-weight: 600; }
.selected-hint.dim { color: var(--color-text-disabled); }
</style>

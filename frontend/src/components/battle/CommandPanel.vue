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
        <template v-if="bwState.flagshipDown">｜⌁ 旗舰降级：指挥半径 -30%</template>
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
/* 非模态：点击战场是选择操作而非取消；仅面板本体可点（沿用既有约定） */
.command-panel-overlay {
  position: fixed; inset: 0; z-index: 1200; pointer-events: none;
  display: flex; align-items: flex-start; justify-content: flex-end;
  padding: 96px var(--ui-3) var(--ui-3) 0;
}
.command-panel {
  pointer-events: auto;
  width: 380px; max-height: calc(100vh - 128px); overflow-y: auto;
  padding: 0; background: var(--ui-panel);
  border: var(--ui-frame-strong); border-radius: var(--ui-radius);
  box-shadow: var(--ui-shadow-panel); backdrop-filter: blur(10px);
  display: flex; flex-direction: column;
}
.cp-header {
  padding: var(--ui-3); border-bottom: var(--ui-frame);
  display: flex; align-items: center; gap: var(--ui-2);
}
.cp-title { font-family: var(--ui-display-font); font-size: var(--fs-h3); font-weight: 800; letter-spacing: 0.1em; color: var(--dmc-gold); }
.cp-bar-wrapper { flex: 1; display: flex; align-items: center; gap: var(--ui-1); }
.cp-bar { flex: 1; height: 8px; background: var(--ui-surface-3); border: 1px solid var(--ui-line); overflow: hidden; }
.cp-fill { height: 100%; background: var(--ui-accent); transition: width var(--ui-dur-normal) var(--ui-ease); }
.cp-text { font-size: var(--fs-caption); font-weight: 800; color: var(--ui-ink-2); white-space: nowrap; font-variant-numeric: tabular-nums; }
.cp-close { background: none; border: none; color: var(--ui-ink-3); font-size: var(--fs-h3); cursor: pointer; }
.cp-close:hover { color: var(--ui-ink); }

.staff-briefing {
  margin: var(--ui-2) var(--ui-3) 0; padding: var(--ui-1) var(--ui-2);
  font-size: var(--fs-caption); font-weight: 700; color: var(--dmc-warning);
  background: rgba(245, 158, 11, 0.07); border: 1px solid rgba(245, 158, 11, 0.24);
  border-radius: var(--ui-radius); line-height: 1.55;
}
.bw-briefing {
  margin: var(--ui-1) var(--ui-3) 0; padding: var(--ui-1) var(--ui-2);
  font-size: var(--fs-caption); font-weight: 700; color: var(--ui-accent);
  background: var(--ui-accent-soft); border: 1px solid var(--ui-line-strong);
  border-radius: var(--ui-radius); line-height: 1.55;
}
.bw-briefing.degraded { color: var(--dmc-danger); border-color: var(--dmc-danger); background: var(--color-error-muted); }

.cp-body { padding: var(--ui-3); display: flex; flex-direction: column; gap: var(--ui-2); }
.cp-section { display: flex; flex-direction: column; gap: var(--ui-1); }
.cp-section-title { font-size: var(--fs-caption); font-weight: 800; color: var(--ui-ink-3); letter-spacing: 0.18em; }

.cp-command {
  padding: var(--ui-2); border: var(--ui-frame); border-radius: var(--ui-radius);
  cursor: pointer; background: var(--ui-surface-3);
  transition: border-color var(--ui-dur-micro), background var(--ui-dur-micro);
}
.cp-command:hover:not(.disabled) { border-color: var(--ui-accent); background: var(--ui-accent-soft); }
.cp-command.selected { border-color: var(--ui-accent); background: var(--ui-accent-soft); }
.cp-command.disabled { opacity: 0.4; cursor: not-allowed; }
.cp-command.admiral { border-color: rgba(245, 158, 11, 0.28); }
.cp-command.admiral.selected { border-color: var(--dmc-warning); background: rgba(245, 158, 11, 0.08); }

.cmd-row { display: flex; justify-content: space-between; align-items: center; gap: var(--ui-2); margin-bottom: 2px; }
.cmd-name { font-size: var(--fs-label); font-weight: 800; color: var(--ui-ink); }
.cmd-cost { font-size: var(--fs-caption); font-weight: 800; color: var(--ui-accent); font-variant-numeric: tabular-nums; }
.cmd-desc { font-size: var(--fs-caption); color: var(--ui-ink-2); line-height: 1.5; }
.cmd-cd { font-size: var(--fs-caption); color: var(--dmc-warning); margin-top: 2px; }

/* 未实现命令：置灰理由需可读，opacity 高于普通 disabled */
.cp-command.unimplemented { opacity: 0.62; }
.cmd-unimplemented { font-size: var(--fs-caption); font-weight: 700; color: var(--dmc-warning); margin-top: 2px; }
.cmd-partial { font-size: var(--fs-caption); color: var(--ui-ink-2); margin-top: 2px; }
.cmd-no-target { font-size: var(--fs-caption); font-weight: 700; color: var(--dmc-warning); margin-top: 2px; }

.cp-footer { padding: var(--ui-2) var(--ui-3); border-top: var(--ui-frame); }
.selected-hint { font-size: var(--fs-label); color: var(--ui-ink); font-weight: 700; }
.selected-hint.dim { color: var(--ui-ink-3); }
</style>

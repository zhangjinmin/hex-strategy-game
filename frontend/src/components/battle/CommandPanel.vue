<template>
  <div class="command-panel-overlay" @click.self="close">
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

      <div class="cp-body">
        <div class="cp-section">
          <div class="cp-section-title">■ 通用命令</div>
          <div
            v-for="cmd in genericCommands"
            :key="cmd.id"
            class="cp-command"
            :class="{ disabled: !cmd.available, selected: cmd.id === selectedId }"
            @click="selectCommand(cmd)"
          >
            <div class="cmd-row">
              <span class="cmd-name">{{ cmd.name }}</span>
              <span class="cmd-cost">{{ cmd.cpCost }}CP</span>
            </div>
            <div class="cmd-desc">{{ cmd.description }}</div>
            <div v-if="cmd.cooldown > 0" class="cmd-cd">冷却 {{ (cmd.cooldown / 1000).toFixed(0) }}s</div>
          </div>
        </div>

        <div class="cp-section" v-if="admiralCommands.length > 0">
          <div class="cp-section-title">★ 提督专属</div>
          <div
            v-for="cmd in admiralCommands"
            :key="cmd.id"
            class="cp-command admiral"
            :class="{ disabled: !cmd.available, selected: cmd.id === selectedId }"
            @click="selectCommand(cmd)"
          >
            <div class="cmd-row">
              <span class="cmd-name">{{ cmd.name }}</span>
              <span class="cmd-cost">{{ cmd.cpCost }}CP</span>
            </div>
            <div class="cmd-desc">{{ cmd.description }}</div>
            <div v-if="cmd.cooldown > 0" class="cmd-cd">冷却 {{ (cmd.cooldown / 1000).toFixed(0) }}s</div>
          </div>
        </div>
      </div>

      <div class="cp-footer">
        <span v-if="selectedId" class="selected-hint">
          已选: {{ selectedName }} — 点击战场选择目标
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

const props = defineProps<{
  cpState: CPState;
  fleetAdmiralId: number;
  battleAdmiralIds: number[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'select-target', abilityId: string): void;
}>();

const selectedId = ref<string | null>(null);

const currentCP = computed(() => props.cpState.currentCP);
const maxCP = computed(() => props.cpState.maxCP);
const cpPct = computed(() => props.cpState.maxCP > 0 ? (props.cpState.currentCP / props.cpState.maxCP) * 100 : 0);

const allCommands = computed(() => {
  const cmds = getAvailableCommands(props.fleetAdmiralId, props.battleAdmiralIds);
  return cmds.map(c => ({
    ...c,
    available: props.cpState.currentCP >= c.cpCost && (props.cpState.cooldowns[c.id] || 0) <= 0,
    cooldown: props.cpState.cooldowns[c.id] || 0,
  }));
});

const genericCommands = computed(() => allCommands.value.filter(c => !c.admiralId));
const admiralCommands = computed(() => allCommands.value.filter(c => c.admiralId));
const selectedName = computed(() => {
  const cmd = allCommands.value.find(c => c.id === selectedId.value);
  return cmd?.name || '';
});

function selectCommand(cmd: CommandAbility & { available: boolean; cooldown: number }) {
  if (!cmd.available) return;
  selectedId.value = cmd.id;
  if (cmd.requiresTarget) {
    emit('select-target', cmd.id);
  } else {
    // 不需要目标 → 直接通过 close 发执行信号
    emit('close');
  }
}

function close() {
  emit('close');
}

// 键盘控制（仅 Esc 关闭，Space 由 BattleScene 统一管理）
function onKey(e: KeyboardEvent) {
  if (e.code === 'Escape') {
    close();
  }
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<style scoped>
.command-panel-overlay {
  position: fixed; inset: 0; z-index: 1200;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
}
.command-panel {
  width: min(380px, 90vw); max-height: 80vh; overflow-y: auto;
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

.cp-footer {
  padding: 10px 16px; border-top: 1px solid rgba(6,182,212,0.15);
}
.selected-hint { font-size: 12px; color: var(--color-text-primary); font-weight: 600; }
.selected-hint.dim { color: var(--color-text-disabled); }
</style>

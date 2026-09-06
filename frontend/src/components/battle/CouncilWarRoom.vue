<template>
  <div class="war-room" v-if="visible">
    <div class="wr-header">
      <span class="wr-title">◤ 军议 · 作战会议 ◢</span>
      <button class="wr-close" @click="setWarRoomOpen(false)">×</button>
    </div>

    <!-- 总指挥 -->
    <div class="wr-supreme" v-if="supremeFac">
      <div class="wr-supreme-badge">◆ 总指挥</div>
      <div class="wr-supreme-name">{{ supremeFac.name }}</div>
      <div class="wr-supreme-sub">军衔 R{{ supremeFac.rank ?? '?' }} · 旗舰直属 — 可实时指挥（移动/攻击/姿态）</div>
    </div>

    <div class="wr-hint" v-if="deployPhase">战前军议：为各舰队分配初始任务，回车开战</div>
    <div class="wr-hint" v-else>你只能直接指挥总指挥旗舰；其余舰队在此下达任务指令</div>

    <!-- 舰队任务列表 -->
    <div class="wr-fleets">
      <div v-for="fac in ownFactions" :key="fac.id" class="wr-fleet" :class="{ supreme: fac.id === supremeId }">
        <div class="wr-fleet-head">
          <span class="wr-fleet-name">{{ fac.id === supremeId ? '◆ ' : '' }}{{ fac.name }}</span>
          <span class="wr-fleet-rank">R{{ fac.rank ?? '?' }}</span>
        </div>
        <div class="wr-fleet-mission">
          任务：<span :class="fac.mission ? 'm-on' : 'm-off'">{{ fac.mission?.text || '（未下达）' }}</span>
        </div>

        <!-- 总指挥旗舰：直接指挥，无任务表单 -->
        <div v-if="fac.id === supremeId" class="wr-fleet-locked">直接指挥中</div>
        <!-- 可改派：部署阶段全员 / 战中军衔≥8（准将） -->
        <template v-else-if="canReassign(fac)">
          <div class="wr-form">
            <select v-model="form[fac.id].type" class="wr-select" @change="onTypeChange(fac.id)">
              <option v-for="mt in missionTypes" :key="mt.type" :value="mt.type">{{ mt.label }}</option>
            </select>
            <select v-if="targetKind(form[fac.id].type) !== 'none'" v-model="form[fac.id].targetId" class="wr-select">
              <option v-for="opt in targetOptions(form[fac.id].type, fac.id)" :key="opt.id" :value="opt.id">{{ opt.name }}</option>
            </select>
            <button class="wr-issue" @click="issue(fac)">下达</button>
          </div>
        </template>
        <!-- 低军衔：战中只接令 -->
        <div v-else class="wr-fleet-locked">接令（军衔不足，战中不可改派）</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useGameStore } from '../../store/gameStore';
import { MISSION_TYPES, buildMission, canReassignMission, type MissionType, type MissionTargetKind } from '../../game/TacticalCommandSystem';

const store = useGameStore();
const missionTypes = MISSION_TYPES;

// 本 store 体量过大，pinia setup-store 的 ref 解包类型推断在部分属性上失效（类型层面仍显示 Ref），
// 沿用 App.vue 的防御式读取口径；运行时 pinia 恒已解包。
const unwrap = <T>(x: any): T => (x && typeof x === 'object' && 'value' in x ? x.value : x) as T;
/** 指挥制战斗中且面板开启时可见 */
const warRoomOpen = computed<boolean>(() => unwrap<boolean>(store.warRoomOpen));
const deployPhase = computed<boolean>(() => unwrap<boolean>(store.battleDeployPhase));
const supremeId = computed<number | null>(() => unwrap<number | null>(store.supremeCommanderId));
const visible = computed(() => warRoomOpen.value && (store.tacticalState as any)?.mapStyle === 'command');
const setWarRoomOpen = (v: boolean) => { (store as any).warRoomOpen = v; };

const ownFactions = computed(() =>
  ((store as any).factions as any[]).filter((f: any) => f.team === 1 && f.active),
);
const enemyFactions = computed(() =>
  ((store as any).factions as any[]).filter((f: any) => f.team !== 1 && f.active),
);
const supremeFac = computed(() =>
  ((store as any).factions as any[]).find((f: any) => f.id === supremeId.value) || null,
);

/** 每舰队一行的表单状态（任务类型 + 目标） */
const form = reactive<Record<number, { type: MissionType; targetId: number }>>({});
watch(ownFactions, (list) => {
  list.forEach((f: any) => {
    if (!form[f.id]) form[f.id] = { type: 'attack_fleet', targetId: 0 };
  });
}, { immediate: true });

const targetKind = (t: MissionType): MissionTargetKind =>
  missionTypes.find((m) => m.type === t)?.needsTarget || 'none';

/** 目标下拉选项：attack→敌舰队；support→其他己方；planet→敌阵营根据地 + 最近中立星球 */
const targetOptions = (t: MissionType, selfId: number) => {
  const kind = targetKind(t);
  if (kind === 'enemy_fleet') {
    return enemyFactions.value.map((f: any) => ({ id: f.id, name: f.name }));
  }
  if (kind === 'ally_fleet') {
    return ownFactions.value.filter((f: any) => f.id !== selfId).map((f: any) => ({ id: f.id, name: f.name }));
  }
  if (kind === 'planet') {
    return [
      { id: 0, name: '最近的中立/敌方星球' },
      ...enemyFactions.value.map((f: any) => ({ id: f.id, name: `${f.name} 根据地` })),
    ];
  }
  return [];
};

const onTypeChange = (facId: number) => {
  const opts = targetOptions(form[facId].type, facId);
  form[facId].targetId = opts.length ? (opts[0].id as number) : 0;
};

const canReassign = (fac: any) => canReassignMission(fac.rank, deployPhase.value);

const issue = (fac: any) => {
  const f = form[fac.id];
  if (!f) return;
  const opts = targetOptions(f.type, fac.id);
  const target = opts.find((o) => o.id === f.targetId);
  const mission = buildMission(f.type, {
    targetId: targetKind(f.type) === 'none' ? undefined : f.targetId,
    targetName: target?.name,
  });
  // dispatchFleetCommand 的 id 兼容 factionId（BattleScene 调度器解析）
  store.dispatchFleetCommand(fac.id, 'mission', mission);
};
</script>

<style scoped>
.war-room {
  position: absolute; right: 12px; top: 96px; width: 292px; max-height: calc(100% - 180px);
  overflow-y: auto; z-index: 30; pointer-events: auto;
  background: rgba(8, 14, 26, 0.92); border: 1px solid rgba(34, 211, 238, 0.35);
  border-radius: 8px; padding: 10px 12px; color: #e2e8f0;
  font-size: 12px; backdrop-filter: blur(4px);
}
.wr-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.wr-title { font-weight: 900; color: #22d3ee; font-size: 13px; letter-spacing: 1px; }
.wr-close {
  background: none; border: 1px solid rgba(148, 163, 184, 0.4); color: #94a3b8;
  width: 20px; height: 20px; border-radius: 4px; cursor: pointer; line-height: 1;
}
.wr-close:hover { color: #fff; border-color: #fff; }
.wr-supreme {
  border: 1px solid rgba(250, 204, 21, 0.45); border-radius: 6px;
  padding: 6px 8px; margin-bottom: 8px; background: rgba(250, 204, 21, 0.06);
}
.wr-supreme-badge { color: #facc15; font-weight: 900; font-size: 11px; }
.wr-supreme-name { font-weight: 900; font-size: 13px; margin: 2px 0; }
.wr-supreme-sub { color: var(--color-text-secondary, #94a3b8); font-size: 10px; }
.wr-hint { color: var(--color-text-secondary, #94a3b8); font-size: 10px; margin-bottom: 8px; line-height: 1.4; }
.wr-fleet {
  border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 6px;
  padding: 6px 8px; margin-bottom: 6px; background: rgba(15, 23, 42, 0.6);
}
.wr-fleet.supreme { border-color: rgba(250, 204, 21, 0.5); }
.wr-fleet-head { display: flex; justify-content: space-between; align-items: center; }
.wr-fleet-name { font-weight: 800; font-size: 12px; }
.wr-fleet-rank { color: #94a3b8; font-size: 10px; font-weight: 800; }
.wr-fleet-mission { font-size: 10px; margin: 3px 0; color: #94a3b8; }
.wr-fleet-mission .m-on { color: #22d3ee; font-weight: 800; }
.wr-fleet-mission .m-off { color: #64748b; }
.wr-fleet-locked { font-size: 10px; color: #64748b; font-style: italic; }
.wr-form { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
.wr-select {
  flex: 1; min-width: 90px; background: rgba(15, 23, 42, 0.95); color: #e2e8f0;
  border: 1px solid rgba(148, 163, 184, 0.4); border-radius: 4px;
  font-size: 10px; padding: 2px 4px; font-family: inherit;
}
.wr-issue {
  background: rgba(34, 211, 238, 0.15); color: #22d3ee; font-weight: 900;
  border: 1px solid rgba(34, 211, 238, 0.5); border-radius: 4px;
  font-size: 10px; padding: 2px 8px; cursor: pointer; font-family: inherit;
}
.wr-issue:hover { background: #22d3ee; color: #0a0f1c; }
</style>

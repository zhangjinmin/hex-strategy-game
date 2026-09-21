<template>
  <div class="war-room" v-if="visible" @mouseenter="setCountdownPaused(true)" @mouseleave="setCountdownPaused(false)">
    <div class="wr-header">
      <span class="wr-title">◤ 军议 · 作战会议 ◢</span>
      <button class="wr-close" @click="setWarRoomOpen(false)">×</button>
    </div>

    <!-- 总指挥确认卡（V18-A · P1）：部署阶段可[确认]/[换人]（本场一次性覆盖，不进存档） -->
    <div class="wr-supreme" v-if="supremeCand">
      <div class="wr-supreme-badge">◆ 总指挥</div>
      <div class="wr-supreme-name">{{ supremeCand.name }}</div>
      <div class="wr-supreme-sub">{{ supremeBasis }}</div>
      <div class="wr-supreme-actions" v-if="deployPhase">
        <select v-model.number="pickId" class="wr-select">
          <option v-for="c in candidates" :key="c.id" :value="c.id" :disabled="c.disabled">
            {{ c.name }}{{ c.disabled ? '（无指挥官）' : '' }}
          </option>
        </select>
        <button class="wr-issue" @click="confirmSupreme">确认</button>
        <button class="wr-issue" @click="swapSupreme">换人</button>
      </div>
      <div class="wr-supreme-sub" v-else>旗舰直属 — 可实时指挥（移动/攻击/姿态）</div>
      <div class="wr-supreme-warn" v-if="swapWarn">{{ swapWarn }}</div>
    </div>

    <div class="wr-hint" v-if="deployPhase">{{ deployHint }}</div>
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
import { computed, reactive, ref, watch } from 'vue';
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
// [2026-09-20] 原先还要求 `tacticalState.mapStyle === 'command'`；该字段已随
//   「星域棋盘 / 全息战术投影 / 3D 战场」三模式一起删除 —— 现在战斗只有指挥制。
const visible = computed(() => warRoomOpen.value);
const setWarRoomOpen = (v: boolean) => { (store as any).warRoomOpen = v; };
// [#74 · A2] 部署倒计时（单一数据源 store.deployCountdownSec）：悬停本面板时暂停计时
const setCountdownPaused = (v: boolean) => { (store as any).deployCountdownPaused = v; };
const cdSec = computed<number>(() => unwrap<number>(store.deployCountdownSec));
const cdPaused = computed<boolean>(() => unwrap<boolean>(store.deployCountdownPaused));
const deployHint = computed<string>(() => {
  const base = '战前军议：为各舰队分配初始任务 · 回车开战';
  if (cdSec.value < 0) return base;   // 战役：无倒计时
  return `${base}（${cdPaused.value ? '已暂停计时' : `${cdSec.value} 秒后自动开战`}）`;
});

const ownFactions = computed(() =>
  ((store as any).factions as any[]).filter((f: any) => f.team === 1 && f.active),
);
const enemyFactions = computed(() =>
  ((store as any).factions as any[]).filter((f: any) => f.team !== 1 && f.active),
);
// [V18-A · P1] 总指挥确认卡：候选/依据由 BattleScene.publishSupremeCommanderPanel 镜像到 store
const candidates = computed<any[]>(() => unwrap<any[]>(store.supremeCommanderCandidates) || []);
const supremeCand = computed<any>(() =>
  candidates.value.find((c: any) => c.id === supremeId.value) || null,
);
const supremeBasis = computed<string>(() => {
  const c = supremeCand.value;
  if (!c) return '';
  return `职位 ${c.roleLabel || '—'} · 军衔 R${c.rank ?? '?'} · 战术 ${c.tactics ?? '?'}`;
});
const pickId = ref<number | null>(null);
watch(supremeId, (v) => { pickId.value = v; }, { immediate: true });
watch(candidates, (list) => {
  const has = (id: any) => list.some((c: any) => c.id === id);
  if ((pickId.value == null || !has(pickId.value)) && list.length) {
    pickId.value = (supremeId.value != null && has(supremeId.value))
      ? supremeId.value
      : (list.find((c: any) => !c.disabled)?.id ?? list[0].id);
  }
}, { immediate: true });
const swapWarn = ref('');
const confirmSupreme = () => {
  (store as any).supremeCommanderOverrideId = supremeId.value; // 认可当前总指挥（本场一次性）
  swapWarn.value = '';
};
const swapSupreme = () => {
  const cur = supremeCand.value;
  const next = candidates.value.find((c: any) => c.id === pickId.value);
  if (!next || next.disabled) { swapWarn.value = '该候选不可用（无指挥官）'; return; }
  if (cur && (next.rank ?? 0) < (cur.rank ?? 0)) {
    swapWarn.value = `⚠ 已指定军衔更低的 ${next.name} 为总指挥（本场一次性覆盖）`;
  } else {
    swapWarn.value = '';
  }
  (store as any).supremeCommanderOverrideId = next.id;
  (store as any).supremeCommanderId = next.id;
};

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
  position: absolute; right: 12px; top: 170px; width: 292px; max-height: calc(100% - 200px);
  /* v3 防溢出：容器异常时面板也不得超出视口右缘/下缘 */
  max-width: calc(100% - 24px);
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
.wr-supreme-actions { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
.wr-supreme-actions .wr-select { flex: 1; min-width: 92px; }
.wr-supreme-warn { color: #fbbf24; font-size: 10px; margin-top: 4px; line-height: 1.35; }
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

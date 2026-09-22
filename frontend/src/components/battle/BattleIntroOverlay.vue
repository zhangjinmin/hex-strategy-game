<template>
  <div v-if="visible" class="io-overlay">
    <!-- 背景纹理：仪式感来自"老式战术显示器开机"，而非全屏大图 -->
    <div class="io-scan"></div>
    <div class="io-vignette"></div>

    <div class="io-shell">
      <!-- 顶栏：标题 / 模式 / 开战倒计时 -->
      <div class="io-topbar">
        <span class="io-title">◤ 战 前 军 议 ◢</span>
        <span class="io-mode">{{ modeLabel }}</span>
        <span class="io-flex"></span>
        <span class="io-cd">{{ cdLine }}</span>
      </div>

      <!-- 对阵：双方提督立绘 -->
      <div class="io-matchup">
        <div class="io-side">
          <div class="io-portrait-wrap">
            <img v-if="mine.portrait" :src="mine.portrait" class="io-portrait" alt="" />
            <div v-else class="io-portrait io-portrait-empty">?</div>
            <div class="io-portrait-glow" :style="{ borderColor: mine.cssColor }"></div>
          </div>
          <div class="io-name" :style="{ color: mine.cssColor }">{{ mine.name }}</div>
          <div class="io-meta">
            <span class="io-flag" :style="{ color: mine.cssColor }">{{ mine.traitLabel }}</span>
            <span class="io-rank">R{{ mine.rank }}</span>
            <span class="io-fleets">{{ mine.fleetCount }} 支舰队</span>
          </div>
        </div>

        <div class="io-vs">VS</div>

        <div class="io-side foe">
          <div class="io-portrait-wrap">
            <img v-if="foe.portrait" :src="foe.portrait" class="io-portrait io-portrait-foe" alt="" />
            <div v-else class="io-portrait io-portrait-empty">?</div>
            <div class="io-portrait-glow" :style="{ borderColor: foe.cssColor }"></div>
          </div>
          <div class="io-name" :style="{ color: foe.cssColor }">{{ foe.name }}</div>
          <div class="io-meta">
            <span class="io-flag" :style="{ color: foe.cssColor }">{{ foe.traitLabel }}</span>
            <span class="io-rank">R{{ foe.rank }}</span>
            <span class="io-fleets">{{ foe.fleetCount }} 支舰队</span>
          </div>
        </div>
      </div>

      <!-- 致辞：结构化模板（人人有词）+ 提督专属台词（有则叠加） -->
      <div class="io-speech">
        <div class="io-speaker">{{ mine.name }}</div>
        <div class="io-line">{{ typed }}<span class="io-caret">▌</span></div>
      </div>

      <!-- 布置区：舰队编成与任务。内嵌 CouncilWarRoom（embedded）⇒ 任务指派实现只有一份 -->
      <div class="io-deploy">
        <div class="io-sec">舰队编成 · 任务下达</div>
        <CouncilWarRoom embedded />
      </div>

      <!-- 操作区：阵型 / 姿态 / 开战 -->
      <div class="io-actions">
        <div class="io-picks">
          <div class="io-group">
            <span class="io-group-label">初始阵型</span>
            <button v-for="f in FORMATIONS" :key="f.value" class="io-opt"
                    :class="{ on: formation === f.value }" @click="pickFormation(f.value)">
              {{ f.label }}<i>{{ f.key }}</i>
            </button>
          </div>
          <div class="io-group">
            <span class="io-group-label">旗舰姿态</span>
            <button v-for="t in TACTICS" :key="t.value" class="io-opt"
                    :class="{ on: tactic === t.value }" @click="pickTactic(t.value)">
              {{ t.label }}
            </button>
          </div>
        </div>
        <button class="io-go" @click="startBattle">⚔ 开 始 战 斗</button>
      </div>

      <div class="io-hint">
        布置完成后点上方按钮开战（或按回车） · 快捷键 1-5 选阵型 / T 换姿态 · Esc 收起本界面
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * G4 · 战前军议全屏层（原「入场仪式」；用户要求：布置与仪式合一，点一次直接开战）
 *
 * 覆盖原「仪式 → 关闭 → 回到部署期 → 再按回车开战」的两段式。现在**单一界面**内完成：
 *   见对阵/致辞 → 指派各舰队任务 → 选初始阵型与旗舰姿态 → 点「开始战斗」直接开战。
 *
 * 与既有逻辑的边界（尽量不加新概念）：
 *  · 阵型 / 姿态 / 开战 = 走 `store.dispatchDeployAction(...)` → `BattleScene.onDeployAction()`
 *    （与键盘 1-5 / T / 回车**完全等价**的同一条实现，两条路径都回写 store 镜像供本层回显）。
 *  · 任务指派 = **内嵌 `CouncilWarRoom`（embedded）**，不重写表单 ⇒ 部署期与战中的任务指派
 *    共用一份实现，避免两处漂移。
 *  · 倒计时沿用既有语义（`BattleScene` 的 `deployCountdownSec`，演习 20s / 战役 -1），此处**只读显示**；
 *    鼠标进入任务区仍按 `CouncilWarRoom` 既有行为暂停计时。
 *  · 立绘只有 160×200（`_v51_assets.cjs` 实测）⇒ **按原始尺寸 1:1 展示、不放大**，
 *    仪式感交给扫描线 + 暗角 + 描边光晕。
 *  · Esc = 收起本层（回到精简部署视图，回车开战仍可用）—— 仅作逃生口，界面本身无"关闭"按钮：
 *    正常路径唯一出口就是「开始战斗」。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useGameStore, getPortrait } from '../../store/gameStore';
import { admiralQuotes, generalQuotes, spawnBriefTemplates, standingOrders } from '../../config/dialoguesData';
import CouncilWarRoom from './CouncilWarRoom.vue';

const store = useGameStore();
// 该 store 体量过大，pinia setup-store 的 ref 解包类型推断在部分属性上失效；沿用 App.vue 的防御式口径。
const unwrap = <T,>(x: any): T => (x && typeof x === 'object' && 'value' in x ? x.value : x) as T;

/** 阵型/姿态的标签与快捷键，与 `BattleScene` 键盘路径的取值域逐字对齐（勿单边新增） */
const FORMATIONS = [
  { value: 'wedge', label: '楔形', key: '1' },
  { value: 'line', label: '横阵', key: '2' },
  { value: 'spindle', label: '纺锤', key: '3' },
  { value: 'circle', label: '圆形', key: '4' },
  { value: 'square', label: '方阵', key: '5' },
] as const;
const TACTICS = [
  { value: 'search', label: '索敌' },
  { value: 'siege', label: '攻坚' },
  { value: 'defend', label: '驻守' },
] as const;

const closed = ref(false);
const deployPhase = computed<boolean>(() => !!unwrap<boolean>(store.battleDeployPhase));
const gameState = computed<string>(() => String(unwrap<string>(store.gameState) ?? ''));
const mode = computed<string>(() => String((unwrap<any>(store.tacticalState) || {}).mode ?? ''));
const modeLabel = computed(() => (mode.value === 'campaign' ? '战役 · 舰队决战' : '演习 · 战术推演'));

const visible = computed(() => deployPhase.value && !closed.value
  && (gameState.value === 'game' || gameState.value === ''));

const formation = computed<string>(() => String(unwrap<string>(store.deployFormation) ?? 'wedge'));
const tactic = computed<string>(() => String(unwrap<string>(store.deployTactic) ?? 'search'));

const cdSec = computed<number>(() => Number(unwrap<number>(store.deployCountdownSec) ?? -1));
const cdLine = computed<string>(() => {
  if (cdSec.value < 0) return '等待你的命令';
  return `${cdSec.value} 秒后自动开战`;
});

const TRAIT_LABEL: Record<string, string> = { empire: '帝国', alliance: '同盟' };

interface Side {
  name: string; portrait: string; rank: number; traitLabel: string; cssColor: string; fleetCount: number;
}
const factions = computed<any[]>(() => (unwrap<any[]>(store.factions) || []).filter((f: any) => f && f.active));

const buildSide = (f: any, fleetCount: number): Side => ({
  name: String(f?.name ?? '未知舰队').replace(/舰队$/, ''),
  portrait: getPortrait(f?.imageId ?? ''),
  rank: Number(f?.rank ?? 0),
  traitLabel: TRAIT_LABEL[String(f?.trait ?? '')] ?? '—',
  cssColor: String(f?.cssColor ?? '#22d3ee'),
  fleetCount,
});

const empty: Side = { name: '——', portrait: '', rank: 0, traitLabel: '—', cssColor: '#64748b', fleetCount: 0 };

/** 按 team 取"主队"（优先 player 类型）并统计该方舰队数。
 *  ⚠ 不写回 store 对象（曾用 `f._fleetCount = …` 污染 store，已改成本地计算）。 */
const sideOf = (team: number): Side => {
  const list = factions.value.filter((f: any) => f.team === team);
  if (!list.length) return empty;
  const lead = list.find((f: any) => f.type === 'player') ?? list[0];
  return buildSide(lead, list.length);
};
const mine = computed<Side>(() => sideOf(1));
const foe = computed<Side>(() => sideOf(2));

/** [v57] 致辞：每次进入军议随机重组——①名言（著名提督专属池优先，无则通用池）
 *  ②简报（模板池随机 + 占位符插值）③口令（高阶 R≥10 / 普通分池随机）。
 *  三段各自随机 ⇒ 同一局与上局不再一模一样。⚠ 不用 computed：依赖不变会缓存，须每次部署期重掷。 */
const speech = ref<string[]>([]);

const pick = <T,>(pool: T[]): T | null => (pool && pool.length ? pool[Math.floor(Math.random() * pool.length)] : null);

const buildSpeech = () => {
  const lines: string[] = [];
  const quote = (admiralQuotes[mine.value.name]?.length ? pick(admiralQuotes[mine.value.name]) : pick(generalQuotes)) ?? '';
  if (quote) lines.push(`「${quote}」`);
  const brief = pick(spawnBriefTemplates) ?? '';
  if (brief) {
    lines.push(
      brief
        .replace('{n}', String(mine.value.fleetCount))
        .replace('{foeN}', String(foe.value.fleetCount))
        .replace('{foe}', foe.value.name)
    );
  }
  const order = pick(mine.value.rank >= 10 ? standingOrders.high : standingOrders.normal) ?? '';
  if (order) lines.push(order);
  speech.value = lines;
};

/** 打字机 */
const typed = ref('');
let typeTimer: number | null = null;
const stopTyping = () => {
  if (typeTimer) { window.clearInterval(typeTimer); typeTimer = null; }
};
const startTyping = () => {
  const full = speech.value.join('\n');
  typed.value = '';
  stopTyping();
  let i = 0;
  typeTimer = window.setInterval(() => {
    typed.value = full.slice(0, ++i);
    if (i >= full.length) stopTyping();
  }, 22);
};

// ── 部署动作（与 BattleScene 键盘路径同一条实现）──
const pickFormation = (v: string) => { (store as any).dispatchDeployAction?.('formation', v); };
const pickTactic = (v: string) => { (store as any).dispatchDeployAction?.('tactic', v); };
const startBattle = () => { (store as any).dispatchDeployAction?.('start'); };
const closeOverlay = () => { closed.value = true; stopTyping(); };

/** 回车 = 开战（本层在 capture 阶段拦下，避免与 Phaser 键盘路径对同一次按键双触发）。
 *  Esc = 收起本层（逃生口）。数字键 / T 不拦截：交给 `BattleScene` 既有键盘路径处理后回写镜像。 */
const onKeydown = (e: KeyboardEvent) => {
  if (!visible.value) return;
  if (e.key === 'Enter') {
    e.preventDefault(); e.stopImmediatePropagation();
    startBattle();
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault(); e.stopImmediatePropagation();
    closeOverlay();
  }
};

watch(deployPhase, (v) => {
  if (v) {
    closed.value = false;
    buildSpeech();
    startTyping();
  } else {
    stopTyping();
  }
}, { immediate: true });

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true);
  if (deployPhase.value) { buildSpeech(); startTyping(); }
});
onBeforeUnmount(() => {
  stopTyping();
  window.removeEventListener('keydown', onKeydown, true);
});
</script>

<style scoped>
.io-overlay {
  position: absolute; inset: 0; z-index: 60; pointer-events: auto;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at 50% 45%, rgba(8, 18, 34, 0.94) 0%, rgba(3, 7, 16, 0.985) 70%);
  color: #e2e8f0; font-family: inherit; overflow: hidden;
}
.io-scan {
  position: absolute; inset: 0; pointer-events: none; opacity: 0.2;
  background: repeating-linear-gradient(to bottom, rgba(34, 211, 238, 0.16) 0 1px, transparent 1px 3px);
}
.io-vignette {
  position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 48%, rgba(0, 0, 0, 0.66) 100%);
}
/* 内容容器：小屏（高度不足）时整层可滚动，避免"开始战斗"被挤出视口 */
.io-shell {
  position: relative; width: min(1180px, 96vw); max-height: 96vh; overflow-y: auto;
  padding: 14px 26px 16px; text-align: center;
}

.io-topbar {
  display: flex; align-items: baseline; gap: 12px;
  border-bottom: 1px solid rgba(34, 211, 238, 0.25); padding-bottom: 7px;
}
.io-title { font-size: 17px; font-weight: 900; letter-spacing: 5px; color: #22d3ee; text-shadow: 0 0 12px rgba(34, 211, 238, 0.5); }
.io-mode { font-size: 11px; letter-spacing: 2px; color: #64748b; }
.io-flex { flex: 1; }
.io-cd { font-size: 11px; font-weight: 800; color: #f59e0b; letter-spacing: 1px; }

.io-matchup { display: flex; align-items: flex-start; justify-content: center; gap: 44px; margin: 12px 0 8px; }
.io-side { width: 210px; }
.io-portrait-wrap { position: relative; width: 160px; height: 200px; margin: 0 auto; }
.io-portrait {
  width: 160px; height: 200px; object-fit: cover; border-radius: 5px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  /* 原图 160×200 ⇒ 1:1 展示、不放大、不糊；仪式感交给扫描线/暗角/光晕 */
  filter: saturate(1.06) contrast(1.04);
}
.io-portrait-foe { filter: saturate(0.8) contrast(1.02) brightness(0.9); }
.io-portrait-empty {
  display: flex; align-items: center; justify-content: center;
  font-size: 32px; color: #475569; background: rgba(15, 23, 42, 0.8);
}
.io-portrait-glow {
  position: absolute; inset: -5px; border: 1px solid; border-radius: 8px; pointer-events: none;
  box-shadow: 0 0 16px rgba(34, 211, 238, 0.2), inset 0 0 22px rgba(0, 0, 0, 0.55); opacity: 0.85;
}
.io-name { margin-top: 7px; font-size: 15px; font-weight: 900; letter-spacing: 1px; }
.io-meta { margin-top: 3px; font-size: 10px; display: flex; gap: 8px; justify-content: center; align-items: center; }
.io-flag { font-weight: 800; }
.io-rank { color: #94a3b8; font-weight: 800; }
.io-fleets { color: #64748b; }
.io-vs { align-self: center; margin-top: 76px; font-size: 14px; font-weight: 900; color: #f59e0b; letter-spacing: 2px; }

.io-speech {
  max-width: 720px; margin: 0 auto; text-align: left; min-height: 60px;
  border-left: 2px solid rgba(34, 211, 238, 0.55); padding: 6px 12px;
  background: rgba(15, 23, 42, 0.5); border-radius: 0 5px 5px 0;
}
.io-speaker { font-size: 11px; font-weight: 900; color: #22d3ee; letter-spacing: 1px; margin-bottom: 3px; }
.io-line { font-size: 12.5px; line-height: 1.65; white-space: pre-wrap; color: #cbd5e1; }
.io-caret { color: #22d3ee; animation: io-blink 1s steps(2) infinite; }
@keyframes io-blink { 50% { opacity: 0; } }

.io-deploy { margin-top: 12px; text-align: left; }
.io-sec {
  font-size: 11px; font-weight: 900; letter-spacing: 2px; color: #22d3ee;
  border-left: 2px solid rgba(34, 211, 238, 0.5); padding-left: 6px; margin-bottom: 6px;
}

.io-actions { margin-top: 12px; }
.io-picks { display: flex; gap: 20px; justify-content: center; flex-wrap: wrap; }
.io-group { display: flex; align-items: center; gap: 4px; }
.io-group-label { font-size: 10px; color: #94a3b8; letter-spacing: 1px; margin-right: 2px; }
.io-opt {
  background: rgba(15, 23, 42, 0.85); color: #cbd5e1; font-weight: 800;
  border: 1px solid rgba(148, 163, 184, 0.35); border-radius: 4px;
  font-size: 11px; padding: 4px 10px; cursor: pointer; font-family: inherit;
}
.io-opt i { font-style: normal; color: #64748b; font-size: 9px; margin-left: 4px; }
.io-opt:hover { border-color: #22d3ee; color: #22d3ee; }
.io-opt.on { background: #22d3ee; color: #06121f; border-color: #22d3ee; }
.io-opt.on i { color: rgba(6, 18, 31, 0.6); }

.io-go {
  display: block; margin: 12px auto 0;
  background: rgba(245, 158, 11, 0.18); color: #f59e0b; font-weight: 900; letter-spacing: 4px;
  border: 1px solid rgba(245, 158, 11, 0.7); border-radius: 5px; padding: 9px 44px;
  font-size: 14px; cursor: pointer; font-family: inherit;
  box-shadow: 0 0 18px rgba(245, 158, 11, 0.16);
}
.io-go:hover { background: #f59e0b; color: #1a1204; }
.io-hint { margin-top: 8px; font-size: 10px; color: #64748b; letter-spacing: 1px; }
</style>

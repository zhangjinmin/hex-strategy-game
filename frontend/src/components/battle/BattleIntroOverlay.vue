<template>
  <div v-if="visible" class="io-overlay ui-void">
    <!-- 深空场 + 极弱扫描线：尺度感来自留白与暗角，不是贴图 -->
    <div class="io-scan"></div>
    <div class="io-vignette"></div>
    <div class="io-rail io-rail--top"></div>
    <div class="io-rail io-rail--bottom"></div>

    <div class="io-shell">
      <!-- 顶栏：我方阵营 / 模式 / 倒计时 / 敌方阵营 -->
      <div class="io-topbar">
        <span class="io-faction-tag" :data-side="mine.faction">我方 · {{ mine.traitLabel }}</span>
        <span class="io-mode">{{ modeLabel }}</span>
        <span class="io-flex"></span>
        <span class="io-cd">{{ cdLine }}</span>
        <span class="io-faction-tag" :data-side="foe.faction">敌方 · {{ foe.traitLabel }}</span>
      </div>

      <!-- 主标题：全屏唯一的 display 级文字，承担「宏大」的第一印象 -->
      <div class="io-headline">
        <h1 class="io-title ui-display">战 前 军 议</h1>
        <!-- kicker 置于主标题下方：顶部中央留给旗舰提示气泡（FloatBubble），避免压字 -->
        <div class="io-kicker ui-kicker">PRE-BATTLE COUNCIL · 舰队决战部署</div>
        <div class="io-subrule"><span></span><i>◆</i><span></span></div>
      </div>

      <!-- 对阵：双方提督立绘 -->
      <div class="io-matchup ui-duel">
        <div class="io-side ui-frame" :data-side="mine.faction">
          <div class="io-side-tag ui-kicker">{{ mine.faction === 'empire' ? 'GALACTIC EMPIRE' : 'FREE PLANETS ALLIANCE' }}</div>
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
          <!-- [W2.2] 教范阵型 + 编成明细（P2 成果可见：换提督 ⇒ 阵型/编成不同） -->
          <div class="io-doctrine" v-if="mine.formationCn">
            <span class="io-form">阵型 {{ mine.formationCn }}</span>
            <span class="io-comp">{{ mine.compText || '—' }}</span>
          </div>
        </div>

        <div class="io-vs">VS</div>

        <div class="io-side foe ui-frame" :data-side="foe.faction">
          <div class="io-side-tag ui-kicker">{{ foe.faction === 'empire' ? 'GALACTIC EMPIRE' : 'FREE PLANETS ALLIANCE' }}</div>
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
          <div class="io-doctrine" v-if="foe.formationCn">
            <span class="io-form">阵型 {{ foe.formationCn }}</span>
            <span class="io-comp">{{ foe.compText || '—' }}</span>
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
        <div class="io-sec ui-rule">舰队编成 · 任务下达</div>
        <CouncilWarRoom embedded />
      </div>

      <!-- 阵型 / 姿态：与部署区并置于左列，避免左列留白、右列满载 -->
      <div class="io-picks">
        <div class="io-group">
          <span class="io-group-label">初始阵型</span>
          <button v-for="f in FORMATIONS" :key="f.value" class="io-opt"
                  :class="{ on: formation === f.value }" @click="pickFormation(f.value)">
            {{ f.label }}<i>{{ f.key }}</i>
          </button>
          <!-- [v108] 所选阵型的数值特性：这三个数本轮起真实生效（转向限速 / 受击乘区 / 互克） -->
          <div class="io-traits">
            <span class="t-item">转向 <b>{{ turnText }}</b></span>
            <span class="t-item">侧后受伤 <b>{{ flankText }}</b></span>
            <span class="t-item">克制 <b>{{ counteredName }}</b></span>
          </div>
          <div class="io-trait-desc">{{ formCfg?.description }}</div>
        </div>
        <div class="io-group">
          <span class="io-group-label">旗舰姿态</span>
          <button v-for="t in TACTICS" :key="t.value" class="io-opt"
                  :class="{ on: tactic === t.value }" @click="pickTactic(t.value)">
            {{ t.label }}
          </button>
        </div>
      </div>

      <!-- 开战：独立居中一行，承担仪式性收束 -->
      <button class="io-go ui-btn ui-btn--primary" @click="startBattle">⚔ 开 始 战 斗</button>

      <div class="io-hint">
        布置完成后点上方按钮开战（或按回车） · 快捷键 1-5 选阵型（仅部署期）/ T 换姿态 · Esc 收起本界面
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
import { resolveAdmiralDoctrine } from '../../game/retreatDoctrine';
// [v108] 阵型特性的**唯一真源**（转向倍率 / 侧后受伤倍率 / 互克）。
//   ⚠ 本文件下方另有一个同名局部常量 `FORMATIONS`（只含 value/label/key 的按钮文案），
//     两者含义不同：那个是"按钮列表"，这个是"数值表"。为避免误用，导入侧改名。
import { FORMATIONS as FORMATION_CFG } from '../../config/formations';
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
/** [v108] 当前所选阵型的数值特性（转向 / 侧后受伤 / 互克）。
 *  「特性不被看见就等于不存在」—— 这些数值自本轮起真实影响转向速率与受击伤害，
 *   但玩家只有在选阵时看得到差异，才会拿它做决策。 */
const formCfg = computed(() => {
  const v = String(unwrap<any>(formation) ?? 'wedge');
  return (FORMATION_CFG as any)[v] ?? (FORMATION_CFG as any).wedge;
});
/** 阵型互克的对手中文名（用于特性行里"克制 xx"） */
const counteredName = computed(() => {
  const t = formCfg.value?.counters;
  return t ? ((FORMATION_CFG as any)[t]?.name ?? String(t)) : '—';
});
/** 与 AI 无关的纯读数文案：转向快/慢由 turnMul 直接映射（1 = 基准） */
const turnText = computed(() => {
  const m = Number(formCfg.value?.turnMul ?? 1);
  const pct = Math.round((m - 1) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
});
const flankText = computed(() => {
  const m = Number(formCfg.value?.flankVulnMul ?? 1);
  return `×${m.toFixed(2)}`;
});
const deployPhase = computed<boolean>(() => !!unwrap<boolean>(store.battleDeployPhase));
const gameState = computed<string>(() => String(unwrap<string>(store.gameState) ?? ''));
const mode = computed<string>(() => String((unwrap<any>(store.tacticalState) || {}).mode ?? ''));
const modeLabel = computed(() => (mode.value === 'campaign' ? '战役 · 舰队决战' : '演习 · 战术推演'));

const visible = computed(() => deployPhase.value && !closed.value
  && (gameState.value === 'game' || gameState.value === ''));

const formation = computed<string>(() => String(unwrap<string>(store.deployFormation) ?? 'wedge'));
const tactic = computed<string>(() => String(unwrap<string>(store.deployTactic) ?? 'search'));

const cdSec = computed<number>(() => Number(unwrap<number>(store.deployCountdownSec) ?? -1));
// [R2] 文案必须与 W4.1 的新行为一致：**到点不再自动开战**（store.deployAutoStart 默认 false）。
//   旧实现三分支只区分 `<0`，`>0` 与 `===0` 都渲染「N 秒后自动开战」⇒ 这是部署期**唯一常显**的倒计时
//   文案（全屏层）⇒ 玩家看到「20…0 秒后自动开战」而实际不自动开战 = 承诺与行为直接矛盾（用户实报"流程乱"）。
const cdLine = computed<string>(() => {
  if (cdSec.value < 0) return '等待你的命令';
  if (cdSec.value > 0) return `${cdSec.value} 秒 · 到点仅提示（不会自动开战）`;
  return '部署时间到 · 可继续调整，回车开战';
});

const TRAIT_LABEL: Record<string, string> = { empire: '帝国', alliance: '同盟' };

/** [W2.2] P2 成果可见：阵型中文名（`MILITARY_STYLE_PARAMS` 真源）+ 编成明细 */
const FORMATION_CN: Record<string, string> = {
  wedge: '楔形阵', line: '横阵', spindle: '纺锤阵', circle: '圆形阵', square: '方阵',
};
/** faction 的教范阵型：**仅在存在 P2 信号时**给出（`admiralStyleTag`/`composition`/`admiralTags`）。
 *  战役轨三者皆无 ⇒ 空串 ⇒ 该行不渲染（避免硬显"楔形阵"而与战略数据实际阵型不符）。 */
const formationCnOf = (f: any): string => {
  const p2Signal = !!(f as any)?.admiralStyleTag || !!(f as any)?.composition
    || !!((f as any)?.admiralTags && (f as any).admiralTags.length);
  if (!p2Signal) return '';
  const tag = (f as any)?.admiralStyleTag;
  const form = resolveAdmiralDoctrine(tag ? [tag] : (f as any)?.admiralTags).formation;
  return FORMATION_CN[form] || form;
};
/** 编成明细（只列非零舰种）：战列×N 巡洋×N …；无 composition（战役轨）⇒ 空串 */
const compTextOf = (c: any): string => {
  if (!c) return '';
  const rows: [string, number][] = [
    ['战列', c.battleships], ['巡洋', c.cruisers], ['驱逐', c.destroyers],
    ['空母', c.carriers || 0], ['战机', c.fighters || 0], ['补给', c.supplies || 0],
  ];
  return rows.filter(([, n]) => n > 0).map(([k, n]) => `${k}×${n}`).join(' ');
};

interface Side {
  name: string; portrait: string; rank: number; traitLabel: string; cssColor: string; fleetCount: number;
  formationCn: string; compText: string;
  /** [统一界面语言] 阵营归属：驱动 data-side 局部皮肤（同屏并置时互不串色） */
  faction: 'alliance' | 'empire' | 'neutral';
}
const factions = computed<any[]>(() => (unwrap<any[]>(store.factions) || []).filter((f: any) => f && f.active));

const buildSide = (f: any, fleetCount: number): Side => {
  const trait = String(f?.trait ?? '');
  const faction: Side['faction'] = trait === 'empire' ? 'empire' : trait === 'alliance' ? 'alliance' : 'neutral';
  // 阵营归属色恒定，不取 store.cssColor（那是旧敌我队伍色，会让帝国侧显示成同盟蓝）。
  // 这里只用于 CSS 的 color / borderColor，用 var() 是合法的。
  const cssColor = faction === 'empire' ? 'var(--color-faction-empire)'
    : faction === 'alliance' ? 'var(--color-faction-alliance)'
    : 'var(--ui-ink-3)';
  return {
    name: String(f?.name ?? '未知舰队').replace(/舰队$/, ''),
    portrait: getPortrait(f?.imageId ?? ''),
    rank: Number(f?.rank ?? 0),
    traitLabel: TRAIT_LABEL[trait] ?? '—',
    cssColor,
    fleetCount,
    formationCn: formationCnOf(f),
    compText: compTextOf(f?.composition),
    faction,
  };
};

const empty: Side = { name: '——', portrait: '', rank: 0, traitLabel: '—', cssColor: 'var(--ui-ink-3)', fleetCount: 0, formationCn: '', compText: '', faction: 'neutral' };

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
const closeOverlay = () => {
  closed.value = true;
  stopTyping();
  // [FREEZE-D1] 内嵌 CouncilWarRoom 随本层（v-if）销毁时若鼠标正悬停其上，
  //   mouseleave 永不触发 ⇒ deployCountdownPaused 永久卡真 ⇒ 倒计时永不归零、部署卡死。
  //   收起即复位（startBattleAfterDeploy 的复位只覆盖正常开战路径，覆盖不到本路径）。
  (store as any).deployCountdownPaused = false;
};

/** 回车 = 开战（本层在 capture 阶段先走 UI 通道派发）。
 *  [FREEZE-D2] ⚠ 不再 stopImmediatePropagation 吞掉回车：旧实现把开战唯一入口让给
 *  `dispatchDeployAction`，若 Phaser dispatcher 未绑定/残留旧场景闭包（挂载竞态）则静默丢弃，
 *  而 Phaser 自身的 ENTER 兜底路径（BattleScene keydown → startBattleAfterDeploy）永远收不到
 *  被吞的事件 ⇒ 部署阶段永久卡死。现放行事件让 Phaser 路径兜底 —— startBattleAfterDeploy
 *  有 deployPhase 守卫（幂等），双触发无害。
 *  Esc = 收起本层（逃生口）。数字键 / T 不拦截：交给 `BattleScene` 既有键盘路径处理后回写镜像。 */
const onKeydown = (e: KeyboardEvent) => {
  if (!visible.value) return;
  if (e.key === 'Enter') {
    e.preventDefault();
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
  // [FREEZE-D1] 卸载同 closeOverlay：防内嵌 CouncilWarRoom 悬停态被销毁后标志卡真
  (store as any).deployCountdownPaused = false;
});
</script>

<style scoped>
/* ==================================================================
   战前军议 · 统一界面语言
   尺度：容器 min(1480px, 94vw)；主标题 --fs-display；双方卡等分栅格。
   纵向预算：六行栅格，致辞与部署并置，保证 1080p 下「开始战斗」在首屏内。
   阵营差异全部来自 data-side 局部令牌，本文件不写阵营色字面量。
   ================================================================== */
.io-overlay {
  position: absolute; inset: 0; z-index: 60; pointer-events: auto;
  display: flex; align-items: center; justify-content: center;
  color: var(--ui-ink); font-family: inherit; overflow: hidden;
  background-color: var(--ui-bg);
}
.io-scan { position: absolute; inset: 0; pointer-events: none; opacity: 0.16; background: var(--ui-field); }
.io-vignette {
  position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse at 50% 44%, transparent 34%, var(--ui-scrim) 100%);
}
.io-rail {
  position: absolute; left: 0; right: 0; height: 2px; pointer-events: none; opacity: 0.75;
  background: linear-gradient(to right, transparent, var(--ui-line-strong) 14%, var(--ui-accent) 50%, var(--ui-line-strong) 86%, transparent);
}
.io-rail--top { top: 0; }
.io-rail--bottom { bottom: 0; }

.io-shell {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  grid-template-areas:
    "top     top"
    "head    head"
    "duel    duel"
    "speech  deploy"
    "picks   deploy"
    "go      go"
    "hint    hint";
  column-gap: var(--ui-5); row-gap: var(--ui-2);
  align-content: center;
  width: min(1480px, 94vw); max-height: 96vh; overflow-y: auto;
  padding: var(--ui-3) var(--ui-6); text-align: center;
}
/* zoom(--ui-scale) 不折算 vh ⇒ 百分比相对已缩放父级（沿用既有修复，勿删） */
.io-overlay > .io-shell { max-height: 100%; }

.io-topbar {
  grid-area: top; display: flex; align-items: center; gap: var(--ui-3);
  border-bottom: 1px solid var(--ui-line); padding-bottom: var(--ui-1);
}
.io-faction-tag {
  font-family: var(--ui-display-font); font-size: var(--fs-label); font-weight: 800;
  letter-spacing: 0.14em; color: var(--ui-accent); white-space: nowrap;
  padding: 4px var(--ui-2); background: var(--ui-accent-soft);
  border: 1px solid var(--ui-line-strong); border-radius: var(--ui-radius);
}
.io-mode { font-size: var(--fs-label); letter-spacing: 0.18em; color: var(--ui-ink-3); }
.io-flex { flex: 1; }
.io-cd { font-size: var(--fs-label); font-weight: 800; color: var(--dmc-warning); letter-spacing: 0.06em; }

.io-headline { grid-area: head; margin: 0; }
.io-kicker { color: var(--ui-ink-3); margin-bottom: 6px; }
.io-title {
  margin: 4px 0 6px; text-align: center; color: var(--ui-ink);
  text-shadow: 0 0 40px rgba(var(--ui-accent-rgb), 0.28);
}
.io-subrule { display: flex; align-items: center; justify-content: center; gap: var(--ui-2); }
.io-subrule span { width: min(220px, 18vw); height: 1px; background: linear-gradient(to right, transparent, var(--ui-line-strong)); }
.io-subrule span:last-child { transform: scaleX(-1); }
.io-subrule i { font-style: normal; font-size: var(--fs-caption); color: var(--ui-accent); }

.io-matchup {
  grid-area: duel; display: grid; grid-template-columns: 1fr auto 1fr; align-items: start;
  gap: var(--ui-6); margin: var(--ui-1) 0;
}
.io-side { padding: var(--ui-2) var(--ui-3) var(--ui-3); min-width: 0; text-align: center; }
.io-side-tag { display: block; margin-bottom: var(--ui-2); color: var(--ui-accent); }

.io-portrait-wrap { position: relative; width: 160px; height: 200px; margin: 0 auto; }
.io-portrait-wrap::before {
  content: ''; position: absolute; inset: -10px;
  border: 1px solid var(--ui-line); pointer-events: none;
}
.io-portrait {
  width: 160px; height: 200px; object-fit: cover; border-radius: 0;
  border: 1px solid var(--ui-line-strong);
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.6);
  filter: saturate(1.06) contrast(1.04);
}
.io-portrait-foe { filter: saturate(0.82) contrast(1.02) brightness(0.9); }
.io-portrait-empty {
  display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-h1); color: var(--ui-ink-3); background: var(--ui-surface-3);
}
.io-portrait-glow {
  position: absolute; inset: -10px; border: 1px solid; border-radius: 0; pointer-events: none;
  box-shadow: 0 0 26px rgba(var(--ui-accent-rgb), 0.22), inset 0 0 26px rgba(0, 0, 0, 0.5);
  opacity: 0.85;
}
.io-name {
  margin-top: var(--ui-2); font-family: var(--ui-display-font);
  font-size: var(--fs-h3); font-weight: var(--ui-display-weight); letter-spacing: 0.1em;
}
.io-meta { margin-top: var(--ui-1); font-size: var(--fs-label); display: flex; gap: var(--ui-2); justify-content: center; align-items: center; }
.io-flag { font-weight: 800; }
.io-rank { color: var(--ui-ink-2); font-weight: 800; font-variant-numeric: tabular-nums; }
.io-fleets { color: var(--ui-ink-3); font-variant-numeric: tabular-nums; }
.io-doctrine { margin-top: var(--ui-1); display: flex; flex-direction: column; align-items: center; gap: 2px; }
.io-form { font-size: var(--fs-label); font-weight: 800; color: var(--ui-accent); letter-spacing: 0.08em; }
.io-comp { font-size: var(--fs-caption); color: var(--ui-ink-3); max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.io-vs {
  align-self: center; margin-top: 76px; width: 76px; height: 76px;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--ui-display-font); font-size: var(--fs-h2); font-weight: 800;
  letter-spacing: 0.04em; color: var(--ui-accent);
  border: 1px solid var(--ui-line-strong); border-radius: 50%;
  background: var(--ui-panel); box-shadow: var(--ui-shadow-raised);
}

.io-speech {
  grid-area: speech; align-self: start; width: 100%; max-width: none; margin: 0;
  text-align: left; min-height: 64px;
  border-left: 3px solid var(--ui-accent); padding: var(--ui-1) var(--ui-3);
  background: var(--ui-panel); border-radius: 0 var(--ui-radius) var(--ui-radius) 0;
}
.io-speaker { font-size: var(--fs-label); font-weight: 800; color: var(--ui-accent); letter-spacing: 0.12em; margin-bottom: 4px; }
.io-line { font-size: var(--fs-body); line-height: 1.55; white-space: pre-wrap; color: var(--ui-ink-2); }
.io-caret { color: var(--ui-accent); animation: io-blink 1s steps(2) infinite; }
@keyframes io-blink { 50% { opacity: 0; } }

.io-deploy { grid-area: deploy; align-self: start; width: 100%; margin: 0; text-align: left; }
.io-sec { margin-bottom: var(--ui-1); }

/* 阵型 / 姿态独占左列第二行：与右侧部署区并置，两列内容量接近 */
.io-picks {
  grid-area: picks; align-self: start; width: 100%;
  display: flex; flex-direction: column; gap: var(--ui-1);
  padding: var(--ui-1) 0 0; text-align: left;
}
.io-group { display: flex; align-items: center; gap: var(--ui-1); flex-wrap: wrap; justify-content: flex-start; }
/* 标签独占一行：窄列里让「标签 → 选项 → 数值说明」形成清晰的三段式 */
.io-group-label { flex: 0 0 100%; font-size: var(--fs-label); color: var(--ui-ink-3); letter-spacing: 0.12em; margin-bottom: 2px; }
.io-opt {
  min-height: 38px; padding: 0 var(--ui-2);
  background: var(--ui-surface-2); color: var(--ui-ink-2); font-weight: 800;
  border: 1px solid var(--ui-line-strong); border-radius: var(--ui-radius);
  font-size: var(--fs-label); cursor: pointer; font-family: inherit;
  transition: background var(--ui-dur-micro) var(--ui-ease), color var(--ui-dur-micro) var(--ui-ease), transform var(--ui-dur-micro) var(--ui-ease);
}
.io-opt i { font-style: normal; color: var(--ui-ink-3); font-size: var(--fs-caption); margin-left: 6px; }
.io-opt:hover { border-color: var(--ui-accent); color: var(--ui-accent); }
.io-opt:active { transform: scale(0.97); }
.io-opt.on { background: var(--ui-accent); color: var(--ui-accent-ink); border-color: var(--ui-accent); }
.io-opt.on i { color: var(--ui-accent-ink); opacity: 0.7; }

.io-traits { flex: 0 0 100%; display: flex; flex-wrap: wrap; gap: 4px var(--ui-2); margin-top: 4px; font-size: var(--fs-caption); color: var(--ui-ink-3); }
.io-traits .t-item b { color: var(--ui-ink); font-weight: 800; }
.io-trait-desc { flex: 0 0 100%; margin-top: 2px; font-size: var(--fs-caption); color: var(--ui-ink-3); line-height: 1.4; max-width: 100%; }

.io-go { grid-area: go; justify-self: center; display: inline-flex; margin: var(--ui-2) auto 0; letter-spacing: 0.28em; }
.io-hint { grid-area: hint; margin: 0; font-size: var(--fs-caption); color: var(--ui-ink-3); letter-spacing: 0.08em; }

/* 1080p 及以下：压缩纵向预算，但保留 --fs-display 主标题（宏大感的核心） */
@media (max-height: 1150px) {
  .io-shell { padding: var(--ui-2) var(--ui-5); row-gap: var(--ui-1); }
  .io-headline { margin: 0; }
  .io-subrule span { width: min(180px, 14vw); }
  .io-matchup { gap: var(--ui-4); margin: 0; }
  .io-side { padding-top: var(--ui-1); padding-bottom: var(--ui-2); }
  .io-side-tag { margin-bottom: var(--ui-1); }
  .io-name { margin-top: var(--ui-1); }
  .io-meta { margin-top: 2px; }
  .io-vs { margin-top: 56px; width: 60px; height: 60px; font-size: var(--fs-h3); }
  .io-speech { min-height: 0; padding: var(--ui-1) var(--ui-2); }
  .io-picks { padding-top: 0; gap: 2px; }
  .io-trait-desc { max-width: 100%; }
  .io-go { margin-top: var(--ui-1); }
}
/* 更矮的窗口才降级标题，避免 900px 以下出现纵向滚动 */
@media (max-height: 900px) {
  .io-title { font-size: var(--fs-h1); }
  .io-portrait-wrap, .io-portrait { height: 160px; }
  .io-trait-desc { display: none; }
}
@media (max-width: 900px) {
  .io-shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "top" "head" "duel" "deploy" "speech" "picks" "go" "hint";
  }
  .io-matchup { gap: var(--ui-2); }
  .io-side { padding: var(--ui-1); }
  .io-vs { display: none; }
}
</style>

<template>
  <div class="eco-dashboard">
    <!-- ============ 顶部国库大盘 ============ -->
    <div class="eco-hero">
      <div class="hero-balance">
        <div class="hero-label">
          <span class="hero-dot"></span>国家国库
        </div>
        <div class="hero-value" :class="balanceClass">{{ formatGold(treasury) }}</div>
        <div class="hero-currency">₮ 银河帝国信用货币</div>
        <div class="hero-meta">
          <span>可维持 <b class="text-gold">{{ burnDays }}</b> 天</span>
          <span class="dot-sep">·</span>
          <span>日均净 <b :class="netClass">{{ netSign }}{{ formatGold(Math.abs(netChange)) }}</b></span>
        </div>
      </div>

      <div class="hero-stats">
        <div class="stat-card">
          <div class="stat-label">日收入</div>
          <div class="stat-value text-green">+{{ formatGold(income) }}</div>
          <div class="stat-sub">{{ incomeSegs.length }} 项来源</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">日支出</div>
          <div class="stat-value text-red">-{{ formatGold(expense) }}</div>
          <div class="stat-sub">{{ expenseSegs.length }} 项开支</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">净收益</div>
          <div class="stat-value" :class="netClass">{{ netSign }}{{ formatGold(Math.abs(netChange)) }}</div>
          <div class="stat-sub" :class="netClass">{{ netChange >= 0 ? '财政盈余' : '财政赤字' }}</div>
        </div>
      </div>
    </div>

    <!-- ============ 三方势力国库对比 ============ -->
    <div class="eco-treasuries">
      <div class="treasury-card alliance">
        <div class="tc-head">
          <span class="tc-flag">同盟</span>
          <span class="tc-name">自由行星同盟</span>
        </div>
        <div class="tc-value">{{ formatGold(factionGold.alliance) }}</div>
        <div class="tc-foot" :class="playerIsAlliance ? 'is-player' : ''">
          {{ playerIsAlliance ? '★ 我方国库' : '敌对势力' }}
        </div>
      </div>
      <div class="treasury-card empire">
        <div class="tc-head">
          <span class="tc-flag">帝国</span>
          <span class="tc-name">银河帝国</span>
        </div>
        <div class="tc-value">{{ formatGold(factionGold.empire) }}</div>
        <div class="tc-foot" :class="playerIsEmpire ? 'is-player' : ''">
          {{ playerIsEmpire ? '★ 我方国库' : '敌对势力' }}
        </div>
      </div>
      <div class="treasury-card fezzan">
        <div class="tc-head">
          <span class="tc-flag">费沙</span>
          <span class="tc-name">费沙自治领</span>
        </div>
        <div class="tc-value text-gold">{{ formatGold(fezzanGold) }}</div>
        <div class="tc-foot">第三方 · 贸易垄断</div>
      </div>
    </div>

    <!-- ============ 赤字预警 ============ -->
    <div v-if="treasury < 5000000" class="eco-warning" :class="treasury < 0 ? 'critical' : ''">
      {{ treasury < 0 ? '国库赤字！舰队士气与补给持续下降，费沙催收风险上升。' :
         treasury < 1000000 ? '国库低于 100 万，造船厂即将停产，费沙可能停止放贷。' :
         '国库告急，按当前消耗率预计 ' + burnDays + ' 天内耗尽。' }}
    </div>

    <!-- ============ 图表区 ============ -->
    <div class="chart-grid">
      <div class="chart-card">
        <div class="section-title">收入构成（日）</div>
        <div class="donut-wrap">
          <svg viewBox="0 0 100 100" class="donut">
            <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(148,163,184,0.1)" stroke-width="12"/>
            <circle v-for="seg in incomeSegs" :key="seg.key" cx="50" cy="50" r="40" fill="none"
              :stroke="seg.color" stroke-width="12" :stroke-dasharray="seg.circ" :stroke-dashoffset="seg.offset"
              transform="rotate(-90 50 50)"/>
          </svg>
          <div class="donut-center">
            <span class="dc-label">日收入</span>
            <span class="dc-val">+{{ formatGoldShort(income) }}</span>
          </div>
        </div>
        <div class="legend">
          <div v-for="seg in incomeSegs" :key="'l'+seg.key" class="legend-row">
            <span class="legend-dot" :style="{ background: seg.color }"></span>
            <span class="legend-label">{{ seg.label }}</span>
            <span class="legend-val">{{ formatGold(seg.value) }}</span>
            <span class="legend-pct">{{ seg.pct }}%</span>
          </div>
          <div v-if="incomeSegs.length === 0" class="bar-foot">暂无收入</div>
        </div>
      </div>

      <div class="chart-card">
        <div class="section-title">支出构成（日）</div>
        <div class="bars-wrap">
          <div v-for="seg in expenseSegs" :key="'b'+seg.key" class="bar-row">
            <span class="bar-label">{{ seg.label }}</span>
            <div class="bar-track">
              <div class="bar-fill" :style="{ width: seg.pct + '%', background: seg.color }"></div>
            </div>
            <span class="bar-val">{{ formatGold(seg.value) }}</span>
          </div>
          <div class="bar-foot" v-if="expenseSegs.length === 0">无支出</div>
        </div>
      </div>

      <div class="chart-card">
        <div class="section-title">国库趋势（近30日）</div>
        <svg viewBox="0 0 200 60" class="trend-svg">
          <polyline :points="trendPoints" fill="none" stroke="#3498db" stroke-width="1.5"/>
        </svg>
        <div class="trend-labels">
          <span>30日前<br/><b>{{ formatGoldShort(trendFirst) }}</b></span>
          <span style="text-align:right">现在<br/><b :class="netClass">{{ formatGoldShort(trendLast) }}</b></span>
        </div>
      </div>
    </div>

    <!-- ============ 收支明细 ============ -->
    <div class="eco-details">
      <div class="eco-section">
        <div class="section-title">收入明细</div>
        <div class="detail-row" v-for="(v, k) in incomeDetail" :key="'i'+k">
          <span>{{ k }}</span>
          <span class="text-green">+{{ formatGold(v) }} <em class="pct">{{ pctOf(v, income) }}%</em></span>
        </div>
      </div>

      <div class="eco-section">
        <div class="section-title">支出明细</div>
        <div class="detail-row" v-for="(v, k) in expenseDetail" :key="'e'+k">
          <span>{{ k }}</span>
          <span class="text-red">-{{ formatGold(v) }} <em class="pct">{{ pctOf(v, expense) }}%</em></span>
        </div>
        <div class="detail-row month-total" v-if="monthlyExtras.length">
          <span class="month-label">本月累计（抚恤/工资/修理）</span>
          <span class="text-red">-{{ formatGold(monthlyExtrasTotal) }}</span>
        </div>
        <div class="detail-row month-extras" v-for="e in monthlyExtras" :key="e.key">
          <span style="padding-left:16px;">· {{ e.label }}</span>
          <span class="text-red">-{{ formatGold(e.value) }}</span>
        </div>
      </div>
    </div>

    <!-- ============ 底部三栏：费沙金融 / 财政政策 / 星球经济（一屏展示） ============ -->
    <div class="eco-bottom">
      <!-- 费沙金融 -->
      <div class="eco-section fezzan-board">
        <div class="section-title">费沙金融 · Fezzan Exchange</div>
        <div class="detail-row">
          <span>费沙金库余额</span>
          <span class="text-gold">{{ formatGold(fezzanGold) }}</span>
        </div>
        <div class="detail-row">
          <span>我方贷款余额</span>
          <span class="text-gold">{{ formatGold(loanPrincipal) }}</span>
        </div>
        <div class="detail-row" v-if="loanPrincipal > 0">
          <span>剩余期限 / 月利率</span>
          <span class="text-cyan">{{ remainingDays }}天 / {{ (FEZZAN_MONTHLY_RATE * 100).toFixed(0) }}%</span>
        </div>
        <div class="detail-row" v-if="loanPrincipal > 0">
          <span>下期应付利息</span>
          <span class="text-cyan">{{ formatGold(loanMonthlyInterest) }}</span>
        </div>
        <button @click="showFezzan = true" class="neo-btn btn-sm text-gold" style="width:100%;margin-top:6px">进入费沙银行</button>
      </div>

      <!-- 财政政策 -->
      <div class="eco-section policy-board">
        <div class="section-title">财政政策</div>
        <div class="eco-slider">
          <span class="slider-label">基础税率</span>
          <input type="range" :min="10" :max="30" :value="taxRate * 100" @input="onTaxChange" class="slider" />
          <span class="tax-val">{{ (taxRate * 100).toFixed(0) }}%</span>
        </div>
        <div class="eco-slider-hint">
          <span>低税养民</span><span>适中</span><span>竭泽而渔</span>
        </div>
        <div class="tax-preview">
          预计日税收 <b class="text-green">+{{ formatGold(previewDailyTax) }}</b>
        </div>
        <div class="eco-toggle">
          <label>
            <input type="checkbox" :checked="warTax" @change="onWarTaxToggle" />
            <span>战争税（+{{ (WAR_TAX_RATE * 100).toFixed(0) }}%，治安每日下降）</span>
          </label>
        </div>
      </div>

      <!-- 星球经济 TOP5（横向条形图） -->
      <div class="eco-section planet-board">
        <div class="section-title">星球经济值（前5）</div>
        <div class="planet-bar" v-for="p in topPlanets" :key="p.name">
          <span class="planet-rank">{{ p.rank }}</span>
          <div class="planet-bar-body">
            <div class="planet-bar-top">
              <span class="planet-name">{{ p.name }}</span>
              <span class="planet-type">{{ p.type }}星</span>
              <span class="planet-economy">{{ formatGold(p.economy) }}</span>
            </div>
            <div class="planet-bar-track">
              <div class="planet-bar-fill" :style="{ width: p.pct + '%' }"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <FezzanMerchant v-if="showFezzan" @close="showFezzan = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGameStore } from '../../store/gameStore';
import { useAdminStore } from '../../store/adminStore';
import FezzanMerchant from './FezzanMerchant.vue';
import { FEZZAN_LOAN, ECONOMY_RATES } from '../../config/economy';
import { formatGold, formatGoldShort } from '../../utils/format';

const store = useGameStore() as any;
const admin = useAdminStore() as any;
const showFezzan = ref(false);

const FEZZAN_MONTHLY_RATE = FEZZAN_LOAN.MONTHLY_INTEREST;
const WAR_TAX_RATE = ECONOMY_RATES.warTaxRate;

const treasury = computed(() => store.metaGold || 0);
const fezzanGold = computed(() => store.fezzanGold || 0);
const factionGold = computed(() => store.factionGold || { alliance: 0, empire: 0 });
const income = computed(() => (admin as any).dailyIncome ?? 0);
const expense = computed(() => (admin as any).dailyExpense ?? 0);
const netChange = computed(() => income.value - expense.value);
const netClass = computed(() => netChange.value >= 0 ? 'text-green' : 'text-red');
const netSign = computed(() => netChange.value >= 0 ? '+' : '-');
const balanceClass = computed(() => treasury.value < 0 ? 'text-red' : treasury.value < 1000000 ? 'text-warning' : 'text-cyan');
const burnDays = computed(() => expense.value > 0 ? Math.floor(treasury.value / expense.value) : 999);

const playerFaction = computed(() => {
  const adm = store.allAdmirals?.find((a: any) => a.id === store.playerAdmiralId);
  return adm?.faction === 'alliance' ? 'alliance' : 'empire';
});
const playerIsAlliance = computed(() => playerFaction.value === 'alliance');
const playerIsEmpire = computed(() => playerFaction.value === 'empire');

const fin = computed(() => admin.adminState?.finance || {});
const loanPrincipal = computed(() => fin.value.loanPrincipal || 0);
const remainingDays = computed(() => Math.max(0, (fin.value.loanTermDays || 0) - (fin.value.loanDaysElapsed || 0)));
const loanMonthlyInterest = computed(() => Math.round((loanPrincipal.value || 0) * FEZZAN_LOAN.MONTHLY_INTEREST));

const dailySalary = computed(() => fin.value.salaryPaid || 0);
const dailyPension = computed(() => fin.value.pensionPaid || 0);
const dailyRepair = computed(() => fin.value.repairPaid || 0);

const incomeDetail = computed(() => ({
  '税收': (admin as any).dailyTaxIncome ?? 0,
  '战争税': (admin as any).dailyWarTaxIncome ?? 0,
  '贸易': (admin as any).dailyTradeIncome ?? 0,
}));

const expenseDetail = computed(() => ({
  '舰队维护': (admin as any).dailyFleetMaintenance ?? 0,
  '造船': (admin as any).dailyShipBuildCost ?? 0,
  '跃迁': (admin as any).dailyWarpCost ?? 0,
  '提督工资': dailySalary.value,
}));

const monthlyExtras = computed(() => {
  const arr: { key: string; label: string; value: number }[] = [];
  if (dailyPension.value > 0) arr.push({ key: 'p', label: '军人抚恤', value: dailyPension.value });
  if (dailyRepair.value > 0) arr.push({ key: 'r', label: '战损修理', value: dailyRepair.value });
  return arr;
});
const monthlyExtrasTotal = computed(() => monthlyExtras.value.reduce((s, e) => s + e.value, 0));

const pctOf = (v: number, total: number) => total > 0 ? Math.round((v / total) * 100) : 0;

const CHART_COLORS = ['#27ae60', '#f39c12', '#3498db', '#8e44ad', '#16a085'];
const EXPENSE_COLORS = ['#e74c3c', '#f97316', '#f1c40f', '#e84393', '#8e44ad'];

const incomeSegs = computed(() => {
  const items = Object.entries(incomeDetail.value).filter(([, v]) => v > 0).map(([k, v], i) => ({
    key: k, label: k, value: v as number, color: CHART_COLORS[i % 5],
  }));
  const total = items.reduce((s, it) => s + it.value, 0);
  const circ = 2 * Math.PI * 40;
  let acc = 0;
  return items.map(it => {
    const pct = total > 0 ? (it.value / total) * 100 : 0;
    const seg = { ...it, pct: Math.round(pct), circ: `${(pct / 100) * circ} ${circ}`, offset: -acc * circ / 100 };
    acc += pct;
    return seg;
  });
});

const expenseSegs = computed(() => {
  const items = Object.entries(expenseDetail.value).filter(([, v]) => v > 0).map(([k, v], i) => ({
    key: k, label: k, value: v as number, color: EXPENSE_COLORS[i % 5],
  }));
  const total = items.reduce((s, it) => s + it.value, 0);
  return items.map(it => ({ ...it, pct: total > 0 ? Math.round((it.value / total) * 100) : 0 }));
});

const trend = computed(() => {
  const ledger: Array<{ treasury: number }> = (store as any).treasuryLedger || [];
  if (ledger.length >= 2) return ledger.slice(-30).map(e => e.treasury);
  const days = 30;
  const net = netChange.value;
  const points: number[] = [];
  let val = treasury.value - net * days;
  for (let i = 0; i < days; i++) { val += net; points.push(val); }
  return points;
});
const trendFirst = computed(() => trend.value[0] || treasury.value);
const trendLast = computed(() => trend.value[trend.value.length - 1] || treasury.value);
const trendCoords = computed(() => {
  const pts = trend.value;
  const min = Math.min(...pts, 0), max = Math.max(...pts, 1);
  const range = max - min || 1;
  return pts.map((v, i) => [i * (200 / (pts.length - 1)), 55 - ((v - min) / range) * 50]);
});
const trendPoints = computed(() => trendCoords.value.map(p => p.join(',')).join(' '));

const taxRate = computed(() => (admin as any).adminState?.finance?.baseTaxRate || 0.15);
const warTax = computed(() => ((admin as any).adminState?.finance?.warTaxRate || 0) > 0);

// ── 预计日税收实时预览 ──
// 税收是每日结算一次（nodeStore.processDailyEconomy），拖税率滑杆后 dailyTaxIncome 要等下一个游戏日才刷新，
// 导致"滑杆没效果"的错觉。此处用当前税率即时复算玩家星球税收，拖动滑杆立即看到变化。
// 公式与 nodeStore.processDailyEconomy 保持一致：tax = Σ floor(pop × economy × rate × security/100)
const TAX_BASE = ECONOMY_RATES.nodeTaxBase; // 0.01，对应税率滑杆 10% 的基准乘数
const previewDailyTax = computed(() => {
  const nodes: any[] = (store as any).strategicNodes || [];
  const pfId = playerIsAlliance.value ? 1 : 2;
  const base = taxRate.value;              // 0.10 ~ 0.30
  const war = warTax.value ? WAR_TAX_RATE : 0; // 战争税 0.15 或 0
  let total = 0;
  nodes.forEach((n: any) => {
    if (n.ownerFactionId !== pfId) return;
    const security = (n.security ?? 60) / 100;
    const rate = TAX_BASE * (base / 0.10) + TAX_BASE * (war / 0.10);
    total += Math.floor((n.population || 0) * (n.economy || 0) * rate * security);
  });
  return total;
});

function onTaxChange(e: Event) {
  const v = parseInt((e.target as HTMLInputElement).value) / 100;
  (admin as any).setTaxRate(v);
}
function onWarTaxToggle() {
  (admin as any).toggleWarTax();
}

const topPlanets = computed(() => {
  const nodes: any[] = (store as any).strategicNodes || [];
  const pfId = playerIsAlliance.value ? 1 : 2;
  const mine = nodes
    .filter((n: any) => n.ownerFactionId === pfId)
    .sort((a: any, b: any) => (b.economy || 0) - (a.economy || 0))
    .slice(0, 5);
  const max = Math.max(...mine.map(n => n.economy || 0), 1);
  return mine.map((n: any, i: number) => ({
    rank: i + 1,
    name: n.name || n.id,
    type: n.economy > 800 ? '经济' : n.economy > 400 ? '工业' : '边境',
    economy: n.economy || 0,
    pct: Math.max(4, Math.round(((n.economy || 0) / max) * 100)), // 相对最大值占比，最小留 4% 保证可见
  }));
});
</script>

<style scoped>
.eco-dashboard { padding: 16px; overflow-y: auto; height: 100%; box-sizing: border-box; min-height: 0; /* 修复：避免被父容器 padding 挤压后内容超出裁切 */ }

/* ===== 顶部大盘 ===== */
.eco-hero {
  display: flex; gap: 16px; align-items: stretch;
  padding: 16px 18px; margin-bottom: 14px;
  background: linear-gradient(160deg, var(--dmc-bg-raised), var(--dmc-bg-panel));
  border: 1px solid var(--dmc-border-accent);
  border-radius: var(--radius-lg);
  position: relative; overflow: hidden;
}
.eco-hero::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent, var(--dmc-gold), transparent);
}
.hero-balance { flex: 1; min-width: 0; }
.hero-label { font-size: 11px; color: var(--dmc-text-secondary); letter-spacing: 2px; display: flex; align-items: center; gap: 6px; }
.hero-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dmc-gold); box-shadow: 0 0 8px var(--dmc-gold); }
.hero-value {
  font-family: var(--dmc-font-mono); font-size: 34px; font-weight: 700; line-height: 1.1;
  margin: 6px 0 2px; letter-spacing: -0.5px; font-variant-numeric: tabular-nums;
}
.hero-currency { font-size: 10px; color: var(--dmc-text-muted); letter-spacing: 1px; }
.hero-meta { margin-top: 8px; font-size: 12px; color: var(--dmc-text-secondary); }
.hero-meta b { font-weight: 600; }
.dot-sep { margin: 0 6px; color: var(--dmc-text-muted); }

.hero-stats { display: flex; gap: 10px; flex: 1.2; }
.stat-card {
  flex: 1; padding: 12px; border-radius: var(--radius-md);
  background: var(--dmc-bg-input); border: var(--dmc-border);
  display: flex; flex-direction: column; justify-content: center;
}
.stat-label { font-size: 10px; color: var(--dmc-text-muted); letter-spacing: 1px; }
.stat-value { font-family: var(--dmc-font-mono); font-size: 20px; font-weight: 700; margin: 4px 0 2px; font-variant-numeric: tabular-nums; }
.stat-sub { font-size: 10px; color: var(--dmc-text-muted); }

/* ===== 三方国库 ===== */
.eco-treasuries { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
.treasury-card {
  padding: 12px; border-radius: var(--radius-md); border: var(--dmc-border);
  background: var(--dmc-bg-panel);
}
.treasury-card.alliance { border-left: 2px solid var(--dmc-alliance-bright); }
.treasury-card.empire { border-left: 2px solid var(--dmc-empire-bright); }
.treasury-card.fezzan { border-left: 2px solid var(--dmc-gold); }
.tc-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.tc-flag { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 3px; letter-spacing: 1px; }
.alliance .tc-flag { background: var(--dmc-alliance-dim); color: var(--dmc-alliance-bright); }
.empire .tc-flag { background: var(--dmc-empire-dim); color: var(--dmc-empire-bright); }
.fezzan .tc-flag { background: var(--dmc-gold-dim); color: var(--dmc-gold); }
.tc-name { font-size: 11px; color: var(--dmc-text-secondary); }
.tc-value { font-family: var(--dmc-font-mono); font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
.tc-foot { font-size: 10px; color: var(--dmc-text-muted); margin-top: 2px; }
.tc-foot.is-player { color: var(--dmc-gold); font-weight: 600; }

/* ===== 预警 ===== */
.eco-warning { padding: 8px 12px; border-radius: var(--radius-sm); margin-bottom: 12px; font-size: 12px; background: var(--dmc-gold-dim); color: var(--dmc-gold); border: 1px solid rgba(201,169,110,0.3); }
.eco-warning.critical { background: var(--dmc-empire-dim); color: var(--dmc-empire-bright); border-color: rgba(231,76,60,0.3); }

/* ===== 图表 ===== */
.chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 14px; min-width: 0; /* 修复：grid 子项缺横向收缩项，三张图表卡在窄容器被撑破、右侧裁切 */ }
.chart-card { border: var(--dmc-border); border-radius: var(--radius-md); padding: 12px; background: var(--dmc-bg-panel); }
.section-title { font-size: 11px; font-weight: 700; color: var(--dmc-text-secondary); margin-bottom: 8px; letter-spacing: 1px; }

.donut-wrap { position: relative; width: 120px; height: 120px; margin: 0 auto 8px; }
.donut { width: 100%; height: 100%; }
.donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.dc-label { font-size: 9px; color: var(--dmc-text-muted); }
.dc-val { font-size: 13px; font-weight: 700; font-family: var(--dmc-font-mono); }
.legend-row { display: flex; align-items: center; gap: 6px; font-size: 11px; padding: 2px 0; color: var(--dmc-text-secondary); }
.legend-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.legend-label { flex: 1; }
.legend-val { font-family: var(--dmc-font-mono); font-size: 10px; color: var(--dmc-text-secondary); }
.legend-pct { color: var(--dmc-text-muted); font-size: 10px; width: 30px; text-align: right; }

.bar-row { display: flex; align-items: center; gap: 6px; font-size: 11px; padding: 4px 0; color: var(--dmc-text-secondary); }
.bar-label { width: 60px; flex-shrink: 0; }
.bar-track { flex: 1; height: 10px; background: rgba(148,163,184,0.1); border-radius: 3px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; }
.bar-val { width: 70px; text-align: right; font-size: 10px; color: var(--dmc-text-secondary); font-family: var(--dmc-font-mono); }
.bar-foot { font-size: 10px; color: var(--dmc-text-muted); text-align: center; padding: 8px; }

.trend-svg { width: 100%; height: 60px; }
.trend-labels { display: flex; justify-content: space-between; font-size: 9px; color: var(--dmc-text-muted); }
.trend-labels b { font-size: 11px; color: var(--dmc-text-primary); font-family: var(--dmc-font-mono); }

/* ===== 明细 ===== */
.eco-details { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
.eco-section { min-width: 0; } /* 修复：grid 子项缺横向收缩项，三栏在窄容器被撑破 */
.detail-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; color: var(--dmc-text-secondary); }
.pct { font-size: 10px; color: var(--dmc-text-muted); font-style: normal; margin-left: 4px; }
.month-total { border-top: 1px dashed var(--dmc-border); margin-top: 4px; padding-top: 6px; font-weight: 600; }
.month-label { color: var(--dmc-text-primary); }
.month-extras { font-size: 11px; }

/* ===== 底部三栏：费沙 / 政策 / 星球 ===== */
.eco-bottom { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 14px; min-width: 0; }
.eco-bottom .eco-section {
  padding: 12px;
  background: var(--dmc-bg-panel);
  border: var(--dmc-border);
  border-radius: var(--radius-md);
}
.fezzan-board { border-color: rgba(201,169,110,0.25); }
.policy-board { border-color: var(--dmc-border); }
.planet-board { border-color: var(--dmc-border); }

/* ===== 费沙 ===== */
.fezzan-board .neo-btn { margin-top: 8px; }

/* ===== 政策 ===== */
.eco-slider { display: flex; align-items: center; gap: 10px; font-size: 12px; margin-bottom: 8px; }
.slider { flex: 1; min-width: 0; accent-color: var(--dmc-info); }
.slider-label { color: var(--dmc-text-secondary); white-space: nowrap; }
.tax-val { font-family: var(--dmc-font-mono); font-weight: 700; color: var(--dmc-gold); min-width: 32px; text-align: right; }
.eco-slider-hint { display: flex; justify-content: space-between; font-size: 9px; color: var(--dmc-text-muted); padding: 0 2px; margin-top: 2px; }
.tax-preview { margin-top: 8px; font-size: 12px; color: var(--dmc-text-secondary); display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.tax-preview b { font-family: var(--dmc-font-mono); font-variant-numeric: tabular-nums; }
.eco-toggle { margin-top: 10px; font-size: 12px; }
.eco-toggle label { display: flex; align-items: center; gap: 6px; cursor: pointer; }

/* ===== 星球 TOP5（横向条形图） ===== */
.planet-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.planet-bar:last-child { margin-bottom: 0; }
.planet-rank {
  width: 18px; height: 18px; line-height: 18px; text-align: center; border-radius: 4px;
  font-size: 10px; font-weight: 700; background: var(--dmc-bg-input); color: var(--dmc-gold); flex-shrink: 0;
}
.planet-bar-body { flex: 1; min-width: 0; }
.planet-bar-top { display: flex; align-items: baseline; gap: 6px; font-size: 11px; margin-bottom: 3px; }
.planet-name { color: var(--dmc-text-primary); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.planet-type { font-size: 9px; color: var(--dmc-text-muted); padding: 0 5px; background: var(--dmc-bg-input); border-radius: 3px; flex-shrink: 0; }
.planet-economy { margin-left: auto; color: var(--dmc-info); font-weight: 600; font-family: var(--dmc-font-mono); font-size: 10px; }
.planet-bar-track { height: 6px; background: rgba(148,163,184,0.1); border-radius: 3px; overflow: hidden; }
.planet-bar-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--dmc-info), #22d3ee); transition: width 0.3s; }

.text-green { color: var(--dmc-success); }
.text-red { color: var(--dmc-empire-bright); }
.text-gold { color: var(--dmc-gold); }
.text-cyan { color: var(--dmc-info); }
.text-warning { color: var(--dmc-warning); }

@media (max-width: 900px) {
  .eco-hero { flex-direction: column; }
  .hero-stats { flex: none; }
  .eco-details { grid-template-columns: 1fr; }
  .eco-bottom { grid-template-columns: 1fr; }
}
</style>

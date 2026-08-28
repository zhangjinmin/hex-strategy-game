<template>
  <div class="fz-overlay" v-if="visible" @click.self="close">
    <div class="fz-modal neo-card">
      <h3 class="modal-title">费沙中央银行 · 金融总盘</h3>
      <p class="fz-desc">费沙只做生意，不站队。我们向银河帝国与自由同盟双方提供贷款。</p>

      <!-- 经济总盘 -->
      <div class="total-board">
        <div class="tb-row">
          <span>借款总额</span>
          <span class="tb-val text-gold">₮{{ fmt(loanPrincipal) }}</span>
        </div>
        <div class="tb-row">
          <span>累计已付利息</span>
          <span class="tb-val text-cyan">₮{{ fmt(loanTotalInterest) }}</span>
        </div>
        <div class="tb-row">
          <span>还款进度</span>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: repayProgress + '%' }"></div>
          </div>
          <span class="tb-val">{{ repayProgress }}%</span>
        </div>
        <div class="tb-row" v-if="loanPrincipal > 0">
          <span>剩余期限</span>
          <span class="tb-val">{{ remainingDays }} / {{ loanTermDays }} 天</span>
        </div>
        <div class="tb-row default-warn" v-if="loanDefaultCount > 0">
          <span>违约状态</span>
          <span class="tb-val text-red">逾期 {{ loanDefaultCount }} 期，利率已升至8%</span>
        </div>
      </div>

      <!-- 贷款操作 -->
      <div class="loan-section">
        <div class="section-title">申请贷款</div>
        <div class="loan-amount">
          <button @click="loanAmount = clamp(loanAmount - 10000000)" class="btn-qty">-</button>
          <span class="loan-num">₮{{ fmt(loanAmount) }}</span>
          <button @click="loanAmount = clamp(loanAmount + 10000000)" class="btn-qty">+</button>
        </div>
        <div class="term-row">
          <button v-for="t in terms" :key="t" class="term-btn" :class="{ active: loanTerm === t }" @click="loanTerm = t">
            {{ t }}天
          </button>
        </div>
        <button @click="takeLoan" class="neo-btn btn-sm text-gold w-100" :disabled="loanPrincipal > 0">确认借款</button>
        <div class="loan-tip" v-if="loanPrincipal > 0">已有未还贷款，结清后方可再借</div>
      </div>

      <!-- 还款 -->
      <div class="loan-section" v-if="loanPrincipal > 0">
        <div class="section-title">提前还款</div>
        <div class="loan-amount">
          <button @click="repayAmount = clamp(repayAmount - 10000000)" class="btn-qty">-</button>
          <span class="loan-num">₮{{ fmt(repayAmount) }}</span>
          <button @click="repayAmount = clamp(repayAmount + 10000000)" class="btn-qty">+</button>
        </div>
        <button @click="repayLoan" class="neo-btn btn-sm text-cyan w-100">还款 ₮{{ fmt(Math.min(repayAmount, loanPrincipal)) }}</button>
      </div>

      <!-- 军用物资（保留少量一次性商品） -->
      <div class="loan-section">
        <div class="section-title">费沙物资供应</div>
        <div class="fz-row">
          <span>📡 购买敌方兵力情报</span>
          <button @click="buyIntel" class="neo-btn btn-sm text-cyan">₮5万</button>
        </div>
        <div class="fz-row">
          <span>🗳️ 政治游说（+500政治工作值）</span>
          <button @click="buyLobbying" class="neo-btn btn-sm text-cyan">₮10万</button>
        </div>
      </div>

      <button @click="close" class="neo-btn btn-sm text-slate-400 mt-3">离开费沙</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useGameStore } from '../../store/gameStore';
import { useAdminStore } from '../../store/adminStore';
import { FEZZAN_LOAN } from '../../config/economy';

const store = useGameStore() as any;
const admin = useAdminStore() as any;
const emit = defineEmits<{ close: [] }>();
const visible = ref(true);

const terms = FEZZAN_LOAN.TERMS;
const loanTerm = ref<number>(120);
const loanAmount = ref<number>(50000000);
const repayAmount = ref<number>(50000000);

const fin = computed(() => admin.adminState?.finance || {});
const loanPrincipal = computed(() => fin.value.loanPrincipal || 0);
const loanTotalInterest = computed(() => fin.value.loanTotalInterest || 0);
const loanTermDays = computed(() => fin.value.loanTermDays || 0);
const loanDaysElapsed = computed(() => fin.value.loanDaysElapsed || 0);
const loanDefaultCount = computed(() => fin.value.loanDefaultCount || 0);
const remainingDays = computed(() => Math.max(0, (loanTermDays.value || 0) - loanDaysElapsed.value));
const repayProgress = computed(() => {
  const max = Math.max(50000000, loanPrincipal.value + loanTotalInterest.value);
  return Math.min(100, Math.round(((loanTotalInterest.value) / max) * 100));
});

const clamp = (v: number) => Math.max(50000000, Math.min(FEZZAN_LOAN.MIN_LOAN * 4, v));
const fmt = (v: number) => Math.round((v || 0) / 10000).toLocaleString() + '万';

function close() { visible.value = false; emit('close'); }

function takeLoan() {
  const r = admin.takeLoan?.(loanAmount.value, loanTerm.value);
  if (r?.success) { store.triggerToast(r.message); }
  else store.triggerToast(r?.message || '借款失败');
}

function repayLoan() {
  const r = admin.repayLoan?.(repayAmount.value);
  if (r?.success) { store.triggerToast(r.message); }
  else store.triggerToast(r?.message || '还款失败');
}

function buyIntel() {
  if ((store.metaGold || 0) < 50000) { store.triggerToast('资金不足！'); return; }
  store.metaGold -= 50000;
  store.triggerToast('费沙商人提供了敌方舰队部署情报。');
}

function buyLobbying() {
  if ((store.metaGold || 0) < 100000) { store.triggerToast('资金不足！'); return; }
  store.metaGold -= 100000;
  const pAdm = store.allAdmirals?.find((a: any) => a.id === store.playerAdmiralId);
  if (pAdm) pAdm.politicalWork = (pAdm.politicalWork || 0) + 500;
  store.triggerToast('政治游说成功：+500政治工作值。');
}
</script>

<style scoped>
.fz-overlay { position: fixed; inset: 0; z-index: 1300; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
.fz-modal { width: min(460px, 85vw); padding: 22px; }
.modal-title { font-size: 15px; font-weight: 800; color: var(--color-gold); margin: 0 0 6px; }
.fz-desc { font-size: 11px; color: var(--color-text-secondary); margin-bottom: 14px; }
.total-board { padding: 10px; border: 1px solid rgba(245,158,11,0.15); border-radius: 4px; margin-bottom: 14px; }
.tb-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 12px; color: var(--color-text-secondary); }
.tb-val { font-weight: 800; }
.progress-bar { flex: 1; height: 6px; background: rgba(148,163,184,0.2); border-radius: 3px; margin: 0 10px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, #f59e0b, #fbbf24); border-radius: 3px; }
.default-warn { color: #ef4444; }
.loan-section { margin-bottom: 14px; }
.section-title { font-size: 11px; font-weight: 700; color: var(--color-text-disabled); margin-bottom: 6px; }
.loan-amount { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 8px; }
.btn-qty { width: 26px; height: 26px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text-primary); border-radius: 3px; cursor: pointer; }
.loan-num { font-size: 15px; font-weight: 800; color: var(--color-gold); min-width: 110px; text-align: center; }
.term-row { display: flex; gap: 6px; margin-bottom: 10px; }
.term-btn { flex: 1; padding: 5px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text-secondary); font-size: 11px; border-radius: 3px; cursor: pointer; }
.term-btn.active { border-color: var(--color-gold); color: var(--color-gold); background: rgba(245,158,11,0.1); }
.loan-tip { font-size: 10px; color: var(--color-text-disabled); margin-top: 6px; text-align: center; }
.w-100 { width: 100%; }
.fz-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(245,158,11,0.08); font-size: 12px; }
.fz-row:last-child { border-bottom: none; }
</style>

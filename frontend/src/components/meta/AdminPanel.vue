<template>
  <div v-if="showAdminPanel" class="admin-panel open">
    <!-- ===== 头部 ===== -->
    <div class="admin-header">
      <span class="header-title">行政院</span>
      <button @click="closePanel" class="neo-btn btn-sm">关闭</button>
    </div>

    <!-- ===== Tab 导航 ===== -->
    <div class="admin-tabs">
      <button v-for="tab in tabs" :key="tab.id" @click="activeTab = tab.id"
              class="neo-btn btn-sm admin-tab" :class="{ active: activeTab === tab.id }">
        <span class="admin-tab-icon" v-html="tab.svg"></span> {{ tab.label }}
      </button>
    </div>

    <!-- ===== 面板内容 ===== -->
    <div class="admin-body">

      <!-- ════════ 财政 Tab ════════ -->
      <div v-if="activeTab === 'finance'" class="tab-content">
        <!-- 国库余额 -->
        <div class="section-card">
          <div class="section-label">国库余额</div>
          <div class="treasury-value">₮ {{ formatNum(metaGold) }}</div>
          <div class="finance-row">
            <div class="finance-cell">
              <span class="cell-label">本月收入</span>
              <span class="cell-value text-green">+{{ formatNum(finance.monthlyIncome) }}</span>
            </div>
            <div class="finance-cell">
              <span class="cell-label">本月支出</span>
              <span class="cell-value text-empire">-{{ formatNum(finance.monthlyExpense) }}</span>
            </div>
            <div class="finance-cell">
              <span class="cell-label">净盈亏</span>
              <span class="cell-value" :class="netProfit >= 0 ? 'text-green' : 'text-empire'">
                {{ netProfit >= 0 ? '+' : '' }}{{ formatNum(netProfit) }}
              </span>
            </div>
          </div>
        </div>

        <!-- 基础税率滑块 -->
        <div class="section-card" :class="{ 'section-disabled': !canAdjustTax }">
          <div class="section-label">基础税率</div>
          <div class="tax-slider-row">
            <input type="range" min="0.1" max="0.3" step="0.05"
                   :value="finance.baseTaxRate"
                   :disabled="!canAdjustTax"
                   @input="handleSetTaxRate(parseFloat(($event.target as HTMLInputElement).value))"
                   class="tax-slider" />
            <span class="tax-value">{{ (finance.baseTaxRate * 100).toFixed(0) }}%</span>
          </div>
          <div v-if="!canAdjustTax" class="perm-hint">职级不足，无权执行此操作</div>
        </div>

        <!-- 战争附加税开关 -->
        <div class="section-card" :class="{ 'section-disabled': !canAdjustTax }">
          <div class="section-label">战争附加税</div>
          <div class="war-tax-row">
            <span class="war-tax-status" :class="{ active: finance.warTaxRate > 0 }">
              {{ finance.warTaxRate > 0 ? '已启用 (+15%)' : '未启用' }}
            </span>
            <button @click="handleToggleWarTax" :disabled="!canAdjustTax"
                    class="neo-btn btn-sm" :class="{ 'active': finance.warTaxRate > 0 }">
              {{ finance.warTaxRate > 0 ? '关闭' : '启用' }}
            </button>
          </div>
          <div v-if="!canAdjustTax" class="perm-hint">职级不足，无权执行此操作</div>
        </div>

        <!-- 后勤改革按钮 (v3 迁出操作) -->
        <div class="section-card" :class="{ 'section-disabled': !canAdminOp('logistics') }">
          <div class="section-label">后勤改革</div>
          <div class="action-row">
            <div class="action-info">
              <span class="action-name">后勤改革</span>
              <span class="action-cost">₮ 2,000</span>
              <span class="action-effect">补给消耗-30%（30天）</span>
            </div>
            <button @click="handleLogisticsReform()"
                    :disabled="!canAdminOp('logistics') || metaGold < 2000"
                    class="neo-btn btn-sm">
              执行
            </button>
          </div>
          <div v-if="!canAdminOp('logistics')" class="perm-hint">职级不足，无权执行此操作</div>
        </div>

        <!-- 舰队维护费明细 -->
        <div class="section-card">
          <div class="section-label">舰队维护费明细</div>
          <div class="maint-total">日维护费合计：₮ {{ formatNum(finance.fleetMaintenanceCost) }}</div>
          <div v-if="fleetMaintList.length > 0" class="maint-list">
            <div v-for="fleet in fleetMaintList" :key="fleet.id" class="maint-item">
              <span class="maint-name">{{ fleet.name }}</span>
              <span class="maint-detail">
                BB×{{ fleet.bb }} · CA×{{ fleet.ca }} · DD×{{ fleet.dd }}
              </span>
              <span class="maint-cost">₮ {{ formatNum(fleet.cost) }}</span>
            </div>
          </div>
          <div v-else class="empty-hint">暂无舰队数据</div>
        </div>
      </div>

      <!-- ════════ 人事 Tab ════════ -->
      <div v-if="activeTab === 'personnel'" class="tab-content">
        <!-- 平均忠诚度 -->
        <div class="section-card">
          <div class="section-label">平均忠诚度</div>
          <div class="loyalty-bar-wrapper">
            <div class="loyalty-bar">
              <div class="loyalty-fill" :class="loyaltyColorClass(personnel.avgLoyalty)"
                   :style="{ width: personnel.avgLoyalty + '%' }"></div>
            </div>
            <span class="loyalty-num">{{ personnel.avgLoyalty.toFixed(1) }}</span>
          </div>
        </div>

        <!-- 提督列表 -->
        <div class="section-card">
          <div class="section-label">提督名册（按忠诚度排序）</div>
          <div class="adm-list">
            <div v-for="adm in sortedAdmirals" :key="adm.id"
                 class="adm-row" :class="{ 'adm-warning': adm.loyalty < 30 }">
              <div class="adm-info">
                <span class="adm-name">{{ adm.name }}</span>
                <span class="adm-role">{{ roleLabel(adm.role) }}</span>
              </div>
              <div class="adm-loyalty">
                <div class="mini-bar">
                  <div class="mini-fill" :class="loyaltyColorClass(adm.loyalty)"
                       :style="{ width: adm.loyalty + '%' }"></div>
                </div>
                <span class="loyalty-text" :class="{ 'text-empire': adm.loyalty < 30 }">
                  {{ (adm.loyalty ?? 70).toFixed(0) }}
                </span>
              </div>
              <div v-if="adm.loyalty < 30" class="warn-tag">⚠ 叛变风险</div>
              <!-- 人事操作按钮 -->
              <div class="adm-actions">
                <button @click="handleReward(adm.id)" class="neo-btn btn-xs btn-reward"
                        :disabled="(gameStore as any).metaGold < 500"
                        title="赏赐：花费500资金，忠诚+10~20">
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px;margin-right:3px;"><circle cx="8" cy="8" r="6"/><path d="M8 4v8M5 7h6"/></svg> 赏赐
                </button>
                <button @click="handlePromote(adm.id)" class="neo-btn btn-xs btn-promote"
                        :disabled="(gameStore as any).adminMerit < 200"
                        title="晋升：花费200行政功勋，忠诚+15~25">
                  ⭐ 晋升
                </button>
              </div>
            </div>
            <div v-if="sortedAdmirals.length === 0" class="empty-hint">暂无可指挥的提督</div>
          </div>
        </div>
      </div>

      <!-- ════════ 科技 Tab ════════ -->
      <div v-if="activeTab === 'tech'" class="tab-content">
        <!-- 4 领域等级 + 研发进度 -->
        <div class="section-card">
          <div class="section-label">科技研发</div>
          <div class="tech-grid">
            <div v-for="field in techFields" :key="field.key" class="tech-item">
              <div class="tech-header">
                <span class="tech-icon" v-html="field.icon"></span>
                <span class="tech-name">{{ field.label }}</span>
                <span class="tech-level">Lv.{{ getTechLevel(field.key) }}</span>
              </div>
              <div class="tech-tier-name">{{ getTechTierDisplay(field.key) }}</div>
              <div class="tech-progress">
                <div class="tech-progress-bar">
                  <div class="tech-progress-fill" :class="{ 'is-focus': technology.researchFocus === field.key }"
                       :style="{ width: getResearchProgress(field.key) + '%' }"></div>
                </div>
                <span class="tech-progress-num">{{ getResearchProgress(field.key).toFixed(0) }}%</span>
              </div>
              <div v-if="technology.researchFocus === field.key" class="focus-badge">研发重点</div>
            </div>
          </div>
        </div>

        <!-- 研发重点选择 -->
        <div class="section-card" :class="{ 'section-disabled': !canAdjustResearch }">
          <div class="section-label">研发重点选择</div>
          <div class="focus-btn-row">
            <button v-for="field in techFields" :key="field.key"
                    @click="handleSetResearchFocus(field.key)"
                    :disabled="!canAdjustResearch"
                    class="neo-btn btn-sm focus-btn"
                    :class="{ active: technology.researchFocus === field.key }">
              {{ field.icon }} {{ field.label }}
            </button>
          </div>
          <div v-if="!canAdjustResearch" class="perm-hint">职级不足，无权执行此操作</div>
        </div>

        <!-- 科技动员按钮 (v3 迁出操作) -->
        <div class="section-card" :class="{ 'section-disabled': !canAdminOp('tech_mobilize') }">
          <div class="section-label">科技动员</div>
          <div class="action-row">
            <div class="action-info">
              <span class="action-name">科技动员</span>
              <span class="action-cost">₮ 3,000</span>
              <span class="action-effect">研发速度×2（30天）</span>
            </div>
            <button @click="handleTechMobilize()"
                    :disabled="!canAdminOp('tech_mobilize') || metaGold < 3000"
                    class="neo-btn btn-sm">
              执行
            </button>
          </div>
          <div v-if="!canAdminOp('tech_mobilize')" class="perm-hint">职级不足，无权执行此操作</div>
        </div>

        <!-- 科技动员 buff 状态 -->
        <div v-if="technology.techMobilizeBuffDays > 0" class="section-card buff-active">
          <div class="section-label">科技动员 (活跃)</div>
          <div class="buff-info">
            <span class="buff-icon">⚡</span>
            <span class="buff-text">研发速度 ×2，剩余 {{ technology.techMobilizeBuffDays }} 天</span>
          </div>
        </div>

        <!-- 情报行动 buff 状态 -->
        <div v-if="intelBuffDays > 0" class="section-card buff-active">
          <div class="section-label">情报行动 (活跃)</div>
          <div class="buff-info">
            <span class="buff-icon"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="7" r="5"/><path d="M4 7l3 3 5-5"/></svg></span>
            <span class="buff-text">敌方可见度提升，剩余 {{ intelBuffDays }} 天</span>
          </div>
        </div>
      </div>

      <!-- ════════ 民生 Tab ════════ -->
      <div v-if="activeTab === 'welfare'" class="tab-content">
        <!-- 概览 -->
        <div class="section-card">
          <div class="section-label">民生概览</div>
          <div class="welfare-row">
            <div class="welfare-cell">
              <span class="cell-label">平均治安度</span>
              <span class="cell-value" :class="welfareColorClass(welfare.avgSecurity)">{{ welfare.avgSecurity.toFixed(1) }}</span>
            </div>
            <div class="welfare-cell">
              <span class="cell-label">平均开发度</span>
              <span class="cell-value text-cyan">{{ welfare.avgDevelopment.toFixed(1) }}</span>
            </div>
            <div class="welfare-cell">
              <span class="cell-label">暴动风险</span>
              <span class="cell-value" :class="welfare.avgSecurity < 30 ? 'text-empire' : 'text-green'">
                {{ welfare.unrestRisk.toFixed(0) }}%
              </span>
            </div>
          </div>
        </div>

        <!-- 节点列表 -->
        <div class="section-card">
          <div class="section-label">辖下节点</div>
          <div class="node-list">
            <div v-for="node in myNodes" :key="node.id" class="node-row">
              <span class="node-name">{{ node.name }}</span>
              <div class="node-bars">
                <div class="mini-bar">
                  <span class="mini-label">治安</span>
                  <div class="mini-fill" :class="welfareColorClass(node.security || 0)"
                       :style="{ width: (node.security || 0) + '%' }"></div>
                </div>
                <div class="mini-bar">
                  <span class="mini-label">经济</span>
                  <div class="mini-fill text-cyan-bg"
                       :style="{ width: Math.min(100, (node.economy || 0) / 50) + '%' }"></div>
                </div>
              </div>
            </div>
            <div v-if="myNodes.length === 0" class="empty-hint">暂无辖下节点</div>
          </div>
        </div>
      </div>

      <!-- ════════ 外交 Tab ════════ -->
      <div v-if="activeTab === 'diplomacy'" class="tab-content">
        <!-- 阵营关系列表 -->
        <div class="section-card">
          <div class="section-label">阵营关系</div>
          <div class="relation-list">
            <div v-for="fac in factionRelations" :key="fac.id" class="relation-row">
              <span class="rel-name">{{ fac.name }}</span>
              <div class="rel-bar-wrapper">
                <div class="rel-bar">
                  <div class="rel-fill" :class="relColorClass(fac.value)"
                       :style="{ width: Math.abs(fac.value) + '%' }"></div>
                </div>
                <span class="rel-value" :class="relColorClass(fac.value)">{{ fac.value > 0 ? '+' : '' }}{{ fac.value }}</span>
              </div>
              <button @click="handleDiplomatPressure(fac.id)"
                      :disabled="!canAdminOp('diplomat_op') || metaGold < 500"
                      class="neo-btn btn-sm rel-btn">
                施压
              </button>
            </div>
            <div v-if="factionRelations.length === 0" class="empty-hint">暂无阵营关系数据</div>
          </div>
        </div>

        <!-- 外交行动 -->
        <div class="section-card" :class="{ 'section-disabled': !canAdminOp('diplomat_op') }">
          <div class="section-label">外交行动</div>
          <div class="action-row">
            <div class="action-info">
              <span class="action-name">外交施压</span>
              <span class="action-cost">₮ 500</span>
              <span class="action-effect">目标阵营关系 +20</span>
            </div>
            <div v-if="!canAdminOp('diplomat_op')" class="perm-hint">职级不足</div>
          </div>
        </div>

        <!-- 当前条约 -->
        <div class="section-card">
          <div class="section-label">当前条约</div>
          <div class="treaty-list">
            <div v-for="(treaty, idx) in treaties" :key="idx" class="treaty-row">
              <span class="treaty-icon"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2h10v12H3z"/><path d="M5 5h6M5 8h4M5 11h3"/></svg></span>
              <span class="treaty-type">{{ treatyTypeLabel(treaty.type) }}</span>
              <span class="treaty-target">- {{ factionName(treaty.targetFactionId) }}</span>
              <span class="treaty-expiry">到期: {{ treaty.expiryDate }}</span>
            </div>
            <div v-if="treaties.length === 0" class="empty-hint">— 暂无条约 —</div>
          </div>
        </div>
      </div>

      <!-- ════════ 情报 Tab ════════ -->
      <div v-if="activeTab === 'intel'" class="tab-content">
        <!-- 情报等级面板 -->
        <div class="section-card">
          <div class="section-label">情报等级</div>
          <div class="intel-list">
            <div v-for="fac in intelLevels" :key="fac.id" class="intel-row">
              <span class="intel-name">{{ fac.name }}</span>
              <div class="intel-bar-wrapper">
                <div class="intel-bar">
                  <div class="intel-fill" :style="{ width: (fac.levelNum / 3 * 100) + '%' }"></div>
                </div>
                <span class="intel-level-text">{{ fac.level }} Lv.{{ fac.levelNum }}</span>
              </div>
            </div>
            <div v-if="intelLevels.length === 0" class="empty-hint">暂无情报数据</div>
          </div>
          <div class="intel-hint">
            none: 无信息 | basic: 兵力级别 | detailed: 舰型分布 | full: 精确编制+移动意图
          </div>
        </div>

        <!-- 情报行动 -->
        <div class="section-card">
          <div class="section-label">情报行动</div>
          <div class="action-row">
            <div class="action-info">
              <span class="action-name">情报搜集</span>
              <span class="action-cost">₮ 200</span>
              <span class="action-effect">揭示相邻敌方节点驻军</span>
            </div>
            <button @click="handleIntelGather()"
                    :disabled="!canAdminOp('intel_op') || metaGold < 200"
                    class="neo-btn btn-sm">
              执行
            </button>
          </div>
          <div class="action-row">
            <div class="action-info">
              <span class="action-name">情报行动</span>
              <span class="action-cost">₮ 1,000</span>
              <span class="action-effect">情报等级+1（15天）</span>
            </div>
            <button @click="handleIntelAction()"
                    :disabled="!canAdminOp('intel_op') || metaGold < 1000"
                    class="neo-btn btn-sm">
              执行
            </button>
          </div>
          <div v-if="!canAdminOp('intel_op')" class="perm-hint">职级不足，无权执行情报操作</div>
        </div>

        <!-- 已揭露信息 -->
        <div class="section-card">
          <div class="section-label">已揭露信息</div>
          <div class="revealed-list">
            <div v-for="fid in revealedFleets" :key="fid" class="revealed-row">
              <span class="revealed-icon"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2"/></svg></span>
              <span class="revealed-text">敌方 {{ getFleetName(fid) }} 信息已揭露</span>
            </div>
            <div v-if="revealedFleets.length === 0" class="empty-hint">— 暂无已揭露信息 —</div>
          </div>
        </div>

        <!-- 活跃 Buff -->
        <div v-if="intelBuffDays > 0" class="section-card buff-active">
          <div class="section-label">情报行动 (活跃)</div>
          <div class="buff-info">
            <span class="buff-icon">⚡</span>
            <span class="buff-text">敌方可见度提升  剩余 {{ intelBuffDays }} 天</span>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useGameStore } from '../../store/gameStore';
import { useAdminStore } from '../../store/adminStore';
import { ROLE_ADMIN_PERMISSIONS } from '../../config/roleConfig';
import type { AdminOperationType, NationalRole } from '../../types/game';

const gameStore = useGameStore();
const adminStore = useAdminStore();

// ─── 面板开关 ───
const showAdminPanel = computed(() => (gameStore as any).showAdminPanel || false);
const closePanel = () => { (gameStore as any).showAdminPanel = false; };

// ─── 行政状态 ───
const adminState = computed(() => (adminStore as any).adminState);
const finance = computed(() => adminState.value?.finance || {
  treasury: 0, baseTaxRate: 0.2, warTaxRate: 0, fleetMaintenanceCost: 0, monthlyIncome: 0, monthlyExpense: 0,
});
const personnel = computed(() => adminState.value?.personnel || { appointments: [], loyaltyModifiers: {}, avgLoyalty: 70 });
const technology = computed(() => adminState.value?.technology || {
  weaponLevel: 1, armorLevel: 1, engineLevel: 1, electronicLevel: 1,
  researchProgress: { weapon: 0, armor: 0, engine: 0, electronic: 0 },
  researchSpeed: 2.0, researchFocus: 'weapon', techMobilizeBuffDays: 0,
});
const welfare = computed(() => adminState.value?.welfare || { avgSecurity: 60, avgDevelopment: 40, unrestRisk: 0 });
const intelBuffDays = computed(() => adminState.value?.intelligence?.intelOpBuffDays || 0);

const metaGold = computed(() => (gameStore as any).metaGold || 0);
const netProfit = computed(() => finance.value.monthlyIncome - finance.value.monthlyExpense);

// ─── Tab 配置（SVG 图标替代 emoji）───
const SVG_FINANCE = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 4v8"/><path d="M5.5 6.5h4a1.5 1.5 0 010 3H6.5a1.5 1.5 0 000 3h4"/></svg>';
const SVG_PERSONNEL = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="4" r="3"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>';
const SVG_TECH = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3"/><path d="M8 1v3"/><path d="M8 12v3"/><path d="M1 8h3"/><path d="M12 8h3"/><path d="M3 3l2 2"/><path d="M11 11l2 2"/><path d="M3 13l2-2"/><path d="M11 5l2-2"/></svg>';
const SVG_WELFARE = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8l6-6 6 6"/><path d="M3 7v7h10V7"/><path d="M6 14v-4h4v4"/></svg>';
const SVG_DIPLOMACY = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="5" cy="8" r="3.5"/><circle cx="11" cy="8" r="3.5"/><path d="M7.5 6.2a3.5 3.5 0 010 3.6"/></svg>';
const SVG_INTEL = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2.5"/><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"/></svg>';

const tabs = [
  { id: 'finance', svg: SVG_FINANCE, label: '财政' },
  { id: 'personnel', svg: SVG_PERSONNEL, label: '人事' },
  { id: 'tech', svg: SVG_TECH, label: '科技' },
  { id: 'welfare', svg: SVG_WELFARE, label: '民生' },
  { id: 'diplomacy', svg: SVG_DIPLOMACY, label: '外交' },
  { id: 'intel', svg: SVG_INTEL, label: '情报' },
];
const activeTab = ref('finance');

// ─── 权限判断 ───
const admList = computed(() => (gameStore as any).allAdmirals || []);
const playerAdmiral = computed(() => {
  return admList.value.find((a: any) => a.id === (gameStore as any).playerAdmiralId);
});

const canAdjustTax = computed(() => {
  if (!playerAdmiral.value) return false;
  const role = playerAdmiral.value.role;
  return ['emperor', 'prime_minister', 'council'].includes(role);
});

const canAdjustResearch = computed(() => {
  if (!playerAdmiral.value) return false;
  const role = playerAdmiral.value.role;
  return ['emperor', 'military_minister', 'prime_minister', 'council'].includes(role);
});

// ─── 人事：提督列表（同阵营，按忠诚度排序） ───
const sortedAdmirals = computed(() => {
  const pAdm = playerAdmiral.value;
  if (!pAdm) return [];
  return admList.value
    .filter((a: any) => a.faction === pAdm.faction)
    .map((a: any) => ({ ...a, loyalty: a.loyalty ?? 70 }))
    .sort((a: any, b: any) => a.loyalty - b.loyalty);
});

// ─── 人事操作 ───
const handleReward = (admiralId: number) => {
  const adminStore = useAdminStore();
  const result = adminStore.rewardAdmiral(admiralId, 500);
  if (result.success) {
    (gameStore as any).triggerToast(result.message);
  } else {
    (gameStore as any).triggerToast('⚠ ' + result.message);
  }
};

const handlePromote = (admiralId: number) => {
  const adminStore = useAdminStore();
  const result = adminStore.promoteAdmiral(admiralId); // 功勋开销按目标军阶自动计算
  if (result.success) {
    (gameStore as any).triggerToast(result.message);
  } else {
    (gameStore as any).triggerToast('⚠ ' + result.message);
  }
};

// ─── 民生：辖下节点 ───
const myNodes = computed(() => {
  const nodes = (gameStore as any).strategicNodes?.value || (gameStore as any).strategicNodes || [];
  const pAdm = playerAdmiral.value;
  const fid = pAdm?.faction === 'alliance' ? 1 : 2;
  return nodes.filter((n: any) => n.ownerFactionId === fid);
});

// ─── 财政：舰队维护费明细 ───
const fleetMaintList = computed(() => {
  const pAdm = playerAdmiral.value;
  const fid = pAdm?.faction === 'alliance' ? 1 : 2;
  const fleets = (gameStore as any).strategicFleets || [];
  const allAdms = (gameStore as any).allAdmirals || [];
  const MAINT_BB = 0.2, MAINT_CA = 0.1, MAINT_DD = 0.05;
  return fleets
    .filter((f: any) => f.factionId === fid)
    .map((f: any) => {
      const c = f.composition || { battleships: 0, cruisers: 0, destroyers: 0 };
      const adm = allAdms.find((a: any) => a.id === f.commanderId);
      const admName = adm?.name || '未知提督';
      const fleetNum = f.fleetNumber || 0;
      return {
        id: f.id,
        name: fleetNum > 0 ? `第${fleetNum}舰队·${admName}` : `${admName}舰队`,
        bb: c.battleships || 0,
        ca: c.cruisers || 0,
        dd: c.destroyers || 0,
        cost: (c.battleships || 0) * MAINT_BB + (c.cruisers || 0) * MAINT_CA + (c.destroyers || 0) * MAINT_DD,
      };
    });
});

// ─── 情报：舰队名称查找 ───
const getFleetName = (fleetId: number): string => {
  const fleets = (gameStore as any).strategicFleets || [];
  const fleet = fleets.find((f: any) => f.id === fleetId);
  if (!fleet) return '舰队';
  const allAdms = (gameStore as any).allAdmirals || [];
  const adm = allAdms.find((a: any) => a.id === fleet.commanderId);
  const admName = adm?.name || '未知提督';
  const fleetNum = fleet.fleetNumber || 0;
  return fleetNum > 0 ? `第${fleetNum}舰队·${admName}` : `${admName}舰队`;
};

// ─── 科技领域配置 ───
const techFields = [
  { key: 'weapon', icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 2l12 12M8 2l-2 4h4L8 2zM8 14V8"/></svg>', label: '武器' },
  { key: 'armor', icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1l6 3v4c0 5-6 7-6 7s-6-2-6-7V4l6-3z"/></svg>', label: '装甲' },
  { key: 'engine', icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5"/><path d="M8 3v5l3 3"/></svg>', label: '引擎' },
  { key: 'electronic', icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12v8H2z"/><path d="M6 4v8"/><line x1="5" y1="12" x2="3" y2="14"/><line x1="11" y1="12" x2="13" y2="14"/></svg>', label: '电子' },
] as const;

const getTechLevel = (field: string): number => {
  const t = technology.value;
  if (field === 'weapon') return t.weaponLevel ?? 1;
  if (field === 'armor') return t.armorLevel ?? 1;
  if (field === 'engine') return t.engineLevel ?? 1;
  if (field === 'electronic') return t.electronicLevel ?? 1;
  return 1;
};

// 科技层级命名（如 "激光炮", "中子炮" 等）
const getTechTierDisplay = (field: string): string => {
  const level = getTechLevel(field);
  const tierName = (adminStore as any).getTechTierName?.(field, level) || '';
  const desc = (adminStore as any).TECH_TREE?.[field]?.[level - 1]?.desc || '';
  return tierName ? `${tierName} — ${desc}` : '';
};

const getResearchProgress = (field: string): number => {
  const rp = technology.value.researchProgress;
  if (!rp) return 0;
  return rp[field] ?? 0;
};

// ─── 行政操作 ───
const handleSetTaxRate = (rate: number) => {
  if (!canAdjustTax.value) return;
  (adminStore as any).setTaxRate(rate);
};
const handleToggleWarTax = () => {
  if (!canAdjustTax.value) return;
  (adminStore as any).toggleWarTax();
};
const handleSetResearchFocus = (field: string) => {
  if (!canAdjustResearch.value) return;
  (adminStore as any).setResearchFocus(field);
};

// ─── 工具函数 ───
const formatNum = (n: number): string => {
  if (n === undefined || n === null || isNaN(n)) return '0';
  return Math.round(n).toLocaleString();
};

const roleLabel = (role: string): string => {
  const dict: Record<string, string> = {
    emperor: '帝国皇帝', prime_minister: '帝国宰相', military_minister: '军务尚书',
    high_command_chief: '统帅本部总长', space_fleet_commander: '宇宙舰队司令',
    space_fleet_deputy: '舰队副司令', council: '评议会议长',
    joint_ops_chief: '统合本部长', joint_ops_deputy: '统合本部次长',
    fleet_commander: '舰队司令官', none: '无职务',
  };
  return dict[role] || role;
};

const loyaltyColorClass = (val: number): string => {
  if (val < 30) return 'fill-danger';
  if (val < 60) return 'fill-warning';
  return 'fill-good';
};

const welfareColorClass = (val: number): string => {
  if (val < 30) return 'text-empire';
  if (val < 60) return 'text-warning';
  return 'text-green';
};

// ─── v3 新增：行政院操作权限 + 处理函数 ───

/** 检查行政院操作权限 */
const canAdminOp = (opType: AdminOperationType): boolean => {
  if (!playerAdmiral.value) return false;
  const role = playerAdmiral.value.role as NationalRole;
  const allowed = ROLE_ADMIN_PERMISSIONS[role] || [];
  return allowed.includes(opType);
};

/** 后勤改革（₮2000，需二次确认） */
const handleLogisticsReform = () => {
  if (!canAdminOp('logistics') || metaGold.value < 2000) return;
  (gameStore as any).requestConfirm(
    '后勤改革',
    '消耗₮2,000，全阵营舰队补给消耗-30%（持续30天）',
    2000,
    () => {
      const result = (adminStore as any).executeLogisticsReform();
      (gameStore as any).triggerToast(result.message);
    }
  );
};

/** 科技动员（₮3000，需二次确认） */
const handleTechMobilize = () => {
  if (!canAdminOp('tech_mobilize') || metaGold.value < 3000) return;
  (gameStore as any).requestConfirm(
    '科技动员',
    '消耗₮3,000，研发速度×2（持续30天）',
    3000,
    () => {
      const result = (adminStore as any).executeTechMobilize();
      (gameStore as any).triggerToast(result.message);
    }
  );
};

/** 情报行动（₮1000，无需二次确认） */
const handleIntelAction = () => {
  if (!canAdminOp('intel_op') || metaGold.value < 1000) return;
  const result = (adminStore as any).executeIntelAction();
  (gameStore as any).triggerToast(result.message);
};

/** 情报搜集（₮200，无需二次确认）— 行政院版：揭示所有相邻敌方节点 */
const handleIntelGather = () => {
  if (!canAdminOp('intel_op') || metaGold.value < 200) return;
  // 行政院版情报搜集：对所有己方节点的相邻敌方节点设置 revealedUntil
  const nodes = (gameStore as any).strategicNodes?.value || (gameStore as any).strategicNodes || [];
  const pAdm = playerAdmiral.value;
  const fid = pAdm?.faction === 'alliance' ? 1 : 2;
  const currentDate = (gameStore as any).universeDate || '796.01.01';
  const nextDate = (() => {
    let [y, m, d] = currentDate.split('.').map(Number);
    d += 1;
    while (d > 30) { d -= 30; m++; if (m > 12) { m = 1; y++; } }
    return `${y}.${m.toString().padStart(2,'0')}.${d.toString().padStart(2,'0')}`;
  })();
  let count = 0;
  nodes.forEach((n: any) => {
    if (n.ownerFactionId === fid && n.connections) {
      n.connections.forEach((connId: number) => {
        const neighbor = nodes.find((nn: any) => nn.id === connId);
        if (neighbor && neighbor.ownerFactionId !== fid) {
          neighbor.revealedUntil = nextDate;
          count++;
        }
      });
    }
  });
  (gameStore as any).metaGold = ((gameStore as any).metaGold || 0) - 200;
  (gameStore as any).triggerToast(`情报搜集完成，揭示了 ${count} 个敌方节点`);
};

/** 外交施压（₮500，无需二次确认） */
const handleDiplomatPressure = (targetFactionId: number) => {
  if (!canAdminOp('diplomat_op') || metaGold.value < 500) return;
  const result = (adminStore as any).executeDiplomatPressure(targetFactionId);
  (gameStore as any).triggerToast(result.message);
};

// ─── 外交 Tab 数据 ───
const diplomacy = computed(() => adminState.value?.diplomacy || { relations: {}, treaties: [] });
const treaties = computed(() => diplomacy.value?.treaties || []);

const factionRelations = computed(() => {
  const rels = diplomacy.value?.relations || {};
  return Object.entries(rels).map(([id, val]) => ({
    id: parseInt(id),
    name: factionName(parseInt(id)),
    value: val as number,
  }));
});

const factionName = (id: number): string => {
  const facMap: Record<number, string> = { 1: '自由行星同盟', 2: '银河帝国' };
  return facMap[id] || '未知阵营';
};

const treatyTypeLabel = (type: string): string => {
  const map: Record<string, string> = {
    ceasefire: '停战协定', trade: '贸易协定', alliance: '同盟条约', war: '战争状态',
  };
  return map[type] || type;
};

const relColorClass = (val: number): string => {
  if (val < -30) return 'text-empire';
  if (val < 0) return 'text-warning';
  if (val < 30) return 'text-cyan';
  return 'text-green';
};

// ─── 情报 Tab 数据 ───
const intelligence = computed(() => adminState.value?.intelligence || { intelLevel: {}, revealedFleets: [], intelOpBuffDays: 0 });
const revealedFleets = computed(() => intelligence.value?.revealedFleets || []);

const intelLevels = computed(() => {
  const levels = intelligence.value?.intelLevel || {};
  return Object.entries(levels).map(([id, level]) => ({
    id: parseInt(id),
    name: factionName(parseInt(id)),
    level: level as string,
    levelNum: { none: 0, basic: 1, detailed: 2, full: 3 }[level as string] ?? 0,
  }));
});
</script>

<style scoped>
/* ===== 侧滑面板容器 ===== */
.admin-panel {
  position: fixed;
  right: 0;
  top: 50px;          /* navbar 下沿起始 */
  height: calc(100vh - 50px);
  width: 520px;
  z-index: 90;
  transform: translateX(100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  background: var(--neo-body);
  border-left: 1px solid var(--color-border);
  box-shadow: -8px 0 24px var(--color-shadow);
  font-family: "Nunito", -apple-system, sans-serif;
}
.admin-panel.open { transform: translateX(0); }

/* ===== 头部 ===== */
.admin-header {
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid var(--overlay-hover);
  background: var(--overlay-surface);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}
.header-title {
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 0.15em;
  color: var(--color-text-primary);
}

/* ===== Tab 导航 ===== */
.admin-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--overlay-hover);
  background: var(--neo-body);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.admin-tab {
  flex: 1;
  min-width: 60px;
  padding: 6px 8px;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  white-space: nowrap;
}
.admin-tab.active {
  color: var(--color-cyan);
  border-color: var(--color-cyan);
}

/* ===== 面板内容区（可滚动） ===== */
.admin-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tab-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ===== 通用卡片 ===== */
.section-card {
  background: var(--neo-surface);
  border: 1px solid var(--overlay-hover);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.section-disabled {
  opacity: 0.6;
}
.section-label {
  font-size: 10px;
  text-transform: uppercase;
  color: var(--color-text-disabled);
  letter-spacing: 0.15em;
  font-weight: 700;
}

/* ===== 财政 Tab ===== */
.treasury-value {
  font-size: 28px;
  font-weight: 900;
  font-family: monospace;
  color: var(--color-warning);
  letter-spacing: 1px;
}
.finance-row, .welfare-row {
  display: flex;
  gap: 8px;
}
.finance-cell, .welfare-cell {
  flex: 1;
  background: var(--color-overlay-pressed);
  border-radius: 6px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
}
.cell-label {
  font-size: 10px;
  color: var(--color-text-secondary);
  font-weight: 600;
}
.cell-value {
  font-size: 14px;
  font-weight: 800;
  font-family: monospace;
}
.text-green { color: var(--color-green); }
.text-empire { color: var(--color-empire); }
.text-warning { color: var(--color-warning); }
.text-cyan { color: var(--color-cyan); }

/* 税率滑块 */
.tax-slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tax-slider {
  flex: 1;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--neo-surface-raised);
  border-radius: 3px;
  outline: none;
}
.tax-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-cyan);
  cursor: pointer;
  border: 2px solid var(--neo-body);
}
.tax-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-cyan);
  cursor: pointer;
  border: 2px solid var(--neo-body);
}
.tax-slider:disabled { opacity: 0.4; cursor: not-allowed; }
.tax-value {
  font-size: 16px;
  font-weight: 900;
  font-family: monospace;
  color: var(--color-cyan);
  min-width: 40px;
  text-align: right;
}

/* 战争税 */
.war-tax-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.war-tax-status {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-secondary);
}
.war-tax-status.active {
  color: var(--color-empire);
}

/* 维护费明细 */
.maint-total {
  font-size: 13px;
  font-weight: 800;
  color: var(--color-warning);
  font-family: monospace;
}
.maint-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
}
.maint-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  background: var(--color-overlay-pressed);
  border-radius: 4px;
  font-size: 11px;
  gap: 8px;
}
.maint-name {
  font-weight: 700;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.maint-detail {
  color: var(--color-text-secondary);
  font-family: monospace;
  font-size: 10px;
  flex: 1;
  text-align: center;
}
.maint-cost {
  color: var(--color-warning);
  font-family: monospace;
  font-weight: 700;
  flex-shrink: 0;
}

/* ===== 人事 Tab ===== */
.loyalty-bar-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
}
.loyalty-bar {
  flex: 1;
  height: 10px;
  background: var(--neo-surface-raised);
  border-radius: 5px;
  overflow: hidden;
}
.loyalty-fill {
  height: 100%;
  transition: width 0.3s;
}
.fill-danger { background: var(--color-empire); }
.fill-warning { background: var(--color-warning); }
.fill-good { background: var(--color-green); }
.loyalty-num {
  font-size: 16px;
  font-weight: 900;
  font-family: monospace;
  color: var(--color-text-primary);
  min-width: 40px;
  text-align: right;
}

.adm-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 400px;
  overflow-y: auto;
}
.adm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--color-overlay-pressed);
  border-radius: 6px;
  border-left: 3px solid transparent;
}
.adm-row.adm-warning {
  border-left-color: var(--color-empire);
  background: rgba(239, 68, 68, 0.08);
}
.adm-info {
  display: flex;
  flex-direction: column;
  min-width: 100px;
  flex-shrink: 0;
}
.adm-name {
  font-size: 12px;
  font-weight: 800;
  color: var(--color-text-primary);
}
.adm-role {
  font-size: 10px;
  color: var(--color-text-secondary);
}
.adm-loyalty {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
}
.mini-bar {
  flex: 1;
  height: 6px;
  background: var(--neo-surface-raised);
  border-radius: 3px;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: center;
}
.mini-fill {
  height: 100%;
  transition: width 0.3s;
}
.text-cyan-bg { background: var(--color-cyan); }
.mini-label {
  position: absolute;
  left: 4px;
  font-size: 9px;
  font-weight: 700;
  color: var(--color-text-disabled);
  z-index: 1;
}
.loyalty-text {
  font-size: 12px;
  font-weight: 800;
  font-family: monospace;
  color: var(--color-text-primary);
  min-width: 30px;
  text-align: right;
}
.warn-tag {
  font-size: 9px;
  font-weight: 800;
  color: var(--color-empire);
  padding: 2px 6px;
  background: rgba(239, 68, 68, 0.15);
  border-radius: 3px;
  white-space: nowrap;
  flex-shrink: 0;
}

/* 人事操作按钮 */
.adm-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.btn-reward,
.btn-promote {
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 4px;
  font-weight: 700;
  transition: all 0.2s;
}
.btn-reward {
  color: var(--color-gold);
  border-color: var(--color-gold);
}
.btn-reward:hover:not(:disabled) {
  background: var(--color-gold);
  color: var(--neo-body);
}
.btn-promote {
  color: var(--color-cyan);
  border-color: var(--color-cyan);
}
.btn-promote:hover:not(:disabled) {
  background: var(--color-cyan);
  color: var(--neo-body);
}
.btn-reward:disabled,
.btn-promote:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ===== 科技 Tab ===== */
.tech-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.tech-item {
  background: var(--color-overlay-pressed);
  border-radius: 6px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}
.tech-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tech-icon { font-size: 16px; }
.tech-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-primary);
  flex: 1;
}
.tech-level {
  font-size: 12px;
  font-weight: 900;
  font-family: monospace;
  color: var(--color-cyan);
}
.tech-tier-name {
  font-size: 10px;
  color: var(--color-text-secondary);
  padding-top: 2px;
  border-top: 1px solid var(--overlay-border);
}
.tech-progress {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tech-progress-bar {
  flex: 1;
  height: 8px;
  background: var(--neo-surface-raised);
  border-radius: 4px;
  overflow: hidden;
}
.tech-progress-fill {
  height: 100%;
  background: var(--color-text-disabled);
  transition: width 0.3s;
}
.tech-progress-fill.is-focus {
  background: var(--color-cyan);
}
.tech-progress-num {
  font-size: 10px;
  font-family: monospace;
  color: var(--color-text-secondary);
  min-width: 30px;
  text-align: right;
}
.focus-badge {
  font-size: 9px;
  font-weight: 800;
  color: var(--color-cyan);
  text-align: center;
  padding: 2px;
  background: rgba(6, 182, 212, 0.1);
  border-radius: 3px;
}

.focus-btn-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.focus-btn {
  flex: 1;
  min-width: 80px;
}
.focus-btn.active {
  color: var(--color-cyan);
  border-color: var(--color-cyan);
}

/* 科技/情报 buff 活跃状态卡片 */
.buff-active {
  border-color: var(--color-green);
  background: rgba(34, 197, 94, 0.06);
}
.buff-info {
  display: flex;
  align-items: center;
  gap: 8px;
}
.buff-icon {
  font-size: 18px;
}
.buff-text {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-green);
}

/* ===== 民生 Tab ===== */
.node-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 350px;
  overflow-y: auto;
}
.node-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--color-overlay-pressed);
  border-radius: 6px;
}
.node-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-primary);
  min-width: 80px;
  flex-shrink: 0;
}
.node-bars {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* ===== 灰色占位 Tab ===== */
.tab-content.disabled {
  opacity: 0.5;
  pointer-events: none;
}
.placeholder-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 16px;
}
.placeholder-icon {
  font-size: 48px;
  opacity: 0.4;
}
.placeholder-text {
  font-size: 14px;
  color: var(--color-text-secondary);
  font-weight: 700;
  letter-spacing: 0.1em;
}

/* ===== 通用辅助 ===== */
.perm-hint {
  font-size: 10px;
  color: var(--color-empire);
  font-weight: 600;
  font-style: italic;
}
.empty-hint {
  font-size: 11px;
  color: var(--color-text-disabled);
  font-family: monospace;
  text-align: center;
  padding: 16px 0;
  text-transform: uppercase;
}

/* ===== 响应式 ===== */
@media (max-width: 600px) {
  .admin-panel {
    width: 100vw;
  }
  .tech-grid {
    grid-template-columns: 1fr;
  }
  .finance-row, .welfare-row {
    flex-direction: column;
  }
}

/* ===== v3 新增：外交/情报/行政操作样式 ===== */
.action-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.action-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.action-name {
  font-size: 13px;
  font-weight: 800;
  color: var(--color-text-primary);
}
.action-cost {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-warning);
  font-family: monospace;
}
.action-effect {
  font-size: 10px;
  color: var(--color-text-secondary);
}

.relation-list, .intel-list, .treaty-list, .revealed-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.relation-row, .intel-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--color-overlay-pressed);
  border-radius: 6px;
}
.rel-name, .intel-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-primary);
  min-width: 80px;
  flex-shrink: 0;
}
.rel-bar-wrapper, .intel-bar-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
}
.rel-bar, .intel-bar {
  flex: 1;
  height: 6px;
  background: var(--neo-surface-raised);
  border-radius: 3px;
  overflow: hidden;
}
.rel-fill {
  height: 100%;
  transition: width 0.3s;
}
.rel-value, .intel-level-text {
  font-size: 11px;
  font-weight: 800;
  font-family: monospace;
  min-width: 35px;
  text-align: right;
}
.rel-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: 11px;
}
.treaty-row, .revealed-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--color-overlay-pressed);
  border-radius: 6px;
  font-size: 11px;
}
.treaty-icon, .revealed-icon { font-size: 14px; }
.treaty-type { font-weight: 800; color: var(--color-text-primary); }
.treaty-target { color: var(--color-text-secondary); flex: 1; }
.treaty-expiry { color: var(--color-text-disabled); font-family: monospace; font-size: 10px; }
.revealed-text { color: var(--color-text-secondary); }
.intel-hint {
  font-size: 9px;
  color: var(--color-text-disabled);
  font-family: monospace;
  line-height: 1.4;
  padding-top: 4px;
}

.admin-tab-icon {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
  margin-right: 2px;
}
.admin-tab-icon :deep(svg) {
  width: 14px;
  height: 14px;
}
</style>

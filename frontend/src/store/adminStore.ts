// ==================================================
// File: src/store/adminStore.ts
// 行政系统核心 Store — 管理行政6模块状态，实现财政/人事/民生每日结算
// ==================================================

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type {
  AdminState,
  FinanceState,
  PersonnelState,
  TechnologyState,
  WelfareState,
  DiplomacyState,
  IntelligenceState,
  TechField,
  LocalOperationType,
  EnemyOpType,
} from '../types/game';
import { useGameStore } from './gameStore';
import { getMilitaryRank, POLITIC_TITLE_RANK } from './gameStore';
import { SHIP_MAINTENANCE, ECONOMY_RATES, ADMIRAL_REWARD_COST, LOCAL_OP_COST, ENEMY_OP_COST, ADMIRAL_SALARY, FEZZAN_LOAN, PENSION_RATE, SHIP_CREW, WAR_ECONOMY, PROMOTION_CEREMONY_COST } from '../config/economy';

// ========== 科技树命名层级配置 ==========
// 对应 Phase 2 设计：武器/防御/后勤/电子各 4 级
export interface TechTier {
  name: string;
  desc: string;
}
export const TECH_TREE: Record<TechField, TechTier[]> = {
  weapon: [
    { name: '激光炮', desc: '基础能量武器' },
    { name: '中子炮', desc: '穿透装甲的高能粒子束' },
    { name: '导向鱼雷', desc: '智能追踪的远距打击' },
    { name: '雷神之锤', desc: '要塞级主炮·毁灭性火力' },
  ],
  armor: [
    { name: '合金装甲', desc: '标准抗打击装甲' },
    { name: '反应装甲', desc: '冲击波主动抵消' },
    { name: '电磁护盾', desc: '能量屏障拦截弹道' },
    { name: '处女神之项链', desc: '首都级防护·近乎不可摧毁' },
  ],
  engine: [
    { name: '高速引擎', desc: '基础跃迁提速' },
    { name: '补给优化', desc: '降低长途补给消耗' },
    { name: '远征战备', desc: '超长距离部署能力' },
    { name: '瓦普跳跃优化', desc: '精准跃迁·最短路径' },
  ],
  electronic: [
    { name: '基础传感器', desc: '提升探测范围' },
    { name: 'ECM干扰', desc: '削弱敌方电子设备' },
    { name: '火控联动', desc: '多舰协同攻击加成' },
    { name: '战术网络', desc: '实时战场数据共享·先手优势' },
  ],
};
import { useAdmiralStore } from './admiralStore';
import { useNodeStore } from './nodeStore';
import { PERSONALITY_MODIFIERS } from '../config/tagConfig';
import type { PersonalityTag } from '../types/game';
import { ROLE_LOCAL_PERMISSIONS, ROLE_ENEMY_PERMISSIONS } from '../config/roleConfig';
import type { BaseAdmiral } from '../config/admiralsData';

// ─── 忠诚度自然衰减/恢复常量 ───
const LOYALTY_DECAY = 0.5;             // 每日自然衰减
const LOYALTY_RIGHTEOUS_BONUS = 0.3;   // 义理标签每日加成
const LOYALTY_OPPORTUNIST_PENALTY = 0.2; // 投机标签每日扣减
const LOYALTY_CHARISMA_BONUS = 0.1;    // 高魅力标签每日加成
const LOYALTY_DEFAULT = 70;            // 默认忠诚度

// ─── 民生恢复常量 ───
const SECURITY_RECOVERY = 0.5;             // 治安每日自然恢复（无防卫司令官）
const SECURITY_RECOVERY_DEF_CMD = 1.5;     // 治安每日恢复（有防卫司令官 ×3）
const WAR_TAX_SECURITY_PENALTY = 0.5;     // 战争税每日治安惩罚

// ─── 赤字惩罚常量 ───
const DEFICIT_MORALE_PENALTY = 3;
const DEFICIT_SUPPLY_PENALTY = 2;

export const useAdminStore = defineStore('admin', () => {
  const adminState = ref<AdminState>(createDefaultAdminState());

  // ─── 默认状态工厂 ───
  function createDefaultAdminState(): AdminState {
    return {
      finance: {
        treasury: 100000000,
        baseTaxRate: 0.1,
        warTaxRate: 0,
        fleetMaintenanceCost: 0,
        monthlyIncome: 0,
        monthlyExpense: 0,
        loanPrincipal: 0,
        loanTotalInterest: 0,
        loanTermDays: 0,
        loanDaysElapsed: 0,
        loanDefaultCount: 0,
        pensionPaid: 0,
        salaryPaid: 0,
        repairPaid: 0,
      },
      personnel: {
        appointments: [],
        loyaltyModifiers: {},
        avgLoyalty: LOYALTY_DEFAULT,
      },
      technology: {
        weaponLevel: 1,
        armorLevel: 1,
        engineLevel: 1,
        electronicLevel: 1,
        researchProgress: { weapon: 0, armor: 0, engine: 0, electronic: 0 },
        researchSpeed: 2.0,
        researchFocus: 'weapon',
        techMobilizeBuffDays: 0,
      },
      welfare: {
        avgSecurity: 60,
        avgDevelopment: 40,
        unrestRisk: 0,
      },
      diplomacy: {
        relations: {},
        treaties: [],
      },
      intelligence: {
        intelLevel: {},
        revealedFleets: [],
        intelOpBuffDays: 0,
      },
      // v3 新增
      localCooldowns: {},
    };
  }

  // ─── 初始化行政状态（新游戏/读档时调用） ───
  function initAdminState(_factionId: number): void {
    adminState.value = createDefaultAdminState();
  }

  // ─── 辅助：获取玩家阵营 ID (1=同盟, 2=帝国) ───
  function getPlayerFactionId(): number {
    const gameStore = useGameStore() as any;
    const playerAdmiralId: number = gameStore.playerAdmiralId;
    if (playerAdmiralId < 0) return 2; // 默认帝国
    const allAdmirals: any[] = gameStore.allAdmirals;
    const adm = allAdmirals.find((a: any) => a.id === playerAdmiralId);
    return adm?.faction === 'alliance' ? 1 : 2;
  }

  // ─── 辅助：获取指定节点的防卫司令官 ───
  function getDefenseCommanderForNode(nodeId: number): any {
    const admiralStore = useAdmiralStore() as any;
    const admList: any[] = admiralStore.admirals || [];
    // 防卫司令官角色为 defense_commander，且驻守在该节点
    return admList.find((a: any) =>
      a.role === 'defense_commander' &&
      (a.assignedNodeId === nodeId || a.currentNodeId === nodeId)
    );
  }

  // ==================================================
  // 财政每日结算（税收由 nodeStore 统一计算后经 playerTaxIncome 传入，消除双重征税）
  // ==================================================
  function processDailyFinance(playerTaxIncome: number): { income: number; expense: number } {
    const gameStore = useGameStore() as any;
    const fleets: any[] = gameStore.strategicFleets || [];
    const nodes: any[] = gameStore.strategicNodes || [];
    const playerFactionId = getPlayerFactionId();

    const ownedNodes = nodes.filter((n: any) => n.ownerFactionId === playerFactionId);

    // ── 舰队维护费（全6舰种按 economy.ts 配置）──
    const myFleets = fleets.filter((f: any) => f.factionId === playerFactionId);
    const maintenance = myFleets.reduce((sum: number, f: any) => {
      const c = f.composition || { battleships: 0, fastBattleships: 0, cruisers: 0, destroyers: 0, carriers: 0, fighters: 0 };
      return sum + (
        (c.battleships || 0) * SHIP_MAINTENANCE.battleship +
        (c.fastBattleships || 0) * SHIP_MAINTENANCE.fastBattleship +
        (c.cruisers || 0) * SHIP_MAINTENANCE.cruiser +
        (c.destroyers || 0) * SHIP_MAINTENANCE.destroyer +
        (c.carriers || 0) * SHIP_MAINTENANCE.carrier +
        (c.fighters || 0) * SHIP_MAINTENANCE.fighter
      );
    }, 0);

    // ── 贸易路线收入（同阵营相邻节点间自动建立贸易，按 connections 拓扑判断）──
    // 修复：旧代码用曼哈顿坐标距离 dist<=2 判断相邻，但节点坐标是像素级（差数百），
    //       导致贸易收入恒为 0。改为按 StarNode.connections 拓扑邻接判断。
    // 银英调性：贸易收入的一半（fezzanTollRate）作为费沙过路费抽成，流入费沙金库（费沙回廊垄断）。
    let tradeIncome = 0;
    const ownedIdSet = new Set(ownedNodes.map((n: any) => n.id));
    for (const a of ownedNodes) {
      const conns: number[] = a.connections || [];
      for (const cid of conns) {
        // 只统计「己方↔己方」的贸易边，且每条无向边只计一次（cid > a.id 去重）
        if (cid <= a.id || !ownedIdSet.has(cid)) continue;
        const b = nodes.find((n: any) => n.id === cid);
        if (!b) continue;
        tradeIncome += Math.min(a.economy || 0, b.economy || 0) * ECONOMY_RATES.tradeCoefficient;
      }
    }
    tradeIncome = Math.round(tradeIncome);

    // ── 费沙过路费抽成：贸易收入 × fezzanTollRate 归费沙金库 ──
    const fezzanToll = Math.round(tradeIncome * ECONOMY_RATES.fezzanTollRate);
    const playerTradeIncome = tradeIncome - fezzanToll;
    if (fezzanToll > 0) {
      gameStore.fezzanGold = (gameStore.fezzanGold || 0) + fezzanToll;
    }

    // ── 占领/治理维护费（非线性：前 N 颗星基础费率，超额部分费率递增，模拟帝国官僚低效）──
    const free = ECONOMY_RATES.governanceFreeNodes;
    let governanceCost = 0;
    ownedNodes.forEach((n: any, idx: number) => {
      const extraNodes = Math.max(0, idx + 1 - free);
      const rate = ECONOMY_RATES.governanceBaseRate + extraNodes * ECONOMY_RATES.governanceExtraPerNode;
      governanceCost += (n.economy || 0) * rate;
    });
    governanceCost = Math.round(governanceCost);

    const totalIncome = (playerTaxIncome || 0) + playerTradeIncome;
    const totalExpense = maintenance + governanceCost;
    // 注意：玩家税收（playerTaxIncome）已由 gameStore 统一计入 factionGold，
    // 此处仅结算「贸易收入（扣费沙抽成后）− 维护/治理支出」，避免对玩家重复征税。
    const netChange = playerTradeIncome - totalExpense;

    // ── 写入国库 ──
    gameStore.metaGold = (gameStore.metaGold || 0) + netChange;
    adminState.value.finance.monthlyIncome = totalIncome;
    adminState.value.finance.monthlyExpense = totalExpense;
    adminState.value.finance.fleetMaintenanceCost = maintenance;
    adminState.value.finance.treasury = gameStore.metaGold;

    // 发布经济指标
    dailyIncome.value = totalIncome;
    dailyExpense.value = totalExpense;
    dailyTaxIncome.value = playerTaxIncome || 0;
    dailyWarTaxIncome.value = 0; // 战争税已并入 nodeStore 统一税收
    dailyTradeIncome.value = playerTradeIncome;
    dailyFleetMaintenance.value = maintenance;
    // 每日重置"当日一次性支出"计数（造船/跃迁在发生时累计）
    dailyShipBuildCost.value = 0;
    dailyWarpCost.value = 0;

    // ── 国库赤字惩罚 ──
    if (gameStore.metaGold < 0) {
      myFleets.forEach((f: any) => {
        f.morale = Math.max(0, (f.morale || 50) - DEFICIT_MORALE_PENALTY);
        f.supply = Math.max(0, (f.supply || 50) - DEFICIT_SUPPLY_PENALTY);
      });
      gameStore.triggerToast('国库赤字！舰队士气与补给下降。');
    }

    // ── 战争税治安惩罚 + 高基础税率的边际代价 ──
    if (adminState.value.finance.warTaxRate > 0) {
      ownedNodes.forEach((n: any) => {
        n.security = Math.max(0, (n.security || 60) - WAR_TAX_SECURITY_PENALTY);
      });
    }
    if (adminState.value.finance.baseTaxRate > 0.2) {
      ownedNodes.forEach((n: any) => {
        n.security = Math.max(0, (n.security || 60) - 0.2);
      });
    }

    return { income: totalIncome, expense: totalExpense };
  }

  // ==================================================
  // v3 提督工资每日结算（月薪/30日）
  // ==================================================
  function settleAdmiralSalaries(): number {
    const admiralStore = useAdmiralStore() as any;
    const admList: any[] = admiralStore.admirals || [];
    const playerFactionId = getPlayerFactionId();
    const gameStore = useGameStore() as any;

    // 双方阵营的提督都发工资（对称经济约束）：玩家工资扣 metaGold，敌方工资扣对应 factionGold。
    // 银英调性：两国都养着庞大的军官团，工资是刚性支出，不能让 AI 国库只进不出。
    // P0修复：BaseAdmiral 无数值 rank 字段，原 ADMIRAL_SALARY[undefined]→全军兜底100金/月；
    // 改为从 rankName 反查军衔。政治头衔（宰相/议会/皇帝）按最高档元帅薪资计算（位高禄重）。
    let playerTotal = 0;
    admList.forEach((a: any) => {
      const factionId = a.faction === 'alliance' ? 1 : 2;
      let rankNum = getMilitaryRank(a.rankName);
      if (rankNum <= 0 && POLITIC_TITLE_RANK[a.rankName]) rankNum = 13; // 政治头衔按元帅档俸禄
      if (rankNum < 1) return;
      const daily = Math.round((ADMIRAL_SALARY[rankNum] || 100) / 30);
      if (factionId === playerFactionId) {
        playerTotal += daily;
      } else {
        // 敌方提督工资，从敌方国库扣除（下限 0）
        if (factionId === 1) gameStore.factionGold.alliance = Math.max(0, (gameStore.factionGold.alliance || 0) - daily);
        else gameStore.factionGold.empire = Math.max(0, (gameStore.factionGold.empire || 0) - daily);
      }
    });
    if (playerTotal > 0) {
      gameStore.metaGold = (gameStore.metaGold || 0) - playerTotal;
      adminState.value.finance.salaryPaid += playerTotal;
    }
    return playerTotal;
  }

  // ==================================================
  // v3 费沙贷款系统
  // ==================================================
  function takeLoan(amount: number, termDays: number): { success: boolean; message: string } {
    const gameStore = useGameStore() as any;
    const treasury = gameStore.metaGold || 0;
    // P0修复：额度上限 = 国库×倍率（与国库正相关，防破产套利）
    // 原代码 Math.max 使破产玩家反而能借满 1000万；MIN_LOAN 语义为"单笔最低借款额"
    const maxLoan = Math.floor(treasury * FEZZAN_LOAN.LIMIT_MULTIPLIER);

    if (amount <= 0 || amount < FEZZAN_LOAN.MIN_LOAN) {
      return { success: false, message: `单笔借款不得低于 ₮${Math.round(FEZZAN_LOAN.MIN_LOAN / 10000)}万` };
    }
    if (amount > maxLoan) {
      return { success: false, message: `借款额度不足（当前国库授信上限 ₮${Math.round(maxLoan / 10000)}万）` };
    }
    if (!FEZZAN_LOAN.TERMS.includes(termDays as 60)) {
      return { success: false, message: '还款期限无效' };
    }
    // 费沙放贷：从费沙金库出账（费沙金库不足则拒绝放贷）
    const fezzanTreasury = gameStore.fezzanGold || 0;
    if (fezzanTreasury < amount) {
      return { success: false, message: '费沙金库不足，暂无法放贷' };
    }
    const fin = adminState.value.finance;
    fin.loanPrincipal += amount;
    fin.loanTermDays = termDays;
    gameStore.metaGold = (gameStore.metaGold || 0) + amount;
    gameStore.fezzanGold = fezzanTreasury - amount;
    return { success: true, message: `费沙放款 ₮${Math.round(amount / 10000)}万，${termDays}天期限` };
  }

  /** 每日贷款结算：30天结息 + 到期还款 + 违约惩罚 */
  function settleLoanDaily(): { interestPaid: number; principalPaid: number } {
    const fin = adminState.value.finance;
    if (fin.loanPrincipal <= 0) return { interestPaid: 0, principalPaid: 0 };
    const gameStore = useGameStore() as any;
    fin.loanDaysElapsed++;

    // 每30天结息一次
    if (fin.loanDaysElapsed % 30 === 0) {
      const rate = fin.loanDefaultCount > 0 ? FEZZAN_LOAN.DEFAULT_INTEREST_RATE : FEZZAN_LOAN.MONTHLY_INTEREST;
      const interest = Math.round(fin.loanPrincipal * rate);
      const treasuryNow = gameStore.metaGold || 0;
      if (treasuryNow >= interest) {
        gameStore.metaGold = treasuryNow - interest;
        gameStore.fezzanGold = (gameStore.fezzanGold || 0) + interest; // 利息流入费沙金库
        fin.loanTotalInterest += interest;
        fin.loanDefaultCount = 0;
      } else {
        // 逾期：付不起利息
        fin.loanDefaultCount++;
        const msg = fin.loanDefaultCount >= 2
          ? `费沙强制拍卖！扣除国库30%作为违约赔偿。`
          : `费沙催收：无力支付利息，利率升至8%！`;
        if (fin.loanDefaultCount >= 2) {
          const forfeit = Math.round(treasuryNow * FEZZAN_LOAN.FORECLOSE_RATIO);
          gameStore.metaGold = treasuryNow - forfeit;
          gameStore.fezzanGold = (gameStore.fezzanGold || 0) + forfeit; // 违约罚金流入费沙
        }
        gameStore.triggerToast(msg);
      }
    }

    // 到期还款（使用结息后的最新国库余额）
    if (fin.loanDaysElapsed >= fin.loanTermDays && fin.loanPrincipal > 0) {
      const treasury = gameStore.metaGold || 0;
      if (treasury >= fin.loanPrincipal) {
        gameStore.metaGold = treasury - fin.loanPrincipal;
        gameStore.fezzanGold = (gameStore.fezzanGold || 0) + fin.loanPrincipal; // 本金偿还流入费沙
        const paid = fin.loanPrincipal;
        fin.loanPrincipal = 0;
        fin.loanDaysElapsed = 0;
        return { interestPaid: 0, principalPaid: paid };
      } else {
        // 到期无法还款 → 违约
        fin.loanDefaultCount++;
        fin.loanTermDays += 30; // 展期
        gameStore.triggerToast('费沙贷款到期无法偿还，已展期30天，利率上升！');
      }
    }
    return { interestPaid: 0, principalPaid: 0 };
  }

  /** 提前还款 */
  function repayLoan(amount: number): { success: boolean; message: string } {
    const fin = adminState.value.finance;
    if (fin.loanPrincipal <= 0) return { success: false, message: '无贷款' };
    const gameStore = useGameStore() as any;
    const repay = Math.min(amount, fin.loanPrincipal, gameStore.metaGold || 0);
    if (repay <= 0) return { success: false, message: '资金不足' };
    gameStore.metaGold = (gameStore.metaGold || 0) - repay;
    gameStore.fezzanGold = (gameStore.fezzanGold || 0) + repay; // 还款流入费沙
    fin.loanPrincipal -= repay;
    if (fin.loanPrincipal <= 0) { fin.loanPrincipal = 0; fin.loanDaysElapsed = 0; }
    return { success: true, message: `已还款 ₮${Math.round(repay / 10000)}万，剩余 ${Math.round(fin.loanPrincipal / 10000)}万` };
  }

  // ==================================================
  // v3 军人抚恤：战斗阵亡后调用
  // ==================================================
  function applyPension(losses: { battleships: number; cruisers: number; destroyers: number; carriers: number; fighters: number }): number {
    const crewLoss =
      (losses.battleships || 0) * SHIP_CREW.battleship +
      (losses.cruisers || 0) * SHIP_CREW.cruiser +
      (losses.destroyers || 0) * SHIP_CREW.destroyer +
      (losses.carriers || 0) * SHIP_CREW.carrier +
      (losses.fighters || 0) * SHIP_CREW.fighter;
    const pension = crewLoss * PENSION_RATE;
    if (pension > 0) {
      const gameStore = useGameStore() as any;
      const treasury = gameStore.metaGold || 0;
      // P2修复：国库不足时按比例支付（原 Math.max(0,...) 实际全免——大额抚恤可白嫖）。
      // 赤字场景：抚恤转为欠付记入国库（允许负值），下次收入优先偿还，体现国家信用。
      const paid = Math.min(treasury, pension);
      gameStore.metaGold = treasury - pension; // 允许透支为负（欠付抚恤）
      adminState.value.finance.pensionPaid += paid;
    }
    return pension;
  }

  // ==================================================
  // v3 修理费：战后伤舰结算
  // ==================================================
  function applyRepairCost(hpLoss: number): number {
    if (hpLoss <= 0) return 0;
    const cost = Math.round(hpLoss * WAR_ECONOMY.repairCostPerHp);
    const gameStore = useGameStore() as any;
    gameStore.metaGold = Math.max(0, (gameStore.metaGold || 0) - cost);
    adminState.value.finance.repairPaid += cost;
    return cost;
  }

  // ==================================================
  // 人事每日结算（仅作用于己方提督）
  // ==================================================
  function processDailyPersonnel(): void {
    const admiralStore = useAdmiralStore() as any;
    const allAdms: any[] = admiralStore.admirals || [];
    const playerFactionId = getPlayerFactionId();
    // 仅己方提督参与忠诚结算（敌方忠诚由策反等情报行动驱动，不受我方人事影响）
    const admList = allAdms.filter((a: any) => (a.faction === 'alliance' ? 1 : 2) === playerFactionId);

    if (admList.length === 0) {
      adminState.value.personnel.avgLoyalty = LOYALTY_DEFAULT;
      return;
    }

    let totalLoyalty = 0;

    admList.forEach((adm: any) => {
      // 确保忠诚度字段存在
      if (adm.loyalty === undefined || adm.loyalty === null) {
        adm.loyalty = LOYALTY_DEFAULT;
      }

      // 自然衰减
      adm.loyalty = Math.max(0, adm.loyalty - LOYALTY_DECAY);

      // 标签修正
      const tags: string[] = adm.tags || [];
      if (tags.includes('righteous')) {
        adm.loyalty = Math.min(100, adm.loyalty + LOYALTY_RIGHTEOUS_BONUS);
      }
      if (tags.includes('opportunist')) {
        adm.loyalty = Math.max(0, adm.loyalty - LOYALTY_OPPORTUNIST_PENALTY);
      }
      if (tags.includes('high_charisma')) {
        adm.loyalty = Math.min(100, adm.loyalty + LOYALTY_CHARISMA_BONUS);
      }

      // 人格修正系数表修正（从 PERSONALITY_MODIFIERS 读取 loyaltyMod）
      for (const tag of tags) {
        const mod = PERSONALITY_MODIFIERS[tag as PersonalityTag];
        if (mod && mod.loyaltyMod !== 0) {
          // loyaltyMod 是一次性修正值，每日按 1/100 折算为微量变化
          adm.loyalty = Math.max(0, Math.min(100, adm.loyalty + mod.loyaltyMod * 0.01));
        }
      }

      totalLoyalty += adm.loyalty;
    });

    // 平均忠诚度（仅己方）
    adminState.value.personnel.avgLoyalty = totalLoyalty / admList.length;

    // ── 提督独立行为：低忠诚度提督可能抗命 ──
    const gameStore = useGameStore() as any;
    admList.forEach((adm: any) => {
      if ((adm.loyalty || 50) < 40 && Math.random() < 0.03) {
        gameStore.triggerToast(`${adm.name} 拒绝服从命令：「我认为这不是明智之举。」`);
      }
    });

    // 叛变风险检测（仅标记，不执行叛变，叛变逻辑在事件引擎中）
    // ambition_faction 标签且 loyalty < 30 → 高叛变风险
  }

  // ==================================================
  // 民生每日结算（T07 完善：防卫司令官效果）
  // ==================================================
  function processDailyWelfare(): void {
    const gameStore = useGameStore() as any;
    const nodes: any[] = gameStore.strategicNodes || [];
    const playerFactionId = getPlayerFactionId();
    const ownedNodes = nodes.filter((n: any) => n.ownerFactionId === playerFactionId);

    if (ownedNodes.length === 0) {
      adminState.value.welfare.avgSecurity = 0;
      adminState.value.welfare.avgDevelopment = 0;
      adminState.value.welfare.unrestRisk = 100;
      return;
    }

    let totalSecurity = 0;
    let totalEconomy = 0;

    ownedNodes.forEach((n: any) => {
      // 防卫司令官辖区治安恢复 ×3（1.5/日 vs 0.5/日）
      const defCommander = getDefenseCommanderForNode(n.id);
      const securityRecovery = defCommander ? SECURITY_RECOVERY_DEF_CMD : SECURITY_RECOVERY;
      n.security = Math.min(100, (n.security || 60) + securityRecovery);
      // 经济不再每日自然增长：星球经济值由「民生投资」等主动决策驱动，避免税收无决策滚雪球
      totalSecurity += n.security;
      totalEconomy += (n.economy || 0);
    });

    adminState.value.welfare.avgSecurity = totalSecurity / ownedNodes.length;
    // 经济值归一化到 0-100（假设最大经济值 5000 → 100）
    adminState.value.welfare.avgDevelopment = Math.min(100, (totalEconomy / ownedNodes.length) / 50);
    adminState.value.welfare.unrestRisk = Math.max(0, 100 - adminState.value.welfare.avgSecurity);
  }

  // ==================================================
  // 科技每日结算（T07 新增：研发进度推进 + 升级 + buff倒计时）
  // ==================================================
  function processDailyTechnology(): void {
    const tech = adminState.value.technology;
    const gameStore = useGameStore() as any;

    // 研发速度 = 基础速度 × 科技动员buff(×2)
    let speed = tech.researchSpeed;
    if (tech.techMobilizeBuffDays > 0) {
      speed *= 2;
      tech.techMobilizeBuffDays--;
    }

    // 焦点领域进度推进
    const focus: TechField = tech.researchFocus || 'weapon';
    tech.researchProgress[focus] = Math.min(100, (tech.researchProgress[focus] || 0) + speed);

    // 满级升级
    if (tech.researchProgress[focus] >= 100) {
      tech.researchProgress[focus] = 0;
      const levelMap: Record<TechField, 'weaponLevel' | 'armorLevel' | 'engineLevel' | 'electronicLevel'> = {
        weapon: 'weaponLevel',
        armor: 'armorLevel',
        engine: 'engineLevel',
        electronic: 'electronicLevel',
      };
      const levelKey = levelMap[focus];
      if (tech[levelKey] < 10) {
        tech[levelKey]++;
        const fieldNames: Record<TechField, string> = {
          weapon: '武器', armor: '装甲', engine: '引擎', electronic: '电子战',
        };
        gameStore.triggerToast?.(`科技突破！${fieldNames[focus]} 提升至 ${tech[levelKey]} 级`);
      }
    }

    // 情报行动buff倒计时
    if (adminState.value.intelligence.intelOpBuffDays > 0) {
      adminState.value.intelligence.intelOpBuffDays--;
    }
  }

  // ==================================================
  // 行政操作函数（供 UI 调用）
  // ==================================================

  /** 设置基础税率 (0.1 ~ 0.3) */
  function setTaxRate(rate: number): void {
    adminState.value.finance.baseTaxRate = Math.max(0.1, Math.min(0.3, rate));
  }

  /** 切换战争附加税（开/关） */
  function toggleWarTax(): void {
    adminState.value.finance.warTaxRate = adminState.value.finance.warTaxRate > 0 ? 0 : 0.15;
  }

  /** 设置科技研发重点领域 */
  function setResearchFocus(field: TechField): void {
    adminState.value.technology.researchFocus = field;
  }

  /** 获取当前财政状态 */
  function getFinanceState(): FinanceState {
    return adminState.value.finance;
  }

  /** 获取当前人事状态 */
  function getPersonnelState(): PersonnelState {
    return adminState.value.personnel;
  }

  /** 赏赐提督：花费资金提升忠诚度（花费按军衔自动计算） */
  function rewardAdmiral(admiralId: number, goldCost?: number): { success: boolean; message: string } {
    const admiralStore = useAdmiralStore();
    const adm = (admiralStore.admirals as unknown as any[]).find((a: any) => a.id === admiralId);
    if (!adm) return { success: false, message: '提督不存在' };
    // P0修复：原 adm?.rank 在 BaseAdmiral 上不存在（undefined→兜底500金）；改由 rankName 反查
    const milRank = getMilitaryRank(adm.rankName);
    const cost = goldCost ?? (ADMIRAL_REWARD_COST[milRank] || 25000);

    const gameStore = useGameStore() as any;
    const currentGold = gameStore.metaGold || 0;
    if (currentGold < cost) {
      return { success: false, message: '资金不足' };
    }

    // 扣除资金（metaGold 为 setup store 的 computed，走 setter）
    gameStore.metaGold = currentGold - cost;

    // 提升忠诚度 (10-20点)
    const loyaltyGain = 10 + Math.floor(Math.random() * 11);
    adm.loyalty = Math.min(100, (adm.loyalty ?? 70) + loyaltyGain);

    return { success: true, message: `赏赐 ${adm.name}，忠诚+${loyaltyGain}` };
  }

  // 军衔名（索引=军阶 1-13）
  const RANK_SEQUENCE = ['', '准尉', '少尉', '中尉', '上尉', '少校', '中校', '上校', '准将', '少将', '中将', '上将', '一级上将', '元帅'];
  // 晋升功勋开销（按目标军阶）；晋升仪式费由国库另付（PROMOTION_CEREMONY_COST）
  const PROMOTION_MERIT_COST: Record<number, number> = {
    2: 50, 3: 80, 4: 120, 5: 160, 6: 200, 7: 260,
    8: 320, 9: 400, 10: 500, 11: 650, 12: 800, 13: 1000,
  };

  /** 晋升提督：真晋升——军衔 +1，rankName 与数值 rank 双写，忠诚提升，国库付仪式费 */
  function promoteAdmiral(admiralId: number, meritCost?: number): { success: boolean; message: string } {
    const admiralStore = useAdmiralStore();
    const adm = (admiralStore.admirals as unknown as any[]).find((a: any) => a.id === admiralId);
    if (!adm) return { success: false, message: '提督不存在' };

    const gameStore = useGameStore() as any;
    const currentRank = getMilitaryRank(adm.rankName);
    if (currentRank <= 0) {
      return { success: false, message: '政治头衔不参与军衔晋升' };
    }
    if (currentRank >= 13) {
      return { success: false, message: `${adm.name} 已是元帅，无法再晋升` };
    }
    const targetRank = currentRank + 1;
    const cost = meritCost ?? PROMOTION_MERIT_COST[targetRank] ?? 200;

    const currentMerit = gameStore.adminMerit || 0;
    if (currentMerit < cost) {
      return { success: false, message: `行政功勋不足（需 ${cost}，现有 ${currentMerit}）` };
    }

    // 国库付晋升仪式费（仪式费不足则拒绝——晋升是国家级仪式）
    const ceremonyCost = PROMOTION_CEREMONY_COST;
    const treasury = gameStore.metaGold || 0;
    if (treasury < ceremonyCost) {
      return { success: false, message: `国库资金不足（晋升仪式需 ₮${Math.round(ceremonyCost / 10000)}万）` };
    }

    // 扣除功勋 + 仪式费
    gameStore.adminMerit = currentMerit - cost;
    gameStore.metaGold = treasury - ceremonyCost;

    // 双写：rankName（战略层持久）+ rank（战斗层数值）
    const oldName = adm.rankName;
    adm.rankName = RANK_SEQUENCE[targetRank];
    // 同步战斗层 allAdmirals 的数值 rank（若该提督已在战斗层注册）
    const battleAdm = (gameStore.allAdmirals as unknown as any[]).find((a: any) => a.id === admiralId);
    if (battleAdm) battleAdm.rank = targetRank;

    // 提升忠诚度 (15-25点)
    const loyaltyGain = 15 + Math.floor(Math.random() * 11);
    adm.loyalty = Math.min(100, (adm.loyalty ?? 70) + loyaltyGain);

    return {
      success: true,
      message: `晋升仪式：${oldName} ${adm.name} → ${adm.rankName}！忠诚+${loyaltyGain}（功勋-${cost}，仪式费 ₮${Math.round(ceremonyCost / 10000)}万）`,
    };
  }

  /** 调职提督：更换职位（忠诚度小幅提升） */
  function transferAdmiral(admiralId: number, newRole: string): { success: boolean; message: string } {
    const admiralStore = useAdmiralStore();
    const adm = (admiralStore.admirals as unknown as any[]).find((a: any) => a.id === admiralId);
    if (!adm) return { success: false, message: '提督不存在' };

    const oldRole = adm.role || 'none';
    adm.role = newRole;

    // 小幅提升忠诚度 (5-10点)
    const loyaltyGain = 5 + Math.floor(Math.random() * 6);
    adm.loyalty = Math.min(100, (adm.loyalty ?? 70) + loyaltyGain);

    return { success: true, message: `调职 ${adm.name}：${oldRole} → ${newRole}，忠诚+${loyaltyGain}` };
  }

  /** 获取当前民生状态 */
  function getWelfareState(): WelfareState {
    return adminState.value.welfare;
  }

  /** 获取当前科技状态 */
  function getTechnologyState(): TechnologyState {
    return adminState.value.technology;
  }

  /** 获取指定领域和等级的科技层级名称 */
  function getTechTierName(field: TechField, level: number): string {
    const tiers = TECH_TREE[field];
    if (!tiers || level < 1 || level > tiers.length) return `${level}级`;
    return tiers[level - 1].name;
  }

  /** 获取当前外交状态 */
  function getDiplomacyState(): DiplomacyState {
    return adminState.value.diplomacy;
  }

  /** 获取当前情报状态 */
  function getIntelligenceState(): IntelligenceState {
    return adminState.value.intelligence;
  }

  // ==================================================
  // v3 新增：本地操作冷却 + 本地/敌方操作函数群 + 行政操作函数
  // ==================================================

  /** 本地操作冷却记录（也同步到 adminState.localCooldowns 以支持存档） */
  const localCooldowns = ref<Record<string, number>>({});

  // ── 经济系统可观察指标（供 EconomyPanel 使用）──
  const dailyIncome = ref(0);
  const dailyExpense = ref(0);
  const dailyTaxIncome = ref(0);
  const dailyWarTaxIncome = ref(0);
  const dailyTradeIncome = ref(0);
  const dailyFleetMaintenance = ref(0);
  const dailyShipBuildCost = ref(0);
  const dailyWarpCost = ref(0);

  /** 同步 localCooldowns 到 adminState（用于存档序列化） */
  function syncCooldownsToState(): void {
    adminState.value.localCooldowns = { ...localCooldowns.value };
  }

  /** 从 adminState 恢复 localCooldowns（用于读档反序列化） */
  function restoreCooldownsFromState(): void {
    localCooldowns.value = { ...(adminState.value.localCooldowns || {}) };
  }

  /** 生成冷却 key：`${nodeId}_${opType}` */
  function getCooldownKey(nodeId: number, opType: string): string {
    return `${nodeId}_${opType}`;
  }

  /** 每日结算：递减冷却计数器 */
  function processDailyLocalCooldowns(): void {
    const cd = localCooldowns.value;
    const keysToDelete: string[] = [];
    for (const key of Object.keys(cd)) {
      cd[key] = cd[key] - 1;
      if (cd[key] <= 0) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(k => delete cd[k]);
    syncCooldownsToState();
  }

  /** 本地操作冷却检查 */
  function isLocalOpCoolingDown(nodeId: number, opType: string): boolean {
    const key = getCooldownKey(nodeId, opType);
    return (localCooldowns.value[key] ?? 0) > 0;
  }

  /** 获取冷却剩余天数 */
  function getCooldownRemaining(nodeId: number, opType: string): number {
    const key = getCooldownKey(nodeId, opType);
    return localCooldowns.value[key] ?? 0;
  }

  /** 二次确认判断（≥₮20万 需确认） */
  function requiresConfirm(cost: number): boolean {
    return cost >= 200000;
  }

  /** 设置冷却 */
  function setCooldown(nodeId: number, opType: string, days: number): void {
    const key = getCooldownKey(nodeId, opType);
    localCooldowns.value[key] = days;
    syncCooldownsToState();
  }

  // ─── 获取玩家提督 ───
  function getPlayerAdmiral(): BaseAdmiral | null {
    const gameStore = useGameStore() as any;
    const playerAdmiralId: number = gameStore.playerAdmiralId;
    if (playerAdmiralId < 0) return null;
    const allAdmirals: any[] = gameStore.allAdmirals;
    const adm = allAdmirals.find((a: any) => a.id === playerAdmiralId);
    return (adm as BaseAdmiral) || null;
  }

  // ─── 获取节点 ───
  function getNode(nodeId: number): any {
    const gameStore = useGameStore() as any;
    const rawNodes = gameStore.strategicNodes;
    const nodes: any[] = rawNodes?.value !== undefined ? rawNodes.value : (rawNodes || []);
    return nodes.find((n: any) => n.id === nodeId) || null;
  }

  // ─── 获取玩家阵营 ID ─── (已在上方定义 getPlayerFactionId)

  // ─── 检查节点是否有己方舰队驻留 ───
  function nodeHasMyFleet(nodeId: number): boolean {
    const node = getNode(nodeId);
    if (!node || !node.garrisonFleets || node.garrisonFleets.length === 0) return false;
    const gameStore = useGameStore() as any;
    const rawFleets = gameStore.strategicFleets;
    const fleets: any[] = rawFleets?.value !== undefined ? rawFleets.value : (rawFleets || []);
    const playerFactionId = getPlayerFactionId();
    return fleets.some((f: any) => f.factionId === playerFactionId && node.garrisonFleets.includes(f.id));
  }

  // ─── 获取节点所属舰队的指挥官 ───
  function getNodeFleetCommanders(nodeId: number): any[] {
    const node = getNode(nodeId);
    if (!node || !node.garrisonFleets) return [];
    const gameStore = useGameStore() as any;
    const rawFleets = gameStore.strategicFleets;
    const fleets: any[] = rawFleets?.value !== undefined ? rawFleets.value : (rawFleets || []);
    const playerFactionId = getPlayerFactionId();
    return fleets
      .filter((f: any) => f.factionId === playerFactionId && node.garrisonFleets.includes(f.id))
      .map((f: any) => ({ fleet: f, commanderId: f.commanderId }));
  }

  // ─── 获取情报等级数值映射 ───
  function intelLevelToNum(level: string): number {
    const map: Record<string, number> = { none: 0, basic: 1, detailed: 2, full: 3 };
    return map[level] ?? 0;
  }

  /**
   * 检查本地操作权限（含 defense_commander 驻守节点限制、fleet_commander 驻守节点限制）
   */
  function canLocalOp(admiral: BaseAdmiral, nodeId: number, opType: LocalOperationType): boolean {
    const role = admiral.role as string;
    const allowed = ROLE_LOCAL_PERMISSIONS[role as keyof typeof ROLE_LOCAL_PERMISSIONS] || [];
    if (!allowed.includes(opType)) return false;

    // defense_commander：仅限 assignedNodeId 节点
    if (role === 'defense_commander') {
      return admiral.assignedNodeId === nodeId || (admiral as any).currentNodeId === nodeId;
    }

    // fleet_commander：仅限 security_boost/emergency_draft 且仅限驻守节点
    if (role === 'fleet_commander') {
      if (!['security_boost', 'emergency_draft'].includes(opType)) return false;
      const gameStore = useGameStore() as any;
      const rawFleets = gameStore.strategicFleets;
      const fleets: any[] = rawFleets?.value !== undefined ? rawFleets.value : (rawFleets || []);
      const myFleet = fleets.find((f: any) => f.commanderId === admiral.id);
      if (!myFleet) return false;
      return myFleet.currentNodeId === nodeId;
    }

    return true;
  }

  /**
   * 检查敌方操作权限（含 defense_commander 相邻节点限制）
   */
  function canEnemyOp(admiral: BaseAdmiral, nodeId: number, opType: EnemyOpType): boolean {
    const role = admiral.role as string;
    const allowed = ROLE_ENEMY_PERMISSIONS[role as keyof typeof ROLE_ENEMY_PERMISSIONS] || [];
    if (!allowed.includes(opType)) return false;

    // defense_commander：仅限相邻节点
    if (role === 'defense_commander') {
      const node = getNode(nodeId);
      if (!node || !node.connections) return false;
      const assignedId = admiral.assignedNodeId ?? (admiral as any).currentNodeId;
      if (assignedId == null) return false;
      return node.connections.includes(assignedId);
    }

    return true;
  }

  /**
   * 执行友方节点本地操作（7 种）
   * 返回 { success, message }
   */
  function executeLocalOp(nodeId: number, opType: LocalOperationType): { success: boolean; message: string } {
    const gameStore = useGameStore() as any;
    const node = getNode(nodeId);
    if (!node) {
      return { success: false, message: '节点数据异常' };
    }

    // 冷却检查
    if (isLocalOpCoolingDown(nodeId, opType)) {
      const remaining = getCooldownRemaining(nodeId, opType);
      return { success: false, message: `该操作冷却中，剩余 ${remaining} 天` };
    }

    const playerFactionId = getPlayerFactionId();

    switch (opType) {
      case 'special_tax': {
        // L1 征收特别税：国库+奖励金，security-5，10天冷却
        const taxReward = LOCAL_OP_COST.special_tax.reward;
        if (gameStore.metaGold < 0 && gameStore.metaGold < -taxReward) {
          return { success: false, message: '国库赤字严重，无法征税' };
        }
        gameStore.metaGold = (gameStore.metaGold || 0) + taxReward;
        node.security = Math.max(0, (node.security || 60) - 5);
        setCooldown(nodeId, 'special_tax', LOCAL_OP_COST.special_tax.cooldown);
        return { success: true, message: `征收特别税 +₮${Math.round(taxReward / 10000)}万，治安-5` };
      }

      case 'security_boost': {
        // L2 强化治安：security+15，₮3万，需有己方舰队驻留
        const cost = LOCAL_OP_COST.security_boost.gold;
        if (!nodeHasMyFleet(nodeId)) {
          return { success: false, message: '该节点需有己方舰队驻留' };
        }
        if ((gameStore.metaGold || 0) < cost) {
          return { success: false, message: `国库不足 ₮${Math.round(cost / 10000)}万` };
        }
        gameStore.metaGold = (gameStore.metaGold || 0) - cost;
        node.security = Math.min(100, (node.security || 60) + 15);
        return { success: true, message: '强化治安完成，治安+15' };
      }

      case 'welfare_invest': {
        // L3 民生投资：economy+150，₮8万
        const cost = LOCAL_OP_COST.welfare_invest.gold;
        if ((gameStore.metaGold || 0) < cost) {
          return { success: false, message: `国库不足 ₮${Math.round(cost / 10000)}万` };
        }
        gameStore.metaGold = (gameStore.metaGold || 0) - cost;
        node.economy = (node.economy || 500) + 150;
        return { success: true, message: '民生投资完成，经济+150' };
      }

      case 'fortify_local': {
        // L4 要塞化：defenseHp×1.5，₮40万，每节点仅限1次
        const cost = LOCAL_OP_COST.fortify_local.gold;
        if (node.fortified) {
          return { success: false, message: '该节点已要塞化，不可重复' };
        }
        if ((gameStore.metaGold || 0) < cost) {
          return { success: false, message: `国库不足 ₮${Math.round(cost / 10000)}万` };
        }
        gameStore.metaGold = (gameStore.metaGold || 0) - cost;
        node.defenseHp = Math.floor((node.defenseHp || 100) * 1.5);
        node.maxDefenseHp = Math.floor((node.maxDefenseHp || 100) * 1.5);
        node.defenseTurrets = (node.defenseTurrets || 0) + 10;
        node.fortified = true;
        return { success: true, message: '要塞化完成，防御HP+50%，炮塔+10' };
      }

      case 'set_hq': {
        // L5 设为防卫司令部：变更 defense_commander 的 assignedNodeId
        const admiralStore = useAdmiralStore() as any;
        const admList: any[] = admiralStore.admirals || [];
        const defCommander = admList.find((a: any) => a.role === 'defense_commander');
        if (!defCommander) {
          return { success: false, message: '尚未任命防卫司令官' };
        }
        defCommander.assignedNodeId = nodeId;
        return { success: true, message: `${node.name || '该节点'} 已设为防卫司令部` };
      }

      case 'emergency_draft': {
        // L6 紧急征召：所属舰队兵源+5%，morale-10，15天冷却
        if (!nodeHasMyFleet(nodeId)) {
          return { success: false, message: '该节点需有己方舰队驻留' };
        }
        const fleetCommanders = getNodeFleetCommanders(nodeId);
        const gameStore2 = useGameStore() as any;
        const rawFleets = gameStore2.strategicFleets;
        const fleets: any[] = rawFleets?.value !== undefined ? rawFleets.value : (rawFleets || []);
        fleets.forEach((f: any) => {
          if (node.garrisonFleets.includes(f.id) && f.factionId === playerFactionId) {
            const comp = f.composition || { battleships: 0, fastBattleships: 0, cruisers: 0, destroyers: 0, carriers: 0, fighters: 0 };
            comp.battleships = Math.floor(comp.battleships * 1.05);
            comp.fastBattleships = Math.floor(comp.fastBattleships * 1.05);
            comp.cruisers = Math.floor(comp.cruisers * 1.05);
            comp.destroyers = Math.floor(comp.destroyers * 1.05);
            comp.carriers = Math.floor(comp.carriers * 1.05);
            comp.fighters = Math.floor(comp.fighters * 1.05);
            f.morale = Math.max(0, (f.morale || 50) - 10);
          }
        });
        setCooldown(nodeId, 'emergency_draft', LOCAL_OP_COST.emergency_draft.cooldown);
        return { success: true, message: '紧急征召完成，兵源+5%，士气-10' };
      }

      case 'intel_gather': {
        // L7 情报搜集：揭示相邻敌方节点，₮2万
        const cost = LOCAL_OP_COST.intel_gather.gold;
        if ((gameStore.metaGold || 0) < cost) {
          return { success: false, message: `国库不足 ₮${Math.round(cost / 10000)}万` };
        }
        gameStore.metaGold = (gameStore.metaGold || 0) - cost;
        // 揭示相邻敌方节点（设置 revealedUntil 为当前日期+1天，表示临时可见到下次结算）
        const currentDate: string = gameStore.universeDate || '796.01.01';
        const nextDate = advanceDateStr(currentDate, 1);
        if (node.connections) {
          const allNodes = (gameStore.strategicNodes?.value ?? gameStore.strategicNodes) as any[];
          allNodes.forEach((n: any) => {
            if (node.connections.includes(n.id) && n.ownerFactionId !== playerFactionId) {
              n.revealedUntil = nextDate;
            }
          });
        }
        return { success: true, message: '情报搜集完成，相邻敌方节点已揭示' };
      }

      default:
        return { success: false, message: '未知操作类型' };
    }
  }

  /**
   * 执行敌方/中立节点情报操作（3 种）
   * 返回 { success, message }
   */
  function executeEnemyOp(nodeId: number, opType: EnemyOpType): { success: boolean; message: string } {
    const gameStore = useGameStore() as any;
    const node = getNode(nodeId);
    if (!node) {
      return { success: false, message: '节点数据异常' };
    }

    // 冷却检查（仅 subvert 有冷却）
    if (isLocalOpCoolingDown(nodeId, opType)) {
      const remaining = getCooldownRemaining(nodeId, opType);
      return { success: false, message: `该操作冷却中，剩余 ${remaining} 天` };
    }

    const playerFactionId = getPlayerFactionId();
    const targetFactionId = node.ownerFactionId;
    const intelLevel = adminState.value.intelligence.intelLevel[targetFactionId] || 'none';

    switch (opType) {
      case 'recon': {
        // E1 侦察：显示舰队数量，₮2万
        const cost = ENEMY_OP_COST.recon.gold;
        if ((gameStore.metaGold || 0) < cost) {
          return { success: false, message: `国库不足 ₮${Math.round(cost / 10000)}万` };
        }
        gameStore.metaGold = (gameStore.metaGold || 0) - cost;
        const currentDate: string = gameStore.universeDate || '796.01.01';
        node.revealedUntil = advanceDateStr(currentDate, 1);
        return { success: true, message: '侦察成功，舰队信息已揭露' };
      }

      case 'infiltrate': {
        // E2 渗透：持续可见15天，需情报≥basic，₮3万
        const cost = ENEMY_OP_COST.infiltrate.gold;
        if (intelLevelToNum(intelLevel) < 1) {
          return { success: false, message: '情报等级不足（需≥basic）' };
        }
        if ((gameStore.metaGold || 0) < cost) {
          return { success: false, message: `国库不足 ₮${Math.round(cost / 10000)}万` };
        }
        gameStore.metaGold = (gameStore.metaGold || 0) - cost;
        const currentDate: string = gameStore.universeDate || '796.01.01';
        node.revealedUntil = advanceDateStr(currentDate, 15);
        // 加入 revealedFleets
        if (node.garrisonFleets) {
          node.garrisonFleets.forEach((fid: number) => {
            if (!adminState.value.intelligence.revealedFleets.includes(fid)) {
              adminState.value.intelligence.revealedFleets.push(fid);
            }
          });
        }
        return { success: true, message: '渗透成功，目标节点持续可见15天' };
      }

      case 'subvert': {
        // E3 策反：降低守军忠诚，需情报≥detailed，₮5万，40%失败概率，30天冷却
        const cost = ENEMY_OP_COST.sabotage.gold;
        if (intelLevelToNum(intelLevel) < 2) {
          return { success: false, message: '情报等级不足（需≥detailed）' };
        }
        if ((gameStore.metaGold || 0) < cost) {
          return { success: false, message: `国库不足 ₮${Math.round(cost / 10000)}万` };
        }
        // 检查目标节点是否有驻守提督
        const admiralStore = useAdmiralStore() as any;
        const admList: any[] = admiralStore.admirals || [];
        // 查找驻守在该节点的敌方提督
        const rawFleets = gameStore.strategicFleets;
        const fleets: any[] = rawFleets?.value !== undefined ? rawFleets.value : (rawFleets || []);
        const enemyFleet = fleets.find((f: any) =>
          f.currentNodeId === nodeId && f.factionId !== playerFactionId
        );
        if (!enemyFleet) {
          return { success: false, message: '该节点无驻军指挥官，无法策反' };
        }
        const targetCommander = admList.find((a: any) => a.id === enemyFleet.commanderId);
        if (!targetCommander) {
          return { success: false, message: '该节点无驻军指挥官，无法策反' };
        }

        gameStore.metaGold = (gameStore.metaGold || 0) - ENEMY_OP_COST.sabotage.gold;
        setCooldown(nodeId, 'subvert', 30);

        // 40% 失败概率
        if (Math.random() < 0.4) {
          // 失败：己方情报等级-1
          const levels = ['full', 'detailed', 'basic', 'none'];
          const curIdx = levels.indexOf(intelLevel);
          if (curIdx < levels.length - 1) {
            adminState.value.intelligence.intelLevel[targetFactionId] = levels[curIdx + 1] as any;
          }
          return { success: false, message: '策反失败，情报等级下降' };
        } else {
          // 成功：loyalty -= random(20,40)
          const loyaltyLoss = Math.floor(20 + Math.random() * 21);
          targetCommander.loyalty = Math.max(0, (targetCommander.loyalty ?? 70) - loyaltyLoss);
          return { success: true, message: `策反成功，守军忠诚-${loyaltyLoss}` };
        }
      }

      default:
        return { success: false, message: '未知操作类型' };
    }
  }

  // ─── P2 防卫官任命 ───
  /** 获取可任命为防卫官的待命提督列表 */
  function getAvailableDefenseCandidates(faction: string): BaseAdmiral[] {
    const admiralStore = useAdmiralStore() as any;
    const admList: BaseAdmiral[] = admiralStore.admirals || [];
    return admList.filter((a: any) =>
      (a.faction || 'alliance') === faction &&
      (a.role === 'none' || a.role === 'fleet_staff')
    );
  }

  /** 获取星球当前的防卫官 */
  function getNodeDefenseOfficer(nodeId: number): BaseAdmiral | null {
    const admiralStore = useAdmiralStore() as any;
    const admList: BaseAdmiral[] = admiralStore.admirals || [];
    return admList.find((a: any) =>
      a.role === 'defense_commander' && a.assignedNodeId === nodeId
    ) || null;
  }

  /** 任命防卫官 */
  function appointDefenseOfficer(admiralId: number, nodeId: number): { success: boolean; message: string } {
    const admiralStore = useAdmiralStore() as any;
    const admList: BaseAdmiral[] = admiralStore.admirals || [];
    const adm = admList.find((a: any) => a.id === admiralId);
    if (!adm) return { success: false, message: '提督不存在' };

    // 解除已有防卫官（同一节点）
    const existing = admList.find((a: any) =>
      a.role === 'defense_commander' && a.assignedNodeId === nodeId && a.id !== admiralId
    );
    if (existing) {
      existing.role = 'none';
      existing.assignedNodeId = null;
    }

    // 设置新防卫官
    adm.role = 'defense_commander';
    adm.assignedNodeId = nodeId;
    const nodeName = (useNodeStore().nodes as any)?.value?.find((n: any) => n.id === nodeId)?.name
      || (useNodeStore().nodes as any).find((n: any) => n.id === nodeId)?.name
      || '未知星球';
    return { success: true, message: `${adm.rankName} ${adm.name} 已任命为 ${nodeName} 防卫司令官` };
  }

  /** 解任防卫官 */
  function removeDefenseOfficer(nodeId: number): { success: boolean; message: string } {
    const admiralStore = useAdmiralStore() as any;
    const admList: BaseAdmiral[] = admiralStore.admirals || [];
    const def = admList.find((a: any) =>
      a.role === 'defense_commander' && a.assignedNodeId === nodeId
    );
    if (!def) return { success: false, message: '该星球无防卫司令官' };
    def.role = 'none';
    def.assignedNodeId = null;
    return { success: true, message: `${def.rankName} ${def.name} 已被解除防卫司令官职务` };
  }

  // ─── 辅助：日期字符串加天数 ───
  function advanceDateStr(dateStr: string, days: number): string {
    let [year, month, day] = dateStr.split('.').map(Number);
    day += days;
    while (day > 30) {
      day -= 30;
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }
    return `${year}.${month.toString().padStart(2, '0')}.${day.toString().padStart(2, '0')}`;
  }

  // ==================================================
  // v3 新增：行政操作函数（从军议迁出的效果）
  // ==================================================

  /** 行政操作：后勤改革（补给消耗-30%/30天，₮20万） */
  function executeLogisticsReform(): { success: boolean; message: string } {
    const gameStore = useGameStore() as any;
    const cost = 200000;
    if ((gameStore.metaGold || 0) < cost) {
      return { success: false, message: `国库不足 ₮${Math.round(cost / 10000)}万` };
    }
    gameStore.metaGold = (gameStore.metaGold || 0) - cost;
    const rawFleets = gameStore.strategicFleets;
    const fleets: any[] = rawFleets?.value !== undefined ? rawFleets.value : (rawFleets || []);
    const playerFactionId = getPlayerFactionId();
    fleets.forEach((f: any) => {
      if (f.factionId === playerFactionId) {
        f.logisticsBuffDays = 30;
      }
    });
    return { success: true, message: '后勤改革完成，补给消耗-30%（30天）' };
  }

  /** 行政操作：科技动员（研发速度×2/30天，₮30万） */
  function executeTechMobilize(): { success: boolean; message: string } {
    const gameStore = useGameStore() as any;
    const cost = 300000;
    if ((gameStore.metaGold || 0) < cost) {
      return { success: false, message: `国库不足 ₮${Math.round(cost / 10000)}万` };
    }
    gameStore.metaGold = (gameStore.metaGold || 0) - cost;
    adminState.value.technology.techMobilizeBuffDays = 30;
    return { success: true, message: '科技动员完成，研发速度×2（30天）' };
  }

  /** 行政操作：情报行动（情报等级+1/15天，₮10万） */
  function executeIntelAction(): { success: boolean; message: string } {
    const gameStore = useGameStore() as any;
    const cost = 100000;
    if ((gameStore.metaGold || 0) < cost) {
      return { success: false, message: `国库不足 ₮${Math.round(cost / 10000)}万` };
    }
    gameStore.metaGold = (gameStore.metaGold || 0) - cost;
    adminState.value.intelligence.intelOpBuffDays = 15;
    return { success: true, message: '情报行动完成，敌方可见度提升（15天）' };
  }

  /** 行政操作：外交施压（目标阵营关系+20，₮5万） */
  function executeDiplomatPressure(targetFactionId: number): { success: boolean; message: string } {
    const gameStore = useGameStore() as any;
    const cost = 50000;
    if ((gameStore.metaGold || 0) < cost) {
      return { success: false, message: `国库不足 ₮${Math.round(cost / 10000)}万` };
    }
    gameStore.metaGold = (gameStore.metaGold || 0) - cost;
    const cur = adminState.value.diplomacy.relations[targetFactionId] || 0;
    adminState.value.diplomacy.relations[targetFactionId] = Math.min(100, cur + 20);
    return { success: true, message: '外交施压成功，关系+20' };
  }

  // ─── 导出 ───
  return {
    adminState,
    localCooldowns,
    initAdminState,
    // 经济指标
    dailyIncome,
    dailyExpense,
    dailyTaxIncome,
    dailyWarTaxIncome,
    dailyTradeIncome,
    dailyFleetMaintenance,
    dailyShipBuildCost,
    dailyWarpCost,
    // 每日结算
    processDailyFinance,
    processDailyPersonnel,
    processDailyWelfare,
    processDailyTechnology,
    processDailyLocalCooldowns,
    // v3 经济新系统
    settleAdmiralSalaries,
    settleLoanDaily,
    takeLoan,
    repayLoan,
    applyPension,
    applyRepairCost,
    // 行政操作
    setTaxRate,
    toggleWarTax,
    setResearchFocus,
    // v3 行政操作函数
    executeLogisticsReform,
    executeTechMobilize,
    executeIntelAction,
    executeDiplomatPressure,
    // v3 本地/敌方操作
    executeLocalOp,
    executeEnemyOp,
    canLocalOp,
    canEnemyOp,
    isLocalOpCoolingDown,
    getCooldownKey,
    getCooldownRemaining,
    // P2 防卫官
    getAvailableDefenseCandidates,
    getNodeDefenseOfficer,
    appointDefenseOfficer,
    removeDefenseOfficer,
    requiresConfirm,
    restoreCooldownsFromState,
    // 状态访问
    getFinanceState,
    getPersonnelState,
    getWelfareState,
    getTechnologyState,
    // 人事操作
    rewardAdmiral,
    promoteAdmiral,
    transferAdmiral,
    TECH_TREE, getTechTierName,
    getDiplomacyState,
    getIntelligenceState,
  };
});

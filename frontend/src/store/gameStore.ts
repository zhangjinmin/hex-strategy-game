import { defineStore } from 'pinia';
import { ref, computed, shallowRef } from 'vue';
import type { Faction, HexTile, StarNode, StrategicFleet, FleetComposition, NationalRole, AutoResolveParams, AutoResolveResult, ArrivalContext, PostBattleContext, ProposalType, AdminOperationType, LocalOperationType, EnemyOpType } from '../types/game';
import { BattleOutcome, ArrivalDecisionType, PostBattleActionType, FACTION_ALLIANCE_ID, FACTION_EMPIRE_ID, totalShips, totalPowerWeight, EMPTY_COMPOSITION } from '../types/game';
import {
  POLITICAL_VOTE_COEFFICIENTS,
  PERSONALITY_MODIFIERS,
  ROLE_FITNESS_MAP,
  ROLE_VOTE_INFLUENCE,
  calculateTagCompatibility,
  getTagsByCategory,
  isPoliticalTag,
} from '../config/tagConfig';
import type { PersonalityTag, AbilityTag, PoliticalTag } from '../types/game';
import { classToTypeCode, REFUGEE, availableFactions, diffConfig, defaultMaps, generateInitialTroops } from '../config/gameData';
import { admiralsData, BaseAdmiral, Admiral } from '../config/admiralsData';
import { assignFleetByNovel } from '../config/fleetAssignment';
import { canPropose, canCommandFleet, findSuperior, ROLE_PERMISSIONS_V2, ROLE_ADMIN_PERMISSIONS, ROLE_LOCAL_PERMISSIONS, ROLE_ENEMY_PERMISSIONS, ROLE_FLEET_AUTHORITY } from '../config/roleConfig';
import { getAdmiralSkills } from '../config/admiralSkills';
import { SKILL_MAP } from '../config/skills';
import { FORMATIONS, DEFAULT_FORMATION, getFormationCombatMods, getFormationCounterBonus, type FormationType } from '../config/formations';
import { evaluateDailyEvents, resetEventCooldowns, type EventContext, type PendingEvent, type ChainReaction } from '../config/events';
import { getEffectiveCompatibility, getDefectionProbability, getRelationBuff } from '../config/admiralRelations';
import { SaveGameData, LoadGameData } from '../../wailsjs/go/main/App';
import { useAdmiralStore } from './admiralStore';
import { useNodeStore } from './nodeStore';
import { useSettingsStore } from './settingsStore';
import { useFleetStore, shipTypeToCompKey } from './fleetStore';
import { useAdminStore } from './adminStore';
import {
  executeProposalEffect,
  executeProposalRejection,
  generateMonthlyProposals,
  PROPOSAL_DEFINITIONS,
} from '../utils/proposalEngine';
import { INITIAL_GOLD, SHIP_MAINTENANCE, WAR_ECONOMY, FEZZAN_INITIAL_GOLD } from '../config/economy';
import {
  TICKS_PER_DAY,
  WARP_COST,
  AUTO_RESOLVE as BALANCE_AUTO_RESOLVE,
  RETREAT_LOSS,
  CASUALTY,
  SINGLE_BATTLE_CASUALTY,
  TECH_BONUS,
  WARP,
  DEFENSIVE_AI_MAX_MOVES,
  AUTO_SAVE_INTERVAL_DAYS,
  DAILY_EVENT_CHANCE,
  RANK_FLEET_LIMIT,
} from '../config/balance';
import {
  runAIStrategicTurn as runAIStrategicTurnEngine,
  runPlayerDefensiveAI as runPlayerDefensiveAIEngine,
  bfsReachable as bfsReachableEngine,
  euclideanDistance as euclideanDistEngine,
} from './aiEngine';
import { useIntelSystem } from './intelSystem';
import { SCENARIOS } from '../config/scenarioConfig';
import {
  calculatePower as calculatePowerEngine,
  rollBoundedLoss as rollBoundedLossEngine,
  autoResolveBattle as autoResolveBattleEngine,
  rollAdmiralCasualties as rollAdmiralCasualtiesEngine,
  isKeyAdmiralDeath,
  rollSingleBattleCasualty as rollSingleBattleCasualtyEngine,
} from './battleResolver';

// P0修复：政治头衔与军衔拆表。宰相14/议会15/皇帝18 不再混入战斗军衔序列，
// 避免 getShipLimit(14+)/RANK_FLEET_LIMIT 被政治角色污染、工资 NaN 兜底等问题。
const rankMap: Record<string, number> = {
  '准尉': 1, '少尉': 2, '中尉': 3, '上尉': 4,
  '少校': 5, '中校': 6, '上校': 7,
  '准将': 8, '少将': 9, '中将': 10, '上将': 11, '一级上将': 12, '元帅': 13,
};

/** 政治头衔独立表：不参与军衔/舰队上限/战斗逻辑，仅供显示与身份判定 */
export const POLITIC_TITLE_RANK: Record<string, number> = {
  '宰相': 14, '议会': 15, '皇帝': 18,
};

/** 全量头衔映射（军衔 + 政治头衔），供 initAdmirals 等显示层使用 */
const fullTitleMap: Record<string, number> = { ...rankMap, ...POLITIC_TITLE_RANK };

export const RANK_NAMES = Object.fromEntries(Object.entries(fullTitleMap).map(([k, v]) => [v, k]));

/** 解析军阶数值（仅战斗序列 1-13）；政治头衔/未知返回 0（非战斗序列） */
export const getMilitaryRank = (rankName?: string): number => rankMap[rankName ?? ''] ?? 0;

const portraitModules = import.meta.glob('../assets/admirals/*.*', { eager: true, query: '?url', import: 'default' });

const imageMap: Record<string, string> = {};
Object.keys(portraitModules).forEach(key => {
  const fileName = key.split('/').pop()?.toLowerCase(); 
  if (fileName) {
    let rawUrl = portraitModules[key] as string;
    if (typeof rawUrl === 'string' && rawUrl.includes('?')) rawUrl = rawUrl.split('?')[0];
    imageMap[fileName] = rawUrl;
  }
});

export const getPortrait = (imgId: string | number) => {
  if (!imgId) return '';
  const idStr = String(imgId);
  const possibleNames = [`${idStr}.jpg`, `${idStr}.jpeg`, `${idStr}.webp`, `${idStr}.png`];
  for (const name of possibleNames) {
    if (imageMap[name]) return imageMap[name];
  }
  return '';
};

export const useGameStore = defineStore('game', () => {
  // ========== 提督数据 ==========
  // admiralStore 是战略层的唯一数据源（BaseAdmiral 含隐藏属性/位置/伤病）
  // allAdmirals 是战斗层的扩展副本（Admiral 额外含 rank/level/merits/staffs/deck）
  // 两者通过 syncAdmirals 保持同步
  const initAdmirals = (): Admiral[] => admiralsData.map((a: BaseAdmiral) => {
      // 计算特技（若数据中已手动指定则保留，否则自动分配）
      const existingSkills = a.skills || [];
      const assignedIds = existingSkills.length > 0 ? [] : getAdmiralSkills(a.id, a.stats);
      const computedSkills = existingSkills.length > 0
        ? existingSkills
        : assignedIds.map(id => SKILL_MAP[id]).filter(Boolean);
      
      return {
        ...a,
        // P0修复：rank 只承载战斗军衔 1-13；政治头衔（宰相/议会/皇帝）rank 记 0（非战斗序列）
        rank: fullTitleMap[a.rankName] || 1,
        level: 1,
        tacticalMerits: 0,
        adminMerits: 0,
        politicalWork: 0,
        staffs: [] as number[],
        deck: ["" , "", "", "", "", "", "", ""],
        flagshipId: "",
        skills: computedSkills,
      };
  });
  
  const allAdmirals = ref<Admiral[]>([]);
  const dispatchAdmirals = ref<number[]>([]);

  // 玩家状态
  const playerAdmiralId = ref<number>(-1);
  const playerRank = ref<number | string>(1);
  const playerMerit = ref<number>(0);
  const showAdmiralSelect = ref(false);
  const showForcePass = ref(false);
  const showPromotion = ref(false);
  const forcePassProposal = ref<any>(null);
  const promotionData = ref<any>(null);

  // 强制通过提案触发
  const triggerForcePassIfAvailable = (proposal: any) => {
    const pAdm = allAdmirals.value.find((a: any) => a.id === playerAdmiralId.value);
    if (pAdm && (pAdm.politicalWork || 0) >= 1000) {
      forcePassProposal.value = proposal;
      showForcePass.value = true;
    }
  };
  // 执行强制通过
  const handleForcePass = () => {
    if (forcePassProposal.value) {
      executeProposalEffect(forcePassProposal.value, {
        gameStore: useGameStore() as any,
        adminStore: useAdminStore() as any,
        playerFactionId: getPlayerFactionId(),
      });
      const pAdm = allAdmirals.value.find((a: any) => a.id === playerAdmiralId.value);
      if (pAdm) pAdm.politicalWork = Math.max(0, (pAdm.politicalWork || 0) - 1000);
      triggerToast('消耗1000政治工作值，强行通过了提案。');
    }
    forcePassProposal.value = null;
    showForcePass.value = false;
  };
  // 拒绝强制通过
  const handleForcePassDecline = () => {
    forcePassProposal.value = null;
    showForcePass.value = false;
  };

  // ── 结局叙事生成器 ──
  const generateEndingNarrative = (won: boolean, type: string) => {
    const stats = gameStats.value;
    const pAdm = allAdmirals.value.find((a: any) => a.id === playerAdmiralId.value);
    const faction = pAdm?.faction === 'alliance' ? '同盟' : '帝国';
    const name = pAdm?.name || '司令官';
    const narrative = won
      ? (type === 'coup'
          ? `${name} 发动政变，推翻了原有政权。\n\n${stats.admiralsKilled > 0 ? stats.admiralsKilled + '位提督牺牲。' : '奇迹般的零伤亡政变。'}\n战报：${stats.battles}场战役 ${stats.victories}胜`
          : `${faction}在${name}指挥下获胜。\n\n${stats.admiralsKilled > 0 ? stats.admiralsKilled + '位提督战死沙场。' : '零提督阵亡！'}共${stats.battles}战${stats.victories}胜，占领${stats.nodesCaptured}星系。`)
      : `${faction}首都沦陷。${stats.admiralsKilled}位提督殉国。${stats.battles}场战役后战争结束。`;
    endingNarrative.value = narrative;
  };

  // ── 政变系统 ──
  const attemptCoup = (): { success: boolean; message: string } => {
    const pAdm = allAdmirals.value.find((a: any) => a.id === playerAdmiralId.value);
    if (!pAdm || (pAdm.politicalWork || 0) < 8000) {
      return { success: false, message: '政治工作值不足（需要8000）' };
    }
    const coupChance = Math.min(0.7, (pAdm.politicalWork - 8000) / 4000 + 0.3);
    pAdm.politicalWork = Math.max(0, pAdm.politicalWork - 8000);
    if (Math.random() < coupChance) {
      // 政变成功
      gameOver.value = true; isWin.value = true;
      winStatus.value = '政变成功 — 你已成为最高权力者！';
      generateEndingNarrative(true, 'coup');
      return { success: true, message: '政变成功！你推翻了现政权，成为新的统治者。' };
    } else {
      // 政变失败 → 流亡
      pAdm.faction = pAdm.faction === 'alliance' ? 'empire' : 'alliance';
      pAdm.loyalty = 30;
      triggerToast(`${pAdm.name} 政变失败，流亡到${pAdm.faction === 'alliance' ? '同盟' : '帝国'}。`);
      return { success: false, message: '政变失败！你被迫流亡到敌方阵营。' };
    }
  };

  // ========== 存档系统 ==========
  const saveSlots = ref<Record<string, { name: string, timestamp: number, data: any, meta?: { admiralName?: string; admiralFaction?: string; universeDate?: string; gameState?: string } }>>({});
  const SAVE_KEY = 'logh_multisaves_v3';

  const persistSlots = async () => {
      try {
          await SaveGameData(JSON.stringify(saveSlots.value));
      } catch (e) {
          localStorage.setItem(SAVE_KEY, JSON.stringify(saveSlots.value));
      }
  };

  const loadSlotsFromStorage = async () => {
      try {
          const raw = await LoadGameData();
          if (raw) saveSlots.value = JSON.parse(raw);
      } catch (e) {
          const raw = localStorage.getItem(SAVE_KEY);
          if (raw) saveSlots.value = JSON.parse(raw);
      }
  };

  // 从 admiralStore 同步到 allAdmirals（保留战斗层扩展字段）
  function syncAdmiralsFromStore() {
      const admiralStore = useAdmiralStore();
      const baseList = admiralStore.admirals as unknown as BaseAdmiral[];
      allAdmirals.value = baseList.map((a: BaseAdmiral) => {
          const existing = allAdmirals.value.find(ea => ea.id === a.id);
          return {
              ...a,
              rank: existing?.rank ?? fullTitleMap[a.rankName] ?? 1,
              level: existing?.level ?? 1,
              tacticalMerits: existing?.tacticalMerits ?? 0,
              adminMerits: existing?.adminMerits ?? 0,
              staffs: existing?.staffs ?? [],
              deck: existing?.deck ?? ["", "", "", "", "", "", "", ""],
              flagshipId: existing?.flagshipId ?? "",
          } as Admiral;
      });
  }

  // 从 allAdmirals 同步回 admiralStore（保留战略层字段）
  function syncAdmiralsToStore() {
      const admiralStore = useAdmiralStore();
      const newList = allAdmirals.value.map(a => ({
          id: a.id,
          name: a.name,
          faction: a.faction,
          stats: a.stats,
          state: a.state,
          deck: a.deck,
          skills: a.skills || [],
          rankName: a.rankName,
          flagshipName: a.flagshipName,
          imageId: a.imageId,
          hiddenStats: a.hiddenStats || { ambition: 50, righteousness: 50, compatibility: 50 },
          currentNodeId: a.currentNodeId ?? null,
          assignedFleetId: a.assignedFleetId ?? null,
          injury: a.injury || { isInjured: false, severity: 0, recoveryTicks: 0 },
          tags: a.tags || [],
      } as BaseAdmiral));
      (admiralStore as any).$patch((state: any) => {
          state.admirals = newList;
      });
  }

  const saveToSlot = async (slotId: string, slotName: string) => {
      const admiralStore = useAdmiralStore();
      const adminStore = useAdminStore();
      const nodeStore = useNodeStore();
      // v3：同步 localCooldowns 到 adminState 以确保存档序列化
      (adminStore as any).restoreCooldownsFromState?.();
      const saveData = JSON.parse(JSON.stringify({
          factionGold: factionGold.value,
          fezzanGold: fezzanGold.value,
          metaGold: metaGold.value,
          tacticalMerit: tacticalMerit.value,
          adminMerit: adminMerit.value,
          allAdmirals: allAdmirals.value,
          admiralsBase: admiralStore.admirals as unknown as BaseAdmiral[],
          nodes: nodeStore.nodes as unknown as StarNode[],
          customMapsData: customMapsData.value,
          mapsPool: mapsPool.value,
          playerAdmiralId: playerAdmiralId.value,
          playerRank: playerRank.value,
          strategicFleets: strategicFleets.value,
          universeDate: universeDate.value,
          strategicTimeSpeed: strategicTimeSpeed.value,
          gameState: gameState.value,
          strategicMapInitialized: strategicMapInitialized.value,
          adminState: (useAdminStore() as any).adminState,
      }));
      saveSlots.value[slotId] = {
          name: slotName,
          timestamp: Date.now(),
          data: saveData,
          meta: {
              admiralName: (() => {
                  const adm = allAdmirals.value.find(a => a.id === playerAdmiralId.value);
                  return adm ? `${adm.rankName} ${adm.name}` : '未知提督';
              })(),
              admiralFaction: (allAdmirals.value.find(a => a.id === playerAdmiralId.value) as any)?.faction || 'alliance',
              universeDate: universeDate.value || '796.01.01',
              gameState: gameState.value,
          }
      };
      await persistSlots();
      triggerToast(`已保存至：${slotName}`);
  };

  /**
   * 初始化舰队归属：为每个 StrategicFleet 设置 parentCommanderId
   *
   * 委托给 assignFleetByNovel，按小说设定精确匹配 admiral ID：
   * - 帝国：莱因哈特麾下 9 人 → id:81，谬肯贝尔加麾下 8 人 → id:82，
   *         未匹配按 fleetNumber 兜底（≤9 → 谬肯贝尔加，>9 → 莱因哈特）
   * - 同盟：全部 → 罗波斯 (id:164)
   *
   * @param admirals 当前内存中的提督列表
   * @param fleets 当前内存中的舰队列表（会被原地修改 parentCommanderId）
   */
  function initFleetAssignment(admirals: BaseAdmiral[], fleets: StrategicFleet[]) {
    assignFleetByNovel(admirals, fleets);
  }

  function loadFromSlot(id: string) {
    const slot = saveSlots.value[id];
    if (!slot || !slot.data) {
      triggerToast(`读档失败：找不到档案`);
      return;
    }
    try {
      const data = slot.data;
      
      // 【核心修复】：以最新的静态配置表为基准
      const freshAdmirals = JSON.parse(JSON.stringify(admiralsData));
      
      // 将存档中的"动态进度"合并进去，抛弃旧的静态属性（名字、基础属性等）
      if (data.allAdmirals) {
        freshAdmirals.forEach((freshAdm: any) => {
          const savedAdm = data.allAdmirals.find((a: any) => a.id === freshAdm.id);
          if (savedAdm) {
            // 只继承动态数据
            freshAdm.level = savedAdm.level ?? freshAdm.level;
            freshAdm.rank = savedAdm.rank ?? freshAdm.rank;
            freshAdm.rankName = savedAdm.rankName ?? freshAdm.rankName;
            freshAdm.currentNodeId = savedAdm.currentNodeId;
            freshAdm.assignedFleetId = savedAdm.assignedFleetId;
            freshAdm.role = savedAdm.role ?? freshAdm.role;
            if (savedAdm.injury) freshAdm.injury = savedAdm.injury;

            // tags 兼容：优先继承存档中的 tags（新存档已有标签）
            // 旧存档无 tags → freshAdm.tags 已从 admiralsData（T02 预填）获取，无需处理
            if (savedAdm.tags && Array.isArray(savedAdm.tags) && savedAdm.tags.length > 0) {
              freshAdm.tags = savedAdm.tags;
            }

            // 如果提督升过级（Lv>1），将升级带来的额外属性加上去（每次升级全属性+2的逻辑）
            if (savedAdm.level > 1) {
              const bonus = (savedAdm.level - 1) * 2;
              freshAdm.stats.command += bonus;
              freshAdm.stats.operations += bonus;
              freshAdm.stats.attack += bonus;
              freshAdm.stats.defense += bonus;
            }
          }
        });
      }
      
      // 覆写内存状态
      allAdmirals.value = freshAdmirals;
      playerAdmiralId.value = data.playerAdmiralId ?? -1;
      if (data.factionGold) factionGold.value = data.factionGold;
      else metaGold.value = data.metaGold || 10000; // 旧档兼容
      if (typeof data.fezzanGold === 'number') fezzanGold.value = data.fezzanGold; // 费沙金库（旧档无此字段则用初始值）
      tacticalMerit.value = data.tacticalMerit || 0;
      adminMerit.value = data.adminMerit || 0;
      universeDate.value = data.universeDate || '796.01.01';

      // v3 存档兼容：过滤已删除类型的 pendingProposals（tax/logistics/tech_mobilize/intel_op/diplomat_op）
      const DELETED_PROPOSAL_TYPES = ['tax', 'logistics', 'tech_mobilize', 'intel_op', 'diplomat_op'];
      activeProposals.value = (data.activeProposals || []).filter((p: any) => !DELETED_PROPOSAL_TYPES.includes(p.type));
      pendingProposals.value = (data.pendingProposals || []).filter((p: any) => !DELETED_PROPOSAL_TYPES.includes(p.type));
      councilPendingCount.value = pendingProposals.value.length;

      // v3 存档兼容：StarNode 字段填充
      const loadedNodes: StarNode[] = (data.strategicNodes || []).map((n: any) => ({
        ...n,
        fortified: n.fortified ?? false,
        revealedUntil: n.revealedUntil ?? undefined,
      }));
      strategicNodes.value = loadedNodes;

      // StrategicFleet 兼容：旧存档可能无 parentCommanderId / fleetNumber / 新舰种 字段
      const loadedFleets: StrategicFleet[] = (data.strategicFleets || []).map((f: any) => ({
        ...f,
        parentCommanderId: f.parentCommanderId ?? null,
        fleetNumber: f.fleetNumber ?? 0,
        composition: {
          battleships: f.composition?.battleships ?? 0,
          fastBattleships: f.composition?.fastBattleships ?? 0,
          cruisers: f.composition?.cruisers ?? 0,
          destroyers: f.composition?.destroyers ?? 0,
          carriers: f.composition?.carriers ?? 0,
          fighters: f.composition?.fighters ?? 0,
        },
        formation: f.formation ?? DEFAULT_FORMATION,
      }));
      strategicFleets.value = loadedFleets;

      // 补全舰队归属（即使旧存档的 fleetNumber=0，也能按索引分割）
      initFleetAssignment(allAdmirals.value as unknown as BaseAdmiral[], strategicFleets.value);

      // v3 存档兼容：恢复 adminState（含 localCooldowns）
      if (data.adminState) {
        const adminStore = useAdminStore();
        (adminStore as any).adminState = data.adminState;
        // 确保 localCooldowns 字段存在
        if (!(adminStore as any).adminState.localCooldowns) {
          (adminStore as any).adminState.localCooldowns = {};
        }
        (adminStore as any).restoreCooldownsFromState?.();
      }

      strategicMapInitialized.value = data.strategicMapInitialized ?? true;

      // 存档加载后进入战略地图（strategicMapInitialized 保持存档值，initStrategicMap 会跳过）
      if (playerAdmiralId.value >= 0) {
          strategicMapVersion.value++;
          gameState.value = 'strategy';
      }

      triggerToast(`成功读取档案`);
    } catch (e) {
      triggerToast(`读档失败：存档文件损坏`);
    }
  }

  const deleteSlot = async (slotId: string) => {
      delete saveSlots.value[slotId];
      await persistSlots();
      triggerToast(`档案已销毁`);
  };

  const createNewSlot = async (slotId: string, slotName: string) => {
      const admiralStore = useAdmiralStore();
      const nodeStore = useNodeStore();
      const saveData = JSON.parse(JSON.stringify({
          factionGold: factionGold.value,
          fezzanGold: fezzanGold.value,
          metaGold: metaGold.value,
          tacticalMerit: tacticalMerit.value,
          adminMerit: adminMerit.value,
          allAdmirals: allAdmirals.value,
          admiralsBase: admiralStore.admirals as unknown as BaseAdmiral[],
          nodes: nodeStore.nodes as unknown as StarNode[],
          customMapsData: customMapsData.value,
          mapsPool: mapsPool.value,
          playerAdmiralId: playerAdmiralId.value,
          playerRank: playerRank.value,
          strategicFleets: strategicFleets.value,
          universeDate: universeDate.value,
          strategicTimeSpeed: strategicTimeSpeed.value,
          gameState: gameState.value,
          strategicMapInitialized: strategicMapInitialized.value,
          adminState: (useAdminStore() as any).adminState,
      }));
      saveSlots.value[slotId] = {
          name: slotName,
          timestamp: Date.now(),
          data: saveData,
          meta: {
              admiralName: (() => {
                  const adm = allAdmirals.value.find(a => a.id === playerAdmiralId.value);
                  return adm ? `${adm.rankName} ${adm.name}` : '未知提督';
              })(),
              admiralFaction: ((admiralStore.admirals as unknown as any[]) || []).find((a: any) => a.id === playerAdmiralId.value)?.faction || 'alliance',
              universeDate: universeDate.value || '796.01.01',
              gameState: gameState.value,
          }
      };
      await persistSlots();
      triggerToast(`新档案已创建：${slotName}`);
  };

  const autoSave = () => { saveToSlot('autosave', '系统自动存档'); };

  // ========== UI / 通用状态 ==========
  const isDataLoaded = ref(false);
  const toastMessage = ref("");

  const battleDialog = ref({ imageId: '', name: '', text: '', visible: false });
  let dialogTimer: any = null;
  const showDialog = (imageId: string, name: string, text: string) => {
    battleDialog.value = { imageId, name, text, visible: true };
    if (dialogTimer) clearTimeout(dialogTimer);
    dialogTimer = setTimeout(() => { battleDialog.value.visible = false; }, 4000);
  };

  const isCastingBomb = ref(false);
  const isSidebarCollapsed = ref(false);
  const gameState = ref<'title' | 'menu' | 'editor' | 'game' | 'strategy' | 'sim'>('title');
  const menuTab = ref<'battle' | 'barracks' | 'command'>('battle');
  const strategyTab = ref<'starmap' | 'battle' | 'command' | 'barracks'>('starmap');

  // ========== 阶段一：战略全局时间轴 ==========
  const strategicNodes = ref<StarNode[]>([]);
  const strategicFleets = ref<StrategicFleet[]>([]);
  const universeDate = ref<string>('796.01.01'); 
  const strategicTimeSpeed = ref<number>(1.0);
  const selectedFleetId = ref<number | null>(null); // 大地图上当前选中的舰队 ID

  // ===== 阶段六：Warp 移动系统常量 =====
  const WARP_CONSTANTS = {
    WARP_SPEED_PX_PER_DAY: 160,
    OCCUPATION_DAYS: 1,
    OCCUPATION_SHIP_LOSS_RATIO: 0.08,
  } as const;

  const AUTO_RESOLVE_DEFAULTS: AutoResolveParams = {
    typeCoeff: { battleships: 4.0, fast_battleships: 3.2, cruisers: 2.5, destroyers: 1.5, carriers: 2.0, fighters: 1.0 },
    commandMod: 1.0,
    attackMod: 1.0,
    defenseMod: 1.0,
    moraleFactor: 1.0,
    fortressBonus: 1.5,
  };

  const strategicPaused = ref(false);
  // 用户手动暂停标志：区分"玩家点暂停"和"系统自动暂停（抵达/战报等）"
  // 安全阀只清理系统暂停，不清理用户手动暂停
  const userPaused = ref(false);
  const pendingArrival = ref<ArrivalContext | null>(null);
  const pendingPostBattle = ref<PostBattleContext | null>(null);
  const arrivalQueue = ref<ArrivalContext[]>([]);
  const aiTurnCounter = ref(0); // 基础 AI 行动节拍计数器
  // 战后处置三选一（占领/掠夺/解放），仅玩家触发
  const pendingCaptureDecision = ref<{ fleetId: number; nodeId: number } | null>(null);

  
  // ================= 阶段三：军议与提案系统 =================
  const showCouncilModal = ref<boolean>(false);
  const showAdminPanel = ref<boolean>(false); // [T06] 行政院侧滑面板开关
  const activeProposals = ref<any[]>([]); // 存储当期历史提案
  // [T04] 非侵入式军议系统状态
  const pendingProposals = ref<any[]>([]);      // 待处理提案队列
  const councilPendingCount = ref(0);            // 待处理提案计数
  const councilHistory = ref<any[]>([]);         // 军议历史记录（最近20条）
  const showCouncilPanel = ref(false);           // 提案面板开关（手动打开）
  const councilMode = ref<'military' | 'political'>('military'); // P2：军事/政略分流

  // ===== P1 链式指挥链提案引擎 =====
  const pendingProposalsV2 = ref<ProposalV2[]>([]); // 待批复提案队列

  interface ProposalV2 {
    id: number;
    proposerId: number;
    proposerName: string;
    superiorId: number;
    superiorName: string;
    type: string;              // 操作类型：planet_op / invasion / budget / personnel
    title: string;             // 显示标题
    description: string;       // 说明文字
    nodeId?: number;           // 关联星球
    responseDeadlineTick: number; // 批复截止 tick
    status: 'pending' | 'approved' | 'rejected';
    onApproved?: () => void;   // 批准后执行的回调（临时绑定，不可序列化）
  }

  // ===== v3 新增：二次确认弹窗 =====
  const pendingConfirm = ref<{ title: string; message: string; cost: number; onConfirm: () => void } | null>(null);

  /** 发起二次确认（≥₮2000 操作调用） */
  const requestConfirm = (title: string, message: string, cost: number, onConfirm: () => void) => {
    pendingConfirm.value = { title, message, cost, onConfirm };
  };

  /** 处理确认/取消 */
  const resolveConfirm = (approved: boolean) => {
    const req = pendingConfirm.value;
    if (!req) return;
    pendingConfirm.value = null;
    if (approved) {
      req.onConfirm();
    }
  };

  // ===== 战术层状态：战役接触后序列化数据的中转站 =====
  // mode: 'campaign' = 大地图战略会战 | 'skirmish' = 主界面独立演习小游戏
  const tacticalState = ref<{
    mode: 'campaign' | 'skirmish';
    battleNodeId?: number;
    battleId?: string;
    attackers: any[];
    defenders: any[];
    mapStyle?: 'hex' | 'crt' | '3d' | 'command';
  } | null>({ mode: 'skirmish', attackers: [], defenders: [] });

  // ===== 战术模拟（独立小游戏模式）=====
  // sim 模式数据与主游戏完全隔离，拥有独立的提督选择、舰队配置和敌方生成逻辑
  const simMode = ref<boolean>(false);
  const simFactionId = ref<string>('empire');
  const simActiveFactionCount = ref<number>(1);
  const simSelectedAdmirals = ref<number[]>([]);

  // 按军衔生成满编舰队 composition（总舰数=getShipLimit，按比例拆分舰种）
  const generateSimFullComposition = (rank: number): FleetComposition => {
    const total = getShipLimit(rank);
    if (rank <= 8)      return { battleships: Math.floor(total * 0.1), fastBattleships: 0, cruisers: Math.floor(total * 0.3), destroyers: Math.floor(total * 0.4), carriers: 0, fighters: Math.floor(total * 0.15), supplies: Math.max(1, Math.floor(total * 0.05)) };
    if (rank <= 9)      return { battleships: Math.floor(total * 0.2), fastBattleships: 0, cruisers: Math.floor(total * 0.3), destroyers: Math.floor(total * 0.3), carriers: Math.floor(total * 0.05), fighters: Math.floor(total * 0.1), supplies: Math.max(1, Math.floor(total * 0.05)) };
    if (rank <= 10)     return { battleships: Math.floor(total * 0.3), fastBattleships: Math.floor(total * 0.1), cruisers: Math.floor(total * 0.25), destroyers: Math.floor(total * 0.2), carriers: Math.floor(total * 0.05), fighters: Math.floor(total * 0.05), supplies: Math.max(1, Math.floor(total * 0.05)) };
    if (rank <= 11)     return { battleships: Math.floor(total * 0.4), fastBattleships: Math.floor(total * 0.1), cruisers: Math.floor(total * 0.2), destroyers: Math.floor(total * 0.15), carriers: Math.floor(total * 0.05), fighters: Math.floor(total * 0.05), supplies: Math.max(1, Math.floor(total * 0.05)) };
    // 保底 ≥1：rank12/13+ 此前连 supplies 字段都没有（undefined→无补给舰槽位→后勤战在高军衔档根本无法演示）
    if (rank <= 12)     return { battleships: Math.floor(total * 0.5), fastBattleships: Math.floor(total * 0.15), cruisers: Math.floor(total * 0.2), destroyers: Math.floor(total * 0.1), carriers: Math.floor(total * 0.03), fighters: Math.floor(total * 0.02), supplies: Math.max(1, Math.floor(total * 0.05)) };
    return { battleships: Math.floor(total * 0.55), fastBattleships: Math.floor(total * 0.2), cruisers: Math.floor(total * 0.15), destroyers: Math.floor(total * 0.05), carriers: Math.floor(total * 0.03), fighters: Math.floor(total * 0.02), supplies: Math.max(1, Math.floor(total * 0.05)) };
  };

  const enterSimMode = () => {
    simMode.value = true;
    simSelectedAdmirals.value = [];
    simFactionId.value = 'all'; // 默认：敌方全阵营随机
    simActiveFactionCount.value = 1;
  };

  const exitSimMode = () => {
    simMode.value = false;
    simSelectedAdmirals.value = [];
    selectedMapId.value = 'random'; // 恢复默认地图
  };

  // 战术模拟的出击启动：构建双方满编舰队 → 序列化 → 写入 tacticalState → 启动战斗
  const launchSimBattle = (mapStyle: 'hex' | 'crt' | '3d' | 'command' = 'command') => {
    if (simSelectedAdmirals.value.length === 0) {
      triggerToast('必须指派至少一名提督出战');
      return;
    }

    // 加载基准提督数据（从 admiralStore 获取隐藏属性）
    const admiralStore = useAdmiralStore();
    const baseAdmirals = admiralStore.admirals as unknown as BaseAdmiral[];

    // 确定玩家阵营 factionId（玩家舰队统一归入 faction 1/2）
    const firstAdm = baseAdmirals.find(a => a.id === simSelectedAdmirals.value[0]);
    const playerFactionId = firstAdm?.faction === 'empire' ? 2 : 1;

    // 构建模拟攻击方（玩家舰队）
    const simFleetId = 9000;
    const mockAttackers: any[] = simSelectedAdmirals.value.map((admId, idx) => {
      const adm = baseAdmirals.find(a => a.id === admId);
      if (!adm) return null;
      const rank = fullTitleMap[adm.rankName] || 9;
      const comp = generateSimFullComposition(rank);
      return {
        id: simFleetId + idx,
        factionId: playerFactionId,
        commanderId: adm.id,
        currentNodeId: 1,
        targetNodeId: null,
        prevNodeId: null,
        warpTargetId: null,
        warpOriginId: null,
        etaDay: null,
        status: 'idle' as const,
        moveProgress: 0,
        composition: comp,
        tacticalSlots: [],
        morale: 100,
        supply: 100,
        supplyDistance: 0,
        formation: DEFAULT_FORMATION,
      };
    }).filter(Boolean);

    // 生成模拟防守方（AI 敌军）：根据 simFactionId 确定敌方势力
    // 'empire' → 敌军从帝国抽 / 'alliance' → 敌军从同盟抽 / 'all' → 混合随机
    const enemyTargetFaction = simFactionId.value;
    let enemyPool = baseAdmirals
      .filter(a => (fullTitleMap[a.rankName] || 0) >= 8); // 准将以上
    
    if (enemyTargetFaction === 'empire') {
      enemyPool = enemyPool.filter(a => a.faction === 'empire');
    } else if (enemyTargetFaction === 'alliance') {
      enemyPool = enemyPool.filter(a => a.faction === 'alliance');
    }
    // 'all' → 不过滤，全阵营随机
    
    enemyPool.sort(() => Math.random() - 0.5);
    
    // 确定敌方 factionId（用于战场渲染）
    const enemyFactionId = enemyTargetFaction === 'empire' ? 2 : (enemyTargetFaction === 'alliance' ? 1 : 2);

    const enemyCount = simActiveFactionCount.value;
    const mockDefenders: any[] = [];
    for (let i = 0; i < enemyCount; i++) {
      const eAdm = enemyPool[i];
      if (!eAdm) continue;
      const rank = fullTitleMap[eAdm.rankName] || 9;
      const comp = generateSimFullComposition(rank);
      mockDefenders.push({
        id: 9100 + i,
        factionId: enemyFactionId,
        commanderId: eAdm.id,
        currentNodeId: 1,
        targetNodeId: null,
        prevNodeId: null,
        warpTargetId: null,
        warpOriginId: null,
        etaDay: null,
        status: 'idle' as const,
        moveProgress: 0,
        composition: comp,
        tacticalSlots: [],
        morale: 100,
        supply: 100,
        supplyDistance: 0,
        formation: DEFAULT_FORMATION,
      });
    }

    // 写入战术中转站（skirmish 模式走 spawnInitialFleets，attackers/defenders 仅作记录）
    tacticalState.value = {
      mode: 'skirmish',
      attackers: [],
      defenders: [],
      mapStyle: mapStyle,
    };
    // 注入战斗层所需的状态变量（供 BattleScene.initFactions 读取）
    dispatchAdmirals.value = simSelectedAdmirals.value;
    selectedFactionId.value = firstAdm?.faction || 'empire';
    activeFactionCount.value = enemyCount;
    selectedDiff.value = 'normal';

    // 启动战斗引擎
    gameState.value = 'game';
    gameOver.value = false;
    isWin.value = false;
    winStatus.value = '';
    // 游戏统计
    gameStats.value = { battles: 0, victories: 0, nodesCaptured: 0, admiralsKilled: 0 };
    isPaused.value = false;
    rewardGold.value = 0;

    triggerToast(`战术模拟启动：${firstAdm?.name || '指挥官'}率领 ${mockAttackers.length} 支舰队迎战 ${enemyCount} 支敌军`);
  };

  // ===== 职权权限映射表 (对抗审查：补全同盟侧等效职务) =====
  const RolePermissions: Record<string, string[]> = {
    'emperor':             ['budget', 'invasion', 'defense'],
    'prime_minister':      ['budget', 'defense'],
    'council':             ['budget', 'defense'],
    'military_minister':   ['budget', 'invasion', 'defense'],
    'high_command_chief':  ['invasion', 'defense'],
    'joint_ops_chief':     ['invasion', 'defense'],
    'space_fleet_commander': ['invasion', 'defense'],
    'space_fleet_deputy':  ['invasion', 'defense'],
    'joint_ops_deputy':    ['invasion', 'defense'],
    'intel_minister':      ['defense'],
    'defense_commander':   ['defense'],
    'fleet_commander':     ['invasion'],
    'fleet_staff':          [],
    'none':                 [],
  };

  // 职务权重映射表
  const roleWeightMap: Record<string, number> = {
      'emperor': 1000,
      'prime_minister': 100, 'council': 100,
      'military_minister': 80, 'high_command_chief': 80, 'joint_ops_chief': 80,
      'space_fleet_commander': 60, 'joint_ops_deputy': 50, 'space_fleet_deputy': 50,
      'intel_minister': 40, 'defense_commander': 20,
      'fleet_commander': 10, 'fleet_staff': 2, 'none': 0
  };

  // AI 投票算法：基于 tags 标签驱动 + 职务倾向 + 随机扰动
  const calculateAIVote = (voter: BaseAdmiral, proposalType: string, proposer: BaseAdmiral) => {
    const voterTags = voter.tags || [];
    const proposerTags = proposer.tags || [];
    const pType = proposalType as ProposalType;

    // 基础值 50，及格线 60
    let score = 50;

    // 1. 政治标签系数：遍历 voter.tags 中的政治标签，查 POLITICAL_VOTE_COEFFICIENTS[tag][proposalType] 累加
    let politicalSum = 0;
    for (const tag of voterTags) {
      if (isPoliticalTag(tag)) {
        const coef = POLITICAL_VOTE_COEFFICIENTS[tag]?.[pType];
        if (coef !== undefined) {
          politicalSum += coef;
        }
      }
    }
    score += politicalSum * 30;  // 政治系数 ×30

    // 2. 标签兼容性：voter 与 proposer 的标签兼容性 (-20 ~ +20)
    score += calculateTagCompatibility(voterTags, proposerTags);

    // 3. 人格修正：遍历 voter.tags 的人格标签，查 PERSONALITY_MODIFIERS[tag].proposalMod 累加
    const voterPersonalityTags = getTagsByCategory(voterTags, 'personality');
    for (const tag of voterPersonalityTags) {
      const mod = PERSONALITY_MODIFIERS[tag as PersonalityTag];
      if (mod) {
        score += mod.proposalMod;
      }
    }

    // 4. 职务影响（保留现有逻辑）：从 ROLE_VOTE_INFLUENCE 查询
    const voterRole = voter.role as string;
    const roleInfluence = ROLE_VOTE_INFLUENCE[voterRole]?.[pType];
    if (roleInfluence !== undefined) {
      score += roleInfluence;
    }

    // 5. budget 特殊处理：提案人投自己 +100
    if (pType === 'budget' && voter.id === proposer.id) {
      score += 100;
    }

    // 6. 随机扰动 (±10)
    score += (Math.random() * 20 - 10);

    return score >= 60;
  };

  // 权重式权重表（政治头衔无军议权重：fullTitleMap 中宰相14/议会15/皇帝18 仍会走 >=12 分支 → 单独拦截）
  const getRankWeight = (rankName: string) => {
    const r = fullTitleMap[rankName] || 0;
    if (rankName === '元帅') return 5;
    if (rankName === '宰相' || rankName === '议会' || rankName === '皇帝') return 0; // 政治头衔不参与军议军衔权重
    if (r >= 12) return 5; // 一级上将/元帅
    if (r >= 10) return 3; // 中将/上将
    if (r >= 8) return 1;  // 准将/少将
    return 0;
  };

  const submitProposal = (type: string, targetNodeId?: number) => {
    const admiralStore = useAdmiralStore();
    const admList = admiralStore.admirals as unknown as BaseAdmiral[];
    const pAdm = admList.find(a => a.id === playerAdmiralId.value);
    if (!pAdm) return false;

    // 1. 职权权限校验（使用 roleConfig 的 canPropose）
    // 权限不足 → 自动转 v2 上报链（呈递上司请示），而非死胡同 toast
    if (!canPropose(pAdm, type as ProposalType)) {
      const def = PROPOSAL_DEFINITIONS[type as ProposalType];
      submitEscalatedProposalV2(
        pAdm, type,
        def?.name || type,
        def?.description || '（详情见军议提案）',
        targetNodeId,
        undefined // 批准后由 processProposalV2 的 commsMessage 通知，玩家再行处理
      );
      return false;
    }

    let support = 0;
    let oppose = 0;
    let vetoed = false;

    // 唱票明细：每位参与投票提督的 {姓名, 赞成/反对, 权重分}，让 calculateAIVote 的人格计算可见
    const voteBreakdown: { name: string; support: boolean; weight: number }[] = [];

    const factionAdmirals = admList.filter(a => a.faction === pAdm.faction);

    factionAdmirals.forEach(adm => {
      const admRole = adm.role as string;
      const weight = roleWeightMap[admRole] || getRankWeight(adm.rankName);
      if (weight <= 0) return;

      const isSupport = calculateAIVote(adm, type, pAdm);

      if (isSupport) {
        support += weight;
        voteBreakdown.push({ name: `${adm.rankName} ${adm.name}`, support: true, weight });
      } else {
        oppose += weight;
        voteBreakdown.push({ name: `${adm.rankName} ${adm.name}`, support: false, weight });
        if (type === 'budget' && ['military_minister', 'council'].includes(admRole)) vetoed = true;
        if (type === 'invasion' && ['high_command_chief', 'joint_ops_chief'].includes(admRole)) vetoed = true;
      }
    });

    // 玩家提案自带本人军阶权重赞成票
    const playerWeight = roleWeightMap[pAdm.role] || getRankWeight(pAdm.rankName);
    support += playerWeight;
    if (playerWeight > 0) {
      voteBreakdown.unshift({ name: `${pAdm.rankName} ${pAdm.name}（提案人）`, support: true, weight: playerWeight });
    }

    const isApproved = (support > oppose) && !vetoed;

    // 构造提案对象（用于效果执行和历史记录）
    const proposal: any = {
      id: Date.now(),
      type,
      targetNodeId,
      proposerId: pAdm.id,
      factionId: pAdm.faction === 'alliance' ? 1 : 2,
      supportWeight: support,
      opposeWeight: oppose,
      status: isApproved ? 'approved' : 'rejected',
      createdAt: universeDate.value,
      resolvedDate: universeDate.value,
      vetoedBy: vetoed ? '上级职能长官' : null,
      voteBreakdown, // 唱票明细随提案进入历史记录
    };

    // [T04] 提案效果执行引擎集成
    const adminStore = useAdminStore();
    const pFactionId = pAdm.faction === 'alliance' ? 1 : 2;
    const ctx = { gameStore: null as any, adminStore, playerFactionId: pFactionId };
    // gameStore 指向自身（通过闭包变量），构造一个精简代理对象
    const gameStoreProxy = {
      get strategicFleets() { return strategicFleets.value; },
      get strategicNodes() { return strategicNodes.value; },
      get metaGold() { return metaGold.value; },
      set metaGold(v: number) { metaGold.value = v; },
      get universeDate() { return universeDate.value; },
      triggerToast: (msg: string) => triggerToast(msg),
    };
    ctx.gameStore = gameStoreProxy;

    if (isApproved) {
      executeProposalEffect(proposal, ctx);
      adminMerit.value += 150; // 议会提案通过行政功勋
      // PP: 提案通过=政治资本+200
      const pAdmProp = allAdmirals.value.find((a: any) => a.id === playerAdmiralId.value);
      if (pAdmProp) pAdmProp.politicalWork = (pAdmProp.politicalWork || 0) + 200;
      councilHistory.value.unshift({ ...proposal, status: 'approved', resolvedDate: universeDate.value });
    } else {
      executeProposalRejection(proposal, ctx);
      councilHistory.value.unshift({ ...proposal, status: 'rejected', resolvedDate: universeDate.value });
      // 触发强行通过面板（若玩家PP≥1000）
      triggerForcePassIfAvailable(proposal);
    }
    if (councilHistory.value.length > 20) {
      councilHistory.value = councilHistory.value.slice(0, 20);
    }

    activeProposals.value.unshift({
      id: proposal.id,
      type,
      targetNodeId,
      support,
      oppose,
      status: isApproved ? 'approved' : 'rejected',
      date: universeDate.value,
      vetoedBy: vetoed ? '上级职能长官' : null,
      voteBreakdown, // 唱票明细
    });

    return isApproved;
  };

  // [T04] 删除 triggerCouncilMeeting 强制弹窗逻辑，改为非侵入式月度提案生成
  // 辅助：获取玩家阵营 ID
  const getPlayerFactionId = (): number => {
    const admiralStore = useAdmiralStore();
    const pAdm = (admiralStore.admirals as unknown as any[]).find(a => a.id === playerAdmiralId.value);
    return pAdm?.faction === 'alliance' ? 1 : 2;
  };

  // [T04] 解决议案：approved=true 提交军议投票，approved=false 玩家直接否决
  const resolveProposal = (proposalIdx: number, approved: boolean) => {
    const proposal = pendingProposals.value[proposalIdx];
    if (!proposal) return;
    if (approved) {
      submitProposal(proposal.type, proposal.targetNodeId);
    } else {
      // 玩家直接否决：不进入投票流程，记录到历史
      councilHistory.value.unshift({ ...proposal, status: 'player_rejected', resolvedDate: universeDate.value });
      if (councilHistory.value.length > 20) councilHistory.value = councilHistory.value.slice(0, 20);
      triggerToast(`提案「${proposal.title || proposal.type}」已被否决`);
    }
    pendingProposals.value.splice(proposalIdx, 1);
    councilPendingCount.value = Math.max(0, councilPendingCount.value - 1);
  };

  // ===== P1 链式指挥链提案（v2）=====
  /**
   * 权限不足时自动向上司呈递提案（v2 上报链）。
   * 设计依据 proposal_refactor_design.md 2.2 铁律：权限不够 → 自动向上司提案 → 等待批复。
   * 越级请示有额外审批惩罚（上司对越级者信任更低），体现体制的阻力而非系统的拒绝。
   */
  const submitEscalatedProposalV2 = (
    pAdm: BaseAdmiral, type: string, title: string, description: string,
    nodeId: number | undefined, onApproved?: () => void
  ) => {
    const admiralStore = useAdmiralStore();
    const admList = (admiralStore.admirals as unknown as BaseAdmiral[]);

    // 沿指挥链查找上司
    let superior: BaseAdmiral | null = null;
    if (pAdm.role === 'fleet_commander') {
      const myFleet = strategicFleets.value.find(
        f => f.commanderId === pAdm.id && f.factionId === (pAdm.faction === 'alliance' ? 1 : 2)
      );
      if (myFleet && myFleet.parentCommanderId) {
        superior = admList.find(a => a.id === myFleet.parentCommanderId) || null;
      }
    }
    if (!superior) {
      superior = findSuperior(pAdm, admList);
    }

    if (!superior) {
      // 指挥链尽头（如参谋/无职军官且无人可呈递）——保持明确拒绝
      const roleName = pAdm.role === 'fleet_commander' ? '分舰队司令'
                     : pAdm.role === 'fleet_staff' ? '参谋'
                     : pAdm.role === 'none' ? '无职军官'
                     : pAdm.role;
      triggerToast(`以${roleName}的职权，无权发起此项提案，且指挥链上无上司可呈递。需更高军阶或要职方可提出。`);
      return;
    }

    // 审批延迟 2-5 天（越级请示流程更慢）
    const delayTicks = (2 + Math.floor(Math.random() * 4)) * TICKS_PER_DAY;
    const proposal: ProposalV2 = {
      id: Date.now(),
      proposerId: pAdm.id,
      proposerName: `${pAdm.rankName} ${pAdm.name}`,
      superiorId: superior.id,
      superiorName: `${superior.rankName} ${superior.name}`,
      type,
      title,
      description,
      nodeId,
      responseDeadlineTick: totalTicks.value + delayTicks,
      status: 'pending',
      onApproved,
    };
    pendingProposalsV2.value.push(proposal);
    triggerToast(`以${pAdm.rankName}${pAdm.name}的职权尚无权发起此项提案，已作为请示呈递至 ${proposal.superiorName}，等待批复（2-5日）。`);
  };

  const submitProposalV2 = (opts: {
    type: string; title: string; description: string;
    nodeId?: number; onApproved?: () => void;
  }) => {
    const admiralStore = useAdmiralStore();
    const admList = (admiralStore.admirals as unknown as BaseAdmiral[]);
    const pAdm = admList.find(a => a.id === playerAdmiralId.value);
    if (!pAdm) return;

    // v2 权限校验：权限不足时自动转为向上司呈递的请示提案（设计铁律：
    // 权限够→直接执行；权限不够→走审批链，而非死胡同 toast）
    if (!canPropose(pAdm, opts.type as ProposalType)) {
      submitEscalatedProposalV2(pAdm, opts.type, opts.title, opts.description, opts.nodeId, opts.onApproved);
      return;
    }

    let superior: BaseAdmiral | null = null;
    if (pAdm.role === 'fleet_commander') {
      const myFleet = strategicFleets.value.find(
        f => f.commanderId === pAdm.id && f.factionId === (pAdm.faction === 'alliance' ? 1 : 2)
      );
      if (myFleet && myFleet.parentCommanderId) {
        superior = admList.find(a => a.id === myFleet.parentCommanderId) || null;
      }
    }

    // 其他角色 → 按指挥链查找
    if (!superior) {
      superior = findSuperior(pAdm, admList);
    }

    if (!superior) {
      triggerToast(`全军令：${opts.title} — 即刻执行。`);
      if (opts.onApproved) opts.onApproved();
      return;
    }

    // 审批延迟 1-3 天
    const delayTicks = (1 + Math.floor(Math.random() * 3)) * TICKS_PER_DAY;
    const proposal: ProposalV2 = {
      id: Date.now(),
      proposerId: pAdm.id,
      proposerName: `${pAdm.rankName} ${pAdm.name}`,
      superiorId: superior.id,
      superiorName: `${superior.rankName} ${superior.name}`,
      type: opts.type,
      title: opts.title,
      description: opts.description,
      nodeId: opts.nodeId,
      responseDeadlineTick: totalTicks.value + delayTicks,
      status: 'pending',
      onApproved: opts.onApproved,
    };
    pendingProposalsV2.value.push(proposal);
    triggerToast(`提案已提交至 ${proposal.superiorName}，请等候批复。`);
  };

  /** 获取当前玩家的完整权限状态（用于UI显示权限受限信息） */
  const playerPermissions = computed(() => {
    const admiralStore = useAdmiralStore();
    const admList = (admiralStore.admirals as unknown as BaseAdmiral[]);
    const pAdm = admList.find(a => a.id === playerAdmiralId.value);
    if (!pAdm) {
      return {
        role: 'none' as NationalRole,
        roleName: '未任命',
        fleetAuthority: 'none' as 'all' | 'group' | 'station' | 'self' | 'none',
        allowedProposals: [] as ProposalType[],
        allowedAdminOps: [] as AdminOperationType[],
        allowedLocalOps: [] as LocalOperationType[],
        allowedEnemyOps: [] as EnemyOpType[],
      };
    }
    const role = pAdm.role;
    return {
      role,
      roleName: role,
      fleetAuthority: (ROLE_FLEET_AUTHORITY[role] || 'none') as 'all' | 'group' | 'station' | 'self' | 'none',
      allowedProposals: (ROLE_PERMISSIONS_V2[role] || []) as ProposalType[],
      allowedAdminOps: (ROLE_ADMIN_PERMISSIONS[role] || []) as AdminOperationType[],
      allowedLocalOps: (ROLE_LOCAL_PERMISSIONS[role] || []) as LocalOperationType[],
      allowedEnemyOps: (ROLE_ENEMY_PERMISSIONS[role] || []) as EnemyOpType[],
    };
  });

  /** 处理待批复提案的 AI 决议 */
  const processProposalV2 = (proposal: ProposalV2) => {
    const admiralStore = useAdmiralStore();
    const admList = (admiralStore.admirals as unknown as BaseAdmiral[]);
    const superior = admList.find(a => a.id === proposal.superiorId);
    const proposer = admList.find(a => a.id === proposal.proposerId);
    if (!superior) { proposal.status = 'approved'; return; }

    // AI 决策：基于政治倾向矩阵（POLITICAL_VOTE_COEFFICIENTS）、标签匹配、战略环境
    const supTags = superior.tags || [];
    const propTags = proposer?.tags || [];

    // ── 主轴：上级政治标签 × 提案类型 → 倾向系数（tagConfig 7×7 矩阵）──
    // POLITICAL_VOTE_COEFFICIENTS 语义：政治标签 tag 对提案类型 pt 的支持倾向（-0.5 ~ +0.5）
    let politicalMod = 0;
    {
      let politicalSum = 0;
      let politicalTagCount = 0;
      for (const tag of supTags) {
        if (isPoliticalTag(tag)) {
          const coef = POLITICAL_VOTE_COEFFICIENTS[tag]?.[proposal.type as ProposalType];
          if (coef !== undefined) politicalSum += coef;
          politicalTagCount++;
        }
      }
      // 取均值后 ×20 转为概率修正：和平派 vs 侵攻 = -0.4×20 = -8%；
      // 军国派 vs 侵攻/征兵 = +0.5×20 = +10%。政治标签上限为 1，均值即原值。
      if (politicalTagCount > 0) politicalMod = (politicalSum / politicalTagCount) * 20;
    }

    let approvalChance = 0.5 + politicalMod;

    // 标签匹配度（保留但降权：原 ×0.15 → ×0.05，政治倾向为主轴）
    const sharedTags = supTags.filter(t => propTags.includes(t));
    approvalChance += sharedTags.length * 0.05;

    // 上下级关系
    if ((superior as any).loyalty >= 70) approvalChance += 0.15;
    if ((superior.hiddenStats?.ambition ?? 0) > 80) approvalChance -= 0.15; // 野心家不喜欢下属抢功

    // 战略环境
    if (proposal.type === 'planet_op' && metaGold.value < 50000) approvalChance -= 0.2;

    // 最终决策
    const approved = Math.random() < Math.min(0.95, Math.max(0.05, approvalChance));
    proposal.status = approved ? 'approved' : 'rejected';

    // 通讯员通知（驳回理由按上级主导标签差异化）
    const resultText = approved ? '已批准' : '已驳回';
    const reasonText = approved ? '' : `（${getSuperiorRejectionReason(superior, proposal.type)}）`;
    commsMessage.value = {
      visible: true,
      title: `提案批复 — ${proposal.title}`,
      message: `${proposal.superiorName} 对 ${proposal.proposerName} 的提案 "${proposal.title}" 作出批复：${resultText}。${reasonText}`,
      faction: superior.faction || 'alliance',
      officerTitle: superior.faction === 'alliance'
        ? `同盟统合作战本部 通讯官`
        : `帝国军务省 通讯少尉 艾密尔`,
      portraitId: superior.faction === 'alliance' ? 9165 : 9099,
    };
    // 暂停游戏等待玩家查看
    strategicPaused.value = true;

    // 批准后执行回调
    if (approved && proposal.onApproved) {
      proposal.onApproved();
    }
  };

  /**
   * 驳回理由库：按上级主导政治标签 × 提案类型返回差异化文案。
   * 文案风格对齐 issueWarpOrder 的身份化模板：有身份、有原因、有规则。
   * 未命中映射时回退到通用理由（保留原"时机不合适"作为兜底）。
   */
  const getSuperiorRejectionReason = (superior: BaseAdmiral, proposalType: string): string => {
    const supTags = superior.tags || [];
    const political = supTags.filter(isPoliticalTag);
    const dominant = political[0]; // 政治标签上限为 1（TAG_LIMITS），首个即主导
    const mil = getTagsByCategory(supTags, 'military')[0];

    // 按主导政治标签给核心理由
    const REASON_BY_POLITICAL: Partial<Record<PoliticalTag, Partial<Record<string, string>>>> = {
      pacifist: {
        invasion: `${superior.name}向来反对轻启战端：多一分流血，便少一分和谈的余地。`,
        conscription: '强行征兵只会掏空民生，此事不予考虑。',
      },
      militarist: {
        defense: '把兵力龟缩在要塞里成何体统？机动力才是舰队的生命。',
        budget: '军费应当投向舰炮，而非躺在账面上。',
      },
      aristocrat: {
        personnel: '官职任免自有门第法度，岂容朝令夕改。',
        budget: '国库用度须循旧例，此例一开后患无穷。',
      },
      reformer: {
        personnel: '人事若仍按旧制运作，改革便无从谈起，暂缓。',
      },
      royalist: {
        invasion: '陛下未下明诏之前，任何人不得擅动刀兵。',
      },
      democrat: {
        conscription: '评议会未审议征兵案，我无权批准，也无意绕开它。',
      },
      ambition_faction: {
        defense: '把资源耗在守势上？成大事者从不修篱筑垒。',
      },
    };
    const reason = dominant ? REASON_BY_POLITICAL[dominant]?.[proposalType] : undefined;
    if (reason) return reason;

    // 军事风格补充理由
    if (mil === 'cautious') return `${superior.name}用兵求稳：准备不足之前，此案不宜推进。`;
    if (mil === 'aggressive') return '这个方案太保守了——要打就打出气势来，否则免谈。';

    // 兜底
    return '上级认为当前时机不合适';
  };

  // ===== 阶段二：核心后勤补给线计算 (BFS 算法) =====
  const calculateSupplyDistance = (startNodeId: number, factionId: number): number => {
    const nodeStore = useNodeStore();
    const nodes = nodeStore.nodes as unknown as any[]; // 规避类型冲突
    
    // 补给源：己方的首都、要塞，或等级>=3的大型造船厂
    const supplySources = nodes
      .filter(n => n.ownerFactionId === factionId && (n.type === 'capital' || n.type === 'fortress' || n.shipyardLevel >= 3))
      .map(n => n.id);

    if (supplySources.includes(startNodeId)) return 0;

    const queue = [{ id: startNodeId, dist: 0 }];
    const visited = new Set([startNodeId]);

    while (queue.length > 0) {
      const { id, dist } = queue.shift()!;
      const node = nodes.find(n => n.id === id);
      if (!node) continue;

      for (const nextId of node.connections) {
        if (visited.has(nextId)) continue;
        const nextNode = nodes.find(n => n.id === nextId);
        
        // 补给线阻断：不能穿过敌对阵营控制的节点
        if (!nextNode || (nextNode.ownerFactionId !== factionId && nextNode.ownerFactionId !== 0)) continue;

        if (supplySources.includes(nextId)) return dist + 1;

        visited.add(nextId);
        queue.push({ id: nextId, dist: dist + 1 });
      }
    }
    return -1; // 返回 -1 代表补给线被完全切断（死地）
  };




  // ===== 宏微观数据折算：战役接触触发器 =====
  // 暂停大地图，分离攻守双方舰队，序列化数据并写入 tacticalState
  const triggerTacticalBattle = (nodeId: number, involvedFleets: any[]) => {
    const nodeStore = useNodeStore();
    const battleNode = (nodeStore.nodes as unknown as any[]).find(n => n.id === nodeId);
    
    const attackers = involvedFleets.filter(f => f.factionId !== battleNode?.ownerFactionId);
    const defenders = involvedFleets.filter(f => f.factionId === battleNode?.ownerFactionId);

    // 检查玩家是否指挥任一参战舰队：若无 → 自动裁决（银英4EX：非玩家战斗不进入手动战术界面）
    const pAdmId = playerAdmiralId.value;
    const playerInvolved = involvedFleets.some((f: any) => f.commanderId === pAdmId);
    if (!playerInvolved) {
      // 只在命名星球通知非玩家战斗（避免"未知宙域"刷屏）
      const locName = battleNode?.name;
      if (locName) {
        triggerToast(`紧急军情：在 ${locName} 爆发了星际会战！（自动裁决中）`);
      }
      // 简易自动裁决：取双方各一支舰队进行战力对比
      const atkFleet = attackers[0];
      const defFleet = defenders[0];
      if (atkFleet && defFleet) {
        const atkAdm = allAdmirals.value.find(a => a.id === atkFleet.commanderId);
        const defAdm = allAdmirals.value.find(a => a.id === defFleet.commanderId);
        const result = autoResolveBattle(atkFleet, defFleet, atkAdm, defAdm, battleNode?.type || 'empty');
        const outLabels: Record<string, string> = { decisive_win: '攻方大胜', marginal_win: '攻方险胜', stalemate: '胶着', rout: '攻方溃败' };
        if (locName) {
          triggerToast(`会战结果 — ${locName}：${outLabels[result.outcome] || '未知'}，攻方剩余 ${result.attackerRemaining} 舰`);
        }
        // 清理溃败/覆灭舰队
        if (result.defenderRemaining <= 0) destroyFleetCleanup(defFleet.id);
        if (result.attackerRemaining <= 0) destroyFleetCleanup(atkFleet.id);
        // 若攻方胜利 → 占领节点（对抗审查：微弱胜利后守方可能有残部，
        // 残部未清时攻方只能驻留轨道，不可占领）
        const canOccupyAuto = result.outcome === BattleOutcome.DECISIVE_WIN
          || (result.outcome === BattleOutcome.MARGINAL_WIN && result.defenderRemaining <= 0);
        if (canOccupyAuto && result.attackerRemaining > 0) {
          nodeStore.captureNode(nodeId, atkFleet.factionId);
          atkFleet.currentNodeId = nodeId;
          atkFleet.status = 'idle' as any;
        }
        strategicNodes.value = nodeStore.nodes as unknown as StarNode[];
      }
      strategicPaused.value = false;
      return;
    }

    strategicPaused.value = true;
    const attackerIds = attackers.map(f => f.id);
    const defenderIds = defenders.map(f => f.id);

    triggerToast(`紧急军情：在 ${battleNode?.name || '深空遭遇'} 爆发了星际会战！`);
    launchTacticalBattle(`BATTLE_${nodeId}_${Date.now()}`, attackerIds, defenderIds, nodeId);
  };

  // ===== 调试专用：强制触发模拟会战 =====
  // 直接构造序列化后的攻守双方槽位数据并写入 tacticalState，绕过战略层寻路
  // --- 调试专用：绕过大地图，强制拉起一次真实的战役推演 ---
  const debugForceBattle = () => {
    // 快速测试攻打伊谢尔伦：battleNodeId=1 触发伊谢尔伦地图 + 要塞武器
    const mockAttacker = {
      fleetId: 9991,
      factionId: 1,
      commanderName: '杨威利 (第13舰队)',
      imageId: '156',
      formation: DEFAULT_FORMATION,
      slots: [
        { type: 'battleship', count: 3000, hp: 6000, maxHp: 6000, atk: 150 },
        { type: 'cruiser', count: 2000, hp: 2400, maxHp: 2400, atk: 90 },
        { type: 'destroyer', count: 2000, hp: 1600, maxHp: 1600, atk: 120 }
      ]
    };

    const mockDefender = {
      fleetId: 9992,
      factionId: 2,
      commanderName: '帝国驻防舰队',
      imageId: '81',
      formation: DEFAULT_FORMATION,
      slots: [
        { type: 'battleship', count: 2000, hp: 4000, maxHp: 4000, atk: 150 },
        { type: 'cruiser', count: 1500, hp: 1800, maxHp: 1800, atk: 90 }
      ]
    };

    tacticalState.value = {
      mode: 'campaign',
      battleNodeId: 1,  // 伊谢尔伦 nodeId
      battleId: 'DEBUG_ISERLOHN',
      attackers: [mockAttacker],
      defenders: [mockDefender]
    };

    // 清理战略状态，避免暂停残留
    strategicPaused.value = false;
    pendingArrival.value = null;
    pendingPostBattle.value = null;
    arrivalQueue.value = [];
    gameOver.value = false;
    isWin.value = false;
    isPaused.value = false;

    gameState.value = 'game';
  };



  let internalTickCounter = ref(0);
  const totalTicks = ref(0);
  const realTickCount = ref(0); // 真实tick计数（不受游戏速度影响），用于冷却保护
  const chainReactions = ref<Array<{ type: string; nodeId: number; nodeName: string; turn: number; description: string; effect: () => void }>>([]);
  const intelSys = useIntelSystem();
  const autoSaveDayCounter = ref(0);
  const eventDayIndex = ref(0); // 事件冷却日计数器
  const pendingEvent = ref<PendingEvent | null>(null); // 待玩家选择的事件

  let globalFleetSeq = 0;
  const nextGlobalFleetId = () => ++globalFleetSeq;

  /** 新建舰队（军务本部入口）：空编成 + 默认阵型 + 自动编号 */
  const createFleet = (commanderId: number): { success: boolean; message: string } => {
    const adm = allAdmirals.value.find((a: any) => a.id === commanderId);
    if (!adm) return { success: false, message: '提督不存在' };
    const factionId = adm.faction === 'alliance' ? 1 : 2;
    const homeNodeId = adm.faction === 'alliance' ? 14 : 56;
    const fleets = strategicFleets.value as any[];

    // 军衔舰队上限：晋升军衔才能指挥更多舰队（成长反馈）
    // P0修复：战斗军衔走 getMilitaryRank（政治头衔返回0 → 无权独立带兵）
    const cmdRank = getMilitaryRank((adm as any).rankName);
    if (cmdRank === 0) {
      return { success: false, message: '政治头衔无独立指挥权：仅战斗序列军官（准将以上）可组建舰队。' };
    }
    const fleetCap = RANK_FLEET_LIMIT[cmdRank] ?? 1; // 0 = 无上限
    const commandedCount = fleets.filter(f => f.commanderId === commanderId).length;
    if (fleetCap > 0 && commandedCount >= fleetCap) {
      return { success: false, message: `军衔不足：${(adm as any).rankName} 最多指挥 ${fleetCap} 支舰队，晋升后方可扩编。` };
    }

    const factionFleets = fleets.filter(f => f.factionId === factionId);
    const fleetNumber = factionFleets.length > 0 ? Math.max(...factionFleets.map(f => f.fleetNumber || 0)) + 1 : 1;
    const emptyComp: FleetComposition = { battleships: 0, fastBattleships: 0, cruisers: 0, destroyers: 0, carriers: 0, fighters: 0 };
    strategicFleets.value.push({
      id: nextGlobalFleetId(), factionId, commanderId: adm.id,
      currentNodeId: homeNodeId, targetNodeId: null,
      prevNodeId: null, warpTargetId: null, warpOriginId: null, etaDay: null,
      status: 'idle', moveProgress: 0,
      composition: emptyComp, tacticalSlots: [],
      morale: 100, supply: 100, supplyDistance: 0,
      parentCommanderId: null, fleetNumber,
      formation: DEFAULT_FORMATION,
    } as any);
    adm.assignedFleetId = (strategicFleets.value[strategicFleets.value.length - 1] as any).id;
    triggerToast(`已新建第${fleetNumber}舰队，由${adm.name}指挥。`);
    return { success: true, message: '新建成功' };
  };

  const emptyComposition: FleetComposition = { ...EMPTY_COMPOSITION };

  const strategicMapInitialized = ref(false);
  // 递增版本号：每次 initStrategicMap 执行时 +1，StrategicScene 监听此值变化后清空所有动态精灵重建
  const strategicMapVersion = ref(0);

  const initStrategicMap = () => {
    if (strategicMapInitialized.value) return; // 已初始化，跳过重置
    const admiralStore = useAdmiralStore();
    const nodeStore = useNodeStore();

    // 防御性重置：万一外部绕过了 restartGame 直接调用，仍能保证计数从 0 开始
    totalTicks.value = 0;
    internalTickCounter.value = 0;
    universeDate.value = '796.01.01';
    strategicPaused.value = false;
    arrivalQueue.value = [];
    pendingArrival.value = null;
    pendingPostBattle.value = null;

    // 重置节点（含随机化经济值）
    nodeStore.resetNodes();
    // 同步 strategicNodes（Phaser 场景仅通过此 ref 读取数据）
    strategicNodes.value = nodeStore.nodes as unknown as StarNode[];

    // 重置提督状态
    const admList = admiralStore.admirals as unknown as BaseAdmiral[];
    admList.forEach((adm: BaseAdmiral) => {
      adm.state = 'idle';
      adm.currentNodeId = null;
      adm.assignedFleetId = null;
      adm.injury = { isInjured: false, severity: 0, recoveryTicks: 0 };
    });

    strategicFleets.value = [];

    // 舰队番号计数器（按阵营独立编号）
    let empireFleetCounter = 0;
    let allianceFleetCounter = 0;

    // ===== 部署玩家舰队（满编 20000 舰）=====
    if (playerAdmiralId.value >= 0) {
      const adm = admList.find(a => a.id === playerAdmiralId.value);
      if (adm) {
        adm.state = 'deployed';
        const nodeList = nodeStore.nodes as unknown as StarNode[];
        const homeNodeId = adm.faction === 'alliance' ? 14 : 56;
        adm.currentNodeId = homeNodeId;
        const fleetId = nextGlobalFleetId();
        const homeNode = nodeList.find(n => n.id === homeNodeId);
        const playerFactionId = adm.faction === 'alliance' ? FACTION_ALLIANCE_ID : FACTION_EMPIRE_ID;
        const playerFleetNum = playerFactionId === FACTION_EMPIRE_ID ? ++empireFleetCounter : ++allianceFleetCounter;
        
        const rank = fullTitleMap[adm.rankName] || 9;
        const totalShips = getShipLimit(rank);
        const fleetComp: FleetComposition = {
          battleships: Math.floor(totalShips * 0.25),
          fastBattleships: Math.floor(totalShips * 0.1),
          cruisers: Math.floor(totalShips * 0.3),
          destroyers: Math.floor(totalShips * 0.25),
          carriers: Math.floor(totalShips * 0.05),
          fighters: Math.floor(totalShips * 0.05),
        };
        
        strategicFleets.value.push({
          id: fleetId,
          factionId: playerFactionId,
          commanderId: adm.id,
          currentNodeId: homeNodeId,
          targetNodeId: null,
          status: 'idle',
          prevNodeId: null,
          warpTargetId: null,
          warpOriginId: null,
          etaDay: null,
          moveProgress: 0,
          composition: fleetComp,
          tacticalSlots: [],
          morale: 100,
          supply: 100,
          supplyDistance: 0,
          parentCommanderId: null,
          fleetNumber: playerFleetNum,
          formation: DEFAULT_FORMATION,
        });
        adm.assignedFleetId = fleetId;
        if (homeNode) homeNode.garrisonFleets.push(fleetId);
      }
    }

    // ===== 按职位部署驻留舰队 =====
    const nodeList2 = nodeStore.nodes as unknown as StarNode[];
    let nextFleetId = nextGlobalFleetId();

    const deployFleet = (adm: BaseAdmiral, nodeId: number, factionId: number) => {
      adm.state = 'deployed';
      adm.currentNodeId = nodeId;
      const r = getMilitaryRank(adm.rankName) || 9;
      const limit = getShipLimit(r);
      const comp: FleetComposition = {
        battleships: Math.floor(limit * 0.3),
        fastBattleships: Math.floor(limit * 0.1),
        cruisers: Math.floor(limit * 0.3),
        destroyers: Math.floor(limit * 0.2),
        carriers: Math.floor(limit * 0.05),
        fighters: Math.floor(limit * 0.05),
      };
      const fId = nextFleetId++;
      const fn = factionId === FACTION_EMPIRE_ID ? ++empireFleetCounter : ++allianceFleetCounter;
      strategicFleets.value.push({
        id: fId, factionId, commanderId: adm.id,
        currentNodeId: nodeId, targetNodeId: null,
        prevNodeId: null, warpTargetId: null, warpOriginId: null, etaDay: null,
        status: 'idle', moveProgress: 0,
        composition: comp, tacticalSlots: [],
        morale: 100, supply: 100, supplyDistance: 0,
        parentCommanderId: null, fleetNumber: fn,
        formation: DEFAULT_FORMATION,
      });
      (strategicFleets.value[strategicFleets.value.length - 1] as any).pathQueue = [];
      adm.assignedFleetId = fId;
      const node = nodeList2.find(n => n.id === nodeId);
      if (node) {
        if (!node.garrisonFleets) node.garrisonFleets = [];
        node.garrisonFleets.push(fId);
      }
    };

    const stationAdmiral = (adm: BaseAdmiral, nodeId: number) => {
      if (adm.state !== 'idle') return;
      adm.state = 'deployed';
      adm.currentNodeId = nodeId;
    };

    // 排除皇帝/议会这种无需部署的角色
    const skipIds = new Set([181, 165]); // 皇帝 / 评议会

    admList.forEach((adm: BaseAdmiral) => {
      if (skipIds.has(adm.id) || adm.state !== 'idle' || adm.id === playerAdmiralId.value) return;
      const role = (adm as any).role as string;
      if (role === 'none') return;

      const isEmpire = adm.faction === 'empire';
      const capital = isEmpire ? 56 : 14;

      // 伊谢尔伦特殊部署
      if (adm.id === 44 || adm.id === 37) {
        if (adm.id === 44) deployFleet(adm, 1, 2);
        else stationAdmiral(adm, 1);
        return;
      }

      // fleet_commander: 首都带满编舰队
      if (role === 'fleet_commander') {
        deployFleet(adm, capital, isEmpire ? 2 : 1);
        return;
      }

      // 其他职位（staff/minister/commander等）：驻守首都，不带舰队
      stationAdmiral(adm, capital);
    });

    // 领土归属
    [1, 2, 3, 4, 55, 56].forEach(id => {
      const n = nodeList2.find(nd => nd.id === id);
      if (n) n.ownerFactionId = 2;
    });
    [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].forEach(id => {
      const n = nodeList2.find(nd => nd.id === id);
      if (n) n.ownerFactionId = 1;
    });
    
    // 初始化舰队归属（设置 parentCommanderId）
    initFleetAssignment(admList, strategicFleets.value);

    internalTickCounter.value = 0;
    realTickCount.value = 0; // 重置真实tick计数
    strategicPaused.value = false;
    userPaused.value = false;
    aiTurnCounter.value = -10; // AI 开局冷却：给玩家 ~12 ticks 缓冲期
    strategicMapInitialized.value = true;
    strategicMapVersion.value++;
  };

  const strategicTick = () => {
    if (gameState.value !== 'strategy') return;

    // 安全阀：如果系统自动暂停且没有活跃的到达/战后/军议面板，强制恢复
    // 注意：用户手动暂停（userPaused）不受安全阀影响
    if (strategicPaused.value && !userPaused.value) {
      if (!pendingArrival.value && !pendingPostBattle.value && !showCouncilModal.value && arrivalQueue.value.length === 0) {
        strategicPaused.value = false;
      } else {
        return;
      }
    }
    // 用户手动暂停 → 完全停止 tick
    if (strategicPaused.value && userPaused.value) return;

    const admiralStore = useAdmiralStore();
    const nodeStore = useNodeStore();
    const ticksElapsed = strategicTimeSpeed.value;
    
    internalTickCounter.value += ticksElapsed;
    totalTicks.value += ticksElapsed;
    realTickCount.value += 1; // 真实tick+1（不受速度影响）

    // 0. 同步 strategicNodes
    strategicNodes.value = nodeStore.nodes as unknown as StarNode[];

    // 0.5 提督叛变检测（每5 tick一次，避免频繁计算）
    if (internalTickCounter.value % 5 === 0) {
      const admiralStore = useAdmiralStore();
      const admList = (admiralStore.admirals as unknown as any[]);
      admList.forEach((adm: any) => {
        if (adm.role === 'emperor' || adm.role === 'council' || adm.id === playerAdmiralId.value) return;
        const loyalty = adm.loyalty ?? 70;
        if (loyalty < 30) {
          const prob = getDefectionProbability(adm);
          if (Math.random() < prob) {
            const enemyFaction = adm.faction === 'empire' ? 'alliance' : 'empire';
            const newFactionId = enemyFaction === 'alliance' ? 1 : 2;
            adm.faction = enemyFaction;
            // P0修复：同步其指挥的舰队归属（原地叛变——舰队留在当前节点，阵营翻转）
            const defectedFleets = (strategicFleets.value as any[]).filter((f: any) => f.commanderId === adm.id);
            defectedFleets.forEach((f: any) => {
              f.factionId = newFactionId;
              f.status = 'idle';
              f.targetNodeId = null;
              f.warpTargetId = null;
              f.moveProgress = 0;
            });
            const fleetNote = defectedFleets.length > 0 ? `（带走${defectedFleets.length}支舰队）` : '';
            triggerToast(`⚠️ 紧急军情：${adm.rankName} ${adm.name} 投敌叛变！${fleetNote}加入${enemyFaction === 'empire' ? '帝国' : '同盟'}阵营。`);
          }
        }
        // 低忠诚度警告
        if (loyalty < 30 && loyalty >= 20 && Math.random() < 0.05) {
          triggerToast(`📨 军情简报：${adm.name} 忠诚度低迷（${loyalty}），存在叛变风险。`);
        }
      });
    }

    // ===== 阶段六：检查 Warp 舰队到达 =====
    checkArrivals();

    // 处理战后连锁反应
    chainReactions.value = chainReactions.value.filter(cr => {
      if (cr.turn <= totalTicks.value) {
        cr.effect();
        return false;
      }
      return true;
    });

    // 舰船生产：由玩家在军务面板通过 fleetStore.buildShips 主动下单（扣国库、按船坞产能建造）
    // 旧的"自动生产"管线已移除：其节点过滤误用 ownerId 字段且产出的舰船从未交付舰队

    // 情报衰减
    intelSys.decayIntel(ticksElapsed);
    const now = totalTicks.value;
    const resolved: number[] = [];
    pendingProposalsV2.value.forEach((p) => {
      if (p.responseDeadlineTick <= now && p.status === 'pending') {
        processProposalV2(p);
        resolved.push(p.id);
      }
    });
    // 清理已处理的提案（延迟一帧避免在执行中修改数组）
    if (resolved.length > 0) {
      pendingProposalsV2.value = pendingProposalsV2.value.filter(p => !resolved.includes(p.id));
    }

    const nodeList = nodeStore.nodes as unknown as StarNode[];
    const admList = admiralStore.admirals as unknown as BaseAdmiral[];

    // ===== 双阵营 AI 回合（开局保护：前20个真实tick不行动，约14秒）=====
    if (realTickCount.value > 20) {
      aiTurnCounter.value += ticksElapsed;
      if (aiTurnCounter.value >= 2) {
        aiTurnCounter.value = 0;
        const pfIdNow = getPlayerFactionId();
        const efId = pfIdNow === 1 ? 2 : 1;
        // 敌方进攻 AI
        runAIStrategicTurn(efId);
        // 友军进攻 AI：排除玩家亲自指挥的舰队（指挥权修复：玩家舰队不再被 AI 擅自调动）
        runAIStrategicTurn(pfIdNow, playerAdmiralId.value);
        // 双方防御 AI（威胁回防；此前防御引擎已实现但从未接线）
        runFactionDefensiveAI(efId);
        runFactionDefensiveAI(pfIdNow);
      }
    }

    // 1. 舰队物理移动与后勤结算
    // 引擎等级加速战略移动：每级 +3%
    const adminStoreMove = useAdminStore();
    const engineLevelMove = (adminStoreMove as any).adminState?.technology?.engineLevel || 1;
    const engineSpeedMod = 1 + Math.max(0, engineLevelMove - 1) * 0.03;

    strategicFleets.value.forEach(fleet => {
      fleet.supplyDistance = calculateSupplyDistance(fleet.currentNodeId, fleet.factionId);

      if (fleet.status === 'moving' && fleet.targetNodeId !== null) {
        const commander = admList.find(a => a.id === fleet.commanderId);
        const mobilityBonus = (commander?.stats?.mobility || 50) / 100;
        // [T07] Warp速度buff：invasion提案通过后 warpSpeedBuffDays > 0 → 移动速度 ×1.3
        let warpMultiplier = 0.5;
        if ((fleet as any).warpSpeedBuffDays > 0) {
          warpMultiplier *= 1.3;
          (fleet as any).warpSpeedBuffDays--;
        }
        fleet.moveProgress += warpMultiplier * ticksElapsed * (1 + mobilityBonus) * engineSpeedMod;
        // [T07] 后勤buff：logistics提案通过后 logisticsBuffDays > 0 → 补给消耗 ×0.7
        // v2: 补给线切断(supplyDistance=-1)时大幅增加消耗（弹尽粮绝）
        let supplyDrain: number;
        if (fleet.supplyDistance === -1) {
          supplyDrain = 0.5 * ticksElapsed; // 补给线被切断 → 消耗×5
        } else {
          supplyDrain = (0.1 + fleet.supplyDistance * 0.05) * ticksElapsed;
        }
        if ((fleet as any).logisticsBuffDays > 0) {
          supplyDrain *= 0.7;
          (fleet as any).logisticsBuffDays--;
        }
        fleet.supply = Math.max(0, fleet.supply - supplyDrain);
        
        if (fleet.moveProgress >= 100) {
          fleet.currentNodeId = fleet.targetNodeId;
          fleet.moveProgress = 0;
          fleet.supplyDistance = calculateSupplyDistance(fleet.currentNodeId, fleet.factionId);
          
          // 自动推进路径队列：若还有后续节点则继续跃迁
          const pathQueue = (fleet as any).pathQueue as number[] | undefined;
          if (pathQueue && pathQueue.length > 1) {
            // 找到当前节点在路径中的位置
            const curIdx = pathQueue.indexOf(fleet.currentNodeId);
            if (curIdx >= 0 && curIdx < pathQueue.length - 1) {
              fleet.targetNodeId = pathQueue[curIdx + 1];
              fleet.status = 'moving';
            } else {
              // 路径异常，清除队列，正常停止
              (fleet as any).pathQueue = [];
              fleet.targetNodeId = null;
              fleet.status = 'idle';
            }
          } else {
            // 无路径队列 → 检查是否为终点
            (fleet as any).pathQueue = [];
            fleet.targetNodeId = null;
            
            const targetNode = nodeList.find(n => n.id === fleet.currentNodeId);
            if (targetNode && targetNode.ownerFactionId !== fleet.factionId) {
              // 检查该节点是否有敌方舰队驻守
              const hasEnemyFleet = strategicFleets.value.some(
                f => f.id !== fleet.id && f.currentNodeId === fleet.currentNodeId && f.factionId !== fleet.factionId
              );
              if (hasEnemyFleet) {
                // 有敌方舰队 → 碰撞检测在下方处理
                fleet.status = 'idle';
              } else {
                // 无人驻守的敌方星球 → 直接行星突击结算
                resolvePlanetaryAssault(fleet.id, fleet.currentNodeId);
              }
            } else {
              fleet.status = 'idle';
              fleet.supply = Math.min(100, fleet.supply + 20);
              fleet.morale = Math.min(100, fleet.morale + 5);
              if (targetNode && !targetNode.garrisonFleets.includes(fleet.id)) {
                targetNode.garrisonFleets.push(fleet.id);
              }
            }
          }
        }
      }

      if (fleet.status === 'bombarding') {
        const targetNode = nodeList.find(n => n.id === fleet.currentNodeId);
        if (targetNode && targetNode.ownerFactionId !== fleet.factionId) {
          const totalAttack = totalPowerWeight(fleet.composition);
          targetNode.defenseHp -= totalAttack * ticksElapsed;
          fleet.supply = Math.max(0, fleet.supply - 0.2 * ticksElapsed);
          
          if (targetNode.defenseHp <= 0) {
            nodeStore.captureNode(targetNode.id, fleet.factionId);
            strategicNodes.value = nodeStore.nodes as unknown as StarNode[];
            const commander = admList.find(a => a.id === fleet.commanderId);
            if (commander) commander.currentNodeId = fleet.currentNodeId;
            fleet.status = 'idle';
            fleet.supplyDistance = 0;
            triggerToast(`已攻陷节点 ${targetNode.name}`);
          }
        } else {
          fleet.status = 'idle';
        }
      }

      if (fleet.status === 'idle') {
        const currentNode = nodeList.find(n => n.id === fleet.currentNodeId);
        const isFriendly = currentNode && currentNode.ownerFactionId === fleet.factionId;
        if (isFriendly) {
          // [T07] 防卫司令官辖区舰队补给恢复 ×2
          const defCommander = currentNode && (admList as any[]).find(
            (a: any) => a.role === 'defense_commander' &&
            (a.assignedNodeId === currentNode.id || a.currentNodeId === currentNode.id)
          );
          const recoverMultiplier = defCommander ? 2.0 : 1.0;
          fleet.supply = Math.min(100, fleet.supply + recoverMultiplier * 2 * ticksElapsed);
          fleet.morale = Math.min(100, fleet.morale + 0.5 * ticksElapsed);
        } else {
          // v2: 敌方/中立领土 → 补给持续消耗
          if (fleet.supplyDistance === -1) {
            // 补给线被完全切断 → 弹尽粮绝
            fleet.supply = Math.max(0, fleet.supply - 0.3 * ticksElapsed);
          } else if (fleet.supplyDistance > 0) {
            fleet.supply = Math.max(0, fleet.supply - (0.05 + fleet.supplyDistance * 0.02) * ticksElapsed);
          }
        }
      }

      // v2: 补给不足的阶梯式影响（亚姆利扎危机）
      if (fleet.supply === 0) {
        // 补给耗尽 → 士气快降（亚姆利扎状态）
        fleet.morale = Math.max(0, fleet.morale - 2 * ticksElapsed);
      } else if (fleet.supply < 30) {
        // 补给严重不足 → 士气快降
        fleet.morale = Math.max(0, fleet.morale - 0.5 * ticksElapsed);
      } else if (fleet.supply < 50) {
        // 补给不足 → 士气缓降
        fleet.morale = Math.max(0, fleet.morale - 0.2 * ticksElapsed);
      }

      // v2: supplyDistance=-1（补给线被完全切断/死地）也触发逃亡
      if (fleet.morale <= 0 && fleet.supply <= 0 && (fleet.supplyDistance >= 2 || fleet.supplyDistance === -1)) {
        const desertionRate = 0.05 * ticksElapsed;
        fleet.composition.battleships = Math.max(0, Math.floor(fleet.composition.battleships * (1 - desertionRate)));
        fleet.composition.cruisers = Math.max(0, Math.floor(fleet.composition.cruisers * (1 - desertionRate)));
        fleet.composition.destroyers = Math.max(0, Math.floor(fleet.composition.destroyers * (1 - desertionRate)));
        
        const remaining = totalShips(fleet.composition);
        if (remaining <= 0) {
          const commander = admList.find(a => a.id === fleet.commanderId);
          if (commander) {
            commander.state = 'wounded';
            commander.currentNodeId = null;
            commander.assignedFleetId = null;
            commander.injury = { isInjured: true, severity: 50, recoveryTicks: 100 }; 
          }
          strategicFleets.value = strategicFleets.value.filter(f => f.id !== fleet.id);
          triggerToast(`提督 ${commander?.name || fleet.commanderId} 的舰队因补给断绝而全军覆没`);
        }
      }
    });
    
    admiralStore.processInjuryRecovery(ticksElapsed);

    // 2. 战役接触判定（碰撞检测）：同节点存在不同阵营舰队 → 触发战术战斗
    // 开局保护：前15个真实tick（~10.5秒，不受游戏速度影响）不触发战斗
    if (realTickCount.value > 15) {
    const nodesWithFleets = new Map<number, any[]>();
    strategicFleets.value.forEach((f: any) => {
      // 跳过跃迁中/已物理移除（currentNodeId<0）与空编成的舰队，避免幽灵战斗
      if ((f.currentNodeId ?? -1) < 0) return;
      if (totalShips(f.composition) <= 0) return;
      if (!nodesWithFleets.has(f.currentNodeId)) nodesWithFleets.set(f.currentNodeId, []);
      nodesWithFleets.get(f.currentNodeId)!.push(f);
    });

    for (const [nodeId, fleets] of nodesWithFleets.entries()) {
      const factionIds = new Set(fleets.map(f => f.factionId));
      if (factionIds.size > 1) {
        // 不同阵营舰队共处同一节点 → 触发星际会战
        triggerTacticalBattle(nodeId, fleets);
        break; // 每 Tick 仅拉起一场战役
      }
    }
    }

    // 3. 造船厂建造推进
    const fleetStore = useFleetStore();
    nodeList.forEach(node => {
      if (node.shipyardLevel > 0) {
        fleetStore.tickConstruction(node.id, node.shipyardLevel, ticksElapsed);
      }
    });

    // 3. 满一日触发内政结算与军议拦截（正确的作用域）
    if (internalTickCounter.value >= TICKS_PER_DAY) {
      internalTickCounter.value -= TICKS_PER_DAY;
      advanceUniverseDate();

      // [T04] 军议触发器：每月 1 号自动生成提案（非侵入式，不强制暂停）
      if (universeDate.value.endsWith('.01')) {
          const adminStore = useAdminStore();
          const ctx = {
            gameStore: {
              get strategicFleets() { return strategicFleets.value; },
              get strategicNodes() { return strategicNodes.value; },
              get metaGold() { return metaGold.value; },
              set metaGold(v: number) { metaGold.value = v; },
              get universeDate() { return universeDate.value; },
              triggerToast: (msg: string) => triggerToast(msg),
            },
            adminStore,
            playerFactionId: getPlayerFactionId(),
          };
          const newProposals = generateMonthlyProposals(ctx);
          pendingProposals.value.push(...newProposals);
          councilPendingCount.value = newProposals.length;
          triggerToast(`本月军议：${newProposals.length} 项提案待审议。`);
      }

      // ── 统一税收结算（nodeStore 为唯一税源；玩家阵营使用行政税率）──
      const adminStore = useAdminStore();
      const finState = (adminStore as any).adminState?.finance;
      const pfIdDaily = getPlayerFactionId();
      const taxResult = nodeStore.processDailyEconomy(
        pfIdDaily,
        finState?.baseTaxRate ?? 0.10,
        finState?.warTaxRate ?? 0
      );
      factionGold.value.alliance += taxResult.alliance || 0;
      factionGold.value.empire += taxResult.empire || 0;
      const playerTax = (pfIdDaily === 1 ? taxResult.alliance : taxResult.empire) || 0;

      // ── 敌方阵营同样支付舰队维护费（对称的经济约束，AI 不再无限刷跃迁）──
      const enemyFacIdDaily = pfIdDaily === 1 ? 2 : 1;
      const enemyMaint = computeFleetMaintenance(enemyFacIdDaily);
      if (enemyFacIdDaily === 1) factionGold.value.alliance = Math.max(0, factionGold.value.alliance - enemyMaint);
      else factionGold.value.empire = Math.max(0, factionGold.value.empire - enemyMaint);

      // 行政系统每日结算：财政（玩家税收经参数传入）+ 人事 + 民生 + 科技
      const settle = adminStore.processDailyFinance(playerTax);
      adminStore.processDailyPersonnel();
      adminStore.processDailyWelfare();
      adminStore.processDailyTechnology();
      // v3 新增：本地操作冷却递减
      adminStore.processDailyLocalCooldowns();
      // v3 新增：提督工资 + 费沙贷款利息/还款
      adminStore.settleAdmiralSalaries();
      adminStore.settleLoanDaily();

      // ── 国库账本（经济面板趋势图使用真实历史数据）──
      treasuryLedger.value.push({ date: universeDate.value, treasury: metaGold.value, income: settle.income, expense: settle.expense });
      if (treasuryLedger.value.length > 60) treasuryLedger.value.splice(0, treasuryLedger.value.length - 60);

      // ── 敌方集结预警（威胁可视化；预警质量随情报等级提升）──
      checkEnemyMassing();

      // 4. 每日随机政治事件结算
      evaluateRandomEvents();

      // ===== P0.1: 胜利条件检查 =====
      checkVictoryConditions();
    }
  };

  /** 计算指定阵营的舰队日维护费总额（按 economy.ts 单价） */
  function computeFleetMaintenance(factionId: number): number {
    return (strategicFleets.value as unknown as any[])
      .filter((f: any) => f.factionId === factionId)
      .reduce((sum: number, f: any) => {
        const c = f.composition || {};
        return sum + (
          (c.battleships || 0) * SHIP_MAINTENANCE.battleship +
          (c.fastBattleships || 0) * SHIP_MAINTENANCE.fastBattleship +
          (c.cruisers || 0) * SHIP_MAINTENANCE.cruiser +
          (c.destroyers || 0) * SHIP_MAINTENANCE.destroyer +
          (c.carriers || 0) * SHIP_MAINTENANCE.carrier +
          (c.fighters || 0) * SHIP_MAINTENANCE.fighter
        );
      }, 0);
  }

  const lastMassingWarnTick = ref(-999999);
  /**
   * 敌方集结预警（威胁可视化）：
   * - 敌方 ≥2 支 idle 舰队聚集在与我方领土相邻的节点 → 集结预警
   * - 情报等级 ≥ detailed 时给出明确规模与窗口，否则仅提示"异动"
   * - 每 5 个游戏日最多预警一次，避免刷屏
   */
  function checkEnemyMassing(): void {
    if (totalTicks.value - lastMassingWarnTick.value < TICKS_PER_DAY * 5) return;
    const pfId = getPlayerFactionId();
    const efId = pfId === 1 ? 2 : 1;
    const admin = useAdminStore() as any;
    const intelLv: string = admin.adminState?.intelligence?.intelLevel?.[efId] || 'none';
    const intelNum = ({ none: 0, basic: 1, detailed: 2, full: 3 } as Record<string, number>)[intelLv] ?? 0;

    const nodes = strategicNodes.value as unknown as any[];
    const enemyIdle = (strategicFleets.value as unknown as any[]).filter(
      (f: any) => f.factionId === efId && f.status === 'idle' && (f.currentNodeId ?? -1) >= 0 && totalShips(f.composition) > 0
    );
    const byNode = new Map<number, number>();
    enemyIdle.forEach((f: any) => byNode.set(f.currentNodeId, (byNode.get(f.currentNodeId) || 0) + 1));

    let massingNode: any = null;
    for (const [nodeId, count] of byNode.entries()) {
      if (count < 2) continue;
      const n = nodes.find((nd: any) => nd.id === nodeId);
      if (!n) continue;
      const threatensUs = n.ownerFactionId === pfId ||
        (n.connections || []).some((cid: number) => {
          const cn = nodes.find((nd2: any) => nd2.id === cid);
          return cn && cn.ownerFactionId === pfId;
        });
      if (threatensUs) { massingNode = n; break; }
    }

    if (massingNode) {
      lastMassingWarnTick.value = totalTicks.value;
      const count = byNode.get(massingNode.id) || 2;
      if (intelNum >= 2) {
        triggerToast(`⚠️ 军情：侦测到敌方 ${count} 支舰队正在 ${massingNode.name} 星域集结，预计数日内发动攻势。`);
      } else {
        triggerToast(`📨 军情简报：${massingNode.name} 星域附近侦测到敌方舰队异动（提升情报等级可获详情）。`);
      }
      return;
    }

    // 次级预警：敌方舰队已向我方领土跃迁
    if (intelNum >= 1) {
      const incoming = (strategicFleets.value as unknown as any[]).find((f: any) => {
        if (f.factionId !== efId || f.status !== ('warping' as any) || f.warpTargetId == null) return false;
        const t = nodes.find((nd: any) => nd.id === f.warpTargetId);
        return !!t && t.ownerFactionId === pfId;
      });
      if (incoming) {
        const t = nodes.find((nd: any) => nd.id === incoming.warpTargetId);
        lastMassingWarnTick.value = totalTicks.value;
        triggerToast(`⚠️ 警报：敌方舰队正跃迁逼近 ${t?.name || '我方星域'}！`);
      }
    }
  }

  /** P0.1: 检查阵营是否已被消灭 */
  const checkVictoryConditions = () => {
    if (gameOver.value) return;
    const nodeStore = useNodeStore();
    const nodes = (nodeStore.nodes as unknown as any[]);
    const admirals = (useAdmiralStore().admirals as unknown as any[]);

    const playerAdm = admirals.find((a: any) => a.id === playerAdmiralId.value);
    const playerFactionId = playerAdm?.faction === 'alliance' ? 1 : 2;
    const enemyFactionId = playerFactionId === 1 ? 2 : 1;

    if (nodes.filter((n: any) => n.ownerFactionId === enemyFactionId).length === 0) {
      gameOver.value = true; isWin.value = true;
      winStatus.value = playerFactionId === 1 ? '同盟胜利 — 帝国已无任何领土' : '帝国胜利 — 同盟已无任何领土';
      strategicPaused.value = true;
      generateEndingNarrative(true, 'conquest');
      commsMessage.value = { visible: true, title: '战争结束', message: endingNarrative.value, faction: playerAdm?.faction || 'alliance', officerTitle: playerAdm?.faction === 'alliance' ? '同盟最高评议会' : '帝国宰相府' };
      return;
    }
    const enemyCapital = nodes.find((n: any) => n.type === 'capital' && n.ownerFactionId === playerFactionId && (enemyFactionId === 1 ? n.id === 14 : n.id === 56));
    if (enemyCapital) {
      gameOver.value = true; isWin.value = true;
      winStatus.value = `${playerAdm?.faction === 'alliance' ? '同盟' : '帝国'}胜利 — 敌方首都被占领！`;
      strategicPaused.value = true;
      generateEndingNarrative(true, 'capital');
      commsMessage.value = { visible: true, title: '战争结束', message: endingNarrative.value, faction: playerAdm?.faction || 'alliance', officerTitle: playerAdm?.faction === 'alliance' ? '同盟最高评议会' : '帝国宰相府' };
      return;
    }
    if (nodes.find((n: any) => n.type === 'capital' && n.ownerFactionId !== playerFactionId && (playerFactionId === 1 ? n.id === 14 : n.id === 56))) {
      gameOver.value = true; isWin.value = false; winStatus.value = '败北 — 首都已沦陷'; strategicPaused.value = true;
      generateEndingNarrative(false, 'defeat');
      commsMessage.value = { visible: true, title: '战役终结', message: endingNarrative.value, faction: playerAdm?.faction || 'alliance', officerTitle: playerAdm?.faction === 'alliance' ? '同盟最高评议会' : '帝国宰相府' };
    }
  };

  // ===== P3: 政治事件引擎（委托给 events 模块） =====
  const evaluateRandomEvents = () => {
    // 如果已有待处理事件，不触发新事件
    if (pendingEvent.value) return;

    const admiralStore = useAdmiralStore();
    const admList = (admiralStore.admirals as unknown as any[]);
    const pAdm = admList.find((a: any) => a.id === playerAdmiralId.value);
    const faction = pAdm?.faction || 'alliance';
    const factionId = faction === 'alliance' ? 1 : 2;

    const ctx: EventContext = {
      faction,
      factionId,
      metaGold: metaGold as unknown as { value: number },
      adminMerit: adminMerit as unknown as { value: number },
      tacticalMerit: tacticalMerit as unknown as { value: number },
      strategicFleets: strategicFleets as unknown as { value: any[] },
      allAdmirals: allAdmirals as unknown as { value: any[] },
      playerAdmiralId: playerAdmiralId as unknown as { value: number },
      playerRank: pAdm?.rankName || '少将',
      playerRole: pAdm?.role || 'fleet_commander',
      triggerToast,
      getNodeStore: () => useNodeStore(),
      totalTicks: totalTicks as unknown as { value: number },
      chainReactions: chainReactions as unknown as { value: ChainReaction[] },
    };

    eventDayIndex.value++;
    const event = evaluateDailyEvents(ctx, eventDayIndex.value);
    if (event) {
      pendingEvent.value = event;
      // 暂停游戏，等待玩家选择
      strategicPaused.value = true;
    }

    // 自动存档：每7天触发一次
    autoSaveDayCounter.value++;
    if (autoSaveDayCounter.value >= 7) {
      autoSaveDayCounter.value = 0;
      autoSave();
    }
  };

  // 玩家选择事件选项后调用
  const resolveEvent = (choiceIndex: number | null) => {
    const event = pendingEvent.value;
    if (!event) return;

    if (choiceIndex !== null && choiceIndex >= 0 && choiceIndex < event.choices.length) {
      // 执行玩家选择的选项
      const admiralStore = useAdmiralStore();
      const admList = (admiralStore.admirals as unknown as any[]);
      const pAdm = admList.find((a: any) => a.id === playerAdmiralId.value);
      const faction = pAdm?.faction || 'alliance';
      const factionId = faction === 'alliance' ? 1 : 2;

      const ctx: EventContext = {
        faction,
        factionId,
        metaGold: metaGold as unknown as { value: number },
        adminMerit: adminMerit as unknown as { value: number },
        tacticalMerit: tacticalMerit as unknown as { value: number },
        strategicFleets: strategicFleets as unknown as { value: any[] },
        allAdmirals: allAdmirals as unknown as { value: any[] },
        playerAdmiralId: playerAdmiralId as unknown as { value: number },
        playerRank: pAdm?.rankName || '少将',
        playerRole: pAdm?.role || 'fleet_commander',
        triggerToast,
        getNodeStore: () => useNodeStore(),
        totalTicks: totalTicks as unknown as { value: number },
        chainReactions: chainReactions as unknown as { value: ChainReaction[] },
      };

      event.choices[choiceIndex].effect(ctx);
      triggerToast(`已处理：${event.name}`);
    } else {
      // 跳过事件
      triggerToast(`暂缓处理：${event.name}`);
    }

    pendingEvent.value = null;
    strategicPaused.value = false;
  };

  const advanceUniverseDate = () => {
    let [year, month, day] = universeDate.value.split('.').map(Number);
    day++;
    if (day > 30) { 
      day = 1;
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }
    universeDate.value = `${year}.${month.toString().padStart(2, '0')}.${day.toString().padStart(2, '0')}`;
  };

  // ========== 战斗层状态 ==========
  // 双阵营国库：同盟和帝国各自独立财政
  const factionGold = ref<{ alliance: number; empire: number }>({ ...INITIAL_GOLD.default });
  // 费沙金库：第三方经济势力，坐收贸易过路费与贷款本息（银英调性：费沙回廊垄断）
  const fezzanGold = ref<number>(FEZZAN_INITIAL_GOLD);
  // metaGold 兼容层：玩家所属阵营的国库视图
  const metaGold = computed({
    get: () => {
      const pfId = getPlayerFactionId();
      return pfId === 1 ? factionGold.value.alliance : factionGold.value.empire;
    },
    set: (v: number) => {
      const pfId = getPlayerFactionId();
      if (pfId === 1) factionGold.value.alliance = v;
      else factionGold.value.empire = v;
    }
  });
  const tacticalMerit = ref(0); 
  const adminMerit = ref(0);    
  const rewardGold = ref(0);

  // 剧本选择（标题界面写入；新游戏初始化时读取，驱动初始国库/年份）
  const selectedScenarioId = ref<string>('astarte_eve');

  // 国库账本：近60个游戏日的真实收支历史（经济面板趋势图数据源）
  const treasuryLedger = ref<Array<{ date: string; treasury: number; income: number; expense: number }>>([]);

  const selectedFactionId = ref('empire');
  const selectedMapId = ref('random');
  const selectedDiff = ref('normal');
  const activeFactionCount = ref(2);

  const troopsData = shallowRef<Record<string, any>[]>(generateInitialTroops() as Record<string, any>[]);
  const customMapsData = shallowRef<Record<string, any>>({});
  const mapsPool = shallowRef<Record<string, any>[]>(defaultMaps as Record<string, any>[]);

  const factions = ref<Faction[]>([]);
  const selectedTile = shallowRef<HexTile | null>(null); 
  const fleetsUI = shallowRef<any[]>([]); 

  const isPaused = ref(false);
  const speedGears = shallowRef<number[]>([0.5, 1.0, 1.5, 2.0, 3.0]);
  const currentSpeedFactor = ref<number>(1.0);
  const gameOver = ref(false);
  const isWin = ref(false);
  const winStatus = ref("");
  const gameStats = ref({ battles: 0, victories: 0, nodesCaptured: 0, admiralsKilled: 0 });
  const endingNarrative = ref('');
  const flagshipDestroyed = ref<any>(null);

  // ── 战略战争迷雾 ──
  const getIntelRange = (): number => {
    const pfId = getPlayerFactionId();
    const admin = useAdminStore() as any;
    const intelLevel = (admin.adminState?.value?.intelligence?.intelLevel || {})[pfId === 1 ? 2 : 1] || 'none';
    const ranges: Record<string, number> = { none: 3, low: 6, medium: 10, high: 20, full: 99 };
    return ranges[intelLevel] || 3;
  };

  const currentBrush = ref<string>('pending');
  const editorTilesData = shallowRef<{ q: number; r: number; type: string }[]>([]);
  const editorHistory = shallowRef<string[]>([]);
  
  let triggerPhaserMatchLaunch: (() => void) | null = null;
  let triggerPhaserEditorInit: (() => void) | null = null;
  let toastTimer: any = null;
  
  let phaserCommandDispatcher: ((id: number, type: string, payload?: any) => void) | null = null;
  const setPhaserCommandDispatcher = (fn: any) => { phaserCommandDispatcher = fn; };
  const dispatchFleetCommand = (id: number, type: string, payload?: any) => {
      if (phaserCommandDispatcher) phaserCommandDispatcher(id, type, payload);
  };

  // ===== 提督扮演：军议面板状态（仅指挥制使用；BattleScene 镜像写入）=====
  /** 战前部署阶段（军议面板据此全员可派任务 + 自动展开） */
  const battleDeployPhase = ref(false);
  /** 总指挥提督 id（BattleScene.computeSupremeCommander 判定；null=未启用提督扮演） */
  const supremeCommanderId = ref<number | null>(null);
  /** 军议面板开关 */
  const warRoomOpen = ref(false);

  // ===== P0 toast 队列化：避免后续通知覆盖前一条 =====
  const toastQueue = ref<string[]>([]);
  let toastActive = false;

  const showNextToast = () => {
    if (toastQueue.value.length === 0) { toastActive = false; toastMessage.value = ""; return; }
    toastActive = true;
    const next = toastQueue.value.shift()!;
    toastMessage.value = next;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { showNextToast(); }, 2200);
  };

  const triggerToast = (msg: string) => {
    // 去重：如果队列末尾已有相同消息或当前正显示，跳过
    if (toastMessage.value === msg) return;
    if (toastQueue.value.length > 0 && toastQueue.value[toastQueue.value.length - 1] === msg) return;
    if (toastQueue.value.length >= 10) toastQueue.value.shift(); // 上限 10 条
    toastQueue.value.push(msg);
    if (!toastActive) showNextToast();
  };
  
  const getTroopById = (id: string) => {
    if (id === 'refugee') return REFUGEE;
    return troopsData.value.find(t => t.id === id) || troopsData.value[0];
  };

  const getEffectiveStats = (admiralId: number) => {
      const adm = allAdmirals.value.find(a => a.id === admiralId);
      if (!adm) return null;
      if (!adm.stats) {
          console.warn(`[getEffectiveStats] Admiral ${admiralId} (${adm.name}) has no stats object, returning defaults.`);
          return { command: 50, operations: 50, intelligence: 50, mobility: 50, attack: 50, defense: 50, tactics: 50 };
      }
      let stats = { ...adm.stats };
      if (Array.isArray(adm.staffs)) {
          adm.staffs.forEach(staffId => {
              const staff = allAdmirals.value.find(a => a.id === staffId);
              if (staff && staff.stats) {
                  stats.command += Math.floor((staff.stats.command || 0) * 0.2);
                  stats.operations += Math.floor((staff.stats.operations || 0) * 0.2);
                  stats.intelligence += Math.floor((staff.stats.intelligence || 0) * 0.2);
                  stats.mobility += Math.floor((staff.stats.mobility || 0) * 0.2);
                  stats.attack += Math.floor((staff.stats.attack || 0) * 0.2);
                  stats.defense += Math.floor((staff.stats.defense || 0) * 0.2);
                  stats.tactics += Math.floor((staff.stats.tactics || 0) * 0.2);
              }
          });
      }
      return stats;
  };

  // ===== 阶段四预留：战略→战术层序列化器 =====

  // ===== 阶段二：大地图舰队移动指令分发 =====
  /** 保留旧接口名以兼容场景，内部转发至新 Warp 系统 */
  const issueFleetMoveOrder = (fleetId: number, targetNodeId: number) => {
    issueWarpOrder(fleetId, targetNodeId);
  };

  // ===== 阶段六：Warp 移动核心函数 =====

  /** BFS 路径可达性检查：返回 fromNodeId → toNodeId 之间是否存在己方补给路径 */
  function bfsReachable(fromNodeId: number, toNodeId: number, factionId: number): boolean {
    return bfsReachableEngine(strategicNodes.value as unknown as any[], fromNodeId, toNodeId, factionId);
  }

  /** 欧几里得距离 */
  function euclideanDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return euclideanDistEngine(a, b);
  }

  /**
   * 核心：下达 Warp 跃迁指令（玩家与 AI 共用，不含职权校验与提示）
   * @returns 成功返回预计旅行天数(travelDays)，失败返回 -1，国库不足返回 -2
   */
  function applyWarpOrder(fleet: any, targetNodeId: number): number {
    if (!fleet || fleet.status !== 'idle') return -1;
    if (fleet.currentNodeId === targetNodeId) return -1;

    // 补给路径检查：只能经过己方或中立节点
    if (!bfsReachable(fleet.currentNodeId, targetNodeId, fleet.factionId)) return -1;

    // 距离与 ETA 计算
    const rawNodes = (strategicNodes.value as unknown as any[]);
    const currentNode = rawNodes.find((n: any) => n.id === fleet.currentNodeId);
    const targetNode = rawNodes.find((n: any) => n.id === targetNodeId);
    if (!currentNode || !targetNode) return -1;

    const dist = euclideanDistance(
      { x: currentNode.x, y: currentNode.y },
      { x: targetNode.x, y: targetNode.y }
    );
    // 引擎等级加速 Warp：每级 +4% 速度
    const adminStoreWarp = useAdminStore();
    const engineLevel = (adminStoreWarp as any).adminState?.technology?.engineLevel || 1;
    const engineSpeedMod = 1 + Math.max(0, engineLevel - 1) * 0.04;
    const travelDays = Math.ceil(dist / (WARP_CONSTANTS.WARP_SPEED_PX_PER_DAY * engineSpeedMod));
    const eta = totalTicks.value + Math.ceil(travelDays * TICKS_PER_DAY);

    // 征途消耗：舰队规模 × 距离 × 基础费率（先校验国库，避免透支）
    const numShips = totalShips(fleet.composition);
    const warpCost = Math.ceil((numShips / WARP_COST.RATE_DIVISOR) * travelDays * WARP_COST.COST_PER_UNIT);
    const treasuryBefore = fleet.factionId === 1 ? factionGold.value.alliance : factionGold.value.empire;
    if (treasuryBefore < warpCost) return -2;

    // 设置 Warp 状态字段
    fleet.prevNodeId = fleet.currentNodeId;
    fleet.warpOriginId = fleet.currentNodeId;
    fleet.warpTargetId = targetNodeId;
    fleet.etaDay = eta;
    fleet.currentNodeId = -1; // 跃迁中：脱离星图
    fleet.status = 'warping' as any;
    fleet.moveProgress = 0;

    // 从当前节点驻军列表移除
    const nodeStore = useNodeStore();
    const originNode = (nodeStore.nodes as unknown as any[]).find((n: any) => n.id === fleet.prevNodeId);
    if (originNode && originNode.garrisonFleets) {
      originNode.garrisonFleets = originNode.garrisonFleets.filter((id: number) => id !== fleet.id);
    }

    // 扣款 + 记账（当日跃迁支出）
    if (fleet.factionId === 1) factionGold.value.alliance -= warpCost;
    else factionGold.value.empire -= warpCost;
    if (fleet.factionId === getPlayerFactionId()) {
      (adminStoreWarp as any).dailyWarpCost = ((adminStoreWarp as any).dailyWarpCost || 0) + warpCost;
    }

    return travelDays;
  }

  /** 发起 Warp 跃迁指令（玩家路径：含职权校验与提示） */
  function issueWarpOrder(fleetId: number, targetNodeId: number) {
    const fleet = strategicFleets.value.find(f => f.id === fleetId);
    if (!fleet) return;

    // 职权校验：校验玩家提督是否有权调动此舰队
    const playerAdmiral = allAdmirals.value.find(a => a.id === playerAdmiralId.value);
    if (playerAdmiral && !canCommandFleet(playerAdmiral, fleet)) {
      const fleetCmdr = allAdmirals.value.find(a => a.id === fleet.commanderId);
      const myRole = playerAdmiral.role === 'fleet_commander' ? '分舰队司令'
                   : playerAdmiral.role === 'fleet_staff' ? '参谋'
                   : playerAdmiral.role === 'none' ? '无职军官'
                   : playerAdmiral.role;
      triggerToast(`以${myRole}的职权，无权调动${fleetCmdr?.name || '该'}舰队。仅限直属上司或统帅级军官下令。`);
      return;
    }

    if (fleet.status !== 'idle') {
      triggerToast('该舰队正在执行任务中，无法下达瓦普指令！');
      return;
    }

    if (fleet.currentNodeId === targetNodeId) {
      triggerToast('舰队已在目标星域驻留。');
      return;
    }

    // P2修复：跃迁前预估费用，高消费（≥20万）弹二段确认，防误点白烧大额国库
    const fleetShips = totalShips(fleet.composition);
    const adminStorePre = useAdminStore();
    const engineLvl = (adminStorePre as any).adminState?.technology?.engineLevel || 1;
    const speedMod = 1 + Math.max(0, engineLvl - 1) * 0.04;
    const rawNodesPre = (strategicNodes.value as unknown as any[]);
    const curNode = rawNodesPre.find((n: any) => n.id === fleet.currentNodeId);
    const tgtNode = rawNodesPre.find((n: any) => n.id === targetNodeId);
    let estimatedCost = 0;
    let estDays = 0;
    if (curNode && tgtNode) {
      estDays = Math.ceil(euclideanDistance(
        { x: curNode.x, y: curNode.y }, { x: tgtNode.x, y: tgtNode.y }
      ) / (WARP_CONSTANTS.WARP_SPEED_PX_PER_DAY * speedMod));
      estimatedCost = Math.ceil((fleetShips / WARP_COST.RATE_DIVISOR) * estDays * WARP_COST.COST_PER_UNIT);
    }

    const doWarp = () => {
      const travelDays = applyWarpOrder(fleet, targetNodeId);
      if (travelDays === -2) {
        triggerToast('国库不足，无法负担本次瓦普跃迁的征途消耗。');
        return;
      }
      if (travelDays < 0) {
        triggerToast('目标星域无补给路径或数据异常，无法执行瓦普跃迁。');
        return;
      }
      const admiral = allAdmirals.value.find(a => a.id === fleet.commanderId);
      const targetName = (strategicNodes.value as unknown as any[]).find((n: any) => n.id === targetNodeId)?.name || '目标星域';
      triggerToast(`${admiral?.name || '未知舰队'} 开始瓦普跃迁，预计 ${travelDays} 日后抵达${targetName}。`);
    };

    if (estimatedCost >= 200000) {
      const targetName = tgtNode?.name || '目标星域';
      requestConfirm(
        '确认瓦普跃迁',
        `${fleetShips} 艘舰 · 约 ${estDays} 日 · 消耗约 ₮${Math.round(estimatedCost / 10000)}万`,
        estimatedCost,
        doWarp
      );
      return;
    }
    doWarp();
  }

  /** 发起 Warp 跃迁指令（AI 路径：跳过职权校验，标记为 AI 控制，无玩家提示） */
  function aiIssueWarpOrder(fleetId: number, targetNodeId: number) {
    const fleet = strategicFleets.value.find(f => f.id === fleetId);
    if (!fleet) return;
    const travelDays = applyWarpOrder(fleet, targetNodeId);
    if (travelDays < 0) return;
    (fleet as any).isAIControlled = true;
  }

  /** 每 Tick 检查 Warp 舰队到达（支持同时到达排队） */
  function checkArrivals(): StrategicFleet[] {
    const arrived: StrategicFleet[] = [];
    const rawNodes = (strategicNodes.value as unknown as any[]);

    strategicFleets.value.forEach(fleet => {
      if (fleet.status !== ('warping' as any)) return;
      if (fleet.etaDay === null) return;
      if (totalTicks.value < fleet.etaDay) return;

      // 抵达目标！
      fleet.status = 'arriving' as any;
      fleet.currentNodeId = fleet.warpTargetId!;
      fleet.etaDay = null;
      fleet.moveProgress = 0;

      // ===== 基础 AI 到达结算（静默自动，不暂停游戏）=====
      // 敌方舰队到达「非玩家」节点（中立）→ 直接自动攻占或自动会战
      // 敌方舰队到达「玩家」节点 → 防守方自动会战（有舰队）或静默占领通知（无防守）
      if (fleet.factionId !== getPlayerFactionId()) {
        const aiTargetNode = rawNodes.find((n: any) => n.id === fleet.warpTargetId);
        if (!aiTargetNode) { arrived.push(fleet); return; }
        if (aiTargetNode.ownerFactionId === getPlayerFactionId()) {
          // 敌军进攻玩家领土 → 防守反击（自动会战/占领通知，不弹进攻面板）
          handleEnemyAttackOnPlayer(fleet, aiTargetNode);
          arrived.push(fleet);
          return;
        }
        // 中立或其他AI节点 → 静默自动结算
        autoResolveAIArrival(fleet, aiTargetNode);
        arrived.push(fleet);
        return;
      }

      const targetNode = rawNodes.find((n: any) => n.id === fleet.warpTargetId);
      const isFriendlyArrival = targetNode && targetNode.ownerFactionId === fleet.factionId;

      // 友方领土抵达 → 直接入驻，不弹窗
      if (isFriendlyArrival) {
        fleet.status = 'idle' as any;
        fleet.warpOriginId = null;
        fleet.warpTargetId = null;
        fleet.etaDay = null;
        arrived.push(fleet);
        return;
      }

      const hasEnemyFleet = strategicFleets.value.some(
        f => f.id !== fleet.id && f.currentNodeId === fleet.warpTargetId && f.factionId !== fleet.factionId
      );
      const enemyFleet = strategicFleets.value.find(
        f => f.id !== fleet.id && f.currentNodeId === fleet.warpTargetId && f.factionId !== fleet.factionId
      );
      const enemyShipCount = enemyFleet
        ? totalShips(enemyFleet.composition)
        : 0;
      const enemyAdm = enemyFleet ? allAdmirals.value.find(a => a.id === enemyFleet.commanderId) : null;

      const ctx: ArrivalContext = {
        fleetId: fleet.id,
        targetNodeId: fleet.warpTargetId!,
        hasEnemyFleet,
        isPlanetOccupied: targetNode ? (targetNode.ownerFactionId !== fleet.factionId && targetNode.ownerFactionId !== 0) : false,
        enemyFleetId: enemyFleet?.id ?? null,
        enemyShipCount,
        enemyCommanderName: enemyAdm?.name ?? null,
      };

      // 排队：如果已有 pendingArrival 未处理，放入队列
      if (pendingArrival.value !== null) {
        arrivalQueue.value.push(ctx);
      } else {
        strategicPaused.value = true;
        pendingArrival.value = ctx;
      }
      arrived.push(fleet);
    });

    return arrived;
  }

  /**
   * 基础 AI 到达结算：敌方舰队抵达非玩家节点时的静默自动处理
   * - 无防守方 → 直接占领
   * - 有防守方 → 自动会战（复用 autoResolveBattle + 伤亡判定），胜则占领
   * 不修改 strategicPaused（尊重玩家手动暂停），不弹 pendingArrival 面板
   */
  function autoResolveAIArrival(fleet: any, targetNode: any) {
    const nodeName = targetNode?.name || '目标星域';
    const defenderFleet = strategicFleets.value.find(
      f => f.id !== fleet.id && f.currentNodeId === targetNode.id && f.factionId !== fleet.factionId
    );
    const admiral = allAdmirals.value.find(a => a.id === fleet.commanderId);

    // 无人防守 → 直接占领
    if (!defenderFleet) {
      const nodeStore = useNodeStore();
      nodeStore.captureNode(targetNode.id, fleet.factionId);
      fleet.currentNodeId = targetNode.id;
      fleet.status = 'idle' as any;
      fleet.warpOriginId = null;
      fleet.warpTargetId = null;
      fleet.etaDay = null;
      strategicNodes.value = nodeStore.nodes as unknown as StarNode[];
      triggerToast(`敌军攻陷 ${nodeName}（无人驻防）。`);
      resolveArrivalsAtNode(targetNode.id, fleet.factionId);
      return;
    }

    // 有防守方 → 自动会战
    const defenderAdm = allAdmirals.value.find(a => a.id === defenderFleet.commanderId);
    const result = autoResolveBattle(fleet, defenderFleet, admiral, defenderAdm, targetNode.type || 'empty');

    // P0.3 伤亡判定（与玩家 AUTO_RESOLVE 路径一致）
    if (result.outcome !== BattleOutcome.STALEMATE) {
      rollSingleBattleCasualty(fleet, result.outcome === BattleOutcome.ROUT ? 'rout' : 'active', admiral);
    }
    if (defenderFleet && result.defenderRemaining <= 0) {
      rollSingleBattleCasualty(defenderFleet, 'destroyed', defenderAdm);
    }

    const outcomeLabels: Record<string, string> = {
      decisive_win: '决定性胜利', marginal_win: '微弱胜利', stalemate: '胶着', rout: '溃败',
    };
    // 对抗审查：占领判定与下方 captureNode 逻辑保持一致（微弱胜利需守方全灭）
    const occupied = (result.outcome === BattleOutcome.DECISIVE_WIN
      || (result.outcome === BattleOutcome.MARGINAL_WIN && result.defenderRemaining <= 0))
      && result.attackerRemaining > 0;
    triggerToast(
      `敌军于 ${nodeName} 与 ${defenderAdm?.name || '守军'} 交战，${outcomeLabels[result.outcome] || '未知'}` +
      `（损失 ${result.attackerLosses} 艘 / 剩余 ${result.attackerRemaining}` +
      `${occupied ? '，已攻占该星域' : ''}）`
    );

    // 防守方全灭清理
    if (result.defenderRemaining <= 0) destroyFleetCleanup(defenderFleet.id);

    // 溃败：攻方撤退或全灭
    if (result.outcome === BattleOutcome.ROUT) {
      if (result.attackerRemaining <= 0) {
        destroyFleetCleanup(fleet.id);
      } else {
        fleet.currentNodeId = targetNode.id;
        retreatFleet(fleet.id);
      }
      return;
    }

    // 胶着：攻方驻留轨道但不占领
    if (result.outcome === BattleOutcome.STALEMATE) {
      fleet.currentNodeId = targetNode.id;
      fleet.status = 'idle' as any;
      fleet.warpOriginId = null; fleet.warpTargetId = null; fleet.etaDay = null;
      return;
    }

    // 胜利：占领节点（对抗审查：微弱胜利守方有残部时只驻留不占领）
    const canOccupy = result.outcome === BattleOutcome.DECISIVE_WIN
      || (result.outcome === BattleOutcome.MARGINAL_WIN && result.defenderRemaining <= 0);
    if (canOccupy && result.attackerRemaining > 0) {
      const nodeStore = useNodeStore();
      nodeStore.captureNode(targetNode.id, fleet.factionId);
      fleet.currentNodeId = targetNode.id;
      fleet.status = 'idle' as any;
      fleet.warpOriginId = null; fleet.warpTargetId = null; fleet.etaDay = null;
      strategicNodes.value = nodeStore.nodes as unknown as StarNode[];
      resolveArrivalsAtNode(targetNode.id, fleet.factionId);
    } else if (result.outcome === BattleOutcome.MARGINAL_WIN && result.defenderRemaining > 0) {
      // 微弱胜利但守方残部尚存：攻方驻留轨道（形成对峙，残部保留）
      fleet.currentNodeId = targetNode.id;
      fleet.status = 'idle' as any;
      fleet.warpOriginId = null; fleet.warpTargetId = null; fleet.etaDay = null;
    }
  }

  /**
   * 敌军进攻玩家节点：防守方自动会战（有舰队）或静默占领（无防守）
   * 不弹 pendingArrival 面板——玩家不应见到"自动占领/取消"的进攻选项
   */
  function handleEnemyAttackOnPlayer(fleet: any, targetNode: any) {
    const nodeName = targetNode?.name || '目标星域';
    // 查找该节点的玩家防守舰队
    const pFactionId = getPlayerFactionId();
    const defenderFleet = strategicFleets.value.find(
      f => f.factionId === pFactionId && f.currentNodeId === targetNode.id
    );

    if (!defenderFleet) {
      // 无人防守 → 敌军占领，通知玩家
      const nodeStore = useNodeStore();
      nodeStore.captureNode(targetNode.id, fleet.factionId);
      fleet.currentNodeId = targetNode.id;
      fleet.status = 'idle' as any;
      fleet.warpOriginId = null; fleet.warpTargetId = null; fleet.etaDay = null;
      strategicNodes.value = nodeStore.nodes as unknown as StarNode[];
      triggerToast(`紧急：敌军攻陷 ${nodeName}（无人驻防）！`);
      resolveArrivalsAtNode(targetNode.id, fleet.factionId);
      return;
    }

    // 有玩家舰队防守 → 自动会战
    const admiral = allAdmirals.value.find(a => a.id === fleet.commanderId);
    const defenderAdm = allAdmirals.value.find(a => a.id === defenderFleet.commanderId);
    const result = autoResolveBattle(fleet, defenderFleet, admiral, defenderAdm, targetNode.type || 'empty');

    // 伤亡判定
    if (result.outcome !== BattleOutcome.STALEMATE) {
      rollSingleBattleCasualty(fleet, result.outcome === BattleOutcome.ROUT ? 'rout' : 'active', admiral);
    }
    if (defenderFleet && result.defenderRemaining <= 0) {
      rollSingleBattleCasualty(defenderFleet, 'destroyed', defenderAdm);
    }

    const outcomeLabels: Record<string, string> = {
      decisive_win: '敌军决定性胜利', marginal_win: '敌军微弱胜利', stalemate: '双方胶着', rout: '敌军溃败',
    };
    // 对抗审查：占领判定与下方 captureNode 逻辑保持一致（微弱胜利需玩家守军全灭）
    const occupied = (result.outcome === BattleOutcome.DECISIVE_WIN
      || (result.outcome === BattleOutcome.MARGINAL_WIN && result.defenderRemaining <= 0))
      && result.attackerRemaining > 0;

    triggerToast(
      `${nodeName} 遭遇敌军突袭！${defenderAdm?.name || '守军'} 迎战，${outcomeLabels[result.outcome] || '未知'}` +
      `（敌军剩余 ${result.attackerRemaining} 舰·${result.defenderRemaining <= 0 && occupied ? '已失守' : '防线守住'}）`
    );

    if (result.defenderRemaining <= 0) destroyFleetCleanup(defenderFleet.id);
    if (result.attackerRemaining <= 0 && result.outcome === BattleOutcome.ROUT) {
      destroyFleetCleanup(fleet.id);
    }

    // 敌军占领节点（对抗审查：微弱胜利守方[此处=玩家守军]残部尚存时不占领）
    const canOccupy = result.outcome === BattleOutcome.DECISIVE_WIN
      || (result.outcome === BattleOutcome.MARGINAL_WIN && result.defenderRemaining <= 0);
    if (canOccupy && result.attackerRemaining > 0) {
      const nodeStore = useNodeStore();
      nodeStore.captureNode(targetNode.id, fleet.factionId);
      fleet.currentNodeId = targetNode.id;
      fleet.status = 'idle' as any;
      fleet.warpOriginId = null; fleet.warpTargetId = null; fleet.etaDay = null;
      strategicNodes.value = nodeStore.nodes as unknown as StarNode[];
      resolveArrivalsAtNode(targetNode.id, fleet.factionId);
    } else {
      fleet.currentNodeId = targetNode.id;
      fleet.status = 'idle' as any;
      fleet.warpOriginId = null; fleet.warpTargetId = null; fleet.etaDay = null;
    }
  }

  /**
   * 基础 AI 战略回合：敌方阵营（非玩家阵营）的自动决策
   * 行为树（简化版）：
   *   1. 集结：将空闲舰队派往最近的「可达且非己方」前线节点（敌方或中立）
   *   2. 防御预备：最后一支防守前线节点的舰队不调动，避免腹地空虚
   *   3. 节制：每回合最多发动有限次进攻，避免瞬间压垮玩家
   * [PLACEHOLDER] MAX_AI_MOVES_PER_TURN / AI_TURN_INTERVAL 需在 playtest 中调参
   */
  function runAIStrategicTurn(factionId: number, excludeCommanderId?: number) {
    const admiralStore = useAdmiralStore();
    runAIStrategicTurnEngine(
      {
        strategicNodes: strategicNodes.value as unknown as any[],
        strategicFleets: strategicFleets.value,
        factionGold: factionGold.value,
        admirals: admiralStore.admirals as unknown as any[],
      },
      factionId,
      aiIssueWarpOrder,
      excludeCommanderId
    );
  }

  /**
   * 己方自动防御 AI：当敌方舰队逼近我方星球或首都时，自动调动己方空闲舰队拦截
   * 每轮最多派遣 2 支舰队，优先保护首都和前线节点
   */
  function runPlayerDefensiveAI() {
    runFactionDefensiveAI(getPlayerFactionId());
  }

  /** 指定阵营的防御 AI（回防/拦截；防御引擎为通用实现，可作用于任意阵营） */
  function runFactionDefensiveAI(factionId: number) {
    const admiralStore = useAdmiralStore();
    // 玩家阵营：排除玩家亲自指挥的舰队，避免防御 AI 越权调动
    const excludeId = factionId === getPlayerFactionId() ? playerAdmiralId.value : undefined;
    runPlayerDefensiveAIEngine(
      {
        strategicNodes: strategicNodes.value as unknown as any[],
        strategicFleets: strategicFleets.value,
        factionGold: factionGold.value,
        admirals: admiralStore.admirals as unknown as any[],
      },
      factionId,
      aiIssueWarpOrder,
      excludeId
    );
  }

  /** 撤退舰队：向 prevNodeId 跃迁，承受 3-8% 舰艇损失 */
  function retreatFleet(fleetId: number) {
    const fleet = strategicFleets.value.find(f => f.id === fleetId);
    if (!fleet) return;

    // 撤退损失 3-8%（覆盖全部6舰种）
    let lossRatio = RETREAT_LOSS.MIN + Math.random() * (RETREAT_LOSS.MAX - RETREAT_LOSS.MIN);
    // 「撤退的艺术」：圆形阵 + 冷静/铁壁特技的提督组织有序撤退，损失减半
    const retreatAdm = allAdmirals.value.find(a => a.id === fleet.commanderId);
    const retreatSkills: string[] = (retreatAdm as any)?.skills?.map((s: any) => s.id || s) || [];
    if ((fleet.formation === 'circle') && (retreatSkills.includes('calm') || retreatSkills.includes('iron_wall'))) {
      lossRatio *= 0.5;
    }
    const c = fleet.composition;
    c.battleships = Math.max(0, Math.floor(c.battleships * (1 - lossRatio)));
    c.fastBattleships = Math.max(0, Math.floor(c.fastBattleships * (1 - lossRatio)));
    c.cruisers = Math.max(0, Math.floor(c.cruisers * (1 - lossRatio)));
    c.destroyers = Math.max(0, Math.floor(c.destroyers * (1 - lossRatio)));
    c.carriers = Math.max(0, Math.floor(c.carriers * (1 - lossRatio)));
    c.fighters = Math.max(0, Math.floor(c.fighters * (1 - lossRatio)));

    const rawNodes = (strategicNodes.value as unknown as any[]);
    const currentNode = rawNodes.find((n: any) => n.id === (fleet.currentNodeId >= 0 ? fleet.currentNodeId : fleet.warpTargetId));
    const prevNode = rawNodes.find((n: any) => n.id === fleet.prevNodeId);

    // 检查撤退目标是否已沦陷
    let retreatTargetId = fleet.prevNodeId;
    let retreatTarget = prevNode;
    let fallbackUsed = false;

    if (!prevNode || prevNode.ownerFactionId !== fleet.factionId) {
      // 原据点已沦陷，改向最近己方首都撤退
      const capitalId = findNearestFriendlyCapital(
        fleet.currentNodeId >= 0 ? fleet.currentNodeId : (fleet.warpTargetId || 0),
        fleet.factionId
      );
      if (capitalId !== null) {
        retreatTargetId = capitalId;
        retreatTarget = rawNodes.find((n: any) => n.id === capitalId) || null;
        fallbackUsed = true;
      } else if (fleet.prevNodeId !== null && fleet.prevNodeId >= 0) {
        // 无可用首都，仍退向 prevNode（最终保险）
        retreatTargetId = fleet.prevNodeId;
        retreatTarget = prevNode;
      } else {
        triggerToast('该舰队无可用撤退路径。');
        return;
      }
    }

    if (currentNode && retreatTarget) {
      const dist = euclideanDistance(
        { x: currentNode.x, y: currentNode.y },
        { x: retreatTarget.x, y: retreatTarget.y }
      );
      const travelDays = Math.ceil(dist / WARP_CONSTANTS.WARP_SPEED_PX_PER_DAY);
      fleet.etaDay = totalTicks.value + Math.ceil(travelDays * TICKS_PER_DAY);
    } else {
      fleet.etaDay = totalTicks.value + TICKS_PER_DAY;
    }

    fleet.warpTargetId = retreatTargetId;
    fleet.warpOriginId = fleet.currentNodeId >= 0 ? fleet.currentNodeId : (fleet.warpTargetId ?? fleet.prevNodeId);
    fleet.currentNodeId = -1;
    fleet.status = 'warping' as any;

    const admiral = allAdmirals.value.find(a => a.id === fleet.commanderId);
    if (fallbackUsed) {
      triggerToast(`${admiral?.name || '舰队'} 原据点已沦陷，改向${retreatTarget?.name || '首都星域'}撤退。损失约 ${Math.round(lossRatio * 100)}% 舰艇。`);
    } else {
      triggerToast(`${admiral?.name || '舰队'} 开始撤退瓦普跃迁，途中损失约 ${Math.round(lossRatio * 100)}% 舰艇。`);
    }
  }

  // ===== 阶段六：自动战斗与占领系统 =====

  /** 计算舰队在指定角色下的战斗力 */
  function calculatePower(
    fleet: StrategicFleet, role: 'attack' | 'defense', admiral: any, nodeType?: string
  ): number {
    const tech = (useAdminStore() as any).adminState?.technology;
    const formation = fleet.formation || DEFAULT_FORMATION;
    const formMod = getFormationCombatMods(formation);
    const basePower = calculatePowerEngine(fleet, role, admiral, nodeType, tech, admiral?.skills || []);
    return basePower * (role === 'attack' ? formMod.attackMod : formMod.defenseMod);
  }

  /** 随机损失比例 */
  function rollBoundedLoss(minPct: number, maxPct: number): number { return rollBoundedLossEngine(minPct, maxPct); }

  /** 按比例削减编成（阵型克制等追加损失用） */
  function applyLossToCompLocal(c: FleetComposition, p: number): FleetComposition {
    return {
      battleships: Math.max(0, Math.floor(c.battleships * (1 - p))),
      fastBattleships: Math.max(0, Math.floor(c.fastBattleships * (1 - p))),
      cruisers: Math.max(0, Math.floor(c.cruisers * (1 - p))),
      destroyers: Math.max(0, Math.floor(c.destroyers * (1 - p))),
      carriers: Math.max(0, Math.floor(c.carriers * (1 - p))),
      fighters: Math.max(0, Math.floor(c.fighters * (1 - p))),
    };
  }

  /** 自动战斗结算 */
  function autoResolveBattle(
    attackerFleet: StrategicFleet,
    defenderFleet: StrategicFleet,
    admiralA: any,
    admiralB: any,
    nodeType: string
  ): AutoResolveResult {
    const tech = (useAdminStore() as any).adminState?.technology;
    const atkForm = attackerFleet.formation || DEFAULT_FORMATION;
    const defForm = defenderFleet.formation || DEFAULT_FORMATION;
    // 双向互克：攻方阵型克守方 / 守方阵型克攻方
    const counterAtk = getFormationCounterBonus(atkForm, defForm);
    const counterDef = getFormationCounterBonus(defForm, atkForm);
    const result = autoResolveBattleEngine(
      attackerFleet, defenderFleet, admiralA, admiralB, nodeType, tech,
      admiralA?.skills || [],
      admiralB?.skills || []
    );
    // 攻方阵型克制守方 → 守方追加损失（P1修复：把克制效果写回编成，原版只改战报数字）
    if (counterAtk > 1.0) {
      const extraLossPct = Math.min(0.20, (counterAtk - 1.0) * 0.25); // 克制1.2→追加5%，1.5→12.5%，封顶20%
      const before = totalShips(defenderFleet.composition);
      defenderFleet.composition = applyLossToCompLocal(defenderFleet.composition, extraLossPct);
      result.defenderLosses = before - totalShips(defenderFleet.composition);
      result.defenderRemaining = totalShips(defenderFleet.composition);
    }
    // 守方阵型克制攻方 → 攻方追加损失
    if (counterDef > 1.0) {
      const extraLossPct = Math.min(0.20, (counterDef - 1.0) * 0.25);
      const before = totalShips(attackerFleet.composition);
      attackerFleet.composition = applyLossToCompLocal(attackerFleet.composition, extraLossPct);
      result.attackerLosses = before - totalShips(attackerFleet.composition);
      result.attackerRemaining = totalShips(attackerFleet.composition);
    }
    const attackPower = calculatePower(attackerFleet, 'attack', admiralA);
    const defensePower = calculatePower(defenderFleet, 'defense', admiralB, nodeType);
    const ratio = defensePower > 0 ? attackPower / defensePower : 99;
    return { ...result, ratio: Math.round(ratio * 100) / 100 };
  }

  /** 占领行星（无防守的节点） */
  function occupyPlanet(fleetId: number) {
    const ctx = pendingArrival.value;
    if (!ctx) return;

    const fleet = strategicFleets.value.find(f => f.id === fleetId);
    if (!fleet) return;

    // 0-舰 守卫检查
    const shipCount = totalShips(fleet.composition);
    if (shipCount <= 0) {
      triggerToast('舰队已无可用舰船，无法执行占领行动。');
      return;
    }

    // 推进 1 天
    internalTickCounter.value += TICKS_PER_DAY;
    advanceUniverseDate();

    // 占领损失 8%（覆盖全部6舰种）
    const lossPct = WARP_CONSTANTS.OCCUPATION_SHIP_LOSS_RATIO;
    const compBefore = { ...fleet.composition };
    fleet.composition.battleships = Math.max(0, Math.floor(fleet.composition.battleships * (1 - lossPct)));
    fleet.composition.fastBattleships = Math.max(0, Math.floor(fleet.composition.fastBattleships * (1 - lossPct)));
    fleet.composition.cruisers = Math.max(0, Math.floor(fleet.composition.cruisers * (1 - lossPct)));
    fleet.composition.destroyers = Math.max(0, Math.floor(fleet.composition.destroyers * (1 - lossPct)));
    fleet.composition.carriers = Math.max(0, Math.floor(fleet.composition.carriers * (1 - lossPct)));
    fleet.composition.fighters = Math.max(0, Math.floor(fleet.composition.fighters * (1 - lossPct)));

    const lostTotal = totalShips(compBefore) - totalShips(fleet.composition);

    // 节点易主
    const nodeStore = useNodeStore();
    nodeStore.captureNode(ctx.targetNodeId, fleet.factionId);
    adminMerit.value += 300;

    // 舰队驻留
    fleet.currentNodeId = ctx.targetNodeId;
    fleet.status = 'idle' as any;
    fleet.warpOriginId = null;
    fleet.warpTargetId = null;
    fleet.etaDay = null;

    // 同步 strategicNodes
    strategicNodes.value = nodeStore.nodes as unknown as StarNode[];

    // 报告占领（简化：仅 toast，由战后面板处理交互）
    const admiral = allAdmirals.value.find(a => a.id === fleet.commanderId);
    const rawNodes = (strategicNodes.value as unknown as any[]);
    const targetNode = rawNodes.find((n: any) => n.id === ctx.targetNodeId);
    const nodeName = targetNode?.name || '目标星域';
    const fac = fleet.factionId === 1 ? 'alliance' : 'empire';

    triggerToast(`${admiral?.name || '舰队'} 成功占领 ${nodeName}，损失 ${lostTotal} 艘舰艇。`);

    // ===== 战后处置：玩家舰队 → 三选一（占领/掠夺/解放）=====
    // AI 舰队占领则直接完成，不弹出决策
    const pFactionId = getPlayerFactionId();
    if (fleet.factionId === pFactionId) {
      pendingCaptureDecision.value = { fleetId, nodeId: ctx.targetNodeId };
      return; // 保持暂停，等待玩家决策
    }

    // AI 占领 → 直接完成
    finalizeOccupyPlanet(ctx.fleetId, ctx.targetNodeId);
  }

  /** 占领收尾：清除到达状态、设置战报、解除暂停 */
  function finalizeOccupyPlanet(fleetId: number, targetNodeId: number) {
    pendingArrival.value = null;
    pendingPostBattle.value = {
      fleetId,
      nodeId: targetNodeId,
      result: null,
      wasManualBattle: false,
      fleetSurvived: true,
    };
    strategicPaused.value = false;
    resolveArrivalsAtNode(targetNodeId, getPlayerFactionId());
  }

  /** 战后处置 — 占领：常规收益，星球归玩家阵营 */
  function handleCaptureOccupy() {
    const dec = pendingCaptureDecision.value;
    if (!dec) return;
    pendingCaptureDecision.value = null;
    finalizeOccupyPlanet(dec.fleetId, dec.nodeId);

    // 连锁反应：占领会触发AI重新评估边境安全
    const rawNodes = (strategicNodes.value as unknown as any[]);
    const node = rawNodes.find((n: any) => n.id === dec.nodeId);
    const nodeName = node?.name || '目标星域';
    const playerFaction = factions.value.find((f: any) => f.type === 'player');
    const playerTeam = playerFaction?.team;
    const oldOwner = factions.value.find((f: any) => f.id === node?.ownerId && f.id !== playerFaction?.id);

    chainReactions.value.push({
      type: 'occupy', nodeId: dec.nodeId, nodeName,
      turn: totalTicks.value + 3 + Math.floor(Math.random() * 4), // 3-6回合后触发
      description: `AI正在评估${nodeName}失守后的战略态势`,
      effect: () => {
        triggerToast(`情报：敌方对${nodeName}的失守做出反应，周边星系开始加固防御。`);
        // 周边敌对星系防御+20%
        rawNodes.forEach((n: any) => {
          if (n.id !== dec.nodeId && factions.value.find((f: any) => f.id === n.ownerId && f.team !== playerTeam)) {
            n.defenseHp = Math.min(200, (n.defenseHp || 50) * 1.2);
          }
        });
      }
    });

    triggerToast(`占领：${nodeName} 已纳入我方管辖。敌军预计3-6回合内做出反应。`);
    // PP: 占领=政治威望+300
    const pAdmOcc = allAdmirals.value.find((a: any) => a.id === playerAdmiralId.value);
    if (pAdmOcc) pAdmOcc.politicalWork = (pAdmOcc.politicalWork || 0) + 300;
  }

  /** 战后处置 — 掠夺：立即获得 gold，星球经济/防御永久下降 */
  function handleCapturePillage() {
    const dec = pendingCaptureDecision.value;
    if (!dec) return;
    pendingCaptureDecision.value = null;

    const rawNodes = (strategicNodes.value as unknown as any[]);
    const node = rawNodes.find((n: any) => n.id === dec.nodeId);
    const pillageGold = (node?.economy || 500) * WAR_ECONOMY.pillageMul + (node?.defenseHp || 50) * WAR_ECONOMY.pillageHpMul;
    metaGold.value += pillageGold;

    // 掠夺惩罚：经济/防御/治安受损（统一引用 WAR_ECONOMY 单一真源）
    if (node) {
      node.economy = Math.max((node.economy || 0) * (1 - WAR_ECONOMY.pillageEconomyDamage), WAR_ECONOMY.pillageMinStat);
      node.defenseHp = Math.max((node.defenseHp || 0) * (1 - WAR_ECONOMY.pillageDefenseDamage), WAR_ECONOMY.pillageMinStat);
      node.security = Math.max((node.security || 60) * (1 - WAR_ECONOMY.pillageSecurityDamage), 15);
    }

    triggerToast(`掠夺：从目标星域搜刮获得 ${pillageGold.toFixed(0)} 资金，当地经济与防御遭受重创。`);
    // PP: 掠夺=威压统治+200（但声望受损）
    const pAdmPill = allAdmirals.value.find((a: any) => a.id === playerAdmiralId.value);
    if (pAdmPill) pAdmPill.politicalWork = (pAdmPill.politicalWork || 0) + 200;
    finalizeOccupyPlanet(dec.fleetId, dec.nodeId);

    // 连锁反应：掠夺导致名声下降，未来外交困难
    const pNodeName = node?.name || '目标星域';
    playerMerit.value = Math.max(0, playerMerit.value - 150);
    chainReactions.value.push({
      type: 'pillage', nodeId: dec.nodeId, nodeName: pNodeName,
      turn: totalTicks.value + 5,
      description: `掠夺${pNodeName}的恶名在外流传`,
      effect: () => {
        triggerToast(`传闻：${pNodeName}遭掠夺一事在银河间传开，你的声望受损。`);
        const nList = (strategicNodes.value as unknown as any[]);
        nList.forEach((n: any) => {
          if (n.ownerId === 0 && n.inclination !== undefined) n.inclination = Math.max(0, n.inclination - 10);
        });
      }
    });
  }

  /** 战后处置 — 解放：星球回归中立，获得大量功勋 */
  function handleCaptureLiberate() {
    const dec = pendingCaptureDecision.value;
    if (!dec) return;
    pendingCaptureDecision.value = null;

    const nodeStore = useNodeStore();
    nodeStore.captureNode(dec.nodeId, 0); // 0 = 中立
    strategicNodes.value = nodeStore.nodes as unknown as StarNode[];
    tacticalMerit.value += 300; // [PLACEHOLDER] 解放功勋
    // PP: 光荣解放=巨大政治声望+500
    const pAdmLib = allAdmirals.value.find((a: any) => a.id === playerAdmiralId.value);
    if (pAdmLib) pAdmLib.politicalWork = (pAdmLib.politicalWork || 0) + 500;

    const rawNodes = (strategicNodes.value as unknown as any[]);
    const node = rawNodes.find((n: any) => n.id === dec.nodeId);
    triggerToast(`解放：${node?.name || '目标星域'} 回归中立状态，获得 300 战术功勋。`);
    finalizeOccupyPlanet(dec.fleetId, dec.nodeId);

    // 连锁反应：解放获外交好感
    const lNodeName = node?.name || '目标星域';
    playerMerit.value = Math.min(99999, playerMerit.value + 100);
    chainReactions.value.push({
      type: 'liberate', nodeId: dec.nodeId, nodeName: lNodeName,
      turn: totalTicks.value + 4,
      description: `${lNodeName}人民对你的解放行动心存感激`,
      effect: () => {
        triggerToast(`外交简报：${lNodeName}在解放后恢复了自治，同盟势力对你的信任上升。`);
        metaGold.value += 20000;
      }
    });
  }

  /** 占领/攻占节点后，将同节点其他到达中的舰队设为 idle */
  function resolveArrivalsAtNode(nodeId: number, factionId: number) {
    arrivalQueue.value = arrivalQueue.value.filter(q => {
      if (q.targetNodeId === nodeId) {
        const f = strategicFleets.value.find(ff => ff.id === q.fleetId);
        if (f) { f.status = 'idle' as any; f.warpOriginId = null; f.warpTargetId = null; f.etaDay = null; f.currentNodeId = nodeId; }
        return false;
      }
      return true;
    });
    strategicFleets.value.forEach(f => {
      if (f.status === ('arriving' as any) && f.currentNodeId === nodeId && f.factionId === factionId) {
        f.status = 'idle' as any; f.warpOriginId = null; f.warpTargetId = null; f.etaDay = null;
      }
    });
  }

  /** 统一入口：处理舰队到达后的决策 */
  function handleArrivalDecision(decisionType: ArrivalDecisionType) {
    const ctx = pendingArrival.value;
    if (!ctx) return;

    const fleet = strategicFleets.value.find(f => f.id === ctx.fleetId);
    if (!fleet) return;

    const admiral = allAdmirals.value.find(a => a.id === fleet.commanderId);

    switch (decisionType) {
      case ArrivalDecisionType.AUTO_OCCUPY: {
        // 自动占领（无防守节点）
        occupyPlanet(ctx.fleetId);
        break;
      }

      case ArrivalDecisionType.AUTO_RESOLVE: {
        // AI 自动裁决
        const defenderFleet = strategicFleets.value.find(
          f => f.id !== fleet.id && f.currentNodeId === ctx.targetNodeId && f.factionId !== fleet.factionId
        );
        if (!defenderFleet) {
          // 无防守者 → 自动占领
          occupyPlanet(ctx.fleetId);
          break;
        }

        const defenderAdm = allAdmirals.value.find(a => a.id === defenderFleet.commanderId);
        const rawNodes = (strategicNodes.value as unknown as any[]);
        const targetNode = rawNodes.find((n: any) => n.id === ctx.targetNodeId);
        const nodeType = targetNode?.type || 'empty';

        const result = autoResolveBattle(fleet, defenderFleet, admiral, defenderAdm, nodeType);

        // 战术功勋奖惩
        const meritMap: Record<string, number> = {
          decisive_win: 500,
          marginal_win: 200,
          stalemate: 50,
          rout: -100,
        };
        tacticalMerit.value += meritMap[result.outcome] || 0;
        if (result.outcome === 'decisive_win') adminMerit.value += 200;
        else if (result.outcome === 'marginal_win') adminMerit.value += 100;

        // P0.3: 自动战斗伤亡判定
        if (result.outcome !== BattleOutcome.STALEMATE) {
          rollSingleBattleCasualty(fleet, result.outcome === BattleOutcome.ROUT ? 'rout' : 'active', admiral);
        }
        // 旗舰系统：溃败 → 旗舰被击沉风险
        if (result.outcome === BattleOutcome.ROUT && admiral && Math.random() < 0.3) {
          admiral.injury = { isInjured: true, severity: 80, recoveryTicks: 60 };
          const name = admiral.name || '提督';
          flagshipDestroyed.value = { name, fleetName: (fleet as any).name || '', admiralId: admiral.id };
          triggerToast(`💥 ${name} 的旗舰被击沉！提督重伤。`);
        }
        if (defenderFleet && result.defenderRemaining <= 0) {
          rollSingleBattleCasualty(defenderFleet, 'destroyed', defenderAdm);
        }

        // 防御方全灭清理
        if (result.defenderRemaining <= 0) destroyFleetCleanup(defenderFleet.id);

        // v3 军人抚恤：按损失总舰数按编成比例估算各舰种损失
        const myComp: Record<string, number> = fleet.composition || {};
        const compTotal = Object.values(myComp).reduce((s, v) => s + (v || 0), 0);
        if (compTotal > 0 && result.attackerLosses > 0) {
          const estLoss = (type: string) => Math.round(((myComp[type] || 0) / compTotal) * result.attackerLosses);
          const adminStore2 = useAdminStore();
          const pension = adminStore2.applyPension({
            battleships: estLoss('battleships') + estLoss('fastBattleships'),
            cruisers: estLoss('cruisers'),
            destroyers: estLoss('destroyers'),
            carriers: estLoss('carriers'),
            fighters: estLoss('fighters'),
          });
          if (pension > 0) triggerToast(`⚰️ 抚恤金支出 ₮${Math.round(pension / 10000)}万（${result.attackerLosses}艘舰阵亡）`);
        }

        // 报告战斗结果
        const fac = fleet.factionId === 1 ? 'alliance' : 'empire';
        const nodeName = targetNode?.name || '目标星域';
        const outcomeLabels: Record<string, [string, string]> = {
          decisive_win: ['决定性胜利', '#10b981'],
          marginal_win: ['微弱胜利', '#f59e0b'],
          stalemate: ['胶着', '#94a3b8'],
          rout: ['溃败', '#ef4444'],
        };
        const [outcomeLabel, outcomeColor] = outcomeLabels[result.outcome] || ['未知', '#94a3b8'];

        // ✅ 修复：不再用 commsMessage（fixed overlay 会覆盖 Phaser canvas 阻塞地图），
        // 改用非阻塞的 triggerToast；详细信息由战后战报面板（pendingPostBattle）展示
        const occupied = result.outcome === BattleOutcome.DECISIVE_WIN
          || (result.outcome === BattleOutcome.MARGINAL_WIN && result.defenderRemaining <= 0);
        const occupiedFinal = occupied && result.attackerRemaining > 0;
        triggerToast(
          `战斗报告 — ${nodeName}：${outcomeLabel}` +
          `（战力比 ${result.ratio}:1，我军损失 ${result.attackerLosses} 艘 / 剩余 ${result.attackerRemaining}` +
          `，敌军损失 ${result.defenderLosses} 艘 / 剩余 ${result.defenderRemaining}` +
          `${occupiedFinal ? '，已占领该星域' : ''}）`
        );

        // 溃败时自动撤退
        if (result.outcome === BattleOutcome.ROUT) {
          // 先清除到达状态
          fleet.currentNodeId = ctx.targetNodeId;
          fleet.status = 'arriving' as any;
          pendingArrival.value = null;

          pendingPostBattle.value = {
            fleetId: fleet.id,
            nodeId: ctx.targetNodeId,
            result,
            wasManualBattle: false,
            fleetSurvived: result.attackerRemaining > 0,
          };
          // 延迟撤退（给 UI 显示结果的时间）
          break;
        }

        // 占领节点（对抗审查：微弱胜利守方残部尚存时只驻留轨道，不占领）
        const canOccupyPlayer = result.outcome === BattleOutcome.DECISIVE_WIN
          || (result.outcome === BattleOutcome.MARGINAL_WIN && result.defenderRemaining <= 0);
        if (canOccupyPlayer && result.attackerRemaining > 0) {
          const nodeStore = useNodeStore();
          nodeStore.captureNode(ctx.targetNodeId, fleet.factionId);
          fleet.currentNodeId = ctx.targetNodeId;
          fleet.status = 'idle' as any;
          fleet.warpOriginId = null;
          fleet.warpTargetId = null;
          fleet.etaDay = null;
          strategicNodes.value = nodeStore.nodes as unknown as StarNode[];
        } else if (result.outcome === BattleOutcome.MARGINAL_WIN && result.defenderRemaining > 0 || result.outcome === BattleOutcome.STALEMATE) {
          // 微弱胜利但守方残部尚存 / 胶着：攻方驻留轨道但未占领
          fleet.currentNodeId = ctx.targetNodeId;
          fleet.status = 'idle' as any;
        }

        pendingArrival.value = null;
        pendingPostBattle.value = {
          fleetId: fleet.id,
          nodeId: ctx.targetNodeId,
          result,
          wasManualBattle: false,
          fleetSurvived: result.attackerRemaining > 0,
        };
        strategicPaused.value = false;
        // 胜利后清理同节点其他到达舰队（对抗审查：仅确认占领后执行）
        if (occupiedFinal) {
          resolveArrivalsAtNode(ctx.targetNodeId, fleet.factionId);
        }
        break;
      }

      case ArrivalDecisionType.MANUAL_BATTLE: {
        // 手动会战：清理到达状态，直接触发战术会战
        pendingArrival.value = null;

        const defenderFleet = strategicFleets.value.find(
          f => f.id !== fleet.id && f.currentNodeId === ctx.targetNodeId && f.factionId !== fleet.factionId
        );
        if (!defenderFleet) {
          triggerToast('未检测到敌方舰队，自动转为占领行动。');
          occupyPlanet(fleet.id);
          break;
        }

        // 直接触发战术会战（gameState='game' → App.vue 挂载 BattleScene）
        fleet.currentNodeId = ctx.targetNodeId;
        triggerTacticalBattle(ctx.targetNodeId, [fleet, defenderFleet]);
        break;
      }

      case ArrivalDecisionType.RETREAT: {
        // 撤退
        fleet.currentNodeId = ctx.targetNodeId; // 临时设置以便 retreatFleet 计算距离
        pendingArrival.value = null;
        retreatFleet(ctx.fleetId);
        strategicPaused.value = false;
        break;
      }

      case ArrivalDecisionType.CANCEL: {
        // 取消（驻留轨道）
        fleet.currentNodeId = ctx.targetNodeId;
        fleet.status = 'idle' as any;
        fleet.warpOriginId = null;
        fleet.warpTargetId = null;
        fleet.etaDay = null;
        pendingArrival.value = null;
        strategicPaused.value = false;
        triggerToast(`${admiral?.name || '舰队'} 已驻留在 ${ctx.targetNodeId} 轨道，待命。`);
        break;
      }
    }

    // 处理下一个排队到达
    popNextArrival();

    // 检查舰队是否全军覆没
    destroyFleetCleanup(fleet.id);
  }

  /** 弹出到达队列中的下一个（如果有） */
  function popNextArrival() {
    if (arrivalQueue.value.length === 0) {
      pendingArrival.value = null;
      return;
    }
    const next = arrivalQueue.value.shift()!;
    strategicPaused.value = true;
    pendingArrival.value = next;
  }

  /** 舰队全灭清理：提督负伤、移编 */
  function destroyFleetCleanup(fleetId: number) {
    const fleet = strategicFleets.value.find(f => f.id === fleetId);
    if (!fleet) return;
    const numShips = totalShips(fleet.composition);
    if (numShips > 0) return;

    const admiral = allAdmirals.value.find(a => a.id === fleet.commanderId);
    if (admiral) {
      admiral.injury = { isInjured: true, severity: 70, recoveryTicks: 200 };
      admiral.state = 'idle';
      admiral.currentNodeId = null;
      admiral.assignedFleetId = null;
    }

    const idx = strategicFleets.value.findIndex(f => f.id === fleetId);
    if (idx >= 0) strategicFleets.value.splice(idx, 1);

    const fac = fleet.factionId === 1 ? 'alliance' : 'empire';
    // ✅ 修复：不再用 commsMessage（fixed overlay 会覆盖 Phaser canvas 阻塞地图），
    // 改用非阻塞的 triggerToast
    triggerToast(
      `舰队全灭报告：${admiral?.name || '提督'} 的舰队已全军覆没。` +
      `提督 ${admiral?.name || ''} 在战斗中负伤，将进入康复期（70 天），待康复后可重新任命。`
    );
  }

  /** 查找最近的己方首都节点（BFS） */
  function findNearestFriendlyCapital(fromNodeId: number, factionId: number): number | null {
    const nodes = (strategicNodes.value as unknown as any[]);
    const visited = new Set<number>([fromNodeId]);
    const queue: number[] = [fromNodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = nodes.find((n: any) => n.id === current);
      if (!node) continue;
      // 找到己方首都
      if (node.type === 'capital' && node.ownerFactionId === factionId) return node.id;
      if (!node.connections) continue;

      for (const nextId of node.connections) {
        if (visited.has(nextId)) continue;
        const nextNode = nodes.find((n: any) => n.id === nextId);
        if (!nextNode) continue;
        if (nextNode.ownerFactionId !== factionId && nextNode.ownerFactionId !== 0) continue;
        visited.add(nextId);
        queue.push(nextId);
      }
    }
    return null;
  }

  /** 战后行动处理 */
  function handlePostBattle(action: PostBattleActionType) {
    const ctx = pendingPostBattle.value;
    if (!ctx) return;

    // ✅ 修复：原版通讯面板已不再用于占领/战斗报告（改用 triggerToast），
    // 此处不再需要清空 commsMessage，避免无意义的 store 写入

    const fleet = strategicFleets.value.find(f => f.id === ctx.fleetId);
    if (!fleet) {
      pendingPostBattle.value = null;
      strategicPaused.value = false;
      return;
    }

    switch (action) {
      case PostBattleActionType.HOLD_POSITION: {
        fleet.status = 'idle' as any;
        fleet.warpOriginId = null;
        fleet.warpTargetId = null;
        fleet.etaDay = null;
        pendingPostBattle.value = null;
        strategicPaused.value = false;
        triggerToast(`${allAdmirals.value.find(a => a.id === fleet.commanderId)?.name || '舰队'} 已驻留当前星域。`);
        break;
      }

      case PostBattleActionType.CONTINUE_ADVANCE: {
        fleet.status = 'idle' as any;
        fleet.warpOriginId = null;
        fleet.warpTargetId = null;
        fleet.etaDay = null;
        pendingPostBattle.value = null;
        strategicPaused.value = false;
        triggerToast('请在大地图上右键选择下一个跃迁目标节点。');
        break;
      }

      case PostBattleActionType.RETURN_TO_BASE: {
        pendingPostBattle.value = null;
        strategicPaused.value = false;

        // 查找最近己方首都
        const capitalId = findNearestFriendlyCapital(fleet.currentNodeId >= 0 ? fleet.currentNodeId : (fleet.warpTargetId || 0), fleet.factionId);
        if (capitalId !== null) {
          fleet.prevNodeId = fleet.currentNodeId >= 0 ? fleet.currentNodeId : (fleet.warpTargetId || 0);
          // 直接使用 warp 机制返航
          fleet.currentNodeId = fleet.currentNodeId >= 0 ? fleet.currentNodeId : (fleet.warpTargetId || 0);
          const rawNodes = (strategicNodes.value as unknown as any[]);
          const currentNode = rawNodes.find((n: any) => n.id === fleet.currentNodeId);
          const capitalNode = rawNodes.find((n: any) => n.id === capitalId);
          if (currentNode && capitalNode) {
            const dist = euclideanDistance(
              { x: currentNode.x, y: currentNode.y },
              { x: capitalNode.x, y: capitalNode.y }
            );
            const travelDays = Math.ceil(dist / WARP_CONSTANTS.WARP_SPEED_PX_PER_DAY);
            fleet.etaDay = totalTicks.value + Math.ceil(travelDays * TICKS_PER_DAY);
            fleet.warpTargetId = capitalId;
            fleet.warpOriginId = fleet.currentNodeId;
            fleet.currentNodeId = -1;
            fleet.status = 'warping' as any;
            const adm = allAdmirals.value.find(a => a.id === fleet.commanderId);
            triggerToast(`${adm?.name || '舰队'} 开始返航至首都 ${capitalNode.name || '基地'}，预计 ${travelDays} 日后抵达。`);
          }
        } else {
          // 找不到首都，退回前一节点
          retreatFleet(ctx.fleetId);
        }
        break;
      }
    }
  }

  // 将宏观舰队数据转化为 Phaser BattleScene 可接收的阵地兵力阵列
  const serializeTacticalFleet = (strategicFleetId: number): any[] => {
    const fleet = strategicFleets.value.find(f => f.id === strategicFleetId);
    if (!fleet) return [];

    const admiral = allAdmirals.value.find(a => a.id === fleet.commanderId);
    if (!admiral) return [];

    const stats = getEffectiveStats(admiral.id);
    if (!stats) return [];

    const supplyFactor = Math.max(0.1, fleet.supply / 100);
    const moraleFactor = Math.max(0.3, fleet.morale / 100);
    const atkMultiplier = 1 + (stats.attack * 0.01);
    const defMultiplier = 1 + (stats.defense * 0.01);

    // [T07] 科技等级影响战术战斗参数
    // 武器等级 → 攻击力 +(level-1)×5%
    // 装甲等级 → 生命值 +(level-1)×5%
    // 引擎等级 → 速度 +(level-1)×3%
    const adminStore = useAdminStore();
    const techState = (adminStore as any).adminState?.technology;
    const techWeaponMod = techState ? 1 + (techState.weaponLevel - 1) * 0.05 : 1;
    const techArmorMod = techState ? 1 + (techState.armorLevel - 1) * 0.05 : 1;
    const techEngineMod = techState ? 1 + (techState.engineLevel - 1) * 0.03 : 1;

    const tacticalUnits: any[] = [];
    const slots = JSON.parse(JSON.stringify(fleet.tacticalSlots || []));
    
    if (slots.length === 0) {
        if (fleet.composition.battleships > 0) slots.push({ x: 0, y: 0, type: 'battleship', count: fleet.composition.battleships });
        if (fleet.composition.fastBattleships > 0) slots.push({ x: 1, y: 0, type: 'fast_battleship', count: fleet.composition.fastBattleships });
        if (fleet.composition.cruisers > 0) slots.push({ x: -1, y: 1, type: 'cruiser', count: fleet.composition.cruisers });
        if (fleet.composition.destroyers > 0) slots.push({ x: 1, y: 1, type: 'destroyer', count: fleet.composition.destroyers });
        if (fleet.composition.carriers > 0) slots.push({ x: -1, y: -1, type: 'carrier', count: fleet.composition.carriers });
        if (fleet.composition.fighters > 0) slots.push({ x: 1, y: -1, type: 'fighter', count: fleet.composition.fighters });
        // 补给运输舰(AUX)：后勤战核心，编入后才会出现在战场，可被击沉 → 断补给
        if ((fleet.composition.supplies || 0) > 0) slots.push({ x: 0, y: 2, type: 'supply', count: fleet.composition.supplies });
    }

    const shipTemplates: Record<string, { hp: number; atk: number }> = {
      battleship:       { hp: 2000, atk: 150 },
      fast_battleship:  { hp: 1700, atk: 140 },
      cruiser:          { hp: 1200, atk: 90  },
      destroyer:        { hp: 800,  atk: 120 },
      carrier:          { hp: 1500, atk: 60  },
      fighter:          { hp: 300,  atk: 110 },
      // 补给运输舰：低血低攻，定位后勤（击沉它 = 切断该舰队补给线）
      supply:           { hp: 900,  atk: 20  },
    };

    const classKeyMap: Record<string, string> = {
      battleship: '战列', fast_battleship: '高战', cruiser: '巡洋',
      destroyer: '驱逐', carrier: '空母', fighter: '舰载',
      supply: '补给',
    };
    const baseDefMap: Record<string, number> = {
      battleship: 15, fast_battleship: 13, cruiser: 10,
      destroyer: 5, carrier: 12, fighter: 2, supply: 5,
    };

    slots.forEach((slot: any) => {
      if (!slot.type || slot.type === 'empty') return;
      const tmpl = shipTemplates[slot.type];
      if (!tmpl) return;

      const factionKey = admiral.faction;
      const classKey = classKeyMap[slot.type] || '驱逐';
      const troopId = `${factionKey}_${classKey}_1`;
      const classObj = getTroopById(troopId);
      const baseDef = baseDefMap[slot.type] || 5;
      
      const scaleCount = Math.max(1, slot.count / 500); 

      tacticalUnits.push({
        gridX: slot.x,
        gridY: slot.y,
        type: slot.type,
        classType: classObj?.cls || classKey,
        hp: Math.floor(tmpl.hp * defMultiplier * supplyFactor * scaleCount * techArmorMod),
        maxHp: Math.floor(tmpl.hp * defMultiplier * supplyFactor * scaleCount * techArmorMod),
        atk: Math.floor(tmpl.atk * atkMultiplier * moraleFactor * scaleCount * techWeaponMod),
        def: Math.floor((classObj?.def || baseDef) * defMultiplier),
        speed: (classObj?.speed || 0.5) * techEngineMod,
        range: classObj?.range || 150,
        interval: classObj?.interval || 3000,
      });
    });

    return tacticalUnits; // 返回純淨數組
  };

  // ===== 阶段四：战略→战术层联动入口 =====
  // 序列化已由 triggerTacticalBattle 完成并写入 tacticalState
  // 直接切换 gameState，由 App.vue 的 watch 触发 mountGame() 创建 BattleScene
  const launchTacticalBattle = (battleId: string, attackerFleetIds: number[], defenderFleetIds: number[], nodeId?: number) => {
    const uniqueAttackerIds = [...new Set(attackerFleetIds)].filter(id => strategicFleets.value.some(f => f.id === id));
    const uniqueDefenderIds = [...new Set(defenderFleetIds)].filter(id => strategicFleets.value.some(f => f.id === id));

    if (uniqueAttackerIds.length === 0 || uniqueDefenderIds.length === 0) {
      console.warn('[launchTacticalBattle] No valid fleet IDs after filtering, silently aborting.');
      gameState.value = 'strategy';
      strategicPaused.value = false;
      return;
    }

    const serializeOne = (fleetId: number) => {
      const fleet = strategicFleets.value.find(f => f.id === fleetId);
      if (!fleet) {
        console.warn(`[launchTacticalBattle] Fleet ${fleetId} not found in strategicFleets, skipping.`);
        return null;
      }
      const admiral = allAdmirals.value.find(a => a.id === fleet.commanderId);
      let units: any[] = [];
      try {
        units = serializeTacticalFleet(fleetId);
      } catch (err) {
        console.error(`[launchTacticalBattle] serializeTacticalFleet(${fleetId}) crashed:`, err);
        units = [];
      }
      if (units.length === 0) {
        console.warn(`[launchTacticalBattle] Fleet ${fleetId} (admiral: ${admiral?.name}) serialized to 0 units. Falling back to composition-derived slots.`);
        // 兜底：直接从 composition 构造最小可用 slot
        const comp = fleet.composition || { ...EMPTY_COMPOSITION };
        const fallbackSlots: any[] = [];
        if (comp.battleships > 0) fallbackSlots.push({ type: 'battleship', count: comp.battleships, hp: 2000, maxHp: 2000, atk: 150 });
        if (comp.fastBattleships > 0) fallbackSlots.push({ type: 'fast_battleship', count: comp.fastBattleships, hp: 1700, maxHp: 1700, atk: 140 });
        if (comp.cruisers > 0) fallbackSlots.push({ type: 'cruiser', count: comp.cruisers, hp: 1200, maxHp: 1200, atk: 90 });
        if (comp.destroyers > 0) fallbackSlots.push({ type: 'destroyer', count: comp.destroyers, hp: 800, maxHp: 800, atk: 120 });
        if (comp.carriers > 0) fallbackSlots.push({ type: 'carrier', count: comp.carriers, hp: 1500, maxHp: 1500, atk: 60 });
        if (comp.fighters > 0) fallbackSlots.push({ type: 'fighter', count: comp.fighters, hp: 300, maxHp: 300, atk: 110 });
        return {
          fleetId: fleet.id,
          factionId: fleet.factionId,
          commanderName: admiral ? admiral.name : '未知提督',
          imageId: admiral ? admiral.imageId : '',
          formation: fleet.formation || DEFAULT_FORMATION,
          slots: fallbackSlots
        };
      }
      return {
        fleetId: fleet.id,
        factionId: fleet.factionId,
        commanderId: admiral?.id ?? null,
        flagshipName: (admiral as any)?.flagshipName || '',
        commanderName: admiral ? admiral.name : '未知提督',
        imageId: admiral ? admiral.imageId : '',
        formation: fleet.formation || DEFAULT_FORMATION,
        slots: units.map((u: any) => ({
          type: u.type,
          count: Math.floor(u.maxHp / 100),
          hp: u.hp,
          maxHp: u.maxHp,
          atk: u.atk,
        }))
      };
    };

    const attackers = uniqueAttackerIds.map(serializeOne).filter(Boolean);
    const defenders = uniqueDefenderIds.map(serializeOne).filter(Boolean);

    if (attackers.length === 0 || defenders.length === 0) {
      const nodeStore = useNodeStore();
      console.error(`[launchTacticalBattle] Aborting: attackers=${attackers.length} defenders=${defenders.length}. Falling back to auto-resolve.`);
      // 降级为自动裁决，避免下次 tick 再次触发同一会战
      const atkFleet = strategicFleets.value.find(f => f.id === uniqueAttackerIds[0]);
      const defFleet = strategicFleets.value.find(f => f.id === uniqueDefenderIds[0]);
      if (atkFleet && defFleet) {
        const atkAdm = allAdmirals.value.find(a => a.id === atkFleet.commanderId);
        const defAdm = allAdmirals.value.find(a => a.id === defFleet.commanderId);
        const bNode = (nodeStore.nodes as unknown as any[]).find(n => n.id === nodeId);
        const result = autoResolveBattle(atkFleet, defFleet, atkAdm, defAdm, bNode?.type || 'empty');
        if (result.defenderRemaining <= 0) destroyFleetCleanup(defFleet.id);
        if (result.attackerRemaining <= 0) destroyFleetCleanup(atkFleet.id);
        if (result.outcome !== BattleOutcome.STALEMATE && result.outcome !== BattleOutcome.ROUT && result.attackerRemaining > 0) {
          nodeStore.captureNode(nodeId!, atkFleet.factionId);
          atkFleet.currentNodeId = nodeId!;
          atkFleet.status = 'idle' as any;
          strategicNodes.value = nodeStore.nodes as unknown as StarNode[];
        }
        triggerToast('会战数据异常，已自动裁决。');
      } else {
        triggerToast('会战数据异常，已自动取消。请重试或检查舰队配置。');
      }
      gameState.value = 'strategy';
      strategicPaused.value = false;
      return;
    }

    const settings = useSettingsStore();
    const mapStyle: 'hex' | 'crt' | '3d' | 'command' = (settings.battlefieldMode as any as 'hex' | 'crt' | '3d' | 'command') || 'command';
    // 战役地图改用战术模拟同款随机大地图
    selectedMapId.value = 'random';

    tacticalState.value = {
      mode: 'campaign',
      battleId,
      battleNodeId: nodeId,
      attackers,
      defenders,
      mapStyle,
    };

    // 退出战略 tick 循环：清理所有未决状态，避免回归战略时出现暂停残留
    strategicPaused.value = false;
    pendingArrival.value = null;
    pendingPostBattle.value = null;
    arrivalQueue.value = [];

    if (triggerPhaserMatchLaunch) triggerPhaserMatchLaunch();
    gameState.value = 'game';
  };


  // ===== 宏微观折算：战役结算与大地图回写 =====
  // ===== P0.3: 提督伤亡判定 =====
  /** 战后对所有参战提督掷骰判定受伤/阵亡
   * @param lossByFleet 可选：fleetId → 实际损失舰数（用于按真实战损计算伤亡率）
   */
  const rollAdmiralCasualties = (winnerFactionId: number, lossByFleet?: Record<number, number>) => {
    if (!tacticalState.value) return;
    const allFleetIds = [
      ...(tacticalState.value.attackers || []),
      ...(tacticalState.value.defenders || []),
    ].map((f: any) => f.fleetId).filter(Boolean);

    const admiralStore = useAdmiralStore();
    const admList = (admiralStore.admirals as unknown as any[]);
    const casualties: string[] = [];

    allFleetIds.forEach((fid: number) => {
      const fleet = strategicFleets.value.find(f => f.id === fid);
      if (!fleet) return;
      const adm = admList.find((a: any) => a.id === fleet.commanderId);
      if (!adm) return;

      const totalLoss = (lossByFleet && lossByFleet[fid] !== undefined)
        ? lossByFleet[fid]
        : totalShips(fleet.composition);
      const isWinner = fleet.factionId === winnerFactionId;

      // 死亡率 = 基础概率 × 损失系数 × 胜败修正
      const lossRatio = totalLoss / 20000; // 中损失比例
      let deathChance = 0.02 * (1 + lossRatio * 2); // 基础 2%，全灭时最高 6%
      if (!isWinner) deathChance *= 1.5; // 败方 +50%
      deathChance = Math.min(0.15, deathChance);

      const roll = Math.random();
      if (roll < deathChance) {
        // 阵亡
        adm.state = 'dead';
        fleet.commanderId = -1;
        fleet.morale = Math.max(0, fleet.morale - 40);
        casualties.push(`${adm.rankName} ${adm.name} 阵亡于战场！`);
      } else if (roll < deathChance * 2.5) {
        // 受伤
        const severity = Math.random();
        const injured = severity > 0.5 ? '重伤' : '轻伤';
        adm.state = 'wounded';
        adm.injury = { isInjured: true, severity: severity > 0.5 ? 0.6 : 0.3, recoveryTicks: Math.floor(30 + severity * 60) };
        casualties.push(`${adm.rankName} ${adm.name} ${injured}，需 ${adm.injury.recoveryTicks} 日静养。`);
      }
    });

    casualties.forEach(msg => {
      triggerToast(`战场急报：${msg}`);
      evaluateRandomAdmiralDeathEffect(msg);
    });
  };

  /** 关键提督阵亡的连锁反应 */
  const evaluateRandomAdmiralDeathEffect = (msg: string) => {
    const admiralStore = useAdmiralStore();
    const admList = (admiralStore.admirals as unknown as any[]);
    const isKeyAdmiral = msg.includes('莱因哈特') || msg.includes('杨威利') || msg.includes('罗波斯') || msg.includes('谬肯贝尔加');
    if (isKeyAdmiral) {
      const faction = msg.includes('莱因哈特') || msg.includes('谬肯贝尔加') ? '帝国' : '同盟';
      // 关键提督阵亡 → 阵营士气波动
      strategicFleets.value.forEach(f => {
        const adm = admList.find((a: any) => a.id === f.commanderId);
        if (adm && (adm.faction === 'empire' ? '帝国' : '同盟') === faction) {
          f.morale = Math.max(0, f.morale - 25);
        }
      });
      triggerToast(`${faction}全军震悼！关键提督阵亡，全军士气−25！`);
    }
  };

  /** P0.3: 单舰队战斗伤亡判定（自动战斗用） */
  const rollSingleBattleCasualty = (fleet: any, severity: 'active' | 'rout' | 'destroyed', admiral: any) => {
    if (!admiral) return;
    const admiralStore = useAdmiralStore();
    const admList = (admiralStore.admirals as unknown as any[]);
    const adm = admList.find((a: any) => a.id === admiral.id);
    if (!adm || adm.state === 'dead') return;

    const deathChance = severity === 'destroyed' ? 0.25 : severity === 'rout' ? 0.08 : 0.03;
    const injuryChance = severity === 'destroyed' ? 0.50 : severity === 'rout' ? 0.30 : 0.15;
    const roll = Math.random();

    if (roll < deathChance) {
      adm.state = 'dead';
      fleet.commanderId = -1;
      fleet.morale = Math.max(0, fleet.morale - 40);
      triggerToast(`战场急报：${adm.rankName} ${adm.name} 随舰队一起阵亡！`);
      evaluateRandomAdmiralDeathEffect(`${adm.rankName} ${adm.name}`);
    } else if (roll < deathChance + injuryChance) {
      adm.state = 'wounded';
      adm.injury = { isInjured: true, severity: 0.4, recoveryTicks: 30 + Math.floor(Math.random() * 30) };
      triggerToast(`战场急报：${adm.rankName} ${adm.name} 负伤，需 ${adm.injury.recoveryTicks} 日静养。`);
    }
  };

  const resolveCampaignBattle = (winnerFactionId: number, survivors: { fleetId: number, remainingSlots: any[] }[]) => {
    // 记录战前各舰队兵力，供战后按真实损失计算提督伤亡
    const preBattleCounts: Record<number, number> = {};
    survivors.forEach(s => {
      const f = strategicFleets.value.find(fl => fl.id === s.fleetId);
      if (f) preBattleCounts[s.fleetId] = totalShips(f.composition);
    });

    // 1. 更新参战舰队的真实兵力与阵型
    survivors.forEach(survivor => {
      const fleet = strategicFleets.value.find(f => f.id === survivor.fleetId);
      if (!fleet) return;

      // 清空旧编制，依据战后存活数据重写（全6舰种，修复旧版只回写3舰种导致
      // 高速战舰/空母/舰载机在手动战斗后凭空消失的数据丢失问题）
      fleet.composition = { ...EMPTY_COMPOSITION };
      fleet.tacticalSlots = [];

      survivor.remainingSlots.forEach(slot => {
        if (slot.count <= 0) return;
        fleet.tacticalSlots.push(slot);
        const compKey = shipTypeToCompKey[slot.type as keyof typeof shipTypeToCompKey];
        if (compKey) fleet.composition[compKey] += slot.count;
      });

      const numShips = totalShips(fleet.composition);
      
      // 2. 舰队覆灭判定
      if (numShips <= 0) {
        fleet.status = 'idle';
        fleet.currentNodeId = -1; // 物理移除
        const admiral = allAdmirals.value.find(a => a.id === fleet.commanderId);
        if (admiral && (admiral as any).state !== 'dead') admiral.state = 'idle';
        triggerToast(`战报：${admiral?.name || '某'} 舰队全军覆没！`);
      }
    });

    // P0.3: 战斗伤亡判定 — 按真实战损对所有参战提督掷骰
    const lossByFleet: Record<number, number> = {};
    survivors.forEach(s => {
      const f = strategicFleets.value.find(fl => fl.id === s.fleetId);
      const before = preBattleCounts[s.fleetId] || 0;
      const after = f ? totalShips(f.composition) : 0;
      lossByFleet[s.fleetId] = Math.max(0, before - after);
    });
    rollAdmiralCasualties(winnerFactionId, lossByFleet);

    // 3. 领土交割与防线破坏判定
    if (tacticalState.value?.battleNodeId) {
      const nodeId = tacticalState.value.battleNodeId;
      const nodeStore = useNodeStore();
      const node = (nodeStore.nodes as unknown as any[]).find(n => n.id === nodeId);
      
      // 若守方战败（胜利者不是节点原主人），且胜利者非中立，节点易主
      if (node && node.ownerFactionId !== winnerFactionId && winnerFactionId !== 0) {
        node.ownerFactionId = winnerFactionId;
        node.defenseHp = Math.floor(node.defenseHp * 0.5); // 城防半毁
        triggerToast(`战略通报：${node.name} 被成功占领！`);
      }
    }

    // 3.5 失败方残存舰队撤退（防止战后碰撞循环触发二次战斗）
    const loserFactionId = winnerFactionId === 1 ? 2 : 1;
    survivors.forEach(survivor => {
      const fleet = strategicFleets.value.find(f => f.id === survivor.fleetId);
      if (!fleet) return;
      const numShips = totalShips(fleet.composition);
      if (numShips > 0 && fleet.factionId === loserFactionId) {
        retreatFleet(fleet.id);
      }
    });

    // 4. 销毁战区上下文，恢复大地图时间流逝
    tacticalState.value = { mode: 'skirmish', attackers: [], defenders: [] };
    gameState.value = 'strategy';
    strategicPaused.value = false;
  };

  // ===== 战斗中 AI 裁决（从战术界面中途退出）=====
  const autoResolveFromBattle = () => {
    const state = tacticalState.value;
    if (!state || state.mode !== 'campaign') return;

    // 基于双方原始编制计算战力比
    const calcPower = (fleets: any[]) => {
      let power = 0;
      const typeCoeff: Record<string, number> = { battleship: 4.0, cruiser: 2.5, destroyer: 1.5 };
      fleets.forEach(f => {
        f.slots?.forEach((s: any) => {
          power += (s.count || 0) * (typeCoeff[s.type] || 1);
        });
      });
      return power;
    };

    const attackerPower = calcPower(state.attackers || []);
    const defenderPower = calcPower(state.defenders || []);
    const ratio = defenderPower > 0 ? attackerPower / defenderPower : 99;

    let winnerFactionId: number;
    let survivors: { fleetId: number; remainingSlots: any[] }[] = [];

    if (ratio > 1.5) {
      // 攻方大胜
      winnerFactionId = state.attackers[0]?.factionId ?? 1;
      state.attackers.forEach(a => {
        const lossPct = 0.05 + Math.random() * 0.05;
        const remainingSlots = (a.slots || []).map((s: any) => ({ ...s, count: Math.floor(s.count * (1 - lossPct)) }));
        survivors.push({ fleetId: a.fleetId, remainingSlots });
      });
      state.defenders.forEach(d => survivors.push({ fleetId: d.fleetId, remainingSlots: [] }));
      triggerToast('AI 裁决：攻方决定性胜利！');
    } else if (ratio > 1.0) {
      // 攻方险胜（P1修复：与 autoResolveBattle 一致——守方残部 15-40% 退守，不再全歼）
      winnerFactionId = state.attackers[0]?.factionId ?? 1;
      state.attackers.forEach(a => {
        const lossPct = 0.15 + Math.random() * 0.10;
        const remainingSlots = (a.slots || []).map((s: any) => ({ ...s, count: Math.floor(s.count * (1 - lossPct)) }));
        survivors.push({ fleetId: a.fleetId, remainingSlots });
      });
      const defLossPct = 0.60 + Math.random() * 0.25;
      state.defenders.forEach(d => {
        const remainingSlots = (d.slots || []).map((s: any) => ({ ...s, count: Math.floor(s.count * (1 - defLossPct)) }));
        survivors.push({ fleetId: d.fleetId, remainingSlots });
      });
      triggerToast('AI 裁决：攻方微弱胜利。');
    } else if (ratio > 0.7) {
      // 胶着 — 守方坚守
      winnerFactionId = state.defenders[0]?.factionId ?? 2;
      state.attackers.forEach(a => {
        const lossPct = 0.20 + Math.random() * 0.10;
        const remainingSlots = (a.slots || []).map((s: any) => ({ ...s, count: Math.floor(s.count * (1 - lossPct)) }));
        survivors.push({ fleetId: a.fleetId, remainingSlots });
      });
      state.defenders.forEach(d => {
        const lossPct = 0.20 + Math.random() * 0.10;
        const remainingSlots = (d.slots || []).map((s: any) => ({ ...s, count: Math.floor(s.count * (1 - lossPct)) }));
        survivors.push({ fleetId: d.fleetId, remainingSlots });
      });
      triggerToast('AI 裁决：双方胶着，守方坚守。');
    } else {
      // 攻方溃败
      winnerFactionId = state.defenders[0]?.factionId ?? 2;
      state.attackers.forEach(a => {
        const lossPct = 0.40 + Math.random() * 0.20;
        const remainingSlots = (a.slots || []).map((s: any) => ({ ...s, count: Math.floor(s.count * (1 - lossPct)) }));
        survivors.push({ fleetId: a.fleetId, remainingSlots });
      });
      state.defenders.forEach(d => {
        const lossPct = 0.05 + Math.random() * 0.05;
        const remainingSlots = (d.slots || []).map((s: any) => ({ ...s, count: Math.floor(s.count * (1 - lossPct)) }));
        survivors.push({ fleetId: d.fleetId, remainingSlots });
      });
      triggerToast('AI 裁决：攻方溃败！');
    }

    resolveCampaignBattle(winnerFactionId, survivors);
  };

  // ===== 战斗中撤退（从战术界面中途退出）=====
  const retreatFromBattle = () => {
    const state = tacticalState.value;
    if (!state || state.mode !== 'campaign') {
      returnToMetaMenu();
      return;
    }

    // 攻方舰队撤退：损失 10-20% 兵力，返回 prevNodeId
    const attackerFleetId = state.attackers[0]?.fleetId;
    if (attackerFleetId) {
      const fleet = strategicFleets.value.find(f => f.id === attackerFleetId);
      if (fleet) {
        const lossPct = 0.10 + Math.random() * 0.10;
        const comp = fleet.composition;
        comp.battleships = Math.floor(comp.battleships * (1 - lossPct));
        comp.fastBattleships = Math.floor(comp.fastBattleships * (1 - lossPct));
        comp.cruisers = Math.floor(comp.cruisers * (1 - lossPct));
        comp.destroyers = Math.floor(comp.destroyers * (1 - lossPct));
        comp.carriers = Math.floor(comp.carriers * (1 - lossPct));
        comp.fighters = Math.floor(comp.fighters * (1 - lossPct));

        // 撤回 prevNodeId
        const prevNodeId = fleet.prevNodeId;
        if (prevNodeId != null && prevNodeId >= 0) {
          const nodeStore = useNodeStore();
          const prevNode = (nodeStore.nodes as unknown as any[]).find(n => n.id === prevNodeId);
          if (prevNode && prevNode.ownerFactionId === fleet.factionId) {
            fleet.currentNodeId = prevNodeId;
          } else {
            // prevNode 丢失 → 找最近友方首都
            const capital = findNearestFriendlyCapital(fleet.currentNodeId ?? 0, fleet.factionId);
            if (capital != null) fleet.currentNodeId = capital;
          }
        }
        fleet.status = 'idle' as any;
        fleet.warpOriginId = null;
        fleet.warpTargetId = null;
        fleet.etaDay = null;
        triggerToast(`舰队已撤退，损失约 ${Math.round(lossPct * 100)}% 兵力。`);
      }
    }

    tacticalState.value = { mode: 'skirmish', attackers: [], defenders: [] };
    gameState.value = 'strategy';
    strategicPaused.value = false;
  };

  const commsMessage = ref<{ visible: boolean; title: string; message: string; faction: string; officerTitle?: string; portraitId?: number }>({
    visible: false, title: '', message: '', faction: 'alliance'
  });

  // ===== 行星突击（无人驻守的要塞/星球攻坚）=====
  const resolvePlanetaryAssault = (fleetId: number, nodeId: number) => {
    const fleet = strategicFleets.value.find(f => f.id === fleetId);
    if (!fleet) return;
    const nodeStore = useNodeStore();
    const node = (nodeStore.nodes as unknown as any[]).find(n => n.id === nodeId);
    if (!node) return;
    if (node.ownerFactionId === fleet.factionId) return; // 己方星球不解算

    const admiral = allAdmirals.value.find(a => a.id === fleet.commanderId);
    const fleetName = admiral?.name ? `${admiral.name}舰队` : '未知舰队';
    const nodeName = node.name || '未知星域';
    const fac = fleet.factionId === 1 ? 'alliance' : 'empire';
    const portraitId = fac === 'alliance' ? (Math.random() > 0.5 ? 9165 : 9166) : (Math.random() > 0.5 ? 9099 : 9100);
    const officerTitle = fac === 'alliance' ? '同盟统合作战本部 下士 杨' : '帝国军务省 通讯少尉 艾密尔';

    // 攻击力 = 舰船加权
    const totalAtk = totalPowerWeight(fleet.composition);
    const defHp = node.defenseHp || 1000;
    const turrets = node.defenseTurrets || 0;
    const effectiveDef = defHp + turrets * 500;

    // 伤亡比例（防御越强损失越大，按比例损失所有舰种）
    const lossRatio = Math.min(0.25, (effectiveDef / (totalAtk + 1)) * 0.08);
    const comp = fleet.composition;
    comp.battleships = Math.max(0, comp.battleships - Math.round(comp.battleships * lossRatio));
    comp.fastBattleships = Math.max(0, comp.fastBattleships - Math.round(comp.fastBattleships * lossRatio));
    comp.cruisers = Math.max(0, comp.cruisers - Math.round(comp.cruisers * lossRatio));
    comp.destroyers = Math.max(0, comp.destroyers - Math.round(comp.destroyers * lossRatio * 1.3));
    comp.carriers = Math.max(0, comp.carriers - Math.round(comp.carriers * lossRatio));
    comp.fighters = Math.max(0, comp.fighters - Math.round(comp.fighters * lossRatio * 1.5)); // 舰载机损失更重

    // 节点易主
    nodeStore.captureNode(nodeId, fleet.factionId);
    strategicNodes.value = nodeStore.nodes as unknown as StarNode[];
    fleet.status = 'idle';

    const totalAfter = totalPowerWeight(comp);

    // ✅ 修复：不再用 commsMessage（fixed overlay 会覆盖 Phaser canvas 阻塞地图），
    // 改用非阻塞的 triggerToast
    triggerToast(
      `行星突击战报 — ${nodeName}：已成功攻占该星域。` +
      `城防 HP ${defHp} / 炮台 ${turrets} 座；` +
      `战损约 ${Math.round(lossRatio * 100)}%，战力从 ${totalAtk} → ${totalAfter}。` +
      `${admiral ? `驻守指挥：${admiral.name} ${admiral.rankName}。` : ''}`
    );

    if (admiral) admiral.currentNodeId = nodeId;
  };


  // 阶段二预留：军衔 → 舰船上限
  // P0修复：宰相14/议会15/皇帝18 拆出战斗序列后，rank≥13 不再出现；保留 13=元帅 20000 封顶
  const getShipLimit = (rank: number) => {
      if (rank <= 0 || rank < 8) return 0;  // 非战斗序列（政治头衔 rank=0）或准将以下不能独立带兵
      if (rank === 8) return 5000;  // 准将 (半支舰队)
      if (rank === 9) return 8000;  // 少将 (半支舰队)
      if (rank === 10) return 12000;// 中将 (完整舰队)
      if (rank === 11) return 15000;// 上将 (完整舰队)
      if (rank === 12) return 18000;// 一级上将 (扩编舰队)
      return 20000;                 // 元帅 (集团军)
  };

  // 军衔 → 战术分舰队槽位上限
  const getSlotLimit = (rank: number) => {
      if (rank <= 0 || rank < 8) return 0; // P0修复：政治头衔（rank=0）无战术槽位
      if (rank <= 9) return 4; // 准将/少将最多 4 个槽位
      return 8;                // 中将以上 8 个槽位
  };

  const togglePause = () => { isPaused.value = !isPaused.value; };
  const getDiffName = (level: string) => diffConfig.find(d => d.level === level)?.name || '会战';
  
  const restartGame = () => {
    // 重置战略时间
    totalTicks.value = 0;
    internalTickCounter.value = 0;
    universeDate.value = '796.01.01';
    strategicPaused.value = false;
    arrivalQueue.value = [];
    pendingArrival.value = null;
    pendingPostBattle.value = null;
    gameOver.value = false;
    isWin.value = false;
    isPaused.value = false;
    tacticalState.value = { mode: 'skirmish', attackers: [], defenders: [] };

    // 强制重置战略地图初始化标志
    strategicMapInitialized.value = false;

    // 关键修复：不调用 startMatchLaunch（会把 gameState 设为 'game'），
    // 否则 confirmAdmiralSelect 随后设为 'strategy'，Vue 批量处理后
    // StrategicScreen 不会重新挂载，导致旧 Phaser 实例残留、显示旧数据。
    // gameState 由 confirmAdmiralSelect 统一设置。
    autoSave();
  };

  const returnToMetaMenu = () => {
    console.trace('[returnToMetaMenu] called from:');
    if (simMode.value) {
      gameState.value = 'sim';
      return;
    }
    gameState.value = 'menu';
    metaGold.value += rewardGold.value;
    autoSave();
    // 清理战斗上下文残留（确保下次进入战略地图时状态干净）
    strategicPaused.value = false;
    isWin.value = false;
    tacticalState.value = { mode: 'skirmish', attackers: [], defenders: [] };
  };
  
  const deleteMap = (id: string) => {
    mapsPool.value = mapsPool.value.filter((m: any) => m.id !== id);
    delete customMapsData.value[id];
    if (selectedMapId.value === id) selectedMapId.value = 'standard';
  };

  const startMatchLaunch = () => {
    autoSave();
    gameState.value = 'game';
    gameOver.value = false;
    isWin.value = false;
    winStatus.value = "";
    selectedTile.value = null;
    isPaused.value = false;
    rewardGold.value = 0;
    if (triggerPhaserMatchLaunch) triggerPhaserMatchLaunch();
  };

  const openEditorMode = () => {
    gameState.value = 'editor';
    let tempTiles = [];
    editorHistory.value = [];
    const maxR = 8;
    for (let q = -maxR; q <= maxR; q++) {
      for (let r = -maxR; r <= maxR; r++) {
        if (Math.abs(q + r) > maxR) continue;
        tempTiles.push({ q, r, type: 'sea' });
      }
    }
    editorTilesData.value = tempTiles;
    editorHistory.value.push(JSON.stringify(editorTilesData.value));
    if (triggerPhaserEditorInit) setTimeout(() => triggerPhaserEditorInit!(), 60);
  };

  const openMapForEdit = (id: string) => {
    if (!customMapsData.value[id]) return;
    gameState.value = 'editor';
    editorTilesData.value = JSON.parse(JSON.stringify(customMapsData.value[id]));
    editorHistory.value = [JSON.stringify(editorTilesData.value)];
    if (triggerPhaserEditorInit) setTimeout(() => triggerPhaserEditorInit!(), 60);
  };
  
  const setPhaserMatchLauncher = (fn: () => void) => { triggerPhaserMatchLaunch = fn; };
  const setPhaserEditorInitializer = (fn: () => void) => { triggerPhaserEditorInit = fn; };

  const initLoadData = async () => {
      await loadSlotsFromStorage();
      const admiralStore = useAdmiralStore();

      // 尝试恢复最近的存档（数据就位，不自动跳转）
      const targetSlot = saveSlots.value['autosave'] || saveSlots.value['slot_1'];
      if (targetSlot) {
          loadFromSlot(targetSlot === saveSlots.value['autosave'] ? 'autosave' : 'slot_1');
          if (playerAdmiralId.value < 0) {
              allAdmirals.value = initAdmirals();
              admiralStore.$patch((state: any) => { state.admirals = JSON.parse(JSON.stringify(admiralsData)); });
              strategicMapInitialized.value = false;
          }
      } else {
          allAdmirals.value = initAdmirals();
          admiralStore.$patch((state: any) => { state.admirals = JSON.parse(JSON.stringify(admiralsData)); });
      }
      gameState.value = 'title';
      isDataLoaded.value = true;
  };

  const confirmAdmiralSelect = (admiralId: number) => {
      playerAdmiralId.value = admiralId;
      showAdmiralSelect.value = false;
      const adm = allAdmirals.value.find(a => a.id === admiralId);
      if (adm) {
          playerRank.value = adm.rankName;

          // ── 新一局完整重置（此前缺失，导致新局继承上一局的国库/贷款/忠诚等状态）──
          // 1) 剧本初始国库
          const scenGold = (INITIAL_GOLD as any)[selectedScenarioId.value] || INITIAL_GOLD.default;
          factionGold.value = {
            alliance: scenGold.alliance ?? INITIAL_GOLD.default.alliance,
            empire: scenGold.empire ?? INITIAL_GOLD.default.empire,
          };
          // 2) 剧本起始年份
          const scen = SCENARIOS.find(s => s.id === selectedScenarioId.value);
          const startYear = scen?.year || 796;
          universeDate.value = `${startYear}.01.01`;
          // 3) 行政系统重置（财政/贷款/人事/科技全部归零）
          const playerFactionId = adm.faction === 'alliance' ? 1 : 2;
          useAdminStore().initAdminState(playerFactionId);
          // 4) 功勋/账本/事件冷却/待处理弹窗重置
          tacticalMerit.value = 0;
          adminMerit.value = 0;
          rewardGold.value = 0;
          playerMerit.value = 0;
          treasuryLedger.value = [];
          resetEventCooldowns();
          pendingEvent.value = null;
          pendingProposalsV2.value = [];
          pendingProposals.value = [];
          councilPendingCount.value = 0;
          // 5) 终局状态/计时器/连锁反应/造船队列重置
          //    （App.vue 路径可能不经 restartGame 直达此处，须自行清终局标志）
          gameOver.value = false;
          isWin.value = false;
          winStatus.value = '';
          eventDayIndex.value = 0;
          autoSaveDayCounter.value = 0;
          lastMassingWarnTick.value = -999999;
          chainReactions.value = [];
          (useFleetStore() as any).constructionQueue = [];

          strategicMapInitialized.value = false;
          initStrategicMap();
          // initStrategicMap 内部会把日期重置为 796，按剧本年份回写
          universeDate.value = `${startYear}.01.01`;
          gameState.value = 'strategy';
      }
      autoSave();
  };

  const classTypeCodeProxy = computed(() => classToTypeCode);


  
  // 导出
  return {
    allAdmirals, dispatchAdmirals, getEffectiveStats, getShipLimit, getSlotLimit,
    saveSlots, saveToSlot, loadFromSlot, deleteSlot, createNewSlot, autoSave,
    isDataLoaded, toastMessage, isCastingBomb, isSidebarCollapsed, gameState, menuTab, strategyTab,
    metaGold, factionGold, fezzanGold, tacticalMerit, adminMerit, rewardGold,
    selectedScenarioId, treasuryLedger,
    selectedFactionId, selectedMapId, selectedDiff, activeFactionCount,
    troopsData, customMapsData, mapsPool,
    factions, selectedTile, fleetsUI, isPaused, speedGears, currentSpeedFactor, gameOver, isWin, winStatus, gameStats,
    currentBrush, editorTilesData, editorHistory,
    classToTypeCode: classTypeCodeProxy, 
    triggerToast, getTroopById, getDiffName,
    togglePause, restartGame, returnToMetaMenu, deleteMap, startMatchLaunch, openEditorMode, openMapForEdit, initLoadData,
    setPhaserMatchLauncher, setPhaserEditorInitializer,
    battleDialog, showDialog,
    setPhaserCommandDispatcher, dispatchFleetCommand,
    // 战略层
    strategicNodes, strategicFleets, universeDate, playerMerit, playerRank, initStrategicMap, strategicTimeSpeed, strategicTick,
    selectedFleetId, issueFleetMoveOrder, issueWarpOrder, retreatFleet,
    playerAdmiralId, playerPermissions, showAdmiralSelect, showForcePass, showPromotion, forcePassProposal, promotionData,
    confirmAdmiralSelect, handleForcePass, handleForcePassDecline, attemptCoup, generateEndingNarrative, endingNarrative, flagshipDestroyed, getIntelRange, createFleet,showCouncilModal, showAdminPanel, activeProposals, submitProposal,
    pendingProposals, pendingProposalsV2, submitProposalV2, councilPendingCount, councilHistory, showCouncilPanel, councilMode, resolveProposal,
    pendingConfirm, requestConfirm, resolveConfirm,
    serializeTacticalFleet, evaluateRandomEvents, launchTacticalBattle, triggerTacticalBattle, calculateSupplyDistance, debugForceBattle,
    pendingEvent, resolveEvent,
    runAIStrategicTurn, runPlayerDefensiveAI, aiIssueWarpOrder,
    tacticalState,
    // 战术模拟（独立小游戏）
    simMode, simFactionId, simActiveFactionCount, simSelectedAdmirals,
    enterSimMode, exitSimMode, launchSimBattle, generateSimFullComposition,
    resolveCampaignBattle, resolvePlanetaryAssault, autoResolveFromBattle, retreatFromBattle, commsMessage,
    // Warp 移动系统
    strategicPaused, userPaused, pendingArrival, pendingPostBattle, pendingCaptureDecision, arrivalQueue, totalTicks, strategicMapVersion, WARP_CONSTANTS, AUTO_RESOLVE_DEFAULTS,
    calculatePower, autoResolveBattle, occupyPlanet, handleArrivalDecision, handlePostBattle,
    handleCaptureOccupy, handleCapturePillage, handleCaptureLiberate,
    // 提督扮演：军议面板状态
    battleDeployPhase, supremeCommanderId, warRoomOpen,
  };
});

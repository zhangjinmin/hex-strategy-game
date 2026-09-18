import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { FleetComposition, ShipType, ShipConstruction } from '../types/game';
import { SHIP_TYPES, SHIP_TACTICAL_HP, totalShips } from '../types/game';
import { SHIP_COST } from '../config/economy';
import { SHIP_TO_COMP_KEY } from '../config/shipScaling';
import { useNodeStore } from './nodeStore';
import { useGameStore } from './gameStore';
import { useAdminStore } from './adminStore';

// ShipType (单数) → FleetComposition key (复数)
// ⚠ 单一真源在 config/shipScaling.ts（战术层折算也要用同一张表），此处只重导出，禁止再写一份字面量。
export const shipTypeToCompKey = SHIP_TO_COMP_KEY as Record<ShipType, keyof FleetComposition>;

export const useFleetStore = defineStore('fleet', () => {
  const constructionQueue = ref<ShipConstruction[]>([]);

  const getConstructionByNode = computed(() => {
    return (nodeId: number) => constructionQueue.value.filter(c => c.nodeId === nodeId);
  });

  const getConstructionByFleet = computed(() => {
    return (fleetId: number) => constructionQueue.value.filter(c => c.fleetId === fleetId);
  });

  function canBuildAt(nodeId: number, factionId: number): boolean {
    const nodeStore = useNodeStore();
    const node = (nodeStore.nodes as unknown as any[]).find(n => n.id === nodeId);
    if (!node) return false;
    if (node.ownerFactionId !== factionId) return false;
    if (node.type !== 'capital' && node.type !== 'fortress') return false;
    if (node.shipyardLevel < 1) return false;
    return true;
  }

  function getRemainingCapacity(admiralId: number, fleetComposition: FleetComposition): number {
    const gameStore = useGameStore();
    const adm = (gameStore.allAdmirals as unknown as any[]).find(a => a.id === admiralId);
    if (!adm) return 0;
    const limit = gameStore.getShipLimit(adm.rank);
    const current = totalShips(fleetComposition);
    return Math.max(0, limit - current);
  }

  // ShipType → economy.ts 造价 key
  const shipTypeToCostKey: Record<ShipType, keyof typeof SHIP_COST> = {
    battleship: 'battleship',
    fast_battleship: 'fastBattleship',
    cruiser: 'cruiser',
    destroyer: 'destroyer',
    carrier: 'carrier',
    fighter: 'fighter',
    supply: 'supply',
  };

  function getShipCost(shipType: ShipType): number {
    return SHIP_COST[shipTypeToCostKey[shipType]] ?? SHIP_COST.default;
  }

  function buildShips(
    fleetId: number,
    nodeId: number,
    factionId: number,
    shipType: ShipType,
    count: number,
  ): { success: boolean; message: string } {
    if (!canBuildAt(nodeId, factionId)) return { success: false, message: '该节点无法建造舰船' };
    if (count <= 0) return { success: false, message: '建造数量必须 > 0' };

    const gameStore = useGameStore();
    const fleets = gameStore.strategicFleets as unknown as any[];
    const fleet = fleets.find(f => f.id === fleetId);
    if (!fleet) return { success: false, message: '未找到目标舰队' };
    // 防御校验：舰队必须属于付款阵营，防止跨阵营扣款
    if (fleet.factionId !== factionId) return { success: false, message: '该舰队不属于己方阵营' };

    // 核心修复：后端必须二次校验军阶上限，且必须扣除当前正在队列中制造的残余数量
    const currentCapacity = getRemainingCapacity(fleet.commanderId, fleet.composition);
    const pendingInQueue = constructionQueue.value
      .filter(c => c.fleetId === fleetId)
      .reduce((acc, c) => acc + c.count, 0);
      
    const actualRemaining = currentCapacity - pendingInQueue;
    if (count > actualRemaining) {
      return { success: false, message: `指挥上限不足，该提督最多还能编入 ${actualRemaining} 艘` };
    }

    const costPerShip = getShipCost(shipType);
    const totalCost = costPerShip * count;
    const gs = gameStore as any;
    const currentGold: number = gs.metaGold || 0;

    if (currentGold < totalCost) {
      return { success: false, message: `资金不足（需要 ₮${Math.round(totalCost / 10000)}万，现有 ₮${Math.round(currentGold / 10000)}万）` };
    }

    // 扣款（metaGold 为 setup store 的 computed，走 setter 最稳妥）
    gs.metaGold = currentGold - totalCost;
    // 记账：当日造船支出（供经济面板展示；pinia 已解包 ref，直接赋值）
    const adminStore = useAdminStore() as any;
    adminStore.dailyShipBuildCost = (adminStore.dailyShipBuildCost || 0) + totalCost;

    constructionQueue.value.push({ fleetId, nodeId, shipType, count, progress: 0, costPerShip });
    return { success: true, message: `开始建造 ${count} 艘${SHIP_TYPES.find(s => s.type === shipType)?.name}（₮${Math.round(totalCost / 10000)}万）` };
  }

  function tickConstruction(nodeId: number, shipyardLevel: number, ticks: number) {
    const buildingItems = constructionQueue.value.filter(c => c.nodeId === nodeId && c.progress < 100);
    if (buildingItems.length === 0) return;

    const gameStore = useGameStore();

    buildingItems.forEach(item => {
      // P1修复：建造点数制——每种船有建造工时（BB=8点/CA=4点/DD=2点/CV=6点/fighter=0.2点），
      // 产能 = 船坞等级 × 20点/日。原来"产能=船坞×200艘/日"与造价无关，
      // 导致攒一队 DD 进度飞快、昂贵舰种也一样快，产能语义失真。
      const buildPoints: Record<string, number> = {
        battleship: 8, fast_battleship: 6.5, cruiser: 4, destroyer: 2, carrier: 6, fighter: 0.2,
      };
      const pointsPerShip = buildPoints[item.shipType] ?? 4;
      const pointsPerDay = Math.max(5, shipyardLevel * 20);
      const totalPoints = pointsPerShip * Math.max(1, item.count);
      const pointsPerTick = pointsPerDay / 10; // 10 tick/日
      item.progress = Math.min(100, item.progress + (pointsPerTick / totalPoints) * 100 * ticks);

      if (item.progress >= 100) {
        const fleet = (gameStore.strategicFleets as unknown as any[]).find(f => f.id === item.fleetId);
        if (fleet) {
          const compKey = shipTypeToCompKey[item.shipType];
          fleet.composition[compKey] += item.count;
        }
        constructionQueue.value = constructionQueue.value.filter(c => c !== item);
      }
    });
  }

  function cancelConstruction(item: ShipConstruction): boolean {
    const gameStore = useGameStore() as any;
    const refund = Math.floor(item.costPerShip * item.count * 0.5);
    gameStore.metaGold = (gameStore.metaGold || 0) + refund;
    constructionQueue.value = constructionQueue.value.filter(c => c !== item);
    return true;
  }

  const getFleetStats = computed(() => {
    return (fleetId: number) => {
      const gameStore = useGameStore();
      const fleet = (gameStore.strategicFleets as unknown as any[]).find(f => f.id === fleetId);
      if (!fleet) return null;
      const comp = fleet.composition;
      return {
        total: totalShips(comp),
        battleships: comp.battleships,
        cruisers: comp.cruisers,
        destroyers: comp.destroyers,
        morale: fleet.morale,
        supply: fleet.supply,
        supplyDistance: fleet.supplyDistance,
      };
    };
  });


  // ===== 阶段二新增：自由坐标战术棋盘 =====

  // 在棋盘 (x,y) 放置一个战舰
  function addTacticalUnit(
    fleetId: number,
    x: number, y: number,
    type: ShipType,
  ): boolean {
    const gameStore = useGameStore();
    const fleet = (gameStore.strategicFleets as unknown as any[]).find((f: any) => f.id === fleetId);
    if (!fleet) return false;
    if (!fleet.tacticalSlots) fleet.tacticalSlots = [];
    const existing = fleet.tacticalSlots.find((s: any) => s.x === x && s.y === y);
    if (existing) return false; // 该位置已有战舰
    fleet.tacticalSlots.push({ x, y, type });
    return true;
  }

  // 从棋盘 (x,y) 移除战舰，返回移除的舰种（用于回池子）
  function removeTacticalUnit(fleetId: number, x: number, y: number): string | null {
    const gameStore = useGameStore();
    const fleet = (gameStore.strategicFleets as unknown as any[]).find((f: any) => f.id === fleetId);
    if (!fleet || !fleet.tacticalSlots) return null;
    const idx = fleet.tacticalSlots.findIndex((s: any) => s.x === x && s.y === y);
    if (idx >= 0) {
      const removed = fleet.tacticalSlots[idx];
      fleet.tacticalSlots.splice(idx, 1);
      return removed.type;
    }
    return null;
  }

  // 计算切入战术界面时的实际编制数据
  const getTacticalDeployment = computed(() => {
    return (fleetId: number) => {
      const gameStore = useGameStore();
      const fleet = (gameStore.strategicFleets as unknown as any[]).find((f: any) => f.id === fleetId);
      if (!fleet) return null;

      const comp = fleet.composition as FleetComposition;
      const slots = fleet.tacticalSlots || [];

      // 兼容旧存档：如果 slots 是字符串数组，跳过（应在 loadFromSlot 中转换）
      if (slots.length > 0 && typeof slots[0] === 'string') {
        return null; // 旧数据格式，已废弃
      }

      // 1. 统计模板中各类舰船的槽位需求量
      const slotCounts: Record<string, number> = { battleship: 0, fast_battleship: 0, cruiser: 0, destroyer: 0, carrier: 0, fighter: 0 };
      slots.forEach((s: any) => {
        if (s.type !== 'empty' && slotCounts.hasOwnProperty(s.type)) slotCounts[s.type]++;
      });

      // 2. 动态均分兵力，计算每个槽位分到的实际数量
      const deployedUnits = slots.map((s: any, index: number) => {
        if (s.type === 'empty') return null;

        const shipType = s.type as ShipType;
        const totalAvailable = comp[shipTypeToCompKey[shipType]] ?? 0;
        const assignedCount = Math.floor(totalAvailable / Math.max(1, slotCounts[shipType]));

        // 如果该舰种池子为空，槽位直接轮空失效
        if (assignedCount <= 0) return null;

        const baseStats = SHIP_TYPES.find((st: any) => st.type === shipType);
        if (!baseStats) return null;

        // 3. 数值升维：战术属性 = 单舰基础值 * 分配到的数量
        // P2修复：HP 走 SHIP_TACTICAL_HP 独立表（原 cost×10 语义混用，空母 HP 反超战舰）
        const tacticalHp = SHIP_TACTICAL_HP[shipType] ?? baseStats.cost * 10;
        return {
          slotIndex: index,
          x: s.x,
          y: s.y,
          shipType: shipType,
          shipCount: assignedCount,
          // 这里的 HP 和 ATK 是战术地图中真实使用的巨量数值
          maxHp: tacticalHp * assignedCount,
          hp: tacticalHp * assignedCount,
          atk: baseStats.atk * Math.sqrt(assignedCount), // 火力采用平方根衰减，体现边际效应，避免被秒杀
          def: baseStats.def * Math.sqrt(assignedCount),
          speed: baseStats.speed
        };
      });

      return deployedUnits.filter((u: any) => u !== null) as any[];
    };
  });

  return {
    constructionQueue,
    getConstructionByNode,
    getConstructionByFleet,
    canBuildAt,
    getRemainingCapacity,
    getShipCost,
    buildShips,
    tickConstruction,
    cancelConstruction,
    getFleetStats,
    addTacticalUnit,
    removeTacticalUnit,
    getTacticalDeployment,
  };
});

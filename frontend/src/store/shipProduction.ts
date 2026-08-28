/**
 * 舰船生产系统（简化版）
 * - 每个己方星系根据等级自动生产舰船
 * - 战斗战损后需回港补充
 * - 玩家可花金币加速生产
 */
import { ref, computed } from 'vue';

export interface ShipyardNode {
  id: number;
  name: string;
  shipyardLevel: number;  // 1-5
  productionQueue: number; // 当前队列中的舰船数
  productionRate: number;  // 每回合生产舰船数
}

const shipyardLevels = [
  { level: 0, name: '无设施', rate: 0, maxQueue: 0, upgradeCost: 0 },
  { level: 1, name: '小型船坞', rate: 2, maxQueue: 50, upgradeCost: 300 },
  { level: 2, name: '中型船坞', rate: 4, maxQueue: 120, upgradeCost: 600 },
  { level: 3, name: '大型船坞', rate: 7, maxQueue: 250, upgradeCost: 1200 },
  { level: 4, name: '军事基地', rate: 12, maxQueue: 500, upgradeCost: 2500 },
  { level: 5, name: '要塞工厂', rate: 20, maxQueue: 1000, upgradeCost: 5000 },
];

export function useShipProduction() {
  const shipyards = ref<Map<number, ShipyardNode>>(new Map());
  const globalReserve = ref(0); // 未部署的总舰数池

  function initShipyard(nodeId: number, name: string, existingLevel: number = 0) {
    if (!shipyards.value.has(nodeId)) {
      shipyards.value.set(nodeId, {
        id: nodeId, name,
        shipyardLevel: Math.min(5, Math.max(0, existingLevel)),
        productionQueue: 0,
        productionRate: shipyardLevels[Math.min(5, existingLevel)].rate,
      });
    }
  }

  function upgradeShipyard(nodeId: number): { cost: number; success: boolean } {
    const sy = shipyards.value.get(nodeId);
    if (!sy || sy.shipyardLevel >= 5) return { cost: 0, success: false };
    const cfg = shipyardLevels[sy.shipyardLevel + 1];
    sy.shipyardLevel++;
    sy.productionRate = shipyardLevels[sy.shipyardLevel].rate;
    return { cost: cfg.upgradeCost, success: true };
  }

  function produce(ticksElapsed: number, factionNodeIds: number[]): { shipsProduced: number } {
    let produced = 0;
    factionNodeIds.forEach(nodeId => {
      const sy = shipyards.value.get(nodeId);
      if (!sy) return;
      const batch = sy.productionRate * ticksElapsed;
      sy.productionQueue += batch;
      globalReserve.value += batch;
      produced += batch;
    });
    return { shipsProduced: produced };
  }

  function rushProduction(nodeId: number): { cost: number; added: number } {
    const sy = shipyards.value.get(nodeId);
    if (!sy) return { cost: 0, added: 0 };
    const cost = 100; // 固定加速费用
    const added = sy.productionRate * 3; // 加速获得3回合产量
    sy.productionQueue += added;
    globalReserve.value += added;
    return { cost, added };
  }

  function replenishFleet(fleetId: number, targetSize: number, nodeId: number): number {
    const sy = shipyards.value.get(nodeId);
    if (!sy || sy.productionQueue <= 0) return 0;
    const needed = Math.max(0, targetSize - globalReserve.value);
    const given = Math.min(needed, sy.productionQueue);
    sy.productionQueue -= given;
    globalReserve.value -= given;
    return given;
  }

  return { shipyards, globalReserve, shipyardLevels, initShipyard, upgradeShipyard, produce, rushProduction, replenishFleet };
}

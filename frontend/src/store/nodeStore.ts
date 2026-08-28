import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { mapTopologyData } from '../config/mapTopologyData';
import type { StarNode } from '../types/game';

export const useNodeStore = defineStore('node', () => {
  // 所有节点数据（响应式副本）
  const nodes = ref<StarNode[]>(JSON.parse(JSON.stringify(mapTopologyData)) as StarNode[]);

  // 按id获取节点
  const getNodeById = computed(() => {
    return (id: number) => nodes.value.find(n => n.id === id);
  });

  // 获取阵营所有节点
  const getNodesByFaction = computed(() => {
    return (factionId: number) => nodes.value.filter(n => n.ownerFactionId === factionId);
  });

  // 重置节点到初始状态（新游戏时调用，含随机化）
  function resetNodes() {
    nodes.value = (mapTopologyData as StarNode[]).map(node => {
      const isCapital = node.type === 'capital';
      const isFortress = node.type === 'fortress';
      const baseEcon = isCapital ? 5000 : (isFortress ? 800 : Math.floor(Math.random() * 2000 + 300));
      return {
        ...node,
        garrisonFleets: [],
        population: isCapital ? 10000 : (isFortress ? 100 : Math.floor(Math.random() * 2000 + 500)),
        security: isCapital ? 100 : Math.floor(Math.random() * 30 + 70),
        economy: baseEcon,
        nodeType: isCapital ? 'capital' : (isFortress ? 'fortress' : (baseEcon > 1500 ? 'economic' : baseEcon > 800 ? 'industrial' : 'border')) as string,
        shipyardLevel: isCapital || isFortress ? 5 : Math.floor(Math.random() * 3 + 1),
        defenseHp: node.defenseHp,
        maxDefenseHp: node.maxDefenseHp,
      } as StarNode;
    });
  }

  // 处理每日经济，返回各阵营税收（全局唯一税收入口）
  // playerFactionId: 玩家阵营，使用行政税率（baseTaxRate + warTaxRate）；其余阵营固定 10% 基准
  function processDailyEconomy(
    playerFactionId = 0,
    baseTaxRate = 0.10,
    warTaxRate = 0,
  ): { alliance: number, empire: number } {
    let allianceTax = 0;
    let empireTax = 0;
    const BASE = 0.01; // 对应税率滑杆 10% 的基准乘数
    nodes.value.forEach(node => {
      if (node.ownerFactionId === 0) return;
      const security = (node.security ?? 60) / 100;
      let rate = BASE; // AI 阵营固定基准税率
      if (node.ownerFactionId === playerFactionId) {
        // 玩家阵营：税率滑杆生效（0.10 → 基准；0.30 → 3倍基准），战争税叠加
        rate = BASE * (baseTaxRate / 0.10) + BASE * (warTaxRate / 0.10);
      }
      // P1修复：高经济值软上限——economy>2000 部分按平方根衰减（开发边际递减），
      // 原线性税使首都/发达星收益过陡，滚雪球无制衡。
      // 例：econ=5000 → 有效 2000+√3000×20≈3095；econ=2300 → 2000+√300×20≈2347
      const econRaw = node.economy || 0;
      const econEffective = econRaw <= 2000 ? econRaw : 2000 + Math.sqrt(econRaw - 2000) * 20;
      const tax = Math.floor((node.population || 0) * econEffective * rate * security);
      if (node.ownerFactionId === 1) allianceTax += tax;
      if (node.ownerFactionId === 2) empireTax += tax;
      // 防御自动修复
      if (node.defenseHp < node.maxDefenseHp) {
        node.defenseHp = Math.min(node.maxDefenseHp, node.defenseHp + node.shipyardLevel * 10);
      }
    });
    return { alliance: allianceTax, empire: empireTax };
  }

  // 节点易主
  function captureNode(nodeId: number, newFactionId: number) {
    const node = nodes.value.find(n => n.id === nodeId);
    if (node) {
      node.ownerFactionId = newFactionId;
      node.defenseHp = Math.floor(node.defenseHp * 0.5);
      node.security = Math.max(0, node.security - 20);
    }
  }

  // BFS：计算从 nodeId 到最近己方节点的跳数（用于补给消耗）
  function distanceToFriendly(nodeId: number, factionId: number): number {
    if (!nodes.value.length) return 99;
    const startNode = nodes.value.find(n => n.id === nodeId);
    if (!startNode) return 99;
    if (startNode.ownerFactionId === factionId) return 0;
    
    const visited = new Set<number>([nodeId]);
    const queue: { id: number; dist: number }[] = [{ id: nodeId, dist: 0 }];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = nodes.value.find(n => n.id === current.id);
      if (!node) continue;
      
      for (const connId of node.connections) {
        if (visited.has(connId)) continue;
        visited.add(connId);
        const neighbor = nodes.value.find(n => n.id === connId);
        if (neighbor && neighbor.ownerFactionId === factionId) {
          return current.dist + 1;
        }
        queue.push({ id: connId, dist: current.dist + 1 });
      }
    }
    return 99; // 无连通路径
  }

  return {
    nodes,
    getNodeById,
    getNodesByFaction,
    resetNodes,
    processDailyEconomy,
    captureNode,
    distanceToFriendly,
  };
});

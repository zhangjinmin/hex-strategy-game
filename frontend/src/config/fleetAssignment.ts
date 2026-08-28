// ==================================================
// File: src/config/fleetAssignment.ts
// 舰队归属映射表：按小说设定硬编码 admiral ID 分类
// ==================================================

import type { BaseAdmiral } from './admiralsData';
import type { StrategicFleet } from '../types/game';
import { FACTION_ALLIANCE_ID, FACTION_EMPIRE_ID, EMPIRE_FLEET_SPLIT_THRESHOLD } from '../types/game';

/**
 * 莱因哈特麾下舰队司令（改革派）— 9 人
 * 米达麦亚(80)、罗严塔尔(98)、毕典菲尔特(62)、法伦海特(65)、
 * 梅克林格(84)、连内肯普(97)、瓦列(99)、坎普(29)、吉尔菲艾斯(15)
 */
export const REINHARD_FLEET_COMMANDERS = new Set<number>([80, 98, 62, 65, 84, 97, 99, 29, 15]);

/**
 * 谬肯贝尔加麾下舰队司令（传统派）— 8 人
 * 艾齐纳哈(0)、斯特汀(36)、休特克豪简(37)、杰克特(44)、
 * 布朗胥百克(71)、梅尔卡兹(85)、立典亥姆(89)、立典拉德(90)
 */
export const MUECKENBERGER_FLEET_COMMANDERS = new Set<number>([0, 36, 37, 44, 71, 85, 89, 90]);

/**
 * 同盟舰队司令 — 13 人（全部归罗波斯 id:164）
 * 杨威利(156)、亚顿·费雪(161)、波布兰(162) 等
 */
export const ALLIANCE_FLEET_COMMANDERS = new Set<number>([101, 103, 106, 113, 114, 123, 136, 145, 147, 149, 156, 161, 162]);

/**
 * 按小说设定分配舰队归属（parentCommanderId）。
 *
 * 帝国侧（factionId = 2）：
 * - 莱因哈特麾下 → space_fleet_deputy (莱因哈特 id:81)
 * - 谬肯贝尔加麾下 → space_fleet_commander (谬肯贝尔加 id:82)
 * - 未匹配兜底：fleetNumber > 9 → 莱因哈特，其余 → 谬肯贝尔加
 *
 * 同盟侧（factionId = 1）：
 * - 全部 → space_fleet_commander (罗波斯 id:164)
 *
 * @param admirals 当前内存中的提督列表
 * @param fleets 当前内存中的舰队列表（会被原地修改 parentCommanderId）
 */
export function assignFleetByNovel(admirals: BaseAdmiral[], fleets: StrategicFleet[]): void {
  // 莱因哈特：帝国宇宙舰队副司令 (space_fleet_deputy, id:81)
  const reinhard = admirals.find(
    a => a.role === 'space_fleet_deputy' && a.faction === 'empire'
  );
  // 谬肯贝尔加：帝国宇宙舰队司令长官 (space_fleet_commander, id:82)
  const mueckenberger = admirals.find(
    a => a.role === 'space_fleet_commander' && a.faction === 'empire'
  );
  // 罗波斯：同盟宇宙舰队司令长官 (space_fleet_commander, id:164)
  const allianceCommander = admirals.find(
    a => a.role === 'space_fleet_commander' && a.faction === 'alliance'
  );

  fleets.forEach(fleet => {
    if (fleet.factionId === FACTION_EMPIRE_ID) {
      // 帝国侧：先按小说设定精确匹配，再按舰队番号兜底
      const commander = admirals.find(a => a.id === fleet.commanderId);
      if (commander && REINHARD_FLEET_COMMANDERS.has(commander.id)) {
        // 莱因哈特麾下
        fleet.parentCommanderId = reinhard?.id ?? null;
      } else if (commander && MUECKENBERGER_FLEET_COMMANDERS.has(commander.id)) {
        // 谬肯贝尔加麾下
        fleet.parentCommanderId = mueckenberger?.id ?? null;
      } else if (fleet.fleetNumber > EMPIRE_FLEET_SPLIT_THRESHOLD) {
        // 兜底：番号 > 9 → 莱因哈特
        fleet.parentCommanderId = reinhard?.id ?? null;
      } else {
        // 兜底：番号 ≤ 9 或番号 = 0（玩家舰队）→ 谬肯贝尔加
        fleet.parentCommanderId = mueckenberger?.id ?? null;
      }
    } else if (fleet.factionId === FACTION_ALLIANCE_ID) {
      // 同盟侧：全部归罗波斯
      fleet.parentCommanderId = allianceCommander?.id ?? null;
    }
  });
}

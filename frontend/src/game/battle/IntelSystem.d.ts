export type IntelContactState = 'unknown' | 'anomaly' | 'contact' | 'identified';

export interface ContactAssessmentInput {
  distance: number;
  sensorRange: number;
  scoutReport?: boolean;
  electronicStrength?: number;
  jammingStrength?: number;
}

export interface ContactAssessment {
  state: IntelContactState;
  effectiveSensorRange: number;
}

export function assessContact(input: ContactAssessmentInput): ContactAssessment;

export interface ContactMemoryInput {
  previous: IntelContactState;
  observed: IntelContactState;
  fired?: boolean;
  /** 交战窗口内（开火后强制战斗接触，不可消失） */
  engaged?: boolean;
  concealmentSucceeded?: boolean;
}

export function resolveContactMemory(input: ContactMemoryInput): IntelContactState;

// ── 持久已知目标档案（团队域 · 无 TTL）──

export interface IntelRecord {
  team: number;
  targetId: number | string;
  kind: 'fleet' | 'base';
  /** 末次确认位置 */
  x: number;
  y: number;
  /** 末次确认时间 */
  t: number;
  firstConfirmedAt: number;
  strength: number | null;
  /** 可靠航迹是否成立（仅显式电子战/欺骗可置 false） */
  reliable: boolean;
}

export interface IntelArchive {
  records: Map<string, IntelRecord>;
}

export function createIntelArchive(): IntelArchive;

export function recordKnownContact(
  archive: IntelArchive,
  input: { team: number; targetId: number | string; kind: 'fleet' | 'base'; x: number; y: number; now: number; strength?: number | null },
): IntelRecord;

export function getKnownContact(archive: IntelArchive, team: number, targetId: number | string): IntelRecord | null;

export function invalidateKnownTrack(archive: IntelArchive, team: number, targetId: number | string): IntelRecord | null;

export function isKnownTrackReliable(archive: IntelArchive, team: number, targetId: number | string): boolean;

// ── 渲染档位 ──

export type IntelDisplayMode = 'live' | 'fuzzy' | 'last_known' | 'hidden';

export interface IntelDisplayInput {
  observed: IntelContactState;
  engaged?: boolean;
  /** 档案已确认且处于实时探测范围（传感器重捕获） */
  identified?: boolean;
  record?: Pick<IntelRecord, 'x' | 'y' | 't' | 'reliable' | 'kind'> | null;
}

export interface IntelDisplay {
  mode: IntelDisplayMode;
  label: string | null;
  x?: number;
  y?: number;
  t?: number;
}

export function resolveIntelDisplay(input: IntelDisplayInput): IntelDisplay;

export function isMaterialIntelChange(
  prev: { x: number; y: number; strength?: number | null } | null,
  next: { x: number; y: number; strength?: number | null; moveThreshold?: number },
): boolean;

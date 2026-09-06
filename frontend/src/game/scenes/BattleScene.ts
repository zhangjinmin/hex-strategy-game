import * as Phaser from 'phaser';
import { useGameStore } from '../../store/gameStore';
import { useNodeStore } from '../../store/nodeStore';
import { battleDialogues } from '../../config/dialoguesData';
// CRT 全息投影渲染（已拆分到 crt/CrtRenderer.ts）
import {
  CRT_Y_SCALE, CRT_GRID_COLOR, CRT_ACCENT, CRT_BG,
  drawCRTBackground, renderCRTWireframeMap, updateCRTEffects, redrawCRTFleets, drawCRTOverlays,
  type CrtContext,
} from './crt/CrtRenderer';
import { drawCommandSpace, drawCommandFleets, drawCommandScanOverlay } from './crt/CommandSpaceRenderer';

// Vite 资源导入：返回运行时 URL，解决 Phaser 加载器找不到 src 下资源的问题
import hyperionUrl from '../../assets/ship/hyperion.png';
import brunhildUrl from '../../assets/ship/brunhild.png';
import allianceShipUrl from '../../assets/ship/alliance_ship.png';
import empireShipUrl from '../../assets/ship/empire_ship.png';
import flameUrl from '../../assets/ship/flame.png';
import isserlohnPlanetUrl from '../../assets/planet/1.png';

// ── 指挥点系统 ──
import { createCPState, updateCPState, getDamageMultiplier, getIncomingMultiplier, getReflectRatio, getSpeedMultiplier, getMoraleModifier, executeCommand, canExecute, getCooldownMs, type CPState, type ActiveEffect } from '../../services/CommandPointSystem';
import type { CommandAbility } from '../../config/commandAbilities';
// ── 指挥带宽系统（指挥链延迟机制）──
import { createBandwidthState, updateBandwidthState, getLinkStatus, hasChannel, establishChannel, canOrderInstantly, isRelayOrder, relayDelayMs, queueDelayedOrder, releaseChannel, degradeForFlagshipLoss, LINK_COLORS, LINK_CN, type BandwidthState, type LinkStatus, type PendingOrder } from '../../services/CommandBandwidthSystem';
import { commandBridge } from '../../services/CommandBridge';
// 3D 战场覆盖层特效桥：只推送事件，2D 特效代码零改动（3D 模式下 2D 层被隐藏）
import { pushFx3d } from '../battle3dFx';
import { updateSupplyChain, collectAuxShips, isSupplyUnit, SUPPLY_SOURCE_RADIUS, SUPPLY_AUX_RADIUS, type SupplyNode, type FleetSupplyInfo } from '../SupplyChainSystem';


// 贴图 key → Vite URL 映射表
const SHIP_TEXTURES: Record<string, string> = {
    hyperion: hyperionUrl,
    brunhild: brunhildUrl,
    alliance_ship: allianceShipUrl,
    empire_ship: empireShipUrl,
    flame: flameUrl,
};

const classToTypeCode: Record<string, string> = {
    '战列': 'BB', '巡洋': 'CA', '驱逐': 'DD', '突击': 'CV', '电子': 'EW', '补给': 'AUX', '运输': 'TR', '无': 'AUX'
};

const getShipTypeCode = (facTrait: string, cls: string) => {
    if (facTrait === 'rebels' && cls === '驱逐') return 'D';
    return classToTypeCode[cls] || 'AUX';
};

// CRT 常量已移至 crt/CrtRenderer.ts

// === CRT 全息战术投影参数 ===

export class BattleScene extends Phaser.Scene {
    private store: any;
    protected globalFleets: any[] = [];
    private phaserProjectiles: any[] = [];
    protected tilesList: any[] = [];
    protected tilesDict: Record<string, any> = {};
    private hpBarsGraphics!: Phaser.GameObjects.Graphics;
    private playerFlare: Phaser.GameObjects.Container | null = null;
    private carrierFighters: Map<number, Phaser.GameObjects.Arc[]> = new Map();
    private activeDialogues: Phaser.GameObjects.Container[] = [];
    private factionMap: Map<number, any> = new Map(); // O(1) faction lookup cache
    // P2 战役阶段目标：1破网 → 2斩链 → 3拔旗
    private battleStage: number = 1;
    private stageReported: boolean = false;
    // P3 战损账单（本场战斗累计）
    private battleLosses: { ships: number; pension: number } = { ships: 0, pension: 0 };
    private battleLossText: Phaser.GameObjects.Text | null = null;
    // P4 名场面
    private duelCooldown: number = 0;            // 一骑讨冷却（避免频繁触发）
    private lastDuelPair: string = '';           // 上次对决的舰队对
    private adversityTriggered: Set<number> = new Set(); // 已触发逆境宣言的舰队
    // P3 战术部署阶段
    private deployPhase: boolean = false;        // 开局部署是否进行中
    private deployText: Phaser.GameObjects.Text | null = null;
    private deployFormation: string = 'wedge';   // 玩家选择的初始阵型
    private deployTactic: string = 'balanced';   // 指令卡：突袭/合围/稳守
    // P4 战术增援
    private reinforceTimer: number = 0;          // 增援计时（ms）
    private reinforceInterval: number = 90000;   // 90秒一波
    private reinforceUsed: Map<number, boolean> = new Map(); // factionId → 本波是否已用
    // P5 战役剧本阶段
    private scriptPhase: string = 'probe';       // probe试探 / clash缠斗 / turn转折 / final决战
    private scriptReported: boolean = false;

    // === CRT 全息战术投影 ===
    // '3d' 走与 'hex' 完全相同的逻辑（所有 === 'crt' 判断对 '3d' 为 false）；3D 视觉由 Battle3DOverlay 叠加渲染
    private mapStyle: 'hex' | 'crt' | '3d' | 'command' = 'command';
    /** 指挥制宇宙起伏地形种子（同一局形状稳定） */
    private commandSpaceSeed = 1;
    private crtGraphics!: Phaser.GameObjects.Graphics;
    private crtWireframe!: Phaser.GameObjects.Graphics;
    private crtFleets!: Phaser.GameObjects.Graphics;  // 每帧更新的舰队线框层
    private crtOverlay!: Phaser.GameObjects.Graphics;
    private crtHudLabel: Phaser.GameObjects.Text | null = null;
    private crtScan: Phaser.GameObjects.Graphics | null = null;  // 指挥制：全屏扫描线 overlay（相机空间）
    private cmdScanTimer = 0;
    private crtGlowTime: { val: number } = { val: 0 };
    private crtFleetRedrawTimer: { val: number } = { val: 0 };

    // ===== 伊谢尔伦要塞武器系统 =====
    private fortressWeapon: {
        chargeTimer: number;
        chargeInterval: number;
        firstFireDelay: number;
        maxRange: number;
        fireAngle: number;
        fortressX: number;
        fortressY: number;
        fortressHp: number;
        fortressMaxHp: number;
        ownerFactionId: number;
        laserGraphics: Phaser.GameObjects.Graphics;
        chargeGraphics: Phaser.GameObjects.Graphics;
        hpBarBg: Phaser.GameObjects.Rectangle;
        hpBarFill: Phaser.GameObjects.Rectangle;
        destroyed: boolean;
        isCharging: boolean;
    } | null = null;

    private hexRadius = 26;
    private baseHexRadius = 26; // 基础值，用于动态缩放计算
    private directions = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];

    // ── 指挥点系统 ──
    private cpState: CPState | null = null;
    private cpCommandMode = false;  // 是否在选目标模式
    private pendingAbilityId: string | null = null;
    // ── 指挥带宽系统（指挥链延迟机制）──
    private bwState: BandwidthState | null = null;
    private commMarkers: Map<number, Phaser.GameObjects.Text> = new Map(); // 舰队ID → 链路指示标记
    private intentLines!: Phaser.GameObjects.Graphics;
    private damageNumbers: { sprite: Phaser.GameObjects.Text; timer: number }[] = [];
    private spaceKey!: Phaser.Input.Keyboard.Key;

    constructor(config?: string | Phaser.Types.Scenes.SettingsConfig) {
        super(config || { key: 'BattleScene' });
    }

    preload() {
        // 使用 Vite 解析后的 URL 加载贴图，确保能找到 src/assets 下的资源
        for (const [key, url] of Object.entries(SHIP_TEXTURES)) {
            this.load.image(key, url);
        }
        // 伊谢尔伦星球图片
        this.load.image('isserlohn_planet', isserlohnPlanetUrl);
    }

    create() {
        this.store = useGameStore();
        const state = (this.store as any).tacticalState;
        const isCampaign = state && state.mode === 'campaign';
        this.mapStyle = state?.mapStyle ?? 'hex';
        if (this.mapStyle === '3d') {
            console.log('[BattleScene] 3D battlefield mode: Phaser logic engine running, rendering delegated to Battle3DOverlay');
        }
        console.log(`[BattleScene] create() mapStyle=${this.mapStyle}, state.mapStyle=${state?.mapStyle}, isCampaign=${isCampaign}`);

        // 重置战斗状态
        this.store.gameOver = false;
        this.store.isWin = false;
        this.store.isPaused = false;

        // === 阶段A：动态地图扩容 ===
        // 根据参战舰队数动态缩放hexRadius，避免多舰队拥挤
        this.scaleMapForFleetCount(state);

        this.cameras.main.centerOn(0, 0);
        // 动态缩放：hexRadius越大（多舰队），初始zoom越小，确保能看到更多战场
        let initZoom = Math.max(0.3, 0.8 * (this.baseHexRadius / this.hexRadius));
        if (this.store.selectedMapId.startsWith('custom_')) initZoom = Math.min(initZoom, 0.7);
        else if (this.store.selectedMapId === 'random_large') initZoom = Math.min(initZoom, 0.45);
        else if (this.store.selectedMapId === 'random_rect') initZoom = Math.min(initZoom, 0.55);
        // 指挥制：无六边形格子，不按 hexRadius 缩放（否则 zoom 会被算到 0.3，
        // 舰队小到看不见、背景线条被压缩成一片）。用固定舒适视角。
        if (this.mapStyle === 'command') initZoom = 0.85;
        this.cameras.main.setZoom(initZoom);

        // === CRT 全息战术投影：3D 俯瞰透视 ===
        // command（指挥制）复用同一套 Graphics 图层与扫描线风格，
        // 但渲染内容改为纯宇宙起伏等高线（不画六边形网格）。
        if (this.mapStyle === 'crt' || this.mapStyle === 'command') {
            if (this.mapStyle === 'crt') {
                // 3D 俯瞰效果通过线框地图的 Y 轴压缩实现（CRT_Y_SCALE）
                console.log(`[BattleScene] CRT holographic mode enabled (yScale=${CRT_Y_SCALE})`);
            } else {
                console.log('[BattleScene] Command mode enabled (pure space, no hex grid)');
                this.commandSpaceSeed = Math.floor(Math.random() * 100000) + 1;
            }

            this.cameras.main.setBackgroundColor(CRT_BG);
            this.crtGraphics = this.add.graphics().setDepth(0);
            this.crtWireframe = this.add.graphics().setDepth(1);
            // 指挥制：舰队光环需盖在单位 sprite(depth 5/6) 之上，否则被遮挡看不见
            this.crtFleets = this.add.graphics().setDepth(this.mapStyle === 'command' ? 10 : 2);
            this.crtOverlay = this.add.graphics().setDepth(100);
            if (this.mapStyle === 'command') {
                // 指挥制：全屏扫描线 overlay（独立层，每 ~60ms 随相机重绘）
                this.crtScan = this.add.graphics().setDepth(101);
                drawCommandSpace(this.cameras.main, this.crtGraphics, this.commandSpaceSeed);
            } else {
                this.drawCRTBackground();
            }
        }

        this.hpBarsGraphics = this.add.graphics().setDepth(30);
        // 补给链可视化：画补给源/运输舰的补给圈，以及到补给舰队的链路
        this.supplyGfx = this.add.graphics().setDepth(12);
        this.globalFleets = [];
        this.phaserProjectiles = [];
        this.tilesList = [];
        this.tilesDict = {};
        // 清理上一局的舰载机
        this.carrierFighters.forEach(fighters => fighters.forEach(f => f.destroy()));
        this.carrierFighters.clear();

        // 【核心隔离逻辑：双轨制分流】
        if (isCampaign) {
            // 轨道 A：大地图真实战役
            this.buildCampaignEnvironment(state);
            this.spawnStrategicFleets(state);
        } else {
            // 轨道 B：主界面演习 / 战术模拟
            this.initFactions();
            const mapDataMatrix = this.buildMapData();
            mapDataMatrix.forEach(data => {
                if (data.type === 'castle') {
                    const fac = this.factionMap.get(data.ownerId);
                    if (fac) {
                        const cScale = this.mapStyle === 'crt' ? CRT_Y_SCALE : 1;
                        fac.castlePos = {
                            x: this.hexRadius * (Math.sqrt(3) * data.q + Math.sqrt(3)/2 * data.r),
                            y: this.hexRadius * (3/2 * data.r) * cScale
                        };
                    }
                }
            });
            // 安全回退：未分配城堡的舰队 → 推到地图边缘（避免城堡在(0,0)中央）
            this.store.factions.forEach((f: any) => {
                if (!f.castlePos || (f.castlePos.x === 0 && f.castlePos.y === 0)) {
                    if (this.mapStyle === 'command') {
                        // 指挥制后勤战：攻左守右直接拉到战场边缘，留出补给纵深
                        // （hex/crt 分支保持原样的 edgeQ 栅格回退）
                        f.castlePos = {
                            x: f.team === 1 ? -1500 : 1500,
                            y: (Math.random() - 0.5) * 600
                        };
                    } else {
                        const edgeQ = f.team === 1 ? -20 : 20;
                        f.castlePos = {
                            x: this.hexRadius * (Math.sqrt(3) * edgeQ),
                            y: (Math.random() - 0.5) * this.hexRadius * 6
                        };
                    }
                }
            });
            // 先实例化舰队，再渲染地块（确保地块多边形在上层，优先接收点击事件）
            this.spawnInitialFleets();
            // 关键：renderHexMap 内部才会填充 tilesList/tilesDict（BattleScene.ts:1126），
            // 而 AI 的探索/目标选择完全依赖 tilesList。此前指挥制直接跳过调用 → tilesList 为空
            // → AI 找不到任何地块目标 → 舰队原地不动（用户实报）。
            // 因此指挥制仍要建地块数据（只是不显示），保证 AI 逻辑完整。
            this.renderHexMap(mapDataMatrix);
            if (this.mapStyle === 'command') {
                // 纯宇宙：隐藏六边形地块与地形标记（保留数据层，仅关闭视觉与交互）
                this.tilesList.forEach((t: any) => {
                    if (t?.sprite) { t.sprite.setVisible(false); t.sprite.disableInteractive(); }
                    if (t?.text) t.text.setVisible(false);
                });
            } else {
                // P1 地形标记渲染
                this.renderTerrainMarkers();
            }
            // CRT 模式：绘制全息线框地图（sprite 在 update 中透明化 + 线框几何体叠加）
            if (this.mapStyle === 'crt') {
                this.renderCRTWireframeMap(mapDataMatrix);
            } else if (this.mapStyle === 'command') {
                // 指挥制：绘制纯宇宙起伏等高线（覆盖在 crtGraphics 上）
                if (this.crtGraphics) {
                    drawCommandSpace(this.cameras.main, this.crtGraphics, this.commandSpaceSeed);
                }
            }
        }

        // 指挥制后勤战：中线带布置 3 个中立星球中继（占领后扩大补给半径）
        // （函数内部自带 mapStyle==='command' 守卫，hex/crt 零影响）
        this.spawnSupplyRelayPlanets();

        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (pointer.isDown) {
                this.cameras.main.scrollX -= (pointer.x - pointer.prevPosition.x) / this.cameras.main.zoom;
                this.cameras.main.scrollY -= (pointer.y - pointer.prevPosition.y) / this.cameras.main.zoom;
            }
        });
        this.input.on('wheel', (pointer: any, gameObjects: any, deltaX: number, deltaY: number) => {
            this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom - deltaY * 0.001, 0.2, 2.5));
        });

        // ── 指挥点系统：空格键暂停/恢复（使用 addKey 而非 on('keydown-SPACE') 更可靠）──
        this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

        // ── P0 即时阵型切换：1-5 数字键（玩家舰队）+ P3 部署阶段指令卡选择 ──
        this.input.keyboard!.on('keydown', (event: any) => {
            const keyName = event?.key?.toUpperCase?.();
            const formName: Record<string, string> = { '1': 'wedge', '2': 'line', '3': 'spindle', '4': 'circle', '5': 'square' };
            const newForm = formName[keyName];

            // P3 部署阶段：数字键选阵型，T键选指令卡（突袭/合围/稳守），回车开始
            if (this.deployPhase) {
                if (newForm) {
                    this.deployFormation = newForm;
                    this.updateDeployText();
                    return;
                }
                if (keyName === 'T') {
                    const seq = ['突袭', '合围', '稳守'];
                    const cur = seq.indexOf(this.deployTactic === 'aggressive' ? '突袭' : this.deployTactic === 'encircle' ? '合围' : '稳守');
                    const next = seq[(cur + 1) % 3];
                    this.deployTactic = next === '突袭' ? 'aggressive' : next === '合围' ? 'encircle' : 'balanced';
                    this.updateDeployText();
                    return;
                }
                if (keyName === 'ENTER') {
                    this.startBattleAfterDeploy();
                    return;
                }
                return; // 部署阶段屏蔽其他按键
            }

            if (!newForm || this.store.isPaused || this.store.gameOver) return;
            const pFac = this.store.factions.find((f: any) => f.type === 'player');
            const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
            if (!pFleet || pFleet.units.length === 0) return;
            if (pFleet.formation === newForm) return;
            const oldForm = pFleet.formation;
            pFleet.formation = newForm;
            // 阵型切换士气/提示
            pFleet._formSwitchCooldown = this.time.now + 1000;
            this.store.triggerToast?.(`[${pFac?.name}] 变阵 → ${this.getFormationCnName(newForm)}`);
            // 变阵瞬间生成扩散光环特效
            pFleet.units.forEach((u: any) => {
                if (u.sprite?.active) {
                    const ring = this.add.circle(u.sprite.x, u.sprite.y, 20, 0x06b6d4, 0.25).setDepth(15);
                    this.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
                }
            });
        });
        // 意图线Graphics层
        this.intentLines = this.add.graphics().setDepth(25);

        // 初始化CP引擎（使用玩家提督的统帅值）
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        const cmd = pFac?.admiralStats?.command || 50;
        this.cpState = createCPState(cmd);

        // 初始化指挥带宽引擎（直连半径随地图缩放：半径的26倍 ≈ 跨越全图1/3）
        this.bwState = createBandwidthState(cmd, this.hexRadius * 26);

        // 强行拦截小游戏的内政 Tick
        this.time.addEvent({
            delay: 1000, loop: true,
            callback: () => {
                if (this.store.gameOver || this.store.isPaused || isCampaign) return; // 战役模式下禁止跑小游戏的造兵铺路逻辑
                
                this.store.factions.filter((f: any) => f.type === 'ai' || f.type === 'ally').forEach((aiFac: any) => {
                    const fleets = this.globalFleets.filter(fl => fl.factionId === aiFac.id);
                    if (fleets.length === 0) return;
                    const fleet = fleets[0];
                    let totalHp = 0, totalMaxHp = 0;
                    fleet.units.forEach((u: any) => { totalHp += u.hp; totalMaxHp += u.maxHp; });
                    const hpPct = totalMaxHp > 0 ? totalHp / totalMaxHp : 0;
                    const myPower = this.calculateFleetPower(fleet);

                    // === 伤害检测：被打了但看不见敌人 → 一定是塔在射 ===
                    const prevHp = fleet._lastTickHp || totalMaxHp;
                    const hpDropped = prevHp - totalHp > totalMaxHp * 0.02;
                    fleet._lastTickHp = totalHp;
                    let underTowerFire = false;
                    if (hpDropped) {
                        // 检测附近是否有敌方塔
                        let nearestEnemyTower: any = null; let minTowerDist = 200;
                        this.tilesList.forEach(t => {
                            if (t.type === 'tower') {
                                const tFac = this.factionMap.get(t.ownerId);
                                if (tFac && tFac.team !== aiFac.team) {
                                    const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, t.x, t.y);
                                    if (d < minTowerDist) { minTowerDist = d; nearestEnemyTower = t; }
                                }
                            }
                        });
                        // 在塔射程内且无可见敌人 → 被塔打
                        if (nearestEnemyTower && minTowerDist < 160) {
                            underTowerFire = true;
                            fleet._targetTower = nearestEnemyTower; // 标记目标塔
                        }
                    }

                    // === 战略态势评估 ===
                    const enemyFacs = this.store.factions.filter((f: any) => this.factionMap.get(f.id)?.team !== aiFac.team && f.active);
                    let totalEnemyPower = 0, nearestEnemyDist = Infinity;
                    enemyFacs.forEach((ef: any) => {
                        const efFleet = this.globalFleets.find(fl => fl.factionId === ef.id);
                        if (efFleet) {
                            totalEnemyPower += this.calculateFleetPower(efFleet);
                            const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, efFleet.x, efFleet.y);
                            if (d < nearestEnemyDist) nearestEnemyDist = d;
                        }
                    });
                    // P5 AI性格化：提督风格权重（基于能力值与标签）
                    const admStats = aiFac.admiralStats || {};
                    const aggScore = (admStats.attack || 50) + (admStats.command || 50);
                    const cautScore = (admStats.defense || 50) + (admStats.tactics || 50);
                    const personalityType = aggScore > cautScore + 20 ? 'aggressive' : (cautScore > aggScore + 20 ? 'cautious' : 'balanced');
                    const advMult = personalityType === 'aggressive' ? 0.8 : (personalityType === 'cautious' ? 1.2 : 1.0);
                    const forceRatio = totalEnemyPower > 0 ? myPower / totalEnemyPower : 999;
                    const isPlayerAlly = aiFac.type === 'ally';

                    // === 战略角色分配（优先级从上到下，P5 性格化调整阈值）===
                    // P3 部署指令卡影响：突袭→AI更早猛攻；合围→AI偏好侧翼；稳守→AI更保守
                    const deployAdj = aiFac._deployTactic === 'aggressive' ? 0.85
                        : (aiFac._deployTactic === 'encircle' ? 1.0 : 1.15);
                    if (underTowerFire) {
                        // 被塔打：拆塔或者跑（激进派顶着拆塔）
                        fleet.stance = hpPct > (personalityType === 'aggressive' ? 0.3 : 0.5) ? 'siege' : 'fallback';
                    } else if (hpPct < 0.35) {
                        fleet.stance = 'fallback';
                    } else if (forceRatio > 2.0 * advMult * deployAdj) {
                        fleet.stance = 'siege';
                    } else if (forceRatio > 1.2 * advMult * deployAdj) {
                        fleet.stance = 'search';
                    } else if (forceRatio > 0.6 * advMult * deployAdj) {
                        fleet.stance = 'search';
                        fleet.formation = 'line';
                    } else {
                        fleet.stance = nearestEnemyDist < 400 ? 'fallback' : 'search';
                    }
                    // P5 性格化：激进派默认楔形突击，保守派默认方阵防御
                    // P3 合围指令：AI 优先楔形包抄
                    if (aiFac._deployTactic === 'encircle' && fleet.stance === 'siege') fleet.formation = 'wedge';
                    else if (fleet.stance === 'siege' && personalityType === 'aggressive') fleet.formation = 'wedge';
                    else if (fleet.stance === 'fallback' && personalityType === 'cautious') fleet.formation = 'circle';

                    // 玩家盟友特殊逻辑：始终跟随玩家主力行动
                    if (isPlayerAlly && fleet.stance !== 'fallback') {
                        const pFac = this.store.factions.find((f: any) => f.type === 'player');
                        const pFleet = pFac ? this.globalFleets.find(fl => fl.factionId === pFac.id) : null;
                        if (pFleet && pFleet.units.length > 0) {
                            const distToPlayer = Phaser.Math.Distance.Between(fleet.x, fleet.y, pFleet.x, pFleet.y);
                            // 远离玩家时主动靠近；靠近时协同作战
                            if (distToPlayer > 350) {
                                fleet.stance = 'search';
                                fleet._escortPlayer = true;
                            } else {
                                fleet._escortPlayer = true;
                                // 与玩家同一姿态协同
                                fleet.stance = pFleet.stance || 'search';
                            }
                        }
                    }
                });

                // ===== AI 智能扩张补给线逻辑（v2 公平化：不再白送金，铺地价格按难度微调） =====
                this.store.factions.filter((f: any) => (f.type === 'ai' || f.type === 'ally') && f.active).forEach((aiFac: any) => {
                    // v2 修复：删除 aiFac.gold += 15 印钞机。AI收入来自 goldRate（与玩家同规则，下方统一结算）
                    const aiPriceMul = this.store.selectedDiff === 'hard' ? 0.7 : (this.store.selectedDiff === 'easy' ? 1.3 : 1.0);
                    if (aiFac.gold >= 50) {
                        const candidates: any[] = [];
                        const aiFleet = this.globalFleets.find(fl => fl.factionId === aiFac.id);
                        const enemyTeam = this.store.factions.find((f: any) => f.team !== aiFac.team && f.active);
                        
                        this.tilesList.forEach(t => {
                            if (t.ownerId === 0 && t.type !== 'sea' && t.type !== 'ruined' && t.type !== 'planet') {
                                let isAdjToMe = false, isAdjToEnemy = false;
                                for (const dir of this.directions) {
                                    const n = this.tilesDict[`${t.q + dir.q},${t.r + dir.r}`];
                                    if (n && n.ownerId === aiFac.id) isAdjToMe = true;
                                    if (n && enemyTeam && this.factionMap.get(n.ownerId)?.team === enemyTeam.team) isAdjToEnemy = true;
                                }
                                if (isAdjToMe) candidates.push({ tile: t, isAdjToEnemy });
                            }
                        });
                        
                        if (candidates.length > 0 && aiFleet) {
                            candidates.sort((a, b) => {
                                // 优先：逼近敌方（切断补给）+ 靠近舰队
                                const scoreA = (a.isAdjToEnemy ? -300 : 0) + Phaser.Math.Distance.Between(a.tile.x, a.tile.y, aiFleet.x, aiFleet.y);
                                const scoreB = (b.isAdjToEnemy ? -300 : 0) + Phaser.Math.Distance.Between(b.tile.x, b.tile.y, aiFleet.x, aiFleet.y);
                                return scoreA - scoreB;
                            });
                            const targetTile = candidates[0].tile;
                            
                            // v2 公平化：AI 铺地成本按难度乘系数（hard 便宜=更快，但非白送）
                            const effectiveCost = Math.max(1, Math.round(targetTile.cost * aiPriceMul));
                            if (aiFac.gold >= effectiveCost) {
                                aiFac.gold -= effectiveCost;
                                targetTile.ownerId = aiFac.id;
                            }
                        }
                    }
                });

                this.updateSupplyNetwork();
                this.processSupplyAndCapture();
                this.drawSupplyChain();   // 补给链可视化（补给圈/运输舰/链路）

                // 结算战略节点收益
                this.tilesList.forEach(t => {
                    if (t.ownerId !== 0) {
                        const fac = this.factionMap.get(t.ownerId);
                        if (fac) {
                            if (t.type === 'mine' || t.type === 'gold_mine') fac.gold += t.type === 'gold_mine' ? 5 : 3;
                        }
                    }
                    
                    if (t.type === 'barracks') {
                        this.globalFleets.forEach(fl => {
                            if (fl.factionId === t.ownerId && Phaser.Math.Distance.Between(fl.x, fl.y, t.x, t.y) < 80) {
                                fl.units.forEach((u: any) => { u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.03); });
                            }
                        });
                    }
                });

                this.store.factions.forEach((f: any) => {
                    if (f.active) {
                        f.gold += f.goldRate;
                        let currentHp = 0; let currentMaxHp = 0;
                        this.globalFleets.filter(fl => fl.factionId === f.id).forEach(fl => {
                            fl.units.forEach((u: any) => { currentHp += u.hp; currentMaxHp += u.maxHp; });
                        });
                        if (currentMaxHp > 0) { f.hp = currentHp; f.maxHp = currentMaxHp; }
                    }
                });

        // ===== P2 战役阶段目标：破网→斩链→拔旗 =====
        this.checkBattleStage();

        // ===== P5 战役剧本阶段推进（试探→缠斗→转折→决战） =====
        this.updateScriptPhase();

        // ===== P4 战术增援：90秒一波拉锯 =====
        this.updateReinforcement();

        // ===== P3 战损账单 HUD（左上角常驻） =====
        if (this.battleLosses.ships > 0 || this.battleLosses.pension > 0) {
            if (!this.battleLossText) {
                this.battleLossText = this.add.text(10, 10, '', {
                    fontSize: '12px', color: '#ef4444', fontStyle: 'bold',
                    backgroundColor: 'rgba(0,0,0,0.55)', padding: { x: 8, y: 4 }
                }).setDepth(60).setScrollFactor(0);
            }
            this.battleLossText.setText(`本场战损：${this.battleLosses.ships} 舰 · 抚恤 ₮${Math.round(this.battleLosses.pension / 10000)}万`);
        }

            }
        });

        // ===== 指令变阵监听 =====
        this.setupCommandDispatcher();

        // ===== P3 战术部署阶段：开局暂停，玩家选择阵型+指令卡 =====
        this.activateDeployPhase();
    }

    /** P3 开启部署阶段：暂停战斗，显示部署选单 */
    private activateDeployPhase() {
        // 只对玩家参与的战术战启用（campaign/自定义战斗），模拟沙盒（sim）跳过
        const state = (this.store as any).tacticalState;
        const isCampaign = state && state.mode === 'campaign';
        const hasPlayer = this.store.factions.some((f: any) => f.type === 'player' && f.active);
        if (this.store.simMode || !hasPlayer) return;

        this.deployPhase = true;
        this.store.isPaused = true;
        // 玩家舰队摆好初始阵型（默认楔形）
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
        if (pFleet) pFleet.formation = this.deployFormation;
        this.updateDeployText();
    }

    /** P3 刷新部署选单文字 */
    private updateDeployText() {
        if (!this.deployText) {
            this.deployText = this.add.text(0, 0, '', {
                fontSize: '14px', color: '#00ff88', fontFamily: 'monospace',
                backgroundColor: 'rgba(0,8,16,0.85)', padding: { x: 16, y: 12 },
            }).setDepth(110).setScrollFactor(0).setOrigin(0.5);
        }
        const tacticLabel = this.deployTactic === 'aggressive' ? '突袭' : (this.deployTactic === 'encircle' ? '合围' : '稳守');
        const formCn = this.getFormationCnName(this.deployFormation);
        const cam = this.cameras.main;
        this.deployText.setPosition(cam.width / 2, cam.height / 2 - 40);
        this.deployText.setText(
            `◤ 战前部署 ◢\n\n` +
            `初始阵型：${formCn}    [1-5 切换]\n` +
            `战术指令：${tacticLabel}   [T 切换]\n` +
            `  突袭：开局主动进攻\n` +
            `  合围：优先包抄侧翼\n` +
            `  稳守：坚守待机反击\n\n` +
            `[回车] 开始战斗`
        );
        // 指令卡改变 AI 开局行为标记
        const aiFacs = this.store.factions.filter((f: any) => f.type === 'ai' && f.active);
        aiFacs.forEach((ai: any) => { ai._deployTactic = this.deployTactic; });
    }

    /** P3 结束部署，开始战斗 */
    private startBattleAfterDeploy() {
        if (!this.deployPhase) return;
        this.deployPhase = false;
        this.store.isPaused = false;
        if (this.deployText) { this.deployText.destroy(); this.deployText = null; }
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
        if (pFleet) pFleet.formation = this.deployFormation;
        // 玩家选择影响 AI 行为：突袭→AI 更早进入 siege；合围→AI 更倾向包抄
        this.store.factions.filter((f: any) => f.type === 'ai' && f.active).forEach((ai: any) => {
            ai._deployTactic = this.deployTactic;
        });
        this.showFleetDialogue(pFleet, 'spawn');
        // P5 战役剧本：开局简报
        this.showBattleBanner('战役开始', '第一阶段：试探接触', '#00ff88');
        this.scriptPhase = 'probe';
        this.scriptReported = false;
    }

    /** P6 重大事件横幅：全屏居中大字 + 扩散动画（替代小 toast 的仪式感） */
    private showBattleBanner(title: string, subtitle: string, color: string = '#fbbf24') {
        const cam = this.cameras.main;
        const cx = cam.width / 2;
        const cy = cam.height / 2;

        const titleTxt = this.add.text(cx, cy - 14, title, {
            fontSize: '30px', color, fontStyle: 'bold', fontFamily: 'monospace',
            backgroundColor: 'rgba(4,8,16,0.75)', padding: { x: 24, y: 10 },
        }).setOrigin(0.5).setDepth(120).setScrollFactor(0).setAlpha(0);

        const subTxt = this.add.text(cx, cy + 26, subtitle, {
            fontSize: '13px', color: '#94a3b8', fontFamily: 'monospace',
        }).setOrigin(0.5).setDepth(120).setScrollFactor(0).setAlpha(0);

        // 入场：淡入 + 轻微放大
        this.tweens.add({ targets: [titleTxt, subTxt], alpha: 1, duration: 250, ease: 'Sine.easeOut' });
        this.tweens.add({ targets: titleTxt, scale: 1.08, duration: 250, yoyo: true, ease: 'Sine.easeOut' });
        this.cameras.main.shake(200, 0.003);

        // 停留 1.8 秒后淡出
        this.time.delayedCall(1800, () => {
            this.tweens.add({ targets: [titleTxt, subTxt], alpha: 0, duration: 400, onComplete: () => { titleTxt.destroy(); subTxt.destroy(); } });
        });
    }

    // 解析大地图真实兵力（解除原有的 tile 强校验阻塞）
    private spawnStrategicFleets(state: any) {
        this.globalFleets = [];

        // 获取攻守双方的出生位置（从 faction.castlePos 读取，已在 buildCampaignEnvironment 中设置）
        const attackerFac = this.factionMap.get(state.attackers?.[0]?.factionId);
        const defenderFac = this.factionMap.get(state.defenders?.[0]?.factionId);
        // 指挥制下默认值同步拉开到 ±1500（正常路径 castlePos 已由 buildCampaignEnvironment 给足，
        // 这里是 castlePos 缺失时的兜底，hex/crt 保持 ±150 原样）
        const fallbackSpawnDist = this.mapStyle === 'command' ? 1500 : 150;
        const attackerSpawn = attackerFac?.castlePos || { x: -fallbackSpawnDist, y: 0 };
        const defenderSpawn = defenderFac?.castlePos || { x: fallbackSpawnDist, y: 0 };

        const deploySide = (fleetsData: any[], isAttacker: boolean) => {
            const spawnX = isAttacker ? attackerSpawn.x : defenderSpawn.x;
            const spawnY = isAttacker ? attackerSpawn.y : defenderSpawn.y;
            fleetsData.forEach((fleetData: any) => {
                const fleetObj: any = {
                    id: fleetData.fleetId, displayId: this.globalFleets.length + 1,
                    factionId: fleetData.factionId, target: null, state: 'idle',
                    units: [], formation: fleetData.formation || 'wedge',
                    commanderId: (fleetData as any).commanderId ?? null,
                    flagshipName: (fleetData as any).flagshipName || '',
                    facingAngle: isAttacker ? 0 : Math.PI,
                    stance: 'search', lastState: 'idle', halfHpTriggered: false,
                    morale: (fleetData as any).morale ?? 100,
                    x: spawnX,
                    y: spawnY
                };

                if (!fleetData.slots) return;

                fleetData.slots.forEach((slot: any, slotIdx: number) => {
                    let texture = 'flame';
                    if (slot.type === 'battleship') texture = fleetData.factionId === 2 ? 'brunhild' : 'hyperion';
                    else if (slot.type === 'cruiser') texture = fleetData.factionId === 2 ? 'empire_ship' : 'alliance_ship';
                    else if (slot.type === 'destroyer') texture = fleetData.factionId === 2 ? 'empire_ship' : 'alliance_ship';

                    const unitContainer = this.add.container(fleetObj.x, fleetObj.y).setDepth(5);
                    const aura = this.add.ellipse(0, 0, 30, 10, isAttacker ? 0x3b82f6 : 0xef4444, 0.4).setName('aura');
                    const shipImg = this.add.image(0, 0, texture).setName('border').setDisplaySize(11, 33);
                    const flame = this.add.image(-15, 0, 'flame').setName('flame').setDisplaySize(20, 6).setVisible(false);
                    const typeText = this.add.text(0, -12, slot.type.substring(0, 2).toUpperCase(), { fontSize: '9px', color: '#ffffff' }).setOrigin(0.5).setName('text');
                    
                    unitContainer.add([aura, flame, shipImg, typeText]);

                    if (!isAttacker) shipImg.setFlipX(true);

                    fleetObj.units.push({
                        sprite: unitContainer, factionId: fleetData.factionId,
                        hp: slot.hp, maxHp: slot.maxHp, atk: slot.atk || 50, def: 10,
                        range: slot.type === 'battleship' ? 180 : (slot.type === 'cruiser' ? 140 : 100),
                        classType: slot.type, atkInterval: 2000, speed: 1.0,
                        lastAtkTime: -((slotIdx * 400) % 2000), state: 'moving', supply: 100,
                        gridX: slot.x, 
                        gridY: slot.y  
                    });
                });
                this.globalFleets.push(fleetObj);
            });
        };

        deploySide(state.attackers, true);
        deploySide(state.defenders, false);
        (this.store as any).triggerToast?.('战区折跃完成，已建立全周天战网。');
    }

    // 保留旧方法供可能的回退（不删除，只从 create 中去掉调用）
    private spawnInitialFleets() {
        this.store.factions.forEach((fac: any) => {
            if (!fac.active || !fac.castlePos) return;
            const activeDeck = fac.deck.filter(Boolean);
            if (activeDeck.length === 0) return;

            const fleetId = Math.random();
            const fleet: any = {
                id: fleetId, displayId: this.globalFleets.length + 1, factionId: fac.id,
                commanderId: fac.id, flagshipName: (fac as any).flagshipName || (this.store.allAdmirals as any[]).find((a: any) => a.id === fac.id)?.flagshipName || '',
                x: fac.castlePos.x, y: fac.castlePos.y, target: null, state: 'assembling', units: [] as any[],
                formation: ['wedge', 'line', 'spindle', 'circle', 'square'][Math.floor(Math.random() * 5)] as any,
                facingAngle: 0, stance: 'search', targetFlare: null,
                lastState: 'assembling', halfHpTriggered: false, // 追加状态记忆
                morale: 100,  // 士气(0-100)：断粮时先掉士气，归零后才扣结构生命
            };
            this.time.delayedCall(800, () => this.showFleetDialogue(fleet, 'spawn')); // 延迟触发舰队出击语录

            this.globalFleets.push(fleet);

            activeDeck.forEach((classId: string, idx: number) => {
                const tTech = this.store.getTroopById(classId);
                const hp = tTech.hp, atk = tTech.atk, def = tTech.def, range = tTech.range, interval = tTech.interval, speed = tTech.speed;
                const isFlagship = idx === 0;
                
                const unitContainer = this.add.container(fac.castlePos.x, fac.castlePos.y).setDepth(isFlagship ? 6 : 5);
                unitContainer.setSize(16, 16);
                const shipTypeCode = getShipTypeCode(fac.trait, tTech.cls);
                
                // 1. 判断该用什么贴图
                let textureKey = '';
                if (isFlagship) {
                    if (fac.name.includes('杨威利')) textureKey = 'hyperion';
                    else if (fac.name.includes('莱茵哈特')) textureKey = 'brunhild';
                    else textureKey = fac.trait === 'empire' ? 'empire_ship' : 'alliance_ship'; // 普通提督的通用旗舰
                } else {
                    textureKey = fac.trait === 'empire' ? 'empire_ship' : 'alliance_ship';
                }

                // 2. 绘制阵营底盘光环（因为图片没法像方块那样描边，需要用底色光环区分敌我）
                const auraW = isFlagship ? 40 : (tTech.cls === '战列' || tTech.cls === '突击' ? 30 : 20);
                const auraH = isFlagship ? 15 : 10;
                // 添加阵营颜色的椭圆光环在飞船底部，并在脱离视野时变色
                const aura = this.add.ellipse(0, 0, auraW, auraH, fac.color, 0.4).setName('aura');

                // 2.5 战舰阴影已移除（俯视图场景中阴影会显示为黑块，影响美观）

                // 3. 生成真实的战舰贴图（原图为竖向俯视图，舰头朝上）
                // 不在此处设旋转角度，统一在 update() 中通过 rotation 补偿方向
                const shipImg = this.add.image(0, 0, textureKey).setName('border');
                // 原图为竖向（舰头朝上），宽高比约 1:3，setDisplaySize 保持竖向比例
                let shipLen = 42; // 战舰在容器坐标系下沿X轴的长度（旋转90度后）
                if (isFlagship) {
                    shipImg.setDisplaySize(14, 42);
                    shipLen = 42;
                } else {
                    if (tTech.cls === '战列' || tTech.cls === '突击') { shipImg.setDisplaySize(11, 33); shipLen = 33; }
                    else if (tTech.cls === '巡洋' || tTech.cls === '电子') { shipImg.setDisplaySize(9, 25); shipLen = 25; }
                    else { shipImg.setDisplaySize(6, 18); shipLen = 18; } // 驱逐
                }

                // 3.5 尾焰：窄版明亮型PNG（48×16，宽高比3:1），NORMAL模式
                // 细长设计：辉光不会超出舰船宽度
                const flameLen = isFlagship ? 28 : (tTech.cls === '战列' || tTech.cls === '突击' ? 22 : (tTech.cls === '巡洋' || tTech.cls === '电子' ? 18 : 14));
                const flame = this.add.image(-shipLen / 2, 0, 'flame').setName('flame');
                flame.setOrigin(0.5, 0.5);        // 居中原点
                flame.setDisplaySize(flameLen, flameLen / 3); // 宽高比3:1（很窄的长条）
                flame.setVisible(false);

                // 4. 将文字移到飞船尾部或侧边，避免挡住贴图
                const typeText = this.add.text(0, -12, isFlagship ? '★' : shipTypeCode, { fontSize: '9px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(0.5).setName('text');

                // 添加顺序：光环 -> 尾焰 -> 战舰 -> 文字(顶)
                unitContainer.add([aura, flame, shipImg, typeText]);

                const initialAtkOffset = (idx * 300) % interval; 
                fleet.units.push({ 
                    sprite: unitContainer, factionId: fac.id, hp, maxHp: hp, atk, def, range, 
                    classType: tTech.cls as any, atkInterval: interval, speed, tier: 'none', 
                    lastAtkTime: -initialAtkOffset, state: 'moving', supply: 100 
                });
            });
        });
    }

    private updateSupplyNetwork() {
        // 1. 初始化所有地块为断开状态
        this.tilesList.forEach(t => t.connected = false);

        // 2. 按 Team 分组进行全局连通性扫描（同盟共享后勤网）
        const teams = [...new Set(this.store.factions.map((f: any) => f.team))];
        
        teams.forEach(team => {
            // 获取该队伍下所有阵营的 ID 集合
            const teamFactionIds = this.store.factions.filter((f: any) => f.team === team).map((f: any) => f.id);
            if (teamFactionIds.length === 0) return;

            const queue: any[] = [];
            
            // 将该队伍所有阵营的司令部(castle)和已占领星球(planet)作为顶级供电源
            this.tilesList.forEach(t => {
                if (teamFactionIds.includes(t.ownerId) && (t.type === 'castle' || t.type === 'planet')) {
                    t.connected = true;
                    queue.push(t);
                }
            });

            // BFS 扩散：只要是同 Team 的地块，全部视为导电体
            let head = 0;
            while (head < queue.length) {
                const curr = queue[head++];
                for (const dir of this.directions) {
                    const neighbor = this.tilesDict[`${curr.q + dir.q},${curr.r + dir.r}`];
                    // 如果邻居未通电，且属于我方团队的任何一个阵营，则为其通电并加入队列
                    if (neighbor && !neighbor.connected && teamFactionIds.includes(neighbor.ownerId)) {
                        neighbor.connected = true;
                        queue.push(neighbor);
                    }
                }
            }
        });

        // v2 修复：CRT 模式下买地/铺路/据点失主后，重画全息棱柱（之前有 bug：后续买的地块没 3D 效果）
        if (this.mapStyle === 'crt' && this.crtWireframe) {
            this.renderCRTWireframeMap(this.tilesList);
        }
    }

    /** 指挥制补给源作用半径（世界单位）：旗舰在此距离内即获得补给。
     *  初值由主理人设定，可按手感调整。 */
    private static readonly SUPPLY_BASE_RADIUS = 420;

    // ===== 补给链（后勤战）=====
    /** 运输舰列表（每帧从存活舰队收集） */
    private auxShips: any[] = [];
    /** 各舰队补给状态：fleet → FleetSupplyInfo */
    private supplyInfo: Map<any, any> = new Map();
    /** 补给链可视化图层（指挥制/2D 通用，画补给圈与链路） */
    private supplyGfx: Phaser.GameObjects.Graphics | null = null;

    /** 绘制补给链可视化：补给圈 + 链路 + 运输舰标记。
     *  让玩家一眼看出部队是否在补给范围内（此前完全不可见）。 */
    private drawSupplyChain() {
        const g = this.supplyGfx;
        if (!g) return;
        g.clear();
        if (!this.store.showSupplyChain) return;   // 可在设置里关闭

        // 补给源覆盖范围（基地/星球）
        this.store.factions.forEach((f: any) => {
            const tf = this.factionMap.get(f.id);
            if (!f.castlePos || !tf) return;
            g.lineStyle(1.5, tf.team === 1 ? 0x22c55e : 0xa855f7, 0.20);
            g.strokeCircle(f.castlePos.x, f.castlePos.y, SUPPLY_SOURCE_RADIUS);
        });
        this.tilesList.forEach((t: any) => {
            if (t.type !== 'planet' && t.type !== 'castle') return;
            const tf = this.factionMap.get(t.ownerId);
            if (!tf) return;
            g.lineStyle(1.2, tf.team === 1 ? 0x22c55e : 0xa855f7, 0.14);
            g.strokeCircle(t.x, t.y, SUPPLY_SOURCE_RADIUS);
        });

        // 运输舰：前出偏移 + 补给圈 + 到被补给舰队的链路
        this.auxShips.forEach((aux: any) => {
            const fl = aux.fleet;
            if (!fl || !fl.units || fl.units.length === 0) return;
            const ax = fl.x + (aux.ox || 0);
            const ay = fl.y + (aux.oy || 0);
            const team = this.factionMap.get(fl.factionId)?.team;
            const color = team === 1 ? 0x22c55e : 0xa855f7;

            // 运输舰补给范围
            g.lineStyle(1.5, color, 0.32);
            g.strokeCircle(ax, ay, SUPPLY_AUX_RADIUS);

            // 运输舰本体标记（橙色方块，区别于作战舰）
            g.fillStyle(0xfb923c, 0.9);
            g.fillRect(ax - 5, ay - 5, 10, 10);

            // 到所属舰队的连线（表现"前出"）
            g.lineStyle(1, 0xfb923c, 0.5);
            g.lineBetween(fl.x, fl.y, ax, ay);
        });

        // 舰队补给状态指示：断链画红圈，链内画绿环
        this.supplyInfo.forEach((info: any, fl: any) => {
            if (!fl.units || fl.units.length === 0) return;
            if (info.inSupply) {
                g.lineStyle(2, 0x22c55e, 0.55);
                g.strokeCircle(fl.x, fl.y, 26);
            } else {
                g.lineStyle(2, 0xef4444, 0.60);
                g.strokeCircle(fl.x, fl.y, 26);
                // 断链警示：再画一个虚化红圈
                g.lineStyle(1, 0xef4444, 0.25);
                g.strokeCircle(fl.x, fl.y, 36);
            }
        });
    }

    /** 找最近的己方补给源（castle/planet）的距离；无补给源返回 null。
     *  指挥制（无格子）下替代地块连通性判定，作为补给链的第一环。 */
    private getNearestSupplySource(x: number, y: number, myTeam: number | undefined): number | null {
        let best: number | null = null;
        this.store.factions.forEach((f: any) => {
            const tf = this.factionMap.get(f.id);
            if (!tf || tf.team !== myTeam) return;
            // 己方司令部
            if (f.castlePos) {
                const d = Phaser.Math.Distance.Between(x, y, f.castlePos.x, f.castlePos.y);
                if (best === null || d < best) best = d;
            }
        });
        // 己方已占领星球（中继点）
        this.tilesList.forEach((t: any) => {
            if (t.type !== 'planet' && t.type !== 'castle') return;
            const tf = this.factionMap.get(t.ownerId);
            if (!tf || tf.team !== myTeam) return;
            const d = Phaser.Math.Distance.Between(x, y, t.x, t.y);
            if (best === null || d < best) best = d;
        });
        return best;
    }

    private processSupplyAndCapture() {
        // ===== 补给链驱动（运输舰 AI + 补给状态计算）=====
        // 运输舰自动前出为半径外友军补给；结果用于下面的补给判定与可视化。
        // homeOf：母港 = 所属阵营 castlePos，写入 AuxShip.homeX/homeY（真往返的返航目标）
        this.auxShips = collectAuxShips(
            this.globalFleets.filter(f => f.units && f.units.length > 0),
            (fl: any) => this.store.factions.find((f: any) => f.id === fl.factionId)?.castlePos ?? null);
        const srcNodes: SupplyNode[] = [];
        this.store.factions.forEach((f: any) => {
            const tf = this.factionMap.get(f.id);
            if (f.castlePos && tf) srcNodes.push({ x: f.castlePos.x, y: f.castlePos.y, team: tf.team, kind: 'castle' });
        });
        this.tilesList.forEach((t: any) => {
            if (t.type !== 'planet' && t.type !== 'castle') return;
            const tf = this.factionMap.get(t.ownerId);
            if (tf) srcNodes.push({ x: t.x, y: t.y, team: tf.team, kind: t.type });
        });
        const teamOf = (fl: any) => this.factionMap.get(fl.factionId)?.team;
        this.supplyInfo = updateSupplyChain(
            this.globalFleets.filter(f => f.units && f.units.length > 0),
            srcNodes, this.auxShips, this.store.currentSpeedFactor || 1, teamOf);

        this.globalFleets.forEach(fl => {
            const fac = this.factionMap.get(fl.factionId);
            if (!fac || fl.units.length === 0) return;

            // 补给判定基准必须使用旗舰的物理坐标，而非舰队虚拟阵型锚点
            const flagship = fl.units[0];
            // CRT模式下sprite.y被Y轴压缩，反算前必须还原为逻辑坐标
            const yComp = this.mapStyle === 'crt' ? CRT_Y_SCALE : 1;
            const realY = flagship.sprite.y / yComp;
            const fQ = Math.round((Math.sqrt(3)/3 * flagship.sprite.x - 1/3 * realY) / this.hexRadius);
            const fR = Math.round((2/3 * realY) / this.hexRadius);

            const currentTile = this.tilesDict[`${fQ},${fR}`];
            // 团队级补给：同team的任意阵营地块均可提供补给（非严格faction匹配）
            const myTeam = this.factionMap.get(fac.id)?.team;

            // ===== 指挥制（无六边形格子）：改用"补给源空间距离"判定 =====
            // 六边形模式下补给靠地块连通（tilesDict + connected）；
            // 指挥制纯宇宙没有格子可依附，若沿用会永远判定为断补给 → 后勤战失效。
            // 因此指挥制下改为：计算旗舰到最近己方补给源（castle/planet）的距离，
            // 在 SUPPLY_BASE_RADIUS 内即视为获得补给。
            const isCommandMode = this.mapStyle === 'command';
            let inSupplyByDistance = false;
            // 补给链判定：优先用 SupplyChainSystem 的结果（含运输舰延伸范围）
            const chainInfo = this.supplyInfo.get(fl);
            if (chainInfo) {
                inSupplyByDistance = !!chainInfo.inSupply;
            } else if (isCommandMode) {
                const src = this.getNearestSupplySource(flagship.sprite.x, realY, myTeam);
                if (src !== null && src < BattleScene.SUPPLY_BASE_RADIUS) inSupplyByDistance = true;
            }

            fl.units.forEach((u: any) => {
                let inSupply = inSupplyByDistance;
                if (!isCommandMode && currentTile && currentTile.ownerId !== 0 && currentTile.connected) {
                    const tileFac = this.factionMap.get(currentTile.ownerId);
                    if (tileFac && tileFac.team === myTeam) inSupply = true;
                }

                if (!isCommandMode && currentTile && currentTile.ownerId !== 0 && currentTile.type === 'barracks') {
                    const tileFac = this.factionMap.get(currentTile.ownerId);
                    if (tileFac && tileFac.team === myTeam) {
                        inSupply = true;
                        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.05);
                    }
                }

                if (inSupply) {
                    u.supply = Math.min(100, (u.supply !== undefined ? u.supply : 100) + 5);
                    // 补给充足 → 士气回升
                    fl.morale = Math.min(100, (fl.morale === undefined ? 100 : fl.morale) + 1);
                } else {
                    // 动态后勤流失率：困难模式敌人自带补给压缩技术(流失极慢)，简单模式流失极快
                    let drainRate = 2;
                    if (fac.type === 'ai') {
                        drainRate = this.store.selectedDiff === 'hard' ? 1 : (this.store.selectedDiff === 'easy' ? 4 : 2);
                    }

                    u.supply = Math.max(0, (u.supply !== undefined ? u.supply : 100) - drainRate);

                    // ===== 断粮三段式惩罚（用户要求：先掉士气，再掉生命）=====
                    if (fl.morale === undefined) fl.morale = 100;
                    // 阶段1：补给 < 30 → 士气持续下降（每帧 -1.5）
                    if (u.supply < 30) {
                        fl.morale = Math.max(0, fl.morale - 1.5);
                    }
                    // 阶段2：士气归零 且 补给仍为 0 → 才开始扣结构生命
                    //        （士气未归零时只表现为战力/机动衰减，见伤害与速度计算处）
                    if (u.supply <= 0 && fl.morale <= 0) {
                        u.hp -= u.maxHp * 0.02;
                    }
                }
            });

            if (currentTile && currentTile.ownerId !== 0 && currentTile.ownerId !== fac.id 
                && currentTile.type !== 'planet' && currentTile.type !== 'castle'
                && fl.units.length > 0
                && Phaser.Math.Distance.Between(flagship.sprite.x, flagship.sprite.y, currentTile.x, currentTile.y) < 60) {
                // === 舰队攻占：站在敌方格子上持续削弱，HP归零即转手 ===
                if (currentTile.hp === undefined) currentTile.hp = 300;
                const totalAtk = fl.units.reduce((s: number, u: any) => s + (u.atk || 50), 0);
                currentTile.hp -= Math.max(25, totalAtk * 0.12);
                // 占领进度：hex透明度反映剩余HP（越低越接近占领）
                const hpPct = Math.max(0.05, currentTile.hp / 300);
                currentTile.sprite.setAlpha(this.mapStyle === 'crt' ? 0.15 + hpPct * 0.2 : 0.4 + hpPct * 0.5);
                if (currentTile.hp <= 0) {
                    currentTile.ownerId = fac.id;
                    currentTile.hp = 0;
                    currentTile.sprite.setFillStyle(fac.color, this.mapStyle === 'crt' ? 0.35 : 0.9);
                    currentTile.sprite.setStrokeStyle(2, fac.color, this.mapStyle === 'crt' ? 0.5 : 1.0);
                    this.showFleetDialogue(fl, 'capture');
                    this.store.triggerToast(`前线据点已被 [${fac.name}] 攻占！`);
                    // v2 修复：占领后立即重新评估目标（推进/拆塔/回防），杜绝占领后发呆
                    fl.state = 'exploring';
                    fl.stance = 'search';
                    // P6 仪式感：玩家方占领 → 横幅
                    if (this.factionMap.get(fac.id)?.team === 1) this.showBattleBanner('前线据点攻占', '后勤线扩展', '#22c55e');
                    this.updateSupplyNetwork();
                }
            }

            if (currentTile && currentTile.ownerId !== fac.id && currentTile.type === 'planet' && fl.units.length > 0) {
                if (Phaser.Math.Distance.Between(fl.x, fl.y, currentTile.x, currentTile.y) < 50) {
                    // 电子战与特种潜入判定
                    const hasSpecOps = fl.units.some((u: any) => u.classType === '电子' || u.classType === '突击');
                    const isHighIntel = (fac.admiralStats?.intelligence || 0) > 80;
                    const isInfiltration = fl.stance === 'siege' && (hasSpecOps || isHighIntel);

                    // 潜入状态下直接从内部瓦解结构，5倍速获取控制权
                    const captureSpeed = isInfiltration ? 100 : 20;
                    currentTile.captureProgress = (currentTile.captureProgress || 0) + captureSpeed;
                    
                    if (currentTile.captureProgress >= 100) {
                        this.showFleetDialogue(fl, 'capture'); // 触发占领语录
                        currentTile.ownerId = fac.id;
                        currentTile.captureProgress = 0;
                        // 3D 覆盖层：星球占领作战视觉
                        pushFx3d({ kind: 'capture', at: { x: currentTile.x, y: currentTile.y }, factionId: fac.id, color: fac.color });
                        if (this.mapStyle !== 'crt') {
                            currentTile.sprite.setFillStyle(fac.color, 0.9); currentTile.sprite.setStrokeStyle(3, fac.color, 1.0);
                        }
                        fac.goldRate += 15;
                        this.store.triggerToast(`战略要地已被 [${fac.name}] 占领！后勤线扩展。`);
                        // v2 修复：占领星球后立即重新评估目标
                        fl.state = 'exploring';
                        fl.stance = 'search';

                        this.tilesList.forEach(t => {
                            const dist = Math.max(Math.abs(t.q - currentTile.q), Math.abs(t.r - currentTile.r), Math.abs(-t.q-t.r - (-currentTile.q-currentTile.r)));
                            if (dist <= 2 && t.type !== 'sea' && t.type !== 'ruined' && t.type !== 'planet' && t.type !== 'castle') {
                                t.ownerId = fac.id; t.type = 'pending';
                                if (this.mapStyle !== 'crt') {
                                    t.sprite.setFillStyle(fac.color, 0.9); t.text.setText('').setAlpha(0);
                                }
                            }
                        });
                    }
                }
            } else if (currentTile && currentTile.type === 'planet') {
                currentTile.captureProgress = 0; 
            }
        });
    }

    private deployFlare(x: number, y: number, factionId: number) {
        if (this.playerFlare) this.playerFlare.destroy();
        this.playerFlare = this.add.container(x, y).setDepth(25);

        // 外层六边形环（匹配游戏hex主题）
        const hexGfx = this.add.graphics();
        const hexR = 24;
        const hexPtArr: number[] = [];
        for (let i = 0; i <= 6; i++) {
            const a = (Math.PI / 3) * i - Math.PI / 6;
            hexPtArr.push(Math.cos(a) * hexR, Math.sin(a) * hexR);
        }
        hexGfx.lineStyle(1.5, 0x00ccff, 0.7);
        hexGfx.strokePath();
        hexGfx.beginPath();
        hexGfx.moveTo(hexPtArr[0], hexPtArr[1]);
        for (let i = 2; i < hexPtArr.length; i += 2) hexGfx.lineTo(hexPtArr[i], hexPtArr[i + 1]);
        hexGfx.strokePath();

        // 中层追踪环（带缺口，旋转）
        const ringGfx = this.add.graphics();
        ringGfx.lineStyle(1.5, 0x00ccff, 0.6);
        ringGfx.beginPath();
        ringGfx.arc(0, 0, 17, -Math.PI * 0.15, Math.PI * 2 - Math.PI * 0.15, false);
        ringGfx.strokePath();

        // 内层十字准星（HUD风格，中心镂空）
        const chGfx = this.add.graphics();
        chGfx.lineStyle(1, 0x00ff88, 0.5);
        const chL = 9, chGap = 5;
        chGfx.lineBetween(0, -chGap - chL, 0, -chGap);
        chGfx.lineBetween(0, chGap, 0, chGap + chL);
        chGfx.lineBetween(-chGap - chL, 0, -chGap, 0);
        chGfx.lineBetween(chGap, 0, chGap + chL, 0);

        // 中心光点
        const dot = this.add.circle(0, 0, 3, 0x00ff88, 0.9);

        this.playerFlare.add([hexGfx, ringGfx, chGfx, dot]);

        // 动画
        this.tweens.add({ targets: hexGfx, alpha: 0.25, duration: 900, repeat: -1, yoyo: true });
        this.tweens.add({ targets: ringGfx, rotation: Math.PI * 2, duration: 3500, repeat: -1 });
        this.tweens.add({ targets: dot, scaleX: 1.8, scaleY: 1.8, alpha: 0.25, duration: 700, repeat: -1, yoyo: true });

        const myFleets = this.globalFleets.filter(fl => fl.factionId === factionId);
        let nearest: any = null; let minDist = 999999;
        myFleets.forEach(fl => {
            const d = Phaser.Math.Distance.Between(fl.x, fl.y, x, y);
            if (d < minDist) { minDist = d; nearest = fl; }
        });
        if (nearest) {
            // ── 指挥带宽门控：新命令能否送达取决于链路状态 ──
            if (this.bwState && factionId === this.store.factions.find((f: any) => f.type === 'player')?.id) {
                const comm = this.getCommCenter();
                const dist = comm ? Phaser.Math.Distance.Between(nearest.x, nearest.y, comm.x, comm.y) : 0;
                const status = getLinkStatus(this.bwState, dist);

                if (status === 'silent') {
                    this.store.triggerToast(`⌁ 通讯链路中断：目标舰队超出旗舰中继范围，拒收信标。它将继续执行既有命令。`);
                    return;
                }
                if (status === 'delayed') {
                    const delayMs = relayDelayMs(this.bwState, dist);
                    queueDelayedOrder(this.bwState, 'flare', nearest.id, { x, y }, delayMs);
                    this.store.triggerToast(`⇢ 信标数据包已发出，经中继节点转发中（预计 ${Math.round(delayMs / 1000)} 秒送达）。`);
                    return;
                }
                // direct：频道锁定失败（容量满）→ 拒发
                if (!canOrderInstantly(this.bwState, status, nearest.id)) {
                    this.store.triggerToast(`⌁ 通信频道已满（${this.bwState.channels.size}/${this.bwState.maxChannels}）：无法与更多舰队建立直连。`);
                    return;
                }
            }

            nearest.targetFlare = {x, y};
            nearest.stance = 'search';
            this.store.triggerToast("战术信标已部署，突击舰队正在改变航向。");
        }
    }

    // 渲染地图切片（将原 create 里的绘图代码抽离复用，完整保留交互与视觉）
    protected renderHexMap(mapDataMatrix: any[]) {
        const isCRT = this.mapStyle === 'crt';
        const yScale = isCRT ? CRT_Y_SCALE : 1;
        mapDataMatrix.forEach(data => {
            const x = this.hexRadius * (Math.sqrt(3) * data.q + Math.sqrt(3)/2 * data.r);
            const y = this.hexRadius * (3/2 * data.r) * yScale;

            if (data.type === 'castle') {
               const fac = this.factionMap.get(data.ownerId);
               if(fac) fac.castlePos = { x, y };
            }

            const points: number[] = [];
            for (let i = 0; i < 6; i++) {
              const angle = (Math.PI / 180) * (60 * i - 30);
              points.push(x + this.hexRadius * Math.cos(angle)); points.push(y + this.hexRadius * Math.sin(angle) * yScale);
            }

            let fillColor = 0x2d3446; let strokeColor = 0x475569; 
            const ownerFac = this.factionMap.get(data.ownerId);
            if (isCRT) {
                // CRT 黑底透明 + 阵营色线框
                fillColor = 0x000000;
                strokeColor = 0x224422; // 默认暗绿
                if (ownerFac) strokeColor = ownerFac.color;
                else if (data.type === 'sea') strokeColor = 0x113366;
                else if (data.type === 'ruined') strokeColor = 0x333333;
                else if (data.type === 'pier') strokeColor = 0x0ea5e9;
                else if (data.type === 'planet') strokeColor = 0x33cc33;
                else if (data.type === 'fortress') strokeColor = 0xff3311;
            } else if (ownerFac) { fillColor = ownerFac.color; strokeColor = ownerFac.color; }
            else if (data.type === 'sea') { fillColor = 0x1e3a8a; strokeColor = 0x2563eb; }
            else if (data.type === 'ruined') { fillColor = 0x1c1917; strokeColor = 0x44403c; }
            else if (data.type === 'pier') { fillColor = 0x0284c7; strokeColor = 0x0ea5e9; }
            else if (data.type === 'planet') { fillColor = 0x92400e; strokeColor = 0xf59e0b; }
            else if (data.type === 'fortress') { fillColor = 0x2a2a3a; strokeColor = 0x6a6a7a; }
            
            const poly = this.add.polygon(0, 0, points, fillColor).setAlpha(isCRT ? 0.01 : 0.9);
            const sWidth = (data.type === 'fortress') ? 2 : (ownerFac ? 3 : (isCRT ? 1.5 : 1));
            poly.setStrokeStyle(sWidth, strokeColor, 1.0);
            poly.setOrigin(0).setInteractive(new Phaser.Geom.Polygon(points), Phaser.Geom.Polygon.Contains);

            // 要塞中心格：用星球图片代替 emoji
            if (data.type === 'fortress' && data.q === 15 && data.r === 0) {
                const planetImg = this.add.image(x, y, 'isserlohn_planet').setDisplaySize(this.hexRadius * 3, this.hexRadius * 3).setDepth(4);
                void planetImg;
            }

            let markTxt = "";
            let fontSize = "14px"; let txtColor = '#e2e8f0';
            if (data.type === 'castle') { 
                if (ownerFac && ownerFac.type === 'player') { markTxt = '★'; fontSize = '20px'; txtColor = '#00ffff'; }
                else if (ownerFac && ownerFac.team === 1) { markTxt = '◈'; fontSize = '20px'; txtColor = '#60a5fa'; }
                else { markTxt = '✇'; fontSize = '20px'; txtColor = '#f87171'; }
            }
            else if (data.type === 'sea' || data.type === 'ruined') markTxt = '';
            else if (data.type === 'pier') markTxt = '⚲';
            else if (data.type === 'planet') { markTxt = '🌍'; fontSize = '18px'; }
            else if (data.type === 'fortress') { markTxt = ''; fontSize = '10px'; } // 中心格用图片，其他要塞格不显示
            else if (data.type === 'gold_mine') markTxt = '✧';
            else if (data.type === 'tower') markTxt = '♜';
            else if (data.type === 'barracks') markTxt = '⚙';

            let txtAlpha = (data.type === 'sea' || data.type === 'ruined' || data.type === 'pending') ? 0.0 : 0.8;
            if (data.type === 'fortress') txtAlpha = 1.0;
            if (data.type === 'castle') txtAlpha = 1.0;

            const txt = this.add.text(x, y, markTxt, {
                fontSize: fontSize, color: isCRT ? '#88cc88' : txtColor, fontFamily: 'monospace', align: 'center'
            }).setOrigin(0.5).setAlpha(isCRT ? 0 : txtAlpha);

            if (isCRT && data.type === 'castle') {
                txt.setColor('#ffcc00').setStroke('#000000', 3);
            } else if (data.type === 'castle') { txt.setStroke('#0f172a', 2); txt.setDepth(10); }

            const tileHp = (data.type === 'ruined' || data.type === 'sea' || data.type === 'fortress') ? 99999 : (data.hp || 150);
            if (data.type === 'planet') data.hp = 1000;
            
            const typeNames: Record<string, string> = {
                'sea': '深空暗流', 'ruined': '陨石废墟', 'pending': '未知空域', 
                'planet': '宜居行星', 'castle': '舰队司令部', 'pier': '星际码头', 
                'gold_mine': '富矿星团', 'tower': '防卫据点', 'barracks': '野战修补站'
            };

            const tile = {
              q: data.q, r: data.r, cost: data.cost, ownerId: data.ownerId, type: data.type,
              typeName: typeNames[data.type] || data.type,
              tileClass: 'none', tier: 'none', hp: tileHp, maxHp: tileHp, x, y, sprite: poly, text: txt, lastTowerShotTime: 0,
              connected: false, captureProgress: 0
            };

            if (!isCRT) {
                if (data.type === 'ruined') {
                    const rockCount = Phaser.Math.Between(3, 6);
                    for (let i = 0; i < rockCount; i++) {
                        const rx = x + Phaser.Math.Between(-14, 14);
                        const ry = y + Phaser.Math.Between(-14, 14);
                        const rSize = Phaser.Math.Between(2, 5);
                        this.add.polygon(rx, ry, [
                            0, 0, rSize, rSize*0.5, rSize*1.2, rSize*1.5, 0, rSize*2, -rSize, rSize*1.2, -rSize*0.8, 0
                        ], 0x44403c).setStrokeStyle(1, 0x292524).setDepth(1).setAngle(Phaser.Math.Between(0, 360));
                    }
                } else if (data.type === 'sea') {
                    this.add.circle(x + Phaser.Math.Between(-10, 10), y + Phaser.Math.Between(-10, 10), 3, 0x1e40af, 0.4).setDepth(1);
                }
            }

            // 左键/右键地块交互
            poly.on('pointerup', async (pointer: Phaser.Input.Pointer) => this.handleTileClick(pointer, tile, poly, txt));
            
            this.tilesList.push(tile);
            this.tilesDict[`${data.q},${data.r}`] = tile;
        });
    }

    /** 指挥制后勤战：战场中线带随机布置 3 个中立星球中继（ownerId=0），
     *  占领后纳入补给源（getNearestSupplySource/processSupplyAndCapture 已支持 planet，无需新写）。
     *  格网覆盖得到的位置就地改类型（复用已隐藏的 sprite）；覆盖不到的位置（战役小格网 + 大 hexRadius）
     *  合成隐藏地块——sprite/text 不可见但必须存在：占领逻辑会调用 setFillStyle/setText（:1070-1086）。
     *  hex/crt 直接 return，一行不动。 */
    private spawnSupplyRelayPlanets() {
        if (this.mapStyle !== 'command') return;
        let placed = 0, guard = 0;
        while (placed < 3 && guard++ < 200) {
            const px = (Math.random() * 2 - 1) * 600;   // 战场中线带
            const py = (Math.random() * 2 - 1) * 400;
            // 避开攻守出生区（指挥制出生点已拉开到 ±1500，留 ≥300 缓冲）
            if (Math.abs(Math.abs(px) - 1500) < 300) continue;
            const q = Math.round((Math.sqrt(3) / 3 * px - 1 / 3 * py) / this.hexRadius);
            const r = Math.round((2 / 3 * py) / this.hexRadius);
            const key = `${q},${r}`;
            const existing = this.tilesDict[key];
            if (existing && (existing.type === 'planet' || existing.type === 'castle'
                || existing.type === 'sea' || existing.type === 'ruined' || existing.type === 'fortress')) continue;
            if (existing) {
                existing.type = 'planet';
                existing.typeName = '宜居行星';
                existing.ownerId = 0;
                existing.hp = 1000; existing.maxHp = 1000;
            } else {
                const x = this.hexRadius * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
                const y = this.hexRadius * (3 / 2 * r);
                const points: number[] = [];
                for (let i = 0; i < 6; i++) {
                    const angle = (Math.PI / 180) * (60 * i - 30);
                    points.push(x + this.hexRadius * Math.cos(angle), y + this.hexRadius * Math.sin(angle));
                }
                const poly = this.add.polygon(0, 0, points, 0x92400e).setAlpha(0).setVisible(false);
                const txt = this.add.text(x, y, '', { fontSize: '18px' }).setOrigin(0.5).setAlpha(0).setVisible(false);
                const tile: any = {
                    q, r, cost: 50, ownerId: 0, type: 'planet', typeName: '宜居行星',
                    tileClass: 'none', tier: 'none', hp: 1000, maxHp: 1000, x, y,
                    sprite: poly, text: txt, lastTowerShotTime: 0,
                    connected: false, captureProgress: 0,
                };
                this.tilesList.push(tile);
                this.tilesDict[key] = tile;
            }
            placed++;
        }
    }

    // ===== 为大地图会战生成纯净对峙宙域（无星系建筑、无经济节点）=====
    private buildCampaignMap() {
        const campaignMatrix: any[] = [];
        // 战役对峙宙域扩容：半径 6→10（127→331 格），3D 化后单帧 InstancedMesh 足以承载
        const radius = 10;
        for (let q = -radius; q <= radius; q++) {
            for (let r = -radius; r <= radius; r++) {
                if (Math.abs(q + r) > radius) continue;
                campaignMatrix.push({ q, r, cost: 50, type: 'pending', ownerId: 0 });
            }
        }
        this.renderHexMap(campaignMatrix);
    }

    // 构建战役模式专属的无污染对峙空域
    private buildCampaignEnvironment(state: any) {
        this.store.factions = [];

        // 确定玩家所属阵营 ID（从 gameStore 的 playerAdmiral 查 faction）
        const pAdmId = (this.store as any).playerAdmiralId;
        const pAdm = pAdmId ? (this.store as any).allAdmirals?.find((a: any) => a.id === pAdmId) : null;
        const pFactionId = pAdm?.faction === 'alliance' ? 1 : (pAdm?.faction === 'empire' ? 2 : 0);

        // 阶段A：战役模式出生点按hexRadius动态缩放
        // 指挥制后勤战：攻左守右拉开到 ±1500（3D 纯宇宙战场跨度约 3000~5500，
        // hexRadius*8 = 208~400 会让双方出生点挤在中线附近，补给纵深为零）
        const spawnDist = this.mapStyle === 'command' ? 1500 : this.hexRadius * 8; // hex/crt: 26→208, 50→400

        if (state.attackers && state.attackers[0]) {
            const isPlayerFac = state.attackers[0].factionId === pFactionId;
            this.store.factions.push({
                id: state.attackers[0].factionId, type: isPlayerFac ? 'player' : 'ai', team: 1,
                name: state.attackers[0].commanderName,
                imageId: state.attackers[0].imageId,
                color: state.attackers[0].factionId === 1 ? 0x3b82f6 : 0xef4444, hp: 100, maxHp: 100, active: true,
                castlePos: { x: -spawnDist, y: 0 }
            });
        }
        if (state.defenders && state.defenders[0]) {
            const isPlayerFac = state.defenders[0].factionId === pFactionId;
            this.store.factions.push({
                id: state.defenders[0].factionId, type: isPlayerFac ? 'player' : 'ai', team: 2,
                name: state.defenders[0].commanderName,
                imageId: state.defenders[0].imageId,
                color: state.defenders[0].factionId === 2 ? 0xef4444 : 0x3b82f6, hp: 100, maxHp: 100, active: true,
                castlePos: { x: spawnDist, y: 0 }
            });
        }

        // 重建 faction 查找缓存：factions 已重新创建，旧缓存指向失效对象
        this.factionMap.clear();
        this.store.factions.forEach((f: any) => this.factionMap.set(f.id, f));

        // 判断是否为伊谢尔伦（nodeId=1 或名称匹配）
        const battleNodeId = state.battleNodeId;
        let isIserlohn = false;
        try {
            const nodeStore = useNodeStore();
            const battleNode = (nodeStore.nodes as unknown as any[]).find(n => n.id === battleNodeId);
            isIserlohn = battleNode && (battleNode.id === 1 || battleNode.name === '伊谢尔伦');
        } catch { /* ignore */ }

        const campaignMatrix: any[] = [];

        if (isIserlohn) {
            // 伊谢尔伦：长条形矩形地图，参考 random_rect 但更长更宽
            // q: -25 到 +25 (横向 51 格), r: -8 到 +8 (纵向 17 格)
            for (let q = -25; q <= 25; q++) {
                for (let r = -8; r <= 8; r++) {
                    let type = 'pending';
                    const rand = Math.random();
                    if (rand < 0.03) type = 'sea';
                    else if (rand < 0.05) type = 'ruined';
                    campaignMatrix.push({ q, r, cost: 50, type, ownerId: 0 });
                }
            }
            // 要塞地块：q=15, r=0 中心 + 6 个相邻格
            const fortressOffsets = [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];
            fortressOffsets.forEach(([dq, dr]) => {
                const tile = campaignMatrix.find(t => t.q === 15 + dq && t.r === 0 + dr);
                if (tile) tile.type = 'fortress';
            });
            this.renderHexMap(campaignMatrix);

            // 初始化要塞武器
            const fX = this.hexRadius * (Math.sqrt(3) * 15 + Math.sqrt(3) / 2 * 0);
            const fY = this.hexRadius * (3 / 2 * 0);
            const defenderFactionId = state.defenders?.[0]?.factionId ?? 2;
            this.fortressWeapon = {
                chargeTimer: 0,
                chargeInterval: 90000,     // 90秒冷却（原30s），雷神之锤一锤定音
                firstFireDelay: 50000,     // 首次发射需50秒（原15s）
                maxRange: 1200,            // 最大射程 [PLACEHOLDER]，轰不到地图最远端
                fireAngle: 0,              // 固定发射方向角（向右，q增大方向）
                fortressX: fX,
                fortressY: fY,
                fortressHp: 10000,
                fortressMaxHp: 10000,
                ownerFactionId: defenderFactionId,
                laserGraphics: this.add.graphics().setDepth(50),
                chargeGraphics: this.add.graphics().setDepth(49),
                hpBarBg: this.add.rectangle(fX, fY - 50, 80, 6, 0x1e293b).setDepth(51).setVisible(false),
                hpBarFill: this.add.rectangle(fX, fY - 50, 80, 6, 0xef4444).setDepth(52).setVisible(false),
                destroyed: false,
                isCharging: false,
            };
            // 调整初始视角：居中显示要塞区域，左右兼顾
            this.cameras.main.setZoom(0.3);
            this.cameras.main.centerOn(fX, 0);
            // 调整出生位置：攻方从左侧方远处进场，守方在要塞东侧驻防
            // 地图范围 q: -25 ~ +25，要塞在 q=15。攻方在 q≈-20，守方在 q≈22
            const atkQ = -20;
            const defQ = 22;
            const leftEdgeX = this.hexRadius * (Math.sqrt(3) * atkQ + Math.sqrt(3) / 2 * 0);
            const rightEdgeX = this.hexRadius * (Math.sqrt(3) * defQ + Math.sqrt(3) / 2 * 0);
            if (state.attackers?.[0]) {
                const fac = this.factionMap.get(state.attackers[0].factionId);
                if (fac) fac.castlePos = { x: leftEdgeX, y: 0 };
            }
            if (state.defenders?.[0]) {
                const fac = this.factionMap.get(state.defenders[0].factionId);
                if (fac) fac.castlePos = { x: rightEdgeX, y: 0 };
            }
        } else {
            // 通用圆形地图
            const radius = 6;
            for (let q = -radius; q <= radius; q++) {
                for (let r = -radius; r <= radius; r++) {
                    if (Math.abs(q + r) > radius) continue;
                    campaignMatrix.push({ q, r, cost: 50, type: 'pending', ownerId: 0 });
                }
            }
            this.renderHexMap(campaignMatrix);
        }
    }



    // ===== 指令调度器绑定 =====
    private setupCommandDispatcher() {
        if (typeof this.store.setPhaserCommandDispatcher === 'function') {
            this.store.setPhaserCommandDispatcher((id: number, type: string, payload: any) => {
                const fleet = this.globalFleets.find(f => f.id === id);
                if (fleet && fleet.factionId) {
                    const fac = this.factionMap.get(fleet.factionId);
                    if (fac && fac.team === 1) {
                        if (type === 'stance') {
                            // ── 指挥带宽门控：变阵命令同样受链路状态约束 ──
                            if (this.bwState) {
                                const comm = this.getCommCenter();
                                const dist = comm ? Phaser.Math.Distance.Between(fleet.x, fleet.y, comm.x, comm.y) : 0;
                                const status = getLinkStatus(this.bwState, dist);
                                if (status === 'silent') {
                                    this.store.triggerToast(`⌁ 通讯链路中断：该舰队无法接收变阵命令，将继续按既有阵型行动。`);
                                    return;
                                }
                                if (status === 'delayed') {
                                    const delayMs = relayDelayMs(this.bwState, dist);
                                    queueDelayedOrder(this.bwState, 'stance', fleet.id, payload, delayMs);
                                    this.store.triggerToast(`⇢ 变阵命令已发出，中继转发中（预计 ${Math.round(delayMs / 1000)} 秒送达）。`);
                                    return;
                                }
                            }
                            this.applyStanceToFleet(fleet, payload);
                        }
                    }
                }
            });
        }
    }

    /**
     * 阶段A：动态地图扩容
     * 根据参战舰队总数动态缩放hexRadius，解决多舰队拥挤问题
     *
     * 规则：
     *   ≤4艘(1v1):   hexRadius=26 (~1300×1300)
     *   ≤8艘(2v2):   hexRadius=32 (~1600×1600)
     *   ≤12艘(3v3):  hexRadius=38 (~1900×1900)
     *   ≤16艘(4v4):  hexRadius=44 (~2200×2200)
     *   >16艘(5v5+): hexRadius=50 (~2500×2500)
     */
    private scaleMapForFleetCount(state: any) {
        const isCampaign = state && state.mode === 'campaign';
        let totalShips = 0;

        if (isCampaign) {
            // 战役模式：从战术状态读取舰队编制
            const attackers = state?.attackers || [];
            const defenders = state?.defenders || [];
            attackers.forEach((f: any) => { totalShips += (f.slots || []).length; });
            defenders.forEach((f: any) => { totalShips += (f.slots || []).length; });
        } else {
            // 演习模式：从deck计算总舰数
            const myAdmirals = this.store.dispatchAdmirals || [];
            myAdmirals.forEach((admId: number) => {
                const admInfo = this.store.allAdmirals.find((a: any) => a.id === admId);
                if (admInfo?.deck) {
                    totalShips += admInfo.deck.filter(Boolean).length;
                }
            });
            // 战术模拟模式敌军满编8艘
            const isSimMode = !!(this.store as any).simMode;
            const enemyCount = parseInt(String(this.store.activeFactionCount), 10) || 2;
            totalShips += isSimMode ? enemyCount * 8 : enemyCount * 6;
        }

        // 根据总舰数缩放hexRadius
        if (totalShips <= 4) this.hexRadius = this.baseHexRadius;      // 26
        else if (totalShips <= 8) this.hexRadius = 32;
        else if (totalShips <= 12) this.hexRadius = 38;
        else if (totalShips <= 16) this.hexRadius = 44;
        else this.hexRadius = 50;

        console.log(`[BattleScene] 动态扩容: ${totalShips}艘 → hexRadius=${this.hexRadius}`);
    }

    /**
     * 阶段C：计算舰队理想交战距离
     * 根据舰队中舰种组成确定最佳交战距离
     * 战列/巡洋 → 中距对射(140-200)；驱逐/高速 → 近距缠斗(<100)；航母 → 远距释放(>250)
     */
    private getFormationCnName(form: string): string {
        const names: Record<string, string> = { wedge: '楔形阵', line: '横阵', spindle: '纺锤阵', circle: '圆形阵', square: '方阵' };
        return names[form] || form;
    }

    /** 获取坐标所在的格子（含地形） */
    private getTerrainAt(x: number, y: number): any {
        const yComp = this.mapStyle === 'crt' ? CRT_Y_SCALE : 1;
        const realY = y / yComp;
        const q = Math.round((Math.sqrt(3) / 3 * x - 1 / 3 * realY) / this.hexRadius);
        const r = Math.round((2 / 3 * realY) / this.hexRadius);
        return this.tilesDict[`${q},${r}`] || null;
    }

    /** 地形 → 移速倍率 */
    private getTerrainSpeedMul(x: number, y: number): number {
        const tile = this.getTerrainAt(x, y);
        if (!tile?.terrain) return 1.0;
        switch (tile.terrain) {
            case 'nebula': return 0.6;    // 星云：减速40%
            case 'gravity': return 1.3;   // 引力点：加速30%
            case 'debris': return 0.85;   // 残骸：轻微减速
            case 'asteroid': return 0.8;  // 小行星带：减速20%
            default: return 1.0;
        }
    }

    /** 地形 → 射程修正（%），小行星带射程-30% */
    private getTerrainRangeMul(x: number, y: number): number {
        const tile = this.getTerrainAt(x, y);
        if (!tile?.terrain) return 1.0;
        if (tile.terrain === 'asteroid') return 0.7;
        return 1.0;
    }

    /** 地形 → 闪避修正（星云+20%） */
    private getTerrainDodgeMul(x: number, y: number): number {
        const tile = this.getTerrainAt(x, y);
        if (!tile?.terrain) return 1.0;
        if (tile.terrain === 'nebula') return 1.2;
        return 1.0;
    }

    /** 渲染地形标记到 hex（nebula/asteroid/gravity/debris） */
    private renderTerrainMarkers() {
        if (!this.tilesList || !this.tilesDict) return;
        const styleMap: Record<string, { color: number; label: string }> = {
            nebula: { color: 0x8b5cf6, label: '☁' },
            asteroid: { color: 0x78716c, label: '◍' },
            gravity: { color: 0xf59e0b, label: '◎' },
            debris: { color: 0x64748b, label: '✕' },
        };
        this.tilesList.forEach((t: any) => {
            if (!t.terrain) return;
            const st = styleMap[t.terrain];
            if (!st) return;
            if (this.mapStyle === 'crt') {
                // CRT 模式：用 alpha 叠加表示
                if (t.sprite?.active) t.sprite.setAlpha((t.sprite.alpha || 0.5) + 0.15);
            } else if (t.sprite?.active) {
                t.sprite.setFillStyle(st.color, 0.12);
                t.sprite.setStrokeStyle(1, st.color, 0.3);
            }
        });
    }

    /**
     * P2 战役阶段目标检查：
     * 阶段1 破网：己方占领 ≥2 个星球 → 战报
     * 阶段2 斩链：切断敌方补给（敌方连通格子数下降>40%）或占领敌方前沿节点 → 战报
     * 阶段3 拔旗：占领敌方基地（自动触发于胜利判定）
     */
    private checkBattleStage() {
        if (this.store.gameOver || this.store.isPaused) return;
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
        if (!pFac || !pFleet || pFleet.units.length === 0) return;

        const myTeam = pFac.team;
        const myTiles = this.tilesList.filter(t => t.ownerId !== 0 && this.factionMap.get(t.ownerId)?.team === myTeam);
        const enemyTiles = this.tilesList.filter(t => t.ownerId !== 0 && this.factionMap.get(t.ownerId)?.team !== myTeam);
        const myPlanets = myTiles.filter(t => t.type === 'planet').length;
        const myCastles = myTiles.filter(t => t.type === 'castle').length;
        const enemyConnected = enemyTiles.filter(t => t.connected).length;
        // ===== 斩链判定（P3）：补给链驱动，兼容无格子的指挥制 =====
        // 原判定只看"敌方连通地块数下降"，指挥制没有格子 → 永远不成立。
        // 改为：统计敌方舰队中断补给的比例；断链过半 或 全部运输舰被击沉 = 斩链成功。
        let enemyFleetsInSupply = 0, enemyFleetsTotal = 0;
        let enemyAuxAlive = 0, enemyAuxTotal = 0;
        this.supplyInfo.forEach((info: any, fl: any) => {
            if (!fl.units || fl.units.length === 0) return;
            const tf = this.factionMap.get(fl.factionId);
            const playerTeam = this.factionMap.get(this.store.factions.find((f: any) => f.isPlayer)?.id ?? -1)?.team;
            if (!tf || tf.team === playerTeam) return;   // 只看敌方
            enemyFleetsTotal++;
            if (info.inSupply) enemyFleetsInSupply++;
        });
        this.auxShips.forEach((aux: any) => {
            const tf = this.factionMap.get(aux.fleet?.factionId);
            const playerTeam = this.factionMap.get(this.store.factions.find((f: any) => f.isPlayer)?.id ?? -1)?.team;
            if (!tf || tf.team === playerTeam) return;
            enemyAuxTotal++;
            if (aux.unit && aux.unit.hp > 0) enemyAuxAlive++;
        });
        // 斩链条件：敌方过半舰队断补给，或敌方运输舰全灭（且曾经有过）
        const enemyCutRatio = enemyFleetsTotal > 0 ? (1 - enemyFleetsInSupply / enemyFleetsTotal) : 0;
        const supplyChainCut = enemyCutRatio >= 0.5 || (enemyAuxTotal > 0 && enemyAuxAlive === 0);
        const enemyCastles = enemyTiles.filter(t => t.type === 'castle').length;

        const reportStage = (stage: number, title: string, desc: string) => {
            if (this.battleStage !== stage || this.stageReported) return;
            this.stageReported = true;
            this.store.triggerToast?.(`[阶段${stage}] ${title}：${desc}`);
        };

        if (this.battleStage === 1 && (myPlanets >= 2 || myCastles >= 2)) {
            this.battleStage = 2; this.stageReported = false;
            reportStage(2, '斩链', '我方已建立前沿跳板，接下来切断敌方补给线！');
        } else if (this.battleStage === 2 && (supplyChainCut || enemyConnected <= 8 || enemyCastles === 0)) {
            this.battleStage = 3; this.stageReported = false;
            reportStage(3, '拔旗', '敌方补给断裂，向敌方基地发起总攻！');
        }
    }

    /**
     * P5 战役剧本阶段推进：probe试探 → clash缠斗 → turn转折 → final决战
     * 基于双方战损比例与接触强度推进，配合名场面营造情绪曲线
     */
    private updateScriptPhase() {
        if (this.store.gameOver || this.store.isPaused || this.deployPhase) return;
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
        if (!pFac || !pFleet || pFleet.units.length === 0) return;

        // 统计双方总HP
        let allyHp = 0, allyMax = 0, enemyHp = 0, enemyMax = 0;
        this.globalFleets.forEach((fl: any) => {
            const fac = this.factionMap.get(fl.factionId);
            if (!fac) return;
            fl.units.forEach((u: any) => {
                if (fac.team === pFac.team) { allyHp += u.hp; allyMax += u.maxHp; }
                else { enemyHp += u.hp; enemyMax += u.maxHp; }
            });
        });
        const allyPct = allyMax > 0 ? allyHp / allyMax : 0;
        const enemyPct = enemyMax > 0 ? enemyHp / enemyMax : 0;
        const engaged = this.globalFleets.some((fl: any) => fl.state === 'engaging');

        // 阶段推进条件
        if (this.scriptPhase === 'probe' && (engaged || allyPct < 0.9 || enemyPct < 0.9)) {
            this.scriptPhase = 'clash'; this.scriptReported = false;
            this.store.triggerToast?.('主力接触——全面会战开始！');
            this.showBattleBanner('全面会战', '主力舰队接触', '#f59e0b');
            this.cameras.main.shake(400, 0.004);
        } else if (this.scriptPhase === 'clash' && (allyPct < 0.55 || enemyPct < 0.55)) {
            this.scriptPhase = 'turn'; this.scriptReported = false;
            this.store.triggerToast?.('战局进入转折点——胜负在此一举！');
            this.showBattleBanner('战局转折', '胜负在此一举', '#ef4444');
        } else if (this.scriptPhase === 'turn' && (allyPct < 0.3 || enemyPct < 0.3)) {
            this.scriptPhase = 'final'; this.scriptReported = false;
            this.store.triggerToast?.('决战时刻——全军突击！');
            this.showBattleBanner('决战时刻', '全军突击！', '#fbbf24');
            // 决战buff：双方伤害+20%
            this.globalFleets.forEach((fl: any) => { fl._finalBattle = true; });
        }
    }

    /**
     * P4 战术增援：每90秒双方各获得一次增援呼叫
     * 增援兵力 = 当前损失比例×50%（最多补到满编的60%）
     */
    private updateReinforcement() {
        if (this.store.gameOver || this.store.isPaused || this.deployPhase) return;
        const hasPlayer = this.store.factions.some((f: any) => f.type === 'player' && f.active);
        if (!hasPlayer) return; // 只在玩家参与的战术战启用

        this.reinforceTimer += 16;
        if (this.reinforceTimer < this.reinforceInterval) return;
        this.reinforceTimer = 0;
        this.reinforceUsed.clear();

        this.store.factions.filter((f: any) => f.active).forEach((fac: any) => {
            const fleets = this.globalFleets.filter((fl: any) => fl.factionId === fac.id);
            if (fleets.length === 0) return;
            fleets.forEach((fl: any) => {
                let hp = 0, max = 0;
                fl.units.forEach((u: any) => { hp += u.hp; max += u.maxHp; });
                const pct = max > 0 ? hp / max : 0;
                if (pct < 0.85) {
                    // 修复受损单位（模拟增援整编）
                    fl.units.forEach((u: any) => {
                        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.25);
                    });
                }
            });
        });
        this.store.triggerToast?.('增援舰队抵达战场——各舰整编补给！');
        this.showBattleBanner('增援抵达', '各舰队完成整编补给', '#06b6d4');
    }

    private getIdealEngageDist(fleet: any): number {        const units = fleet.units || [];
        if (units.length === 0) return 140;

        // 统计舰种
        let battleships = 0, cruisers = 0, destroyers = 0, carriers = 0;
        units.forEach((u: any) => {
            const cls = u.classType || '';
            if (cls === '战列' || cls === 'battleship') battleships++;
            else if (cls === '巡洋' || cls === 'cruiser') cruisers++;
            else if (cls === '驱逐' || cls === 'destroyer') destroyers++;
            else if (cls === '航母' || cls === 'carrier' || cls === '突击') carriers++;
        });

        // 主力舰种决定理想距离
        if (carriers > 0) return 260;              // 航母 → 远距
        if (battleships >= 3) return 180;          // 战列为主 → 中距
        if (cruisers >= 3) return 150;             // 巡洋为主 → 中近
        if (destroyers >= 3) return 90;            // 驱逐为主 → 近距缠斗
        return 140;                                // 默认
    }

    /**
     * 阶段B：计算舰队视野范围
     * 视野 = 基础(200×缩放) + 情报值×2 + 电子科技×30
     * search姿态额外+50（索敌模式视野更广）
     */
    private getVisionRange(fleet: any, myFac: any): number {
        const scaleFactor = this.hexRadius / this.baseHexRadius; // 地图缩放比
        const baseVision = 200 * scaleFactor;
        const intel = myFac.admiralStats?.intelligence || 50;
        const ecmLevel = myFac.admiralStats?.electronicLevel || 0;
        let vision = baseVision + intel * 2 + ecmLevel * 30;
        if (fleet.stance === 'search') vision += 50;
        return vision;
    }

    // ── 指挥点系统方法 ──

    /** 打开命令面板（暂停游戏） */
    private openCommandPanel() {
        if (!this.cpState) return;
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
        if (!pFleet || !pFac) return;

        commandBridge.cpState = this.cpState;
        commandBridge.fleetAdmiralId = pFac.id;
        commandBridge.battleAdmiralIds = this.store.factions
            .filter((f: any) => f.active)
            .map((f: any) => f.id);
        commandBridge.selectedAbilityId = null;
        commandBridge.staffBriefing = this.buildStaffBriefing(pFleet, pFac);
        commandBridge.visible = true;
        commandBridge.pendingCallback = (targetId: number | null) => {
            if (commandBridge.selectedAbilityId) {
                this.executeCommandFromPanel(commandBridge.selectedAbilityId, targetId);
            }
            commandBridge.visible = false;
            commandBridge.pendingCallback = null;
        };
        this.store.isPaused = true;
    }

    /** 参谋敌情摘要：可见敌舰队数、最近敌距离、我方阵型克制判断（复用 update 内 beats 表） */
    private buildStaffBriefing(pFleet: any, pFac: any): string {
        // 敌情收集：只统计迷雾可见的敌方舰队（复用渲染迷雾同款口径：友军建筑300px / 舰队250·450px）
        let visibleEnemyCount = 0;
        let nearestDist = Infinity;
        let nearestEnemy: any = null;
        const allyFactionIds = this.store.factions.filter((f: any) => f.team === pFac.team).map((f: any) => f.id);
        const allyFleets = this.globalFleets.filter(fl => allyFactionIds.includes(fl.factionId));
        const allyVisionNodes = this.tilesList.filter(t => allyFactionIds.includes(t.ownerId) && (t.type === 'castle' || t.type === 'tower' || t.type === 'planet'));
        this.globalFleets.forEach(ef => {
            if (ef.units.length === 0) return;
            const efFac = this.factionMap.get(ef.factionId);
            if (!efFac || efFac.team === pFac.team || !efFac.active) return;
            const fx = ef.units[0].sprite?.x ?? ef.x;
            const fy = ef.units[0].sprite?.y ?? ef.y;
            let inVision = allyVisionNodes.some(node => Phaser.Math.Distance.Between(fx, fy, node.x, node.y) < 300);
            if (!inVision) {
                inVision = allyFleets.some(pFl => {
                    if (pFl.units.length === 0) return false;
                    const vr = pFl.stance === 'search' ? 450 : 250;
                    return Phaser.Math.Distance.Between(fx, fy, pFl.units[0].sprite.x, pFl.units[0].sprite.y) < vr;
                });
            }
            if (!inVision) return;
            visibleEnemyCount++;
            const d = Phaser.Math.Distance.Between(pFleet.x, pFleet.y, ef.x, ef.y);
            if (d < nearestDist) { nearestDist = d; nearestEnemy = ef; }
        });

        if (visibleEnemyCount === 0) return '参谋：当前视野内无敌舰队。';
        const formCn: Record<string, string> = { wedge: '楔形阵', line: '横阵', spindle: '纺锤阵', circle: '圆形阵', square: '方阵' };
        // 阵型克制判断（与 update 内 beats 表保持一致）
        const beats: Record<string, string> = { 'wedge': 'spindle', 'spindle': 'circle', 'circle': 'square', 'square': 'line', 'line': 'wedge' };
        let formAdvice = '';
        if (nearestEnemy) {
            const eForm = nearestEnemy.formation;
            if (beats[pFleet.formation] === eForm) {
                formAdvice = `我方${formCn[pFleet.formation] || pFleet.formation}克制其${formCn[eForm] || eForm}，保持阵型！`;
            } else if (beats[eForm] === pFleet.formation) {
                formAdvice = `警告：敌${formCn[eForm] || eForm}克制我方${formCn[pFleet.formation] || pFleet.formation}，建议变阵！`;
            } else {
                formAdvice = `敌${formCn[eForm] || eForm}与我方${formCn[pFleet.formation] || pFleet.formation}互不克制。`;
            }
        }
        return `参谋：敌 ${visibleEnemyCount} 队接近，最近 ${Math.round(nearestDist)}px。${formAdvice}`;
    }

    /** 执行命令 */
    private executeCommandFromPanel(abilityId: string, targetFleetId: number | null) {
        if (!this.cpState) return;
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
        if (!pFleet) return;

        const result = executeCommand(this.cpState, abilityId, pFleet.id, targetFleetId, pFleet.factionId);
        if (result) {
            // 可视化反馈
            this.showCommandEffect(result);
        }
        this.store.isPaused = false;
    }

    /** 命令效果可视化 */
    private showCommandEffect(effect: ActiveEffect) {
        const pFleet = this.globalFleets.find((f: any) => f.id === effect.casterFleetId);
        if (!pFleet) return;
        // ── 瞬时效果：紧急抢修的旗舰 HP 回复（effect.value 即 shield 0.5 前的 heal 定义）──
        if (effect.commandId === 'emergency_repair') {
            const flagship = pFleet.units[0];
            if (flagship) {
                const heal = flagship.maxHp * 0.2;
                flagship.hp = Math.min(flagship.maxHp, flagship.hp + heal);
                this.spawnDamageNumber(flagship.sprite.x, flagship.sprite.y - 18, heal, false);
                // 绿色维修光环
                const ring = this.add.circle(flagship.sprite.x, flagship.sprite.y, 22, 0x10b981, 0.4).setDepth(50);
                this.tweens.add({ targets: ring, scale: 2.5, alpha: 0, duration: 700, onComplete: () => ring.destroy() });
            }
        }
        const col = effect.effect.type === 'shield' || effect.effect.type === 'reflect' ? 0x10b981 :
                    effect.effect.type === 'damage_boost' ? 0xef4444 :
                    effect.effect.type === 'debuff' ? 0xa855f7 : 0x06b6d4;
        const flash = this.add.circle(pFleet.x, pFleet.y, 40, col, 0.4).setDepth(50);
        this.tweens.add({ targets: flash, scale: 2, alpha: 0, duration: 600, onComplete: () => flash.destroy() });
        // 录战斗日志
        const efName = this.factionMap.get(pFleet.factionId)?.name || '舰队';
        const cmdName = effect.commandId.replace(/_/g, ' ');
        if ((this.store as any).addBattleLog) {
            (this.store as any).addBattleLog({ text: `${efName} 执行了「${cmdName}」`, type: 'ability' });
        }
    }

    /** 每帧应用命令效果 */
    private applyCommandEffects(dtMs: number) {
        if (!this.cpState) return;
        updateCPState(this.cpState, dtMs);
        // CP恢复指示（接近满时更新桥接状态）
        if (commandBridge.visible && commandBridge.cpState) {
            commandBridge.cpState = this.cpState;
        }
    }

    // ==================== 指挥带宽系统（指挥链延迟机制） ====================

    /** 玩家通信中枢：玩家主舰队（第一支玩家舰队）的旗舰坐标 */
    private getCommCenter(): { x: number, y: number, fleet: any } | null {
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        if (!pFac) return null;
        const mainFleet = this.globalFleets.find(fl => fl.factionId === pFac.id);
        if (!mainFleet) return null;
        return { x: mainFleet.x, y: mainFleet.y, fleet: mainFleet };
    }

    /**
     * 每帧推进指挥带宽系统：
     * 1. 直连半径随地图缩放动态刷新（旗舰损毁时收缩60%）
     * 2. direct 区舰队自动建立频道；被歼灭舰队释放频道
     * 3. 处理送达的中继订单（信标/变阵延迟执行）
     * 4. 更新各玩家舰队的链路指示标记
     */
    private applyBandwidthEffects(dtMs: number) {
        if (!this.bwState) return;
        const bw = this.bwState;
        const comm = this.getCommCenter();

        // 1. 直连半径动态刷新（地图缩放 / 旗舰降级）
        bw.relayRange = this.hexRadius * 26 * (bw.flagshipDown ? 0.6 : 1);

        // 2. 链路维护 + 指示标记
        this.globalFleets.forEach(fleet => {
            const pFac = this.store.factions.find((f: any) => f.type === 'player');
            if (!pFac || fleet.factionId !== pFac.id) return;

            // 舰队被歼灭：释放频道与标记
            if (fleet.units.length === 0) {
                releaseChannel(bw, fleet.id);
                const marker = this.commMarkers.get(fleet.id);
                if (marker) { marker.destroy(); this.commMarkers.delete(fleet.id); }
                return;
            }

            const dist = comm ? Phaser.Math.Distance.Between(fleet.x, fleet.y, comm.x, comm.y) : 0;
            const status: LinkStatus = getLinkStatus(bw, dist);
            fleet._linkStatus = status;
            fleet._linkDist = dist;

            // direct 区自动锁定频道（容量不足则排队语义：先到先得）
            if (status === 'direct') establishChannel(bw, fleet.id);

            // 指示标记：跟随舰队上方的链路状态角标
            let marker = this.commMarkers.get(fleet.id);
            if (!marker) {
                marker = this.add.text(fleet.x, fleet.y - 34, '', {
                    fontSize: '10px', fontFamily: 'monospace', fontStyle: 'bold',
                    stroke: '#000000', strokeThickness: 2,
                }).setOrigin(0.5).setDepth(30);
                this.commMarkers.set(fleet.id, marker);
            }
            const color = `#${LINK_COLORS[status].toString(16).padStart(6, '0')}`;
            const pending = bw.delayedOrders.filter(o => o.fleetId === fleet.id).length;
            const hasCh = hasChannel(bw, fleet.id);
            const chMark = hasCh ? ' ◉' : '';
            const pendMark = pending > 0 ? ` ⇢${pending}` : '';
            const degraded = bw.flagshipDown ? '⌁' : '';
            marker.setText(`${LINK_CN[status]}${chMark}${pendMark}${degraded}`);
            marker.setColor(color);
            marker.setPosition(fleet.x, fleet.y - 34);
            marker.setVisible(status !== 'direct' || pending > 0 || !hasCh || bw.flagshipDown);
        });

        // 孤儿标记清理（舰队列表里已不存在的）
        const pFac2 = this.store.factions.find((f: any) => f.type === 'player');
        const playerFleetIds = new Set(this.globalFleets.filter(fl => pFac2 && fl.factionId === pFac2.id).map(fl => fl.id));
        this.commMarkers.forEach((marker, fid) => {
            if (!playerFleetIds.has(fid)) { marker.destroy(); this.commMarkers.delete(fid); }
        });

        // 3. 中继订单送达执行
        const arrived = updateBandwidthState(bw, dtMs);
        arrived.forEach(order => this.executeRelayedOrder(order));

        // 4. 同步桥接（面板显示）
        if (commandBridge.visible) {
            commandBridge.bwState = bw;
        }
    }

    /** 执行送达的中继订单（延迟信标 / 延迟变阵） */
    private executeRelayedOrder(order: PendingOrder) {
        const fleet = this.globalFleets.find(fl => fl.id === order.fleetId);
        if (!fleet || fleet.units.length === 0) return; // 收件人已失联，订单作废
        const fac = this.factionMap.get(fleet.factionId);
        if (!fac || fac.team !== 1) return;

        if (order.kind === 'flare') {
            // 抵达信标：仅当无交战时接收（交战中的舰队不会被中继命令强行拉走，保持战斗连贯）
            if (fleet.state === 'engaging') return;
            fleet.targetFlare = order.payload;
            fleet.stance = 'search';
            this.store.triggerToast(`⇢ 中继命令送达：[${fac.name || '舰队'}] 收到信标坐标，转向突进。`);
            // 中继波纹特效：数据包到达
            const ring = this.add.circle(fleet.x, fleet.y, 18, 0x00ccff, 0.35).setDepth(28);
            this.tweens.add({ targets: ring, scale: 2.5, alpha: 0, duration: 600, onComplete: () => ring.destroy() });
        } else if (order.kind === 'stance') {
            this.applyStanceToFleet(fleet, order.payload);
            this.store.triggerToast(`⇢ 中继命令送达：[${fac.name || '舰队'}] 变阵「${order.payload}」生效。`);
        }
    }

    /** 姿态命令的公共执行体（即时/延迟两路共用） */
    private applyStanceToFleet(fleet: any, payload: string) {
        fleet.stance = payload;
        fleet.assignedRole = payload;
        if (payload === 'search') fleet.formation = 'spindle';
        else if (payload === 'siege') fleet.formation = 'wedge';
        else if (payload === 'defend') fleet.formation = 'circle';
        else if (payload === 'fallback') fleet.formation = 'line';
        else if (payload === 'stealth') fleet.formation = 'spindle';

        const stanceNames: Record<string, string> = {
            search: '索敌-纺锤阵', siege: '攻坚-雁行阵', fallback: '撤退-线型阵',
            defend: '驻守-圆阵', stealth: '隐身潜行',
        };
        this.store.triggerToast(`舰队变阵：[${stanceNames[payload] || payload}]`);
    }

    /** 渲染伤害数字 */
    private spawnDamageNumber(x: number, y: number, value: number, isCrit: boolean) {
        const txt = this.add.text(x, y, Math.floor(value).toString(), {
            fontSize: isCrit ? '14px' : '11px',
            color: isCrit ? '#f59e0b' : '#ffffff',
            fontFamily: 'monospace', fontStyle: 'bold',
            stroke: '#000000', strokeThickness: 2,
        }).setDepth(45).setAlpha(0.8);
        this.tweens.add({
            targets: txt, y: y - 40, alpha: 0,
            duration: 900, ease: 'Sine.easeOut',
            onComplete: () => txt.destroy()
        });
    }

    /** 渲染敌人攻击意图线（暂停时） */
    private renderIntentLines() {
        this.intentLines.clear();
        if (!commandBridge.visible) return;
        this.globalFleets.forEach(fleet => {
            const myFac = this.factionMap.get(fleet.factionId);
            if (!myFac || myFac.type === 'player') return; // 不画玩家的意图
            fleet.units?.forEach((u: any) => {
                if (u._target && u.hp > 0) {
                    const tgt = u._target;
                    this.intentLines.lineStyle(1.5, 0xff4444, 0.5);
                    this.intentLines.beginPath();
                    this.intentLines.moveTo(u.sprite.x, u.sprite.y);
                    this.intentLines.lineTo(tgt.sprite.x, tgt.sprite.y);
                    this.intentLines.strokePath();
                    // 红色小三角
                    this.intentLines.fillStyle(0xff4444, 0.7);
                    const ang = Math.atan2(tgt.sprite.y - u.sprite.y, tgt.sprite.x - u.sprite.x);
                    this.intentLines.fillTriangle(
                        tgt.sprite.x - 8 * Math.cos(ang), tgt.sprite.y - 8 * Math.sin(ang),
                        tgt.sprite.x - 4 * Math.cos(ang + 0.3), tgt.sprite.y - 4 * Math.sin(ang + 0.3),
                        tgt.sprite.x - 4 * Math.cos(ang - 0.3), tgt.sprite.y - 4 * Math.sin(ang - 0.3)
                    );
                }
            });
        });
    }

    private initFactions() {
        const team1Colors = [0x00ffff, 0x3b82f6, 0x10b981, 0x6366f1, 0x0ea5e9];
        const team2Colors = [0xff0000, 0xf59e0b, 0xd946ef, 0xf43f5e, 0xb91c1c];
        const allFactionsConf: any[] = [];

        const myAdmirals = this.store.dispatchAdmirals || [];
        const isSimMode = !!(this.store as any).simMode; // 战术模拟模式检测
        // 战术模拟模式下的满编 8 舰 deck（与 spawnStrategicFleets 的 rank 计算保持一致的精神）
        const simFullDeck = (faction: string) => [
          `${faction}_战列_1`, `${faction}_战列_1`,
          `${faction}_巡洋_1`, `${faction}_巡洋_1`, `${faction}_巡洋_1`,
          `${faction}_驱逐_1`, `${faction}_驱逐_1`, `${faction}_驱逐_1`
        ];
        myAdmirals.forEach((admId: number, index: number) => {
            const admInfo = this.store.allAdmirals.find((a: any) => a.id === admId);
            if (!admInfo) return;
            const effStats = this.store.getEffectiveStats(admId) || admInfo.stats;
            
            allFactionsConf.push({ 
                id: admInfo.id, imageId: admInfo.imageId, type: index === 0 ? 'player' : 'ai', team: 1, 
                name: `${admInfo.name}舰队`, color: team1Colors[index % team1Colors.length], 
                cssColor: '#' + team1Colors[index % team1Colors.length].toString(16).padStart(6, '0'), 
                trait: admInfo.faction, 
                deck: isSimMode ? simFullDeck(admInfo.faction) : admInfo.deck, 
                admiralStats: effStats, rank: admInfo.rank
            });
        });

        if (allFactionsConf.length === 0) {
            allFactionsConf.push({ id: 999, imageId: '', type: 'player', team: 1, name: '独立舰队', color: team1Colors[0], cssColor: '#00ffff', trait: 'empire', deck: [], admiralStats: { operations: 50, command: 70 }, rank: 3 });
        }

        const enemyCount = parseInt(String(this.store.activeFactionCount), 10) || 2;
        const diff = this.store.selectedDiff || 'normal';
        
        // 1. 按照能力总值排序提督池
        let enemyPool = this.store.allAdmirals.filter((a: any) => a.faction !== this.store.selectedFactionId);
        enemyPool.sort((a: any, b: any) => {
            const totalA = Object.values(a.stats).reduce((acc: any, val: any) => acc + val, 0) as number;
            const totalB = Object.values(b.stats).reduce((acc: any, val: any) => acc + val, 0) as number;
            return totalA - totalB;
        });

        // 根据难度筛选提督池区间
        if (diff === 'easy') {
            enemyPool = enemyPool.slice(0, Math.max(2, Math.floor(enemyPool.length / 2))); // 简单：只选能力最弱的一半
        } else if (diff === 'hard') {
            enemyPool = enemyPool.slice(-Math.max(2, Math.floor(enemyPool.length / 2))); // 困难：只选能力最强的一半
        }
        enemyPool.sort(() => Math.random() - 0.5); // 打乱后抽取

        for (let i = 0; i < enemyCount; i++) {
           const eAdm = enemyPool[i];
           if (!eAdm) continue;
           const cColor = team2Colors[i % team2Colors.length];
           
           // 2. 动态配置建制与副官加成
           let enemyDeck: string[] = [];
           let buffedStats = { ...eAdm.stats };

           if (isSimMode) {
               // 战术模拟：敌军满编 8 艘 (+10 全属性)
               enemyDeck = simFullDeck(eAdm.faction);
               Object.keys(buffedStats).forEach(k => buffedStats[k] += 10);
           } else if (diff === 'easy') {
               // 简单：4艘基础舰，无副官
               enemyDeck = [`${eAdm.faction}_战列_1`, `${eAdm.faction}_巡洋_1`, `${eAdm.faction}_驱逐_1`, `${eAdm.faction}_驱逐_1`];
           } else if (diff === 'hard') {
               // 困难：满编8艘，模拟极品副官配置 (+30全属性)
               enemyDeck = [`${eAdm.faction}_战列_1`, `${eAdm.faction}_战列_1`, `${eAdm.faction}_突击_1`, `${eAdm.faction}_巡洋_1`, `${eAdm.faction}_巡洋_1`, `${eAdm.faction}_驱逐_1`, `${eAdm.faction}_驱逐_1`, `${eAdm.faction}_电子_1`];
               Object.keys(buffedStats).forEach(k => buffedStats[k] += 30);
           } else {
               // 普通：6艘标准舰，模拟普通副官 (+10全属性)
               enemyDeck = [`${eAdm.faction}_战列_1`, `${eAdm.faction}_战列_1`, `${eAdm.faction}_巡洋_1`, `${eAdm.faction}_巡洋_1`, `${eAdm.faction}_驱逐_1`, `${eAdm.faction}_驱逐_1`];
               Object.keys(buffedStats).forEach(k => buffedStats[k] += 10);
           }

           allFactionsConf.push({ 
               id: eAdm.id + 10000, imageId: eAdm.imageId, type: 'ai', team: 2, 
               name: `${eAdm.name}舰队`, color: cColor, cssColor: '#' + cColor.toString(16).padStart(6, '0'), 
               trait: eAdm.faction, deck: enemyDeck, admiralStats: buffedStats, rank: diff === 'hard' ? 4 : (diff === 'easy' ? 2 : 3)
           });
        }

        this.store.factions = allFactionsConf.map(fc => {
          const ops = fc.admiralStats?.operations || 0;
          return {
            ...fc, hp: 100, maxHp: 100, 
            gold: (this.store.selectedDiff === 'easy' && fc.team === 1 ? 500 : 200) + ops * 2, 
            goldRate: (this.store.selectedDiff === 'easy' && fc.team === 1 ? 5 : 2) + Math.floor(ops / 20), 
            active: true, castlePos: {x:0, y:0}, unitCount: 0,
            buildCounts: { barracks: 0, mines: 0, towers: 0 } 
          };
        });
        
        this.store.factions.filter((f: any) => f.team === 2).forEach((ai: any) => {
          // v2 公平化：不再白送金。hard 差异改为决策更激进（铺地价格已在扩张逻辑中×0.7）
        });

        // 重建 faction 查找缓存：factions 已重新创建，旧缓存指向失效对象
        this.factionMap.clear();
        this.store.factions.forEach((f: any) => this.factionMap.set(f.id, f));
    }

    private buildMapData(): any[] {
        let mapDataMatrix: any[] = [];
        if (this.store.selectedMapId === 'random') {
          // 战场扩容（对齐 demo 大地图观感）：半径 25→32（1951→3169 格）
          for (let q = -32; q <= 32; q++) {
            for (let r = -32; r <= 32; r++) {
              if (Math.abs(q + r) > 32) continue;
              let type = 'pending'; const rand = Math.random();
              if (rand < 0.04) type = 'sea';
              else if (rand < 0.07) type = 'ruined';
              mapDataMatrix.push({ q, r, cost: 50, type, ownerId: 0 });
            }
          }
          const numPlanets = 15 + Math.floor(Math.random() * 10);
          const landHexes = mapDataMatrix.filter(t => t.type === 'pending');
          for(let i=0; i<numPlanets && landHexes.length > 0; i++) {
             const idx = Math.floor(Math.random() * landHexes.length);
             landHexes[idx].type = 'planet'; landHexes.splice(idx, 1);
          }
        } else if (this.store.selectedMapId === 'random_rect') {
          // 长条地图扩容：41×21 → 53×27
          for (let q = -26; q <= 26; q++) {
            for (let r = -13; r <= 13; r++) {
              let type = 'pending'; const rand = Math.random();
              if (rand < 0.04) type = 'sea'; else if (rand < 0.07) type = 'ruined';
              mapDataMatrix.push({ q, r, cost: 50, type, ownerId: 0 });
            }
          }
          const numPlanets = 6 + Math.floor(Math.random() * 4);
          const landHexes = mapDataMatrix.filter(t => t.type === 'pending');
          for(let i=0; i<numPlanets && landHexes.length > 0; i++) {
             const idx = Math.floor(Math.random() * landHexes.length);
             landHexes[idx].type = 'planet'; landHexes.splice(idx, 1);
          }
        } else if (this.store.selectedMapId === 'random_large') {
          for (let q = -16; q <= 16; q++) {
            for (let r = -16; r <= 16; r++) {
              if (Math.abs(q + r) > 20) continue;
              let type = 'pending'; const rand = Math.random();
              if (rand < 0.04) type = 'sea'; else if (rand < 0.07) type = 'ruined';
              mapDataMatrix.push({ q, r, cost: 50, type, ownerId: 0 });
            }
          }
          const numPlanets = 8 + Math.floor(Math.random() * 5);
          const landHexes = mapDataMatrix.filter(t => t.type === 'pending');
          for(let i=0; i<numPlanets && landHexes.length > 0; i++) {
             const idx = Math.floor(Math.random() * landHexes.length);
             landHexes[idx].type = 'planet'; landHexes.splice(idx, 1);
          }
        } else if (this.store.selectedMapId.startsWith('custom_')) {
          const rawCustom = JSON.parse(JSON.stringify(this.store.customMapsData[this.store.selectedMapId]));
          mapDataMatrix = rawCustom.map((c: any) => ({ ...c, ownerId: 0 }));
        } else {
          for (let q = -6; q <= 6; q++) { for (let r = -6; r <= 6; r++) {
            if (Math.abs(q + r) > 7) continue;
            let tType = 'pending'; if (q === 0 || r === 0 || q + r === 0) tType = 'sea';
            mapDataMatrix.push({ q, r, cost: 50, type: tType, ownerId: 0 });
          } }
        }

        let validStartNodes = mapDataMatrix.filter(t => t.type === 'pending' || t.type === 'pier' || t.type === 'planet');
        validStartNodes.sort((a, b) => a.q - b.q); 
        
        if (validStartNodes.length > 0) {
            const fCount = this.store.factions.length / 2;
            const poolSize = Math.max(fCount * 2, Math.floor(validStartNodes.length * 0.15));
            let team1Nodes = validStartNodes.slice(0, poolSize);
            let team2Nodes = validStartNodes.slice(-poolSize);
            team1Nodes.sort(() => Math.random() - 0.5); team2Nodes.sort(() => Math.random() - 0.5);
            const customCastles = mapDataMatrix.filter(t => t.type === 'castle');
            customCastles.forEach(c => { c.type = 'pending'; c.ownerId = 0; c.cost = 50; });
            const useRandomSpawn = this.store.selectedMapId === 'random' || this.store.selectedMapId === 'random_rect' || this.store.selectedMapId === 'random_large' || customCastles.length < this.store.factions.length;
            
            let usedNodes = new Set();
            this.store.factions.forEach((f: any, idx: number) => {
               let node: any = null;
               if (useRandomSpawn) {
                   let targetPool = f.team === 1 ? team1Nodes : team2Nodes;
                   node = targetPool.find((n: any) => !usedNodes.has(n));
                   if (!node) node = validStartNodes.find((n: any) => !usedNodes.has(n));
               } else { node = customCastles[idx]; }

               if (!node) {
                const validTiles = mapDataMatrix.filter(t => t.type !== 'sea' && t.type !== 'ruined' && !usedNodes.has(t));
                if (validTiles.length > 0) {
                    node = validTiles[Math.floor(Math.random() * validTiles.length)];
                }
            }

                if (node) {
                    usedNodes.add(node);
                    node.type = 'castle'; 
                    node.ownerId = f.id; 
                    node.cost = 0;
                    mapDataMatrix.forEach(t => {
                       const dist = Math.max(Math.abs(t.q - node.q), Math.abs(t.r - node.r), Math.abs(-t.q-t.r - (-node.q-node.r)));
                       if (dist <= 2) {
                           if (t.type === 'sea' || t.type === 'ruined') { 
                               t.type = 'pending'; 
                               t.cost = 50; 
                           }
                           t.ownerId = f.id;
                       }
                   });
               }
            });
        }

        mapDataMatrix.forEach(t => {
          if (t.type === 'pending' || t.type === 'mystery') {
            let roll = Math.random();
            if (roll < 0.05) { t.type = 'gold_mine'; t.cost = 100; }
            else if (roll < 0.10) { t.type = 'tower'; t.cost = 50; }
            else { t.type = 'pending'; t.cost = 50; }
          }
        });

        // ── P1 地形系统：为可通行格子随机注入地形效果（星云/小行星带/引力点/残骸区）──
        // 对称公平：地形只加在非出生区（距所有castle ≥4 格）
        const castleTiles = mapDataMatrix.filter(t => t.type === 'castle');
        mapDataMatrix.forEach(t => {
          if (t.type === 'sea' || t.type === 'ruined' || t.type === 'planet' || t.type === 'castle') return;
          const nearCastle = castleTiles.some(c => {
            const d = Math.max(Math.abs(t.q - c.q), Math.abs(t.r - c.r), Math.abs(-t.q-t.r - (-c.q-c.r)));
            return d <= 3;
          });
          if (nearCastle) return; // 出生区不放置地形，保证公平
          const roll = Math.random();
          if (roll < 0.06) t.terrain = 'nebula';        // 星云：减速+视野-50%+闪避+
          else if (roll < 0.12) t.terrain = 'asteroid';  // 小行星带：射程-30%+近战优
          else if (roll < 0.16) t.terrain = 'gravity';   // 引力点：移速+30%
          else if (roll < 0.20) t.terrain = 'debris';    // 残骸区：可藏匿
          if (t.terrain) t.cost += 25; // 有地形的格子铺路更贵
        });
        return mapDataMatrix;
    }

    /** 计算舰队战斗力（HP × DPS 估值） */
    private calculateFleetPower(fleet: any): number {
        if (!fleet || !fleet.units) return 0;
        let total = 0;
        fleet.units.forEach((u: any) => {
            const effectiveHp = Math.max(0, u.hp);
            const dpsEstimate = (u.atk || 50) / Math.max(1, (u.atkInterval || 2000) / 1000);
            total += effectiveHp * (1 + dpsEstimate * 0.1);
        });
        return total;
    }

    private isAdjacentToTeam(targetTile: any, teamId: number) {
        for (const dir of this.directions) {
          const neighbor = this.tilesDict[`${targetTile.q + dir.q},${targetTile.r + dir.r}`];
          if (neighbor && neighbor.ownerId !== 0) {
             const ownerFac = this.factionMap.get(neighbor.ownerId);
             if (ownerFac && ownerFac.team === teamId) return true;
          }
        } return false;
    }

    private async handleTileClick(pointer: Phaser.Input.Pointer, tile: any, poly: Phaser.GameObjects.Polygon, txt: Phaser.GameObjects.Text) {
        if (pointer.getDistance() > 30 || this.store.gameOver || this.store.isPaused) return;
        const { sprite, text, ...pureTile } = tile;
        
        // 动态判定地块名称
        if (pureTile.type === 'pending') {
            const pFacInfo = this.store.factions.find((f: any) => f.type === 'player');
            if (tile.ownerId === 0) pureTile.type = '未知空域';
            else if (pFacInfo && tile.ownerId === pFacInfo.id) pureTile.type = '我方控制区';
            else pureTile.type = '敌占区';
        } else {
            pureTile.type = tile.typeName || pureTile.type;
        }
        
        this.store.selectedTile = pureTile;
        
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        if (!pFac || !pFac.active) return;
        
        if (this.store.isCastingBomb) { 
            this.castBomb(tile.x, tile.y, tile, pFac); 
            return;
        }
        if (tile.type === 'sea' || tile.type === 'ruined') return;

        // 右鍵點擊 (button === 2)：投放戰術信標
        if (pointer.button === 2) {
            this.deployFlare(tile.x, tile.y, pFac.id);
            if (this.mapStyle === 'crt') poly.setAlpha(0.3);
            return;
        }

        // 左鍵點擊 (button === 0)：擴張補給線或建立野戰修補站
        if (tile.ownerId !== pFac.id) {
            // 【核心重构】补给线防御装甲化：凡是被占领的格子（非中立），一律不准直接购买！
            if (tile.ownerId !== 0) {
                this.store.triggerToast("无法直接购买敌方控制区，必须派遣舰队用炮火摧毁其补给节点！");
                return;
            }
            if (tile.type === 'planet') {
                this.store.triggerToast("星球无法直接购买，请指派舰队靠近压制！");
                return;
            }

            // 點擊中立格子，若相鄰且資金足夠則佔領（擴張補給線）
            if (this.isAdjacentToTeam(tile, pFac.team)) {
                if (pFac.gold >= tile.cost) {
                    pFac.gold -= tile.cost;
                    tile.ownerId = pFac.id;
                    poly.setFillStyle(pFac.color, 0.9);
                    poly.setStrokeStyle(3, pFac.color, 1.0);
                    if (this.mapStyle === 'crt') poly.setAlpha(0.35);
                    // 觸發連通性更新
                    this.updateSupplyNetwork(); 
                } else {
                    this.store.triggerToast(`資金不足，擴張該空域需要 ${tile.cost} 經費`);
                }
            }
            return;
        }

        // 點擊已佔領的普通格子：建立野戰修補站
        if (tile.ownerId === pFac.id && tile.connected && tile.type === 'pending') {
            if (pFac.gold >= 300) {
                pFac.gold -= 300;
                tile.type = 'barracks';
                poly.setFillStyle(pFac.color, 0.9); 
                poly.setStrokeStyle(3, pFac.color, 1.0);
                txt.setText('⚙').setAlpha(0.8);
                this.store.triggerToast("野戰修補站部署完畢，提供範圍補給。");
            } else {
                this.store.triggerToast("經費不足，建立野戰修補站需 300 經費。");
            }
            return;
        }
    }

    private castBomb(x: number, y: number, tile: any, pFac: any) {
        if (pFac.gold < 200) {
            this.store.isCastingBomb = false;
            this.store.triggerToast("资金不足，无法执行主炮打击(需200)");
            return;
        }
        pFac.gold -= 200; this.store.isCastingBomb = false;
        
        const shockwave = this.add.circle(x, y, 10, 0xef4444).setAlpha(0.8).setDepth(40);
        this.tweens.add({ targets: shockwave, radius: 150, alpha: 0, duration: 500, onComplete: () => shockwave.destroy() });
        
        if (tile.ownerId !== pFac.id && this.factionMap.get(tile.ownerId)?.team !== pFac.team) tile.hp -= 300;
        
        this.globalFleets.forEach(fl => {
           if (this.factionMap.get(fl.factionId)?.team !== pFac.team) {
              fl.units.forEach((u: any) => {
                                    if (Phaser.Math.Distance.Between(x, y, u.sprite.x, u.sprite.y) < 150) {
                      const minDmg = Math.max(1, Math.floor(u.maxHp * 0.005));
                      u.hp -= Math.max(200, minDmg);
                  }
              });
           }
        });
    }

    update(time: number, delta: number) {
        if (this.store.gameOver) return;

        // ── 指挥点：空格键检测（每帧检查，暂停时也能工作）──
        if (this.spaceKey && Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
            if (commandBridge.visible) {
                commandBridge.visible = false;
                commandBridge.pendingCallback = null;
                this.store.isPaused = false;
            } else {
                this.openCommandPanel();
            }
        }

        if (this.store.isPaused) {
            this.renderIntentLines();
            return;
        }
        const dt = this.store.currentSpeedFactor;
        this.hpBarsGraphics.clear();

        // ── 指挥点系统：应用效果（CP恢复+效果倒计时+伤害/速度修正）──
        this.applyCommandEffects(delta);
        this.applyBandwidthEffects(delta);

        // 构建 faction 查找缓存（O(1) Map 替代 O(N) find，每帧节省 ~16000 次线性扫描）
        this.factionMap.clear();
        this.store.factions.forEach((f: any) => this.factionMap.set(f.id, f));

        // === CRT 全息投影效果 ===
        if (this.mapStyle === 'crt') {
            this.updateCRTEffects(time);
        } else if (this.mapStyle === 'command') {
            // 指挥制：纯宇宙，不画六边形网格；舰队光环每帧重绘，扫描线 overlay 随相机节流重绘
            if (this.crtFleets) {
                drawCommandFleets(this.crtFleets, this.globalFleets, this.crtGlowTime.val, this.factionMap);
            }
            this.cmdScanTimer += delta;
            if (this.crtScan && this.cmdScanTimer > 60) {
                this.cmdScanTimer = 0;
                drawCommandScanOverlay(this.cameras.main, this.crtScan, this.time.now);
            }
        }

        const pFac = this.store.factions.find((f: any) => f.type === 'player');
                
        this.tilesList.forEach(t => {
            if (t.type === 'tower' && t.ownerId !== 0) {
                const myTowerFac = this.factionMap.get(t.ownerId);
                if (!myTowerFac) return;
                const towerRate = Math.max(800, 1500 - (myTowerFac.admiralStats?.intelligence || 0) * 5);
                if (time - t.lastTowerShotTime > (towerRate / dt)) { 
                    let targets: any[] = [];
                    this.globalFleets.forEach(fl => {
                        const uFac = this.factionMap.get(fl.factionId);
                        if (uFac && uFac.team !== myTowerFac.team) targets.push(...fl.units);
                    });
                    let closestTarget: any = null; let minDist = 140; 
                    targets.forEach(u => {
                        const d = Phaser.Math.Distance.Between(t.x, t.y, u.sprite.x, u.sprite.y);
                        if (d < minDist) { minDist = d; closestTarget = u; }
                    });
                    if (closestTarget) {
                        t.lastTowerShotTime = time;
                        const rect = this.add.circle(t.x, t.y, 4, myTowerFac.color);
                        this.phaserProjectiles.push({ sprite: rect, target: closestTarget, damage: 15 + Math.floor((myTowerFac.admiralStats?.attack || 0)/10) });
                    }
                }
            }
        });

        for (let i = this.phaserProjectiles.length - 1; i >= 0; i--) {
            const p = this.phaserProjectiles[i];
            if (!p.target.sprite || !p.target.sprite.active) { p.sprite.destroy(); this.phaserProjectiles.splice(i, 1); continue; }
            
            const angle = Math.atan2(p.target.sprite.y - p.sprite.y, p.target.sprite.x - p.sprite.x);
            p.sprite.rotation = angle;
            // 【放慢相位炮弹】12.0 → 6.0，飞行速度减半，营造炮弹缓缓逼近的压迫感
            p.sprite.x += Math.cos(angle) * 6.0 * dt;
            p.sprite.y += Math.sin(angle) * 6.0 * dt;

            if (Phaser.Math.Distance.Between(p.sprite.x, p.sprite.y, p.target.sprite.x, p.target.sprite.y) < 15) {
                                const minTowerDmg = Math.max(1, Math.floor(p.target.maxHp * 0.005));
                p.target.hp -= Math.max(p.damage, minTowerDmg);
                // 伤害数字
                this.spawnDamageNumber(p.target.sprite.x, p.target.sprite.y, Math.max(p.damage, minTowerDmg), false);
                if (p.target.sprite.active) {
                    p.target.sprite.setAlpha(0.3);
                    this.time.delayedCall(100, () => { if (p.target.sprite && p.target.sprite.active) p.target.sprite.setAlpha(1.0); });
                }
                
                const tFac = this.factionMap.get(p.target.factionId);
                const shieldColor = tFac ? tFac.color : 0x06b6d4;
                const impactAngleRad = Math.atan2(p.sprite.y - p.target.sprite.y, p.sprite.x - p.target.sprite.x);
                const impactAngleDeg = Phaser.Math.RadToDeg(impactAngleRad);
                // 3D 覆盖层：塔弹命中护盾涟漪事件（dir=激光传播方向=弹丸行进方向，见 battle3dFx 契约）
                pushFx3d({ kind: 'shield', at: { x: p.target.sprite.x, y: p.target.sprite.y }, dir: { x: -Math.cos(impactAngleRad), y: -Math.sin(impactAngleRad) }, color: shieldColor });

                const impactX = p.target.sprite.x + Math.cos(impactAngleRad) * 10;
                const impactY = p.target.sprite.y + Math.sin(impactAngleRad) * 10;
                const impactFlash = this.add.circle(impactX, impactY, 4, 0xffffff, 1).setDepth(21).setBlendMode(Phaser.BlendModes.ADD);

                // 【球形护盾涟漪】3D球面护盾的2D投影=椭圆弧线，仅弧边无填充无弦线，从受击点向两侧扩散消散
                const gfx = this.add.graphics().setDepth(20);
                const rippleState: any = { rx: 14, ry: 8, span: 0.45, alpha: 1 };
                const drawShieldArc = () => {
                    gfx.clear();
                    if (rippleState.alpha <= 0) return;
                    const a1 = impactAngleRad - rippleState.span;
                    const a2 = impactAngleRad + rippleState.span;
                    gfx.lineStyle(Math.max(0.4, 3 * rippleState.alpha), shieldColor, rippleState.alpha);
                    gfx.beginPath();
                    for (let s = 0; s <= 24; s++) {
                        const t = a1 + (a2 - a1) * (s / 24);
                        const px = p.target.sprite.x + rippleState.rx * Math.cos(t);
                        const py = p.target.sprite.y + rippleState.ry * Math.sin(t);
                        s === 0 ? gfx.moveTo(px, py) : gfx.lineTo(px, py);
                    }
                    gfx.strokePath();
                };
                drawShieldArc();

                this.tweens.add({ targets: impactFlash, scale: 0.1, alpha: 0, duration: 200 / dt, ease: 'Cubic.easeOut', onComplete: () => impactFlash.destroy() });
                this.tweens.add({
                    targets: rippleState, rx: 32, ry: 18, span: Math.PI * 0.6, alpha: 0,
                    duration: 1100 / dt, ease: 'Sine.easeOut',
                    onUpdate: drawShieldArc,
                    onComplete: () => gfx.destroy()
                });

                p.sprite.destroy(); 
                this.phaserProjectiles.splice(i, 1);
            }
        }

        this.globalFleets = this.globalFleets.filter(fleet => {
            // P3 战损账单：累计玩家舰队战损（非AI）
            const pFac3 = this.store.factions.find((f: any) => f.type === 'player');
            const isPlayerFleet = pFac3 && fleet.factionId === pFac3.id;
            fleet.units = fleet.units.filter((u: any) => {
                if (u.hp <= 0) {
                    if (isPlayerFleet) {
                        this.battleLosses.ships += 1;
                        // P3 抚恤金：按舰种船员×PENSION_RATE 估算（v3 经济体系）
                        const cls = u.classType || '';
                        const crew = cls === '战列' ? 3000 : cls === '巡洋' ? 1000 : cls === '驱逐' ? 500 : cls === '突击' ? 5000 : 500;
                        this.battleLosses.pension += crew * 50;
                    }
                    // ── 旗舰沉没叙事：特写 + 提督诀别台词 + 接任播报 ──
                    // filter 顺序遍历，units[0] 被评估时仍是旗舰；units.length > 1 保证还有接任者（否则走下方全灭分支）
                    if (fleet.units[0] === u && fleet.units.length > 1) {
                        const sinkFac = this.factionMap.get(fleet.factionId);
                        const sinkName = sinkFac?.name || '舰队';
                        (this.store as any).triggerToast?.(`★ ${sinkName}旗舰被击沉！副舰长接任指挥权。`);
                        // ── 指挥带宽降级：玩家旗舰沉没 → 通信阵列受损，全军频道重置 ──
                        const pFacForBw = this.store.factions.find((f: any) => f.type === 'player');
                        if (this.bwState && pFacForBw && fleet.factionId === pFacForBw.id && this.getCommCenter()?.fleet === fleet) {
                            degradeForFlagshipLoss(this.bwState);
                            this.showBattleBanner('⌁ 通信阵列受损', '旗舰中继天线损毁：指挥半径收缩，全军频道重置', '#ef4444');
                        }
                        if ((this.store as any).addBattleLog) {
                            (this.store as any).addBattleLog({ text: `${sinkName}旗舰被击沉，指挥权移交`, type: 'battle' });
                        }
                        this.showFleetDialogue(fleet, 'defeat', true);
                        // 特写：镜头短暂推近沉没点再拉回
                        try {
                            const preZoom = this.cameras.main.zoom;
                            this.cameras.main.pan(fleet.x, fleet.y, 300, 'Sine.easeInOut');
                            this.cameras.main.setZoom(Math.min(2.0, preZoom * 1.5));
                            this.cameras.main.shake(400, 0.006);
                            this.time.delayedCall(2000, () => {
                                this.cameras.main.setZoom(preZoom);
                            });
                        } catch (e) { /* 镜头动画非关键路径 */ }
                    }
                    u.sprite.destroy(); return false;
                }
                return true;
            });
            
        // 实时同步对话气泡坐标：固定在前端头像框右侧，且抵消镜头缩放保持 UI 级大小
        this.activeDialogues.forEach(b => {
            const target = b.getData('targetShip');
            if (target && target.sprite && target.sprite.active) {
                const cam = this.cameras.main;
                // 设定屏幕空间的固定偏移量：右侧 90px，偏上 40px (对齐浮动头像框)
                const offsetX = 90 / cam.zoom;
                const offsetY = -40 / cam.zoom;
                
                b.x = target.sprite.x + offsetX; 
                b.y = target.sprite.y + offsetY;
                b.setScale(1 / cam.zoom); // 逆向缩放，确保气泡和外部 HTML 的头像框比例一致
            }
        });

            if (fleet.units.length === 0) {
                const fac = this.factionMap.get(fleet.factionId);
                if (fac) {
                    // ── 舰队全灭：提督诀别台词（isDefeat=true 固定坐标气泡）──
                    this.showFleetDialogue({ ...fleet, factionId: fleet.factionId, x: fleet.x, y: fleet.y }, 'defeat', true);
                    fac.active = false;
                    const activeAllies = this.store.factions.filter((f: any) => f.team === 1 && f.active);
                    const activeEnemies = this.store.factions.filter((f: any) => f.team === 2 && f.active);
                    if (activeAllies.length === 0) {
                        this.store.gameOver = true; this.store.isWin = false;
                        this.store.winStatus = "我方联合舰队全军覆没！"; this.store.rewardGold = 45;
                    } else if (activeEnemies.length === 0) {
                        this.store.gameOver = true; this.store.isWin = true;
                        this.store.winStatus = "敌对势力全数歼灭！"; this.store.rewardGold = 350;
                        // P4c 最后一击慢镜头
                        try {
                            this.cameras.main.setZoom(1.5);
                            this.cameras.main.shake(600, 0.008);
                            this.time.delayedCall(2500, () => this.cameras.main.setZoom(1));
                        } catch (e) { /* 镜头动画非关键路径 */ }
                    }
                }
                return false;
            }
            return true;
        });

        this.globalFleets.forEach(fleet => {
            const myFac = this.factionMap.get(fleet.factionId);
            if (!myFac || !myFac.active) {
                fleet.units.forEach((u: any) => { u.hp = 0; u.sprite.destroy(); });
                fleet.units = []; return;
            }

            let minFleetDist = 99999; let closestEnemyFleet: any = null;
            // === 阶段B：视野迷雾系统 ===
            // 视野 = 基础200 + 情报值×2 + 电子科技×30（随hexRadius缩放）
            const visionRange = this.getVisionRange(fleet, myFac);
            // 视野内敌人按距离分级：近(<50%视野)=完全可见，中(50-80%)=识别类型，远(80-100%)=模糊
            let visibleEnemies: { ef: any; dist: number; clarity: 'full' | 'partial' | 'fuzzy' }[] = [];
            this.globalFleets.forEach(ef => {
                if (ef.units.length > 0) {
                    const efFac = this.factionMap.get(ef.factionId);
                    if (efFac && efFac.team !== myFac.team && efFac.active) {
                        const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, ef.x, ef.y);
                        if (d < visionRange) {
                            let clarity: 'full' | 'partial' | 'fuzzy' = 'full';
                            if (d > visionRange * 0.8) clarity = 'fuzzy';   // 视野边缘：只能感知"有东西"
                            else if (d > visionRange * 0.5) clarity = 'partial'; // 中距：识别舰队类型
                            visibleEnemies.push({ ef, dist: d, clarity });
                        }
                    }
                }
            });
            // 只有清晰目标才可锁定为交战对象
            const clearEnemies = visibleEnemies.filter(v => v.clarity !== 'fuzzy');
            clearEnemies.sort((a, b) => a.dist - b.dist);
            if (clearEnemies.length > 0) {
                closestEnemyFleet = clearEnemies[0].ef;
                minFleetDist = clearEnemies[0].dist;
            }

            // P4a 一骑讨：双方舰队极近距离接触（<95px）→ 名场面镜头+对决台词（冷却30秒/同一对只触发一次）
            if (closestEnemyFleet && minFleetDist < 95 && this.time.now > this.duelCooldown) {
                const pairKey = [Math.min(fleet.id, closestEnemyFleet.id), Math.max(fleet.id, closestEnemyFleet.id)].join('-');
                if (pairKey !== this.lastDuelPair) {
                    this.lastDuelPair = pairKey;
                    this.duelCooldown = this.time.now + 30000;
                    this.cameras.main.shake(300, 0.004);
                    this.showFleetDialogue(fleet, 'engage');
                    this.showFleetDialogue(closestEnemyFleet, 'engage');
                    // 镜头拉近到对决点
                    this.tweens.add({
                        targets: this.cameras.main, zoom: Math.min(2.2, (this.cameras.main.zoom || 1) * 1.4), duration: 400, ease: 'Sine.easeOut',
                        onComplete: () => {
                            this.tweens.add({ targets: this.cameras.main, zoom: 1, duration: 1200, ease: 'Sine.easeInOut' });
                        }
                    });
                }
            }

            // P4b 逆境宣言：舰队血量首次低于25% → 触发逆转宣言（士气爆发特效）
            if (fleet.units.length > 0) {
                let hpSum = 0, hpMax = 0;
                fleet.units.forEach((u: any) => { hpSum += u.hp; hpMax += u.maxHp; });
                const hpPctFleet = hpMax > 0 ? hpSum / hpMax : 0;
                if (hpPctFleet < 0.25 && !this.adversityTriggered.has(fleet.id)) {
                    this.adversityTriggered.add(fleet.id);
                    const advNames: Record<number, string> = { 1: '战局未定，胜负难料！', 2: '牺牲换来的，岂能就此罢休！' };
                    const advText = advNames[fleet.factionId] || '绝境反攻，绝不后退！';
                    this.showFleetDialogue(fleet, 'engage');
                    // 逆转buff：伤害+15% 10秒
                    fleet._adversityBuffUntil = this.time.now + 10000;
                    // 金色爆发光环
                    fleet.units.forEach((u: any) => {
                        if (u.sprite?.active) {
                            const ring = this.add.circle(u.sprite.x, u.sprite.y, 18, 0xfbbf24, 0.3).setDepth(16);
                            this.tweens.add({ targets: ring, scale: 3, alpha: 0, duration: 700, onComplete: () => ring.destroy() });
                        }
                    });
                    this.cameras.main.shake(250, 0.003);
                }
            }
            // 模糊目标仅作为"可疑目标"记录，不触发交战
            const fuzzyTargets = visibleEnemies.filter(v => v.clarity === 'fuzzy');
            // 视野边缘有可疑目标但无法确认 → 降低探索欲望，转为警戒
            const hasUncertainThreat = fuzzyTargets.length > 0 && !closestEnemyFleet;
            if (hasUncertainThreat && fleet.stance === 'search') {
                fleet.stance = 'defend'; // 索敌中发现可疑目标 → 切换驻守警戒
            }
             
            let closestEnemyTile: any = null; let minTileDist = 99999;
            this.tilesList.forEach(t => {
                const isValuable = ['castle', 'planet', 'barracks', 'gold_mine', 'tower', 'pier'].includes(t.type);
                if (isValuable && t.ownerId !== 0 && t.type !== 'sea' && t.type !== 'ruined') {
                    const oFac = this.factionMap.get(t.ownerId);
                    if (oFac && oFac.team !== myFac.team && oFac.active) {
                        const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, t.x, t.y);
                        let score = d - (t.type === 'castle' ? 800 : 0);
                        if (score < minTileDist) { minTileDist = score; closestEnemyTile = t; }
                     }
                }
            });

            // 塔目标化：查询可攻击的敌方塔（优先于探索目标）
            let closestEnemyTower: any = null; let minTowerDist = 250;
            this.tilesList.forEach(t => {
                if (t.type === 'tower') {
                    const tFac = this.factionMap.get(t.ownerId);
                    if (tFac && tFac.team !== myFac.team) {
                        const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, t.x, t.y);
                        if (d < minTowerDist) { minTowerDist = d; closestEnemyTower = t; }
                    }
                }
            });

            let fleetTargetX = fleet.x; let fleetTargetY = fleet.y;
            let isEngaging = false;
            let isRetreating = false;

            if (fleet.state !== fleet.lastState) {
                if (fleet.state === 'engaging') this.showFleetDialogue(fleet, 'engage');
                else if (fleet.state === 'retreating') this.showFleetDialogue(fleet, 'retreat');
                fleet.lastState = fleet.state;
            }

            // 1. 状态评估：血量与补给度
            let totalHp = 0, totalMaxHp = 0;
            fleet.units.forEach((u: any) => { totalHp += u.hp; totalMaxHp += u.maxHp; });
            const hpPct = totalMaxHp > 0 ? totalHp / totalMaxHp : 0;
            
            if (hpPct < 0.5 && !fleet.halfHpTriggered) {
                fleet.halfHpTriggered = true;
                this.showFleetDialogue(fleet, 'halfHp');
            }

            const currentSupply = fleet.units[0]?.supply || 0;

            // 状态转换判定：断粮或姿态为撤退时，强制进入撤退状态
            const isManualRetreat = fleet.stance === 'fallback';
            if (fleet.state !== 'retreating' && (isManualRetreat || currentSupply < 30)) {
                fleet.state = 'retreating';
            } else if (fleet.state === 'retreating' && !isManualRetreat && currentSupply > 80) {
                fleet.state = 'exploring';
            }

            // 确定当前优先级状态 — 带威胁评估 + 塔攻击
            // v2 修复：engaging 但目标消失（守军被灭/基地易主）→ 强制转 exploring 重新评估，杜绝死锁
            if (fleet.state === 'engaging' && !closestEnemyFleet && !closestEnemyTower && !fleet.targetFlare) {
                fleet.state = 'exploring';
                fleet.stance = 'search';
            }
            if (fleet.targetFlare && !isManualRetreat) {
                fleet.state = 'flaring';
            } else if (fleet.state !== 'retreating') {
                const engageDist = fleet.stance === 'siege' ? 300 : 250;
                // v2 修复：塔攻击不再限制 hpPct>0.4（残血也必须拆塔/反击，否则原地被点死）
                const shouldAttackTower = closestEnemyTower && minTowerDist < 170
                    && (!closestEnemyFleet || minFleetDist > 200);
                // v2 新增：残血(<30%)且无近敌 → 优先撤退保命，不硬拼
                const isCriticalLowHp = hpPct < 0.3 && !closestEnemyFleet && !shouldAttackTower;
                if (isCriticalLowHp && fleet.state !== 'retreating') {
                    fleet.state = 'retreating';
                    fleet.stance = 'fallback';
                }
                if (closestEnemyFleet && minFleetDist < engageDist) {
                    // === 阶段C：聚焦火力 — 多目标时优先补刀残血/威胁最大 ---
                    // 从visibleEnemies中选择最优目标（不只看最近的）
                    let bestTarget = closestEnemyFleet;
                    let bestScore = -Infinity;
                    visibleEnemies.forEach(ve => {
                        const ePower = this.calculateFleetPower(ve.ef);
                        const eHpPct = ve.ef.units.reduce((s: number, u: any) => s + u.hp, 0) / Math.max(1, ve.ef.units.reduce((s: number, u: any) => s + u.maxHp, 0));
                        // 补刀残血优先 + 距离惩罚 + 威胁加成
                        let score = (1 - eHpPct) * 300 - ve.dist + ePower * 0.1;
                        if (score > bestScore) { bestScore = score; bestTarget = ve.ef; }
                    });
                    closestEnemyFleet = bestTarget;
                    minFleetDist = Phaser.Math.Distance.Between(fleet.x, fleet.y, closestEnemyFleet.x, closestEnemyFleet.y);

                    // 威胁评估：战斗力和血量的比较加权
                    const myPower = this.calculateFleetPower(fleet);
                    const enemyPower = this.calculateFleetPower(closestEnemyFleet);
                    const powerRatio = enemyPower > 0 ? myPower / enemyPower : 999;

                    // 协调：统计已有几支友军盯上了这个敌人
                    let alliesOnTarget = 0;
                    this.globalFleets.forEach(af => {
                        if (af.factionId !== fleet.factionId) {
                            const afFac = this.factionMap.get(af.factionId);
                            if (afFac && afFac.team === myFac.team && af._lastTargetFleetId === closestEnemyFleet.id) {
                                alliesOnTarget++;
                            }
                        }
                    });

                    // === 阶段C：避免过饱和 — 最多2支舰队打同一目标 ===
                    const canEngage = powerRatio > 0.8 ||
                        (powerRatio > 0.5 && hpPct > 0.7 && alliesOnTarget <= 1) ||
                        (alliesOnTarget === 0 && powerRatio > 0.3 && hpPct > 0.5);

                    if (canEngage) {
                        fleet.state = 'engaging';
                        fleet._lastTargetFleetId = closestEnemyFleet.id;
                        // 阵型选择（由engaging逻辑进一步细化）
                        if (alliesOnTarget >= 2) {
                            fleet.formation = 'circle'; // 3+舰队 → 包围
                        } else if (powerRatio > 1.5) {
                            fleet.formation = 'wedge';  // 绝对优势 → 楔形追击
                        } else {
                            fleet.formation = 'line';   // 均势 → 战列对射
                        }
                    } else {
                        // 打不过或目标已饱和，保持距离或撤退
                        fleet.state = 'exploring';
                        if (myPower < enemyPower * 0.4) {
                            fleet.stance = 'fallback';
                        }
                    }
                } else if (shouldAttackTower) {
                    // === 塔攻击模式 ===
                    fleet.state = 'engaging';
                    fleet._lastTargetFleetId = null;
                    fleetTargetX = closestEnemyTower.x;
                    fleetTargetY = closestEnemyTower.y;
                    fleet.formation = 'wedge'; // 突击阵型
                } else {
                    fleet.state = 'exploring';
                }
            }

            // 2. 根据状态设定战术目标坐标
            if (fleet.state === 'flaring' && fleet.targetFlare) {
                fleetTargetX = fleet.targetFlare.x; fleetTargetY = fleet.targetFlare.y;
                if (Phaser.Math.Distance.Between(fleet.x, fleet.y, fleetTargetX, fleetTargetY) < 40) {
                    const flareYComp = this.mapStyle === 'crt' ? CRT_Y_SCALE : 1;
                    const flareRealY = fleetTargetY / flareYComp;
                    const fQ = Math.round((Math.sqrt(3)/3 * fleetTargetX - 1/3 * flareRealY) / this.hexRadius);
                    const fR = Math.round((2/3 * flareRealY) / this.hexRadius);
                    const tileAtFlare = this.tilesDict[`${fQ},${fR}`];
                    const isUncapturedPlanet = tileAtFlare && tileAtFlare.type === 'planet' && tileAtFlare.ownerId !== fleet.factionId;
                    const isEnemyTile = tileAtFlare && tileAtFlare.ownerId !== 0 && tileAtFlare.ownerId !== fleet.factionId
                        && this.factionMap.get(tileAtFlare.ownerId)?.team !== this.factionMap.get(fleet.factionId)?.team;

                    // 敌方地块上：信标保持，舰队停留等待占领
                    if (isEnemyTile) {
                        fleetTargetX = fleet.x;
                        fleetTargetY = fleet.y;
                    } else if (!isUncapturedPlanet) {
                        fleet.targetFlare = null;
                        fleet.state = 'exploring';
                        if (this.playerFlare) { this.playerFlare.destroy(); this.playerFlare = null; }
                    }
                }
            } else if (fleet.state === 'retreating') {
                isRetreating = true;
                // === 阶段C：撤退重组 — 到达补给点后等待恢复 ===
                // 优先找最近的兵营，其次是己方连通节点
                let nearestSupply: any = null;
                let minDistToSupply = Infinity;
                this.tilesList.forEach(t => {
                    if (t.type === 'barracks' && t.ownerId === myFac.id) {
                        const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, t.x, t.y);
                        if (d < minDistToSupply) { minDistToSupply = d; nearestSupply = t; }
                    }
                });
                if (!nearestSupply) {
                    this.tilesList.forEach(t => {
                        if (t.ownerId === myFac.id && t.connected && (t.type === 'castle' || t.type === 'planet' || t.type === 'barracks' || t.type === 'pending')) {
                            const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, t.x, t.y);
                            if (d < minDistToSupply) { minDistToSupply = d; nearestSupply = t; }
                        }
                    });
                }
                if (nearestSupply) {
                    fleetTargetX = nearestSupply.x; fleetTargetY = nearestSupply.y;
                    // 已到达补给点 → 标记重组状态，等待恢复
                    if (Phaser.Math.Distance.Between(fleet.x, fleet.y, fleetTargetX, fleetTargetY) < 60) {
                        fleet._regrouping = true;
                        fleetTargetX = fleet.x; fleetTargetY = fleet.y; // 停留恢复
                        // 重组完成（HP>70%且补给>60）→ 重新评估是否出击
                        if (hpPct > 0.7 && currentSupply > 60) {
                            fleet._regrouping = false;
                            fleet.state = 'exploring';
                            fleet.stance = 'search';
                        }
                    }
                } else {
                    fleetTargetX = myFac.castlePos.x; fleetTargetY = myFac.castlePos.y;
                }
                // 撤退中若敌军在射程内，标记接敌以触发拖刀开火（但重组中不主动接敌）
                isEngaging = !!(closestEnemyFleet && minFleetDist < 250 && !fleet._regrouping);
            } else if (fleet.state === 'engaging' && closestEnemyFleet) {
                isEngaging = true;
                if (fleet.stance === 'defend') {
                    fleetTargetX = fleet.x; fleetTargetY = fleet.y;
                } else if (fleet.stance === 'siege') {
                    fleetTargetX = closestEnemyFleet.x; fleetTargetY = closestEnemyFleet.y;
                } else {
                    // === 阶段C：战术AI重构 ===
                    const myPower = this.calculateFleetPower(fleet);
                    const enemyPower = this.calculateFleetPower(closestEnemyFleet);
                    const powerRatio = enemyPower > 0 ? myPower / enemyPower : 999;

                    // --- 1. 距离保持：按舰种确定理想交战距离 ---
                    const idealDist = this.getIdealEngageDist(fleet);

                    // --- 2. 包抄行为：计算敌方朝向，尝试侧后接近 ---
                    const enemyAngle = closestEnemyFleet.facingAngle || 0;
                    // 从敌人背后45°方向接近 = 侧翼包抄
                    const flankAngle = enemyAngle + Math.PI + (Math.random() > 0.5 ? Math.PI/4 : -Math.PI/4);
                    const approachAngle = Math.atan2(closestEnemyFleet.y - fleet.y, closestEnemyFleet.x - fleet.x);
                    // 夹角越小越接近正面，夹角越大越接近侧后
                    const angleDiff = Math.abs(Math.atan2(Math.sin(approachAngle - enemyAngle), Math.cos(approachAngle - enemyAngle)));
                    const isBehind = angleDiff > Math.PI * 0.6; // 在敌人侧后方
                    const isFlanking = angleDiff > Math.PI * 0.3 && angleDiff <= Math.PI * 0.6; // 侧翼

                    // --- 3. 聚焦火力：优先补刀残血，避免3+打1 ---
                    let alliesOnTarget = 0;
                    this.globalFleets.forEach(af => {
                        if (af.factionId !== fleet.factionId) {
                            const afFac = this.factionMap.get(af.factionId);
                            if (afFac && afFac.team === myFac.team && af._lastTargetFleetId === closestEnemyFleet.id) {
                                alliesOnTarget++;
                            }
                        }
                    });

                    // --- 4. 指挥官影响：统帅决定战术风格 ---
                    const cmdStat = myFac.admiralStats?.command || 50;
                    const isAggressive = cmdStat > 80;   // 莱因哈特式：主动包抄
                    const isCautious = cmdStat < 40;     // 低能指挥官：只会正面冲

                    // 决策：选择攻击位置和方式
                    if (isCautious) {
                        // 低统帅：正面直冲，无战术
                        fleetTargetX = closestEnemyFleet.x; fleetTargetY = closestEnemyFleet.y;
                        fleet.formation = 'wedge';
                    } else if (minFleetDist < 60) {
                        // 极近距离：脱离缠斗，拉开到理想距离
                        const escapeAngle = Math.atan2(fleet.y - closestEnemyFleet.y, fleet.x - closestEnemyFleet.x);
                        fleetTargetX = fleet.x + Math.cos(escapeAngle) * idealDist * 0.5;
                        fleetTargetY = fleet.y + Math.sin(escapeAngle) * idealDist * 0.5;
                    } else if (minFleetDist < idealDist * 0.7) {
                        // 已进入缠斗距离：保持当前位置对射，或侧翼机动
                        if (isAggressive && !isBehind) {
                            // 尝试绕到侧后
                            fleetTargetX = closestEnemyFleet.x + Math.cos(flankAngle) * idealDist;
                            fleetTargetY = closestEnemyFleet.y + Math.sin(flankAngle) * idealDist;
                        } else {
                            // 保持当前位置
                            fleetTargetX = fleet.x; fleetTargetY = fleet.y;
                        }
                    } else if (isAggressive && !isBehind && !isFlanking) {
                        // 高统帅+不在侧后 → 尝试包抄
                        fleetTargetX = closestEnemyFleet.x + Math.cos(flankAngle) * idealDist;
                        fleetTargetY = closestEnemyFleet.y + Math.sin(flankAngle) * idealDist;
                    } else {
                        // 标准接近：从当前角度接近到理想距离
                        fleetTargetX = closestEnemyFleet.x - Math.cos(approachAngle) * idealDist;
                        fleetTargetY = closestEnemyFleet.y - Math.sin(approachAngle) * idealDist;
                    }

                    // 阵型选择：根据战场态势和指挥官风格
                    if (alliesOnTarget >= 2) {
                        fleet.formation = 'circle';  // 3+舰队集火 → 包围
                    } else if (isAggressive && powerRatio > 1.3) {
                        fleet.formation = 'wedge';   // 优势+激进 → 楔形突破
                    } else if (powerRatio > 0.8) {
                        fleet.formation = 'line';    // 均势 → 战列对射
                    } else {
                        fleet.formation = 'spindle'; // 劣势 → 纺锤防御
                    }
                }
            }
            
            if (fleet.state === 'exploring') {
                let exploreTarget: any = null;
                let minScore = Infinity;
                
                // 【高阶智能】判断舰队当前的后勤健康度。若补给低于 75%，极度抗拒脱离后勤网深入敌后
                const currentSupply = fleet.units[0]?.supply || 0;
                const needsTethering = currentSupply < 75;

                // 【核心重构】战术姿态决定寻路权重
                // 方向性探索：计算敌方阵地方向，偏好朝敌方推进
                const enemyCastles = this.tilesList.filter(t => t.type === 'castle' 
                    && this.factionMap.get(t.ownerId)?.team !== myFac.team);
                const enemyDirX = enemyCastles.length > 0 
                    ? enemyCastles.reduce((s: number, c: any) => s + c.x, 0) / enemyCastles.length 
                    : myFac.castlePos?.x + 500;
                const enemyDirY = enemyCastles.length > 0
                    ? enemyCastles.reduce((s: number, c: any) => s + c.y, 0) / enemyCastles.length
                    : 0;

                // 【v2 目标去重】收集友军已分配的目标（星球/塔/基地），避免多舰队扑同一目标
                const claimedTargets = new Set<string>();
                this.globalFleets.forEach(af => {
                    if (af.factionId !== fleet.factionId) return;
                    const afFac2 = this.factionMap.get(af.factionId);
                    if (!afFac2 || afFac2.team !== myFac.team || af.id === fleet.id) return;
                    if (af._targetTileKey) claimedTargets.add(af._targetTileKey);
                });

                this.tilesList.forEach(t => {
                    const tOwnerFac = t.ownerId !== 0 ? this.factionMap.get(t.ownerId) : undefined;
                    const isAlly = tOwnerFac && tOwnerFac.team === myFac.team;

                    if (!isAlly && t.type !== 'sea' && t.type !== 'ruined') {
                        const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, t.x, t.y);
                        let score = d;

                        // v2 目标去重：已有友军盯上的目标大幅降权（除非是当前唯一的）
                        const tileKey = `${t.q},${t.r}`;
                        if (claimedTargets.has(tileKey)) score += 2500;

                        // 探索奖励：未探索的格子获得大幅分数奖励，驱动AI主动探图
                        if (!t.explored) score -= 3000;

                        // 方向性探索：朝敌方阵地走加分（远离减分）
                        const distToEnemy = Phaser.Math.Distance.Between(t.x, t.y, enemyDirX, enemyDirY);
                        const distFromMe = Phaser.Math.Distance.Between(fleet.x, fleet.y, enemyDirX, enemyDirY);
                        score += (distToEnemy - distFromMe) * 2; // 接近敌人→负分=偏好

                        if (fleet.stance === 'siege') {
                            // 攻坚：星球和司令部拥有致命吸引力
                            if (t.type === 'planet' || t.type === 'castle') score -= 8000; 
                            else if (t.type === 'barracks' || t.type === 'tower') score -= 3000; 
                            if (t.ownerId !== 0) score -= 1000; 
                        } else if (fleet.stance === 'search') {
                            // 索敌：对敌占区更感兴趣，渴望扫荡边缘
                            if (t.ownerId !== 0) score -= 2000; 
                        } else if (fleet.stance === 'defend') {
                            // 驻守：极大惩罚，禁止乱跑
                            score += 10000; 
                        }

                        // 【补给牵引算法】如果粮草下降，严厉惩罚远离己方连通节点的格子
                        if (needsTethering) {
                            let distToOwnSupply = Infinity;
                            for (const dir of this.directions) {
                                const neighbor = this.tilesDict[`${t.q + dir.q},${t.r + dir.r}`];
                                if (neighbor && neighbor.ownerId === myFac.id && neighbor.connected) {
                                    distToOwnSupply = 0; break; 
                                }
                            }
                            // 如果该目标点不与己方补给网接壤，增加巨额惩罚分数，迫使舰队在补给线尽头驻足等待玩家“喂饭”
                            if (distToOwnSupply > 0) score += 5000; 
                        }
                        
                        if (score < minScore) { minScore = score; exploreTarget = t; }
                    }
                });

                if (fleet.stance === 'search' && closestEnemyFleet) {
                    // 索敌模式专属：只要视野里有敌人舰队，立刻放弃铺地，像疯狗一样咬上去
                    fleetTargetX = closestEnemyFleet.x; fleetTargetY = closestEnemyFleet.y;
                } else if (fleet.stance === 'defend') {
                    // 驻守模式：坚守当前阵地
                    fleetTargetX = fleet.x; fleetTargetY = fleet.y;
                } else if (exploreTarget) {
                    // v2 记录目标归属，供其他友军去重
                    fleet._targetTileKey = `${exploreTarget.q},${exploreTarget.r}`;
                    if (Phaser.Math.Distance.Between(fleet.x, fleet.y, exploreTarget.x, exploreTarget.y) < 25) {
                        fleetTargetX = fleet.x; fleetTargetY = fleet.y;
                    } else {
                        fleetTargetX = exploreTarget.x; fleetTargetY = exploreTarget.y;
                    }
                } else {
                    fleet._targetTileKey = null;
                    fleetTargetX = myFac.castlePos.x; fleetTargetY = myFac.castlePos.y;
                }
            }

            // === 恐慌响应：被看不见的敌人打→必须动 ===
            const hpSinceLastTick = fleet._lastTickHp || totalMaxHp;
            const tookSignificantDmg = hpSinceLastTick - totalHp > totalMaxHp * 0.03;
            if (tookSignificantDmg && !closestEnemyFleet && fleet.state !== 'retreating') {
                const dodgeAngle = Math.atan2(myFac.castlePos.y - fleet.y, myFac.castlePos.x - fleet.x);
                fleetTargetX = fleet.x + Math.cos(dodgeAngle + (Math.random() - 0.5) * 1.5) * 120;
                fleetTargetY = fleet.y + Math.sin(dodgeAngle + (Math.random() - 0.5) * 1.5) * 120;
            }
            fleet._lastTickHp = totalHp;

            const distToTarget = Phaser.Math.Distance.Between(fleet.x, fleet.y, fleetTargetX, fleetTargetY);
            let fAngle = fleet.facingAngle || 0;
            // 移动方向（默认与朝向一致；撤退时分离：移动朝补给点，火炮朝敌军）
            let moveAngle = fAngle;
            
            if (distToTarget > 5) { 
                fAngle = Math.atan2(fleetTargetY - fleet.y, fleetTargetX - fleet.x);
                moveAngle = fAngle;
                // 拖刀战术：撤退时若被追击，火炮朝向敌军但移动方向仍是补给点
                if (isRetreating && isEngaging && closestEnemyFleet) {
                    fAngle = Math.atan2(closestEnemyFleet.y - fleet.y, closestEnemyFleet.x - fleet.x);
                    // moveAngle 保持朝向 fleetTarget (已经在 distToTarget>5 分支设置好)
                }
                fleet.facingAngle = fAngle;
            } else if (isEngaging && closestEnemyFleet) {
                // 已抵达射击位置停船：火炮锁定敌军，移动方向不变
                fAngle = Math.atan2(closestEnemyFleet.y - fleet.y, closestEnemyFleet.x - fleet.x);
                fleet.facingAngle = fAngle;
            }
             
            let repulseX = 0; let repulseY = 0;
            this.globalFleets.forEach(otherFleet => {
                if (fleet.id !== otherFleet.id) {
                    const oFac = this.factionMap.get(otherFleet.factionId);
                    if (oFac && oFac.team === myFac.team) {
                        const fDist = Phaser.Math.Distance.Between(fleet.x, fleet.y, otherFleet.x, otherFleet.y);
                        if (fDist > 0 && fDist < 80) {
                            const repulseAngle = Math.atan2(fleet.y - otherFleet.y, fleet.x - otherFleet.x);
                            const force = (80 - fDist) * 0.02;
                            repulseX += Math.cos(repulseAngle) * force; repulseY += Math.sin(repulseAngle) * force;
                        }
                    }
                }
            });

            const fleetSupplyFactor = (fleet.units[0]?.supply > 30) ? 1.0 : 0.5;
            // 士气衰减 → 机动下降（100→1.0，0→0.7）
            const flMoraleSpd = (fleet.morale === undefined ? 100 : fleet.morale);
            const moraleSpeedMult = 0.7 + 0.3 * (flMoraleSpd / 100);
            const isMeleeStance = isRetreating || fleet.stance === 'siege';
            // 渐变减速：40px内最慢(0.3) → 120px外全速(1.0)，消除速度跳变
            let congestionSlowdown = 1.0;
            if (closestEnemyFleet && !isMeleeStance && minFleetDist < 120) {
                congestionSlowdown = 0.3 + 0.7 * Math.min(1, Math.max(0, (minFleetDist - 40) / 80));
            }
            const retreatSpeedBonus = isRetreating ? 3.0 : 1.0;
            // ── 指挥点修正：速度倍率（speed_boost / 黄金狮子咆哮的移速+30%）──
            const cpSpeedMult = this.cpState ? getSpeedMultiplier(this.cpState, fleet.id, fleet.factionId) : 1.0;
            const fleetBaseSpeed = ((0.30 + (myFac.admiralStats?.mobility || 0) * 0.003) * fleetSupplyFactor * moraleSpeedMult) * retreatSpeedBonus * cpSpeedMult;

            // ── P1 地形效果：当前所在格子的移动修正 ──
            const terrainSpeedMul = this.getTerrainSpeedMul(fleet.x, fleet.y);

            // 计算本帧原始速度向量
            let rawVX = 0, rawVY = 0;
            if (fleet.state === 'assembling' && distToTarget < 15) {
                rawVX = repulseX * dt; rawVY = repulseY * dt;
            } else if (distToTarget < 5) {
                rawVX = repulseX * dt; rawVY = repulseY * dt;
            } else if (isEngaging && distToTarget < 120 && !isRetreating) {
                const engageSpeed = 0.05 * retreatSpeedBonus;
                rawVX = (Math.cos(moveAngle) * engageSpeed + repulseX) * dt * congestionSlowdown;
                rawVY = (Math.sin(moveAngle) * engageSpeed + repulseY) * dt * congestionSlowdown;
            } else if (fleet.stance !== 'defend') {
                rawVX = (Math.cos(moveAngle) * fleetBaseSpeed * terrainSpeedMul + repulseX) * dt * congestionSlowdown;
                rawVY = (Math.sin(moveAngle) * fleetBaseSpeed * terrainSpeedMul + repulseY) * dt * congestionSlowdown;
            }

            // 直接施加速度（无平滑，保证全速移动）
            fleet.x += rawVX;
            fleet.y += rawVY;

            let damageMultiplier = 1.0;
            if (isEngaging && closestEnemyFleet) {
                const mForm = fleet.formation; const eForm = closestEnemyFleet.formation; 
                const beats: Record<string, string> = { 'wedge': 'spindle', 'spindle': 'circle', 'circle': 'square', 'square': 'line', 'line': 'wedge' };
                if (beats[mForm] === eForm) damageMultiplier = 1.3; 
                else if (beats[eForm] === mForm) damageMultiplier = 0.7;
            }

            const positions = fleet.units.map((u: any, index: number) => {
                if (fleet.formation === 'wedge') {
                    // 雁行阵：标准V字队形，旗舰居中，两翼对称展开
                    const coords = [
                        [0, 0],     // 0: 旗舰 (V字顶点)
                        [-1, 1],    // 1: 右翼前锋
                        [-1, -1],   // 2: 左翼前锋
                        [-2, 2],    // 3: 右翼中排
                        [-2, -2],   // 4: 左翼中排
                        [-3, 3],    // 5: 右翼后排
                        [-3, -3],   // 6: 左翼后排
                        [-4, 0]     // 7: 殿后
                    ];
                    return [coords[index]?.[0] || 0, coords[index]?.[1] || 0];
                } else if (index === 0) return [0, 0];

                if (fleet.formation === 'line') {
                    // 单纵阵：一列纵队
                    const col = Math.floor((index + 1) / 2); return [-col, col * (index % 2 === 0 ? -1 : 1) * 0.3];
                } else if (fleet.formation === 'spindle') {
                    // 纺锤阵：紧密菱形
                    const coords = [ [0,0], [1,0], [0,1], [0,-1], [-1,0], [1,1], [1,-1], [-1,1] ];
                    return [coords[index]?.[0] || 0, coords[index]?.[1] || 0];
                } else if (fleet.formation === 'circle') {
                    // 圆阵：均匀环形分布
                    const angle = ((index - 1) / Math.max(1, fleet.units.length - 1)) * Math.PI * 2; return [Math.cos(angle) * 1.8, Math.sin(angle) * 1.8];
                } else if (fleet.formation === 'square') {
                    // 方阵：2x4网格
                    const row = Math.floor((index) / 2); const col = index % 2;
                    return [-row + 1.5, (col - 0.5) * 1.5];
                } else {
                    const coords = [ [0,0], [-1,0], [-2,0], [-3,0], [-1,1], [-2,1], [-3,1], [-4,0] ];
                    return [coords[index]?.[0] || 0, coords[index]?.[1] || 0];
                }
            });

            fleet.units.forEach((u: any, index: number) => {
                const gx = positions[index][0]; const gy = positions[index][1];
                const spacing = 28; // 阵型间距（像素）
                const ox = gx * spacing; const oy = gy * spacing;
                const rx = ox * Math.cos(fAngle) - oy * Math.sin(fAngle);
                const ry = ox * Math.sin(fAngle) + oy * Math.cos(fAngle);

                // 阵型呼吸：停泊时微幅正弦浮动
                const isStopped = distToTarget < 5 || (isEngaging && fleet.stance !== 'siege');
                const breatheX = isStopped ? Math.sin(time * 0.0012 + index * 1.7) * 1.2 : 0;
                const breatheY = isStopped ? Math.cos(time * 0.0015 + index * 1.3) * 1.2 : 0;

                const targetUnitX = fleet.x + rx + breatheX;
                const targetUnitY = fleet.y + ry + breatheY;
                const uDist = Phaser.Math.Distance.Between(u.sprite.x, u.sprite.y, targetUnitX, targetUnitY);

                // 阻尼lerp平滑追踪阵型位（消除弹簧式振荡）
                if (uDist > 2) {
                    const unitLerp = Math.min(0.08, uDist * 0.003); // 距离越远追赶越快，但上限固定
                    u.sprite.x += (targetUnitX - u.sprite.x) * unitLerp;
                    u.sprite.y += (targetUnitY - u.sprite.y) * unitLerp;
                }
                 
                u.sprite.setAlpha(uDist > 150 ? 0.4 : 1.0);
                u.sprite.rotation = fAngle; // 容器整体转向（跟随舰队朝向）

                // 舰头方向补偿：原图舰头朝上(-Y)，容器+X轴对应舰队前进方向
                // 需要将原图顺时针转 90°(π/2)，使舰头从"上"转到"右"(容器前进方向)
                const borderShape = u.sprite.getByName('border') as any;
                if (borderShape) borderShape.rotation = Math.PI / 2;

                // 阴影已移除

                // 距离过远阵型拉扯时，底盘光环变成警告色
                const auraColor = uDist > 150 ? 0x38bdf8 : myFac.color;
                const auraShape = u.sprite.getByName('aura') as any;
                if (auraShape) {
                    auraShape.setFillStyle(auraColor, uDist > 150 ? 0.8 : 0.4);
                    auraShape.rotation = 0; // 光环保持横向
                }

                // 尾焰：仅在移动时显示，带闪烁/脉动效果
                // isMoving 判断与速度挂钩：移动越快尾焰越亮越长
                const isMoving = uDist > 5;
                const flameShape = u.sprite.getByName('flame') as any;
                if (flameShape) {
                    flameShape.setVisible(isMoving);
                    if (isMoving) {
                        const speedFactor = Math.min(1, uDist / 60);
                        const phase = time * 0.018 + index * 0.7;
                        // 增强闪烁幅度，让动画效果明显
                        const flicker = 0.75 + Math.sin(phase * 1.3) * 0.20 + Math.sin(phase * 2.7) * 0.08;
                        flameShape.setAlpha(flicker * (0.85 + speedFactor * 0.15));
                        // 增强脉动幅度
                        const pulseX = 0.85 + Math.sin(phase * 1.7) * 0.12 + speedFactor * 0.08;
                        const pulseY = 0.90 + Math.sin(phase * 2.1) * 0.08 + speedFactor * 0.05;
                        flameShape.scaleX = pulseX;
                        flameShape.scaleY = pulseY;
                    }
                }

                // 确保文字永远保持正向可读，不随舰队一起翻转
                const textObj = u.sprite.getByName('text') as any;
                if (textObj) textObj.rotation = -fAngle;
                if (isEngaging && time - u.lastAtkTime > (u.atkInterval / dt)) {
                    let targetShip: any = null;
                    if (closestEnemyFleet) {
                        // P1 地形：小行星带射程-30%
                        const rangeMul = this.getTerrainRangeMul(fleet.x, fleet.y);
                        const effectiveRange = (u.range + 30) * rangeMul;
                        const inRangeUnits = closestEnemyFleet.units.filter((eu: any) => 
                            Phaser.Math.Distance.Between(u.sprite.x, u.sprite.y, eu.sprite.x, eu.sprite.y) <= effectiveRange
                        );
                        if (inRangeUnits.length > 0) targetShip = inRangeUnits[Math.floor(Math.random() * inRangeUnits.length)];
                    }

                    if (targetShip) {
                        u.lastAtkTime = time;
                        const targetFac = this.factionMap.get(targetShip.factionId);
                        
                        const unitSupplyFactor = u.supply > 30 ? 1.0 : 0.5;
                        // 士气衰减：士气越低伤害越低（100→1.0，0→0.6），与补给衰减叠乘
                        const flMorale1 = (fleet.morale === undefined ? 100 : fleet.morale);
                        const moraleDmgMult = 0.6 + 0.4 * (flMorale1 / 100);
                        const admAtk = myFac.admiralStats?.attack || 0;
                        const tgtDef = targetFac?.admiralStats?.defense || 0;
                        
                        const effectiveDef = targetShip.supply > 0 ? (targetShip.def + Math.floor(tgtDef * 0.1)) : 0;
                        // P1 地形：星云内闪避+20%（减伤）
                        const nebulaDodge = this.getTerrainDodgeMul(closestEnemyFleet.x, closestEnemyFleet.y);
                        let baseDmg = (((u.atk + Math.floor(admAtk * 0.2)) * unitSupplyFactor) - effectiveDef) / nebulaDodge;
                        if (u.classType === '电子' || u.classType === '无') baseDmg = (u.atk + Math.floor(admAtk * 0.1)) * unitSupplyFactor / nebulaDodge;
                        
                        const angleToAttacker = Math.atan2(u.sprite.y - closestEnemyFleet.y, u.sprite.x - closestEnemyFleet.x);
                        let angleDiff = Math.abs(angleToAttacker - closestEnemyFleet.facingAngle);
                        if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
                        
                        let backstabMulti = 1.0;
                        if (angleDiff > Math.PI * 0.75) { 
                            backstabMulti = 1.5;
                            const critText = this.add.text(targetShip.sprite.x, targetShip.sprite.y - 15, 'CRIT!', { fontSize: '10px', color: '#fbbf24', fontStyle: 'bold' }).setOrigin(0.5);
                            this.tweens.add({ targets: critText, y: targetShip.sprite.y - 30, alpha: 0, duration: 800 / dt, onComplete: () => critText.destroy() });
                        }
                        // 隐身奇袭加成：隐身舰队破隐后首次攻击 +30%
                        if ((fleet as any).ambushReady) {
                            (fleet as any).ambushReady = false;
                            backstabMulti *= 1.3;
                            const ambushText = this.add.text(targetShip.sprite.x, targetShip.sprite.y - 25, 'AMBUSH!', { fontSize: '10px', color: '#06b6d4', fontStyle: 'bold' }).setOrigin(0.5).setDepth(50);
                            this.tweens.add({ targets: ambushText, y: targetShip.sprite.y - 40, alpha: 0, duration: 800 / dt, onComplete: () => ambushText.destroy() });
                        }

                        // ── 指挥点修正：伤害倍率（isDefending=驻守姿态时激活护盾分支）──
                        const isFleetDefending = fleet.stance === 'defend';
                        const cpDmgMult = this.cpState ? getDamageMultiplier(this.cpState, fleet.id, isFleetDefending, fleet.factionId) : 1.0;
                        // ── 指挥点修正：士气加成（morale_rally 等 morale 效果 → 每10点士气+3%伤害）──
                        const cpMorale = this.cpState ? getMoraleModifier(this.cpState, fleet.id, fleet.factionId) : 0;
                        const cpMoraleMult = 1.0 + Math.max(0, cpMorale) * 0.003;
                        // P4b 逆境宣言buff：+15%伤害
                        const adversityMult = (fleet._adversityBuffUntil && this.time.now < fleet._adversityBuffUntil) ? 1.15 : 1.0;
                        // P5 决战时刻buff：+20%伤害
                        const finalMult = fleet._finalBattle ? 1.2 : 1.0;
                        let finalDmg = Math.max(1, baseDmg * damageMultiplier * backstabMulti * cpDmgMult * cpMoraleMult * adversityMult * finalMult * moraleDmgMult);
                        // 战损保底：最低造成目标 1% 最大舰数的破甲伤害
                        const minDmg = Math.max(1, Math.floor(targetShip.maxHp * 0.01));
                        finalDmg = Math.max(finalDmg, minDmg);

                        // ── 指挥点修正：受击方护盾减伤 + reflect 反弹 ──
                        // 受击舰队有活跃 shield 效果（紧急抢修/紧急回避等）或处于驻守姿态 → 减伤；
                        // 有 reflect 效果（杨威利魔术的反击）→ 按系数反弹给攻击方
                        const tgtFleet = closestEnemyFleet; // 受击的是敌方舰队
                        if (this.cpState && tgtFleet) {
                            const tgtDefending = tgtFleet.stance === 'defend';
                            const incomingMult = getIncomingMultiplier(this.cpState, tgtFleet.id, tgtDefending);
                            finalDmg = Math.max(1, finalDmg * incomingMult);
                            const reflectRatio = getReflectRatio(this.cpState, tgtFleet.id);
                            if (reflectRatio > 0) {
                                const reflected = finalDmg * reflectRatio;
                                u.hp -= reflected;
                                if (reflected > 1) this.spawnDamageNumber(u.sprite.x, u.sprite.y - 10, reflected, false);
                            }
                        }

                        if (u.classType === '突击') {
                            const fighterCount = 4;
                            const dmgPerFighter = finalDmg / fighterCount;
                            for (let i = 0; i < fighterCount; i++) {
                                const fighter = this.add.triangle(u.sprite.x, u.sprite.y, 0, 3, 5, 1.5, 0, 0, myFac.color).setDepth(20);
                                const tgtX = targetShip.sprite.x + Phaser.Math.Between(-20, 20); const tgtY = targetShip.sprite.y + Phaser.Math.Between(-20, 20);
                                fighter.rotation = Math.atan2(tgtY - u.sprite.y, tgtX - u.sprite.x);

                                this.tweens.add({
                                    targets: fighter, x: tgtX, y: tgtY, duration: (500 + Math.random() * 400) / dt, ease: 'Sine.easeInOut',
                                    onComplete: () => {
                                        fighter.destroy();
                                        const exp = this.add.circle(tgtX, tgtY, 5, 0xffaa00).setDepth(21).setBlendMode(Phaser.BlendModes.ADD);
                                        this.tweens.add({ targets: exp, scale: 1.5, alpha: 0, duration: 200 / dt, onComplete: () => exp.destroy()});
                                        
                                        targetShip.hp -= dmgPerFighter;
                                        if (targetShip.sprite && targetShip.sprite.active) {
                                            targetShip.sprite.setAlpha(0.5);
                                            this.time.delayedCall(50, () => { if (targetShip.sprite && targetShip.sprite.active) targetShip.sprite.setAlpha(1.0); });
                                        }
                                    }
                                });
                            }
                        } else {
                            const dist = Phaser.Math.Distance.Between(u.sprite.x, u.sprite.y, targetShip.sprite.x, targetShip.sprite.y);
                            const fireAngle = Math.atan2(targetShip.sprite.y - u.sprite.y, targetShip.sprite.x - u.sprite.x);
                            
                            // 导弹/鱼雷 → 驱逐和巡洋专属（兼容中英文 classType）
                            const isMissileShip = u.classType === 'destroyer' || u.classType === 'cruiser' 
                                || u.classType === '驱逐' || u.classType === '巡洋';
                            if (isMissileShip) {
                                const burstCount = u.classType === 'destroyer' || u.classType === '驱逐' ? 6 : 4;
                                // 3D 覆盖层：导弹齐射（power>=2 标记导弹视觉）
                                pushFx3d({ kind: 'laser', from: { x: u.sprite.x, y: u.sprite.y }, to: { x: targetShip.sprite.x, y: targetShip.sprite.y }, color: myFac.color, power: burstCount });
                                const totalDur = Math.min(800, dist * 3.0) / dt;
                                const perpBase = fireAngle + Math.PI / 2;
                                const startX = u.sprite.x, startY = u.sprite.y;
                                const tgtX = targetShip.sprite.x, tgtY = targetShip.sprite.y;
                                
                                for (let m = 0; m < burstCount; m++) {
                                    // 宽散射角 + 发射口错位（模拟多联装发射管陆续射出）
                                    const launchAngle = fireAngle + (m - burstCount/2 + 0.5) * 0.15;
                                    const offsetX = Math.cos(perpBase) * (m - burstCount/2) * 3;
                                    const offsetY = Math.sin(perpBase) * (m - burstCount/2) * 3;
                                    
                                    // 小型光点导弹，密集齐射时以蛇形轨迹突进
                                    const missile = this.add.circle(startX + offsetX, startY + offsetY, 1.0, myFac.color)
                                        .setDepth(18).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.0);
                                    
                                    this.time.delayedCall(m * 35 / dt, () => {
                                        if (!missile.active) return;
                                        missile.setAlpha(0.95);
                                        const proxy = { t: 0 };
                                        this.tweens.add({
                                            targets: proxy, t: 1,
                                            duration: totalDur, ease: 'Sine.easeIn',
                                            onUpdate: () => {
                                                if (!missile.active) return;
                                                const p = proxy.t;
                                                const wobbleAmp = (1 - p) * 40 * Math.sin(p * 12 + m * 2.5);
                                                const wobbleMed = (1 - p) * 18 * Math.sin(p * 7 + m * 0.8);
                                                const wobble = wobbleAmp + wobbleMed;
                                                
                                                const cx = (startX + offsetX) + (tgtX - startX - offsetX) * p;
                                                const cy = (startY + offsetY) + (tgtY - startY - offsetY) * p;
                                                missile.x = cx + Math.cos(perpBase) * wobble;
                                                missile.y = cy + Math.sin(perpBase) * wobble;
                                                
                                                // 稀疏尾迹粒子
                                                if (Math.random() < 0.45) {
                                                    const dot = this.add.circle(missile.x, missile.y, 0.5, 0xffffff, 0.4)
                                                        .setDepth(17).setBlendMode(Phaser.BlendModes.ADD);
                                                    this.tweens.add({ targets: dot, alpha: 0, scale: 0.2, duration: 250 / dt, onComplete: () => dot.destroy() });
                                                }
                                            },
                                            onComplete: () => {
                                                missile.destroy();
                                                const exp = this.add.circle(tgtX + Phaser.Math.Between(-4, 4), tgtY + Phaser.Math.Between(-4, 4), 3, 0xffaa00, 0.8)
                                                    .setDepth(21).setBlendMode(Phaser.BlendModes.ADD);
                                                this.tweens.add({ targets: exp, scale: 3.0, alpha: 0, duration: 280 / dt, onComplete: () => exp.destroy()});
                                            }
                                        });
                                    });
                                }
                            } else {
                                // === 战列舰主炮激光（细束，银英风格）===
                                // 外层辉光: 2px 宽，半透明
                                const laser = this.add.rectangle(u.sprite.x, u.sprite.y, dist, 2, myFac.color).setOrigin(0, 0.5).setRotation(fireAngle).setDepth(15).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.7);
                                // 内核: 0.8px 亮白细线
                                const core = this.add.rectangle(u.sprite.x, u.sprite.y, dist, 0.8, 0xffffff).setOrigin(0, 0.5).setRotation(fireAngle).setDepth(16).setAlpha(0.9);
                                this.tweens.add({ targets: [laser, core], alpha: 0, duration: 900 / dt, ease: 'Expo.easeOut', onComplete: () => { laser.destroy(); core.destroy(); } });
                            }

                            targetShip.hp -= finalDmg;
                            // 伤害数字
                            const isCrit = backstabMulti > 1.2;
                            this.spawnDamageNumber(targetShip.sprite.x, targetShip.sprite.y, finalDmg, isCrit);
                            // === 受击后坐力：被命中的舰队轻微后推 ===
                            if (closestEnemyFleet && closestEnemyFleet.units.length > 0) {
                                const knockDir = Math.atan2(closestEnemyFleet.y - u.sprite.y, closestEnemyFleet.x - u.sprite.x);
                                const knockForce = (finalDmg / Math.max(1, targetShip.maxHp)) * 8; // 按伤害比例后推
                                closestEnemyFleet.x += Math.cos(knockDir) * knockForce;
                                closestEnemyFleet.y += Math.sin(knockDir) * knockForce;
                            }
                            if (targetShip.sprite && targetShip.sprite.active) {
                                targetShip.sprite.setAlpha(0.3);
                                this.time.delayedCall(100, () => { if (targetShip.sprite && targetShip.sprite.active) targetShip.sprite.setAlpha(1.0); });
                            }
                            
                            const tFac = this.factionMap.get(targetShip.factionId);
                            const shieldColor = tFac ? tFac.color : 0x06b6d4;
                            const impactAngleRad = Math.atan2(u.sprite.y - targetShip.sprite.y, u.sprite.x - targetShip.sprite.x);
                            const impactAngleDeg = Phaser.Math.RadToDeg(impactAngleRad);
                            // 3D 覆盖层：激光 + 定向护盾涟漪事件（dir=激光传播方向=射手→目标，见 battle3dFx 契约）
                            pushFx3d({ kind: 'laser', from: { x: u.sprite.x, y: u.sprite.y }, to: { x: targetShip.sprite.x, y: targetShip.sprite.y }, color: myFac.color });
                            pushFx3d({ kind: 'shield', at: { x: targetShip.sprite.x, y: targetShip.sprite.y }, dir: { x: -Math.cos(impactAngleRad), y: -Math.sin(impactAngleRad) }, color: shieldColor });

                            const impactX = targetShip.sprite.x + Math.cos(impactAngleRad) * 10;
                            const impactY = targetShip.sprite.y + Math.sin(impactAngleRad) * 10;
                            const impactFlash = this.add.circle(impactX, impactY, 4, 0xffffff, 1).setDepth(21).setBlendMode(Phaser.BlendModes.ADD);

                            // 【球形护盾涟漪】
                            const gfx = this.add.graphics().setDepth(20);
                            const rippleState: any = { rx: 14, ry: 8, span: 0.45, alpha: 1 };
                            const drawShieldArc = () => {
                                gfx.clear();
                                if (rippleState.alpha <= 0) return;
                                const a1 = impactAngleRad - rippleState.span;
                                const a2 = impactAngleRad + rippleState.span;
                                gfx.lineStyle(Math.max(0.4, 2 * rippleState.alpha), shieldColor, rippleState.alpha);
                                gfx.beginPath();
                                for (let s = 0; s <= 24; s++) {
                                    const t = a1 + (a2 - a1) * (s / 24);
                                    const px = targetShip.sprite.x + rippleState.rx * Math.cos(t);
                                    const py = targetShip.sprite.y + rippleState.ry * Math.sin(t);
                                    s === 0 ? gfx.moveTo(px, py) : gfx.lineTo(px, py);
                                }
                                gfx.strokePath();
                            };
                            drawShieldArc();

                            this.tweens.add({ targets: impactFlash, scale: 0.1, alpha: 0, duration: 200 / dt, ease: 'Cubic.easeOut', onComplete: () => impactFlash.destroy() });
                            this.tweens.add({
                                targets: rippleState, rx: 32, ry: 18, span: Math.PI * 0.6, alpha: 0,
                                duration: 1100 / dt, ease: 'Sine.easeOut',
                                onUpdate: drawShieldArc,
                                onComplete: () => gfx.destroy()
                            });
                        }
                    } 
                    else if (closestEnemyTile && Phaser.Math.Distance.Between(u.sprite.x, u.sprite.y, closestEnemyTile.x, closestEnemyTile.y) <= u.range + (u.classType==='战列' || u.classType==='突击' || u.classType==='无' ? 0 : 8)) {
                         u.lastAtkTime = time;
                         const admAtk = myFac.admiralStats?.attack || 0;
                         const unitSupplyFactor = u.supply > 30 ? 1.0 : 0.5;
                         // 士气衰减（同上）
                         const flMorale2 = (fleet.morale === undefined ? 100 : fleet.morale);
                         const moraleDmgMult = 0.6 + 0.4 * (flMorale2 / 100);
                         
                         const dist = Phaser.Math.Distance.Between(u.sprite.x, u.sprite.y, closestEnemyTile.x, closestEnemyTile.y);
                         const fireAngle = Math.atan2(closestEnemyTile.y - u.sprite.y, closestEnemyTile.x - u.sprite.x);
                         const tileLaser = this.add.rectangle(u.sprite.x, u.sprite.y, dist, 3, myFac.color).setOrigin(0, 0.5).setRotation(fireAngle).setDepth(15).setBlendMode(Phaser.BlendModes.ADD);
                         const tileCore = this.add.rectangle(u.sprite.x, u.sprite.y, dist, 1, 0xffffff).setOrigin(0, 0.5).setRotation(fireAngle).setDepth(16);
                         this.tweens.add({ targets: [tileLaser, tileCore], alpha: 0, duration: 300 / dt, ease: 'Expo.easeOut', onComplete: () => { tileLaser.destroy(); tileCore.destroy(); } });
                         // 3D 覆盖层：对地激光 + 命中闪光
                         pushFx3d({ kind: 'laser', from: { x: u.sprite.x, y: u.sprite.y }, to: { x: closestEnemyTile.x, y: closestEnemyTile.y }, color: myFac.color });
                         pushFx3d({ kind: 'hit', at: { x: closestEnemyTile.x, y: closestEnemyTile.y }, color: myFac.color });

                         closestEnemyTile.hp -= ((u.atk + Math.floor(admAtk * 0.2)) * unitSupplyFactor);
                         
                         if (closestEnemyTile.hp <= 0) { 
                             const oldOwnerFac = this.factionMap.get(closestEnemyTile.ownerId);
                             if (oldOwnerFac) {
                                 if (closestEnemyTile.type === 'barracks') { oldOwnerFac.buildCounts.barracks = Math.max(0, oldOwnerFac.buildCounts.barracks - 1); oldOwnerFac.goldRate -= 1; }
                                 else if (closestEnemyTile.type === 'gold_mine') { oldOwnerFac.buildCounts.mines = Math.max(0, oldOwnerFac.buildCounts.mines - 1); oldOwnerFac.goldRate -= 4; }
                                 else if (closestEnemyTile.type === 'tower') { oldOwnerFac.buildCounts.towers = Math.max(0, oldOwnerFac.buildCounts.towers - 1); oldOwnerFac.goldRate -= 1; }
                                 else if (closestEnemyTile.type === 'planet') { oldOwnerFac.goldRate -= 15; }
                             }

                             if (closestEnemyTile.type === 'castle') {                              
                                 const targetFac = this.factionMap.get(closestEnemyTile.ownerId);
                                 if (targetFac && targetFac.active) {
                                     targetFac.goldRate = Math.max(0, targetFac.goldRate - 20);
                                     this.tilesList.filter((tx: any) => tx.ownerId === targetFac.id).forEach((tx: any) => {
                                         tx.ownerId = 0; tx.type = 'pending'; tx.connected = false;
                                         tx.sprite.setFillStyle(0x2d3446, 0.9); tx.sprite.setStrokeStyle(2, 0x475569, 1);
                                         tx.text.setText('').setAlpha(0);
                                     });
                                 }
                             } else {
                                 closestEnemyTile.ownerId = u.factionId;
                                 closestEnemyTile.sprite.setFillStyle(myFac.color, 0.9);
                                 closestEnemyTile.sprite.setStrokeStyle(3, myFac.color, 1.0);
                                 
                                 if (closestEnemyTile.type === 'pier') { closestEnemyTile.hp = 250; }
                                 else if (closestEnemyTile.type === 'planet') { closestEnemyTile.hp = 1000; }
                                 else { 
                                     closestEnemyTile.type = 'pending'; closestEnemyTile.hp = 150; closestEnemyTile.cost = 50; 
                                     closestEnemyTile.text.setText('').setAlpha(0); 
                                 }
                             }
                         }
                    }
                }
            });
        });

        // ===== 航母舰载机系统：突击型舰船环绕母舰的护卫机群 =====
        this.globalFleets.forEach(fleet => {
            if (fleet.units.length === 0) return;
            fleet.units.forEach((u: any) => {
                if (u.classType !== '突击' && u.classType !== 'CV') return;
                // 每架母舰最多 6 架舰载机
                let fighters = this.carrierFighters.get(fleet.id);
                if (!fighters) {
                    fighters = [];
                    for (let i = 0; i < 6; i++) {
                        const fDot = this.add.circle(u.sprite.x, u.sprite.y, 1.5, 0x06b6d4).setDepth(7).setBlendMode(Phaser.BlendModes.ADD);
                        fighters!.push(fDot);
                    }
                    this.carrierFighters.set(fleet.id, fighters);
                }
                const mx = u.sprite.x; const my = u.sprite.y;
                fighters.forEach((fDot, i) => {
                    const orbitAngle = time * 0.002 + (i / fighters!.length) * Math.PI * 2;
                    const orbitR = 18 + Math.sin(time * 0.003 + i) * 3;
                    fDot.x = mx + Math.cos(orbitAngle) * orbitR;
                    fDot.y = my + Math.sin(orbitAngle) * orbitR;
                    fDot.setAlpha(0.5 + Math.sin(time * 0.005 + i) * 0.3);
                });
            });
        });

        // 清理已死亡航母的舰载机
        for (const [fleetId, fighters] of this.carrierFighters.entries()) {
            const fleet = this.globalFleets.find(fl => fl.id === fleetId);
            const hasCV = fleet && fleet.units.some((u: any) => u.classType === '突击' || u.classType === 'CV');
            if (!hasCV) {
                fighters.forEach(f => f.destroy());
                this.carrierFighters.delete(fleetId);
            }
        }

        const uiData: any[] = [];
        const cam = this.cameras.main;
        const playerFac = this.store.factions.find((f: any) => f.type === 'player');
        
        // 【修复】视野共享：将所有友军阵营（与玩家同Team）纳入视野贡献节点
        const allyFactions = this.store.factions.filter((f: any) => f.team === playerFac?.team);
        const allyFactionIds = allyFactions.map((f: any) => f.id);
        const allyFleets = this.globalFleets.filter(fl => allyFactionIds.includes(fl.factionId));
        const allyVisionNodes = this.tilesList.filter(t => allyFactionIds.includes(t.ownerId) && (t.type === 'castle' || t.type === 'tower' || t.type === 'planet'));

        // 1. 初始化各阵营的实时统计数据与视野状态
        this.store.factions.forEach((f: any) => { 
            f.inVision = (f.type === 'player'); 
            f.unitCount = 0;
            f.hp = 0;
            f.maxHp = 0;
        });

        this.globalFleets.forEach(fl => {
            if (fl.units.length > 0) {
                const flagship = fl.units[0]; 
                const fac = this.factionMap.get(fl.factionId);
                
                if (fac) {
                    // 实时累加该阵营当前的建制数与绝对血量
                    fac.unitCount += fl.units.length;
                    fl.units.forEach((u: any) => { fac.hp += u.hp; fac.maxHp += u.maxHp; });
                }

                // 2. 战争迷雾：敌方舰队默认隐藏，除非进入玩家视野
                let isVisible = true;
                if (fac && fac.team !== playerFac?.team) {
                    isVisible = false;
                    // 修复坐标：必须使用战舰 sprite 的绝对坐标计算视距
                    const fx = flagship.sprite.x;
                    const fy = flagship.sprite.y;

                    // 判断是否在友军高价值建筑视野内 (雷达半径 300)
                    for (const node of allyVisionNodes) {
                        if (Phaser.Math.Distance.Between(fx, fy, node.x, node.y) < 300) { isVisible = true; break; }
                    }
                    // 判断是否在友军舰队视野内 (普通视野 250，索敌姿态视野 450)
                    if (!isVisible) {
                        for (const pFl of allyFleets) {
                            if (pFl.units.length > 0) {
                                const px = pFl.units[0].sprite.x;
                                const py = pFl.units[0].sprite.y;
                                const visionRange = pFl.stance === 'search' ? 450 : 250;
                                if (Phaser.Math.Distance.Between(fx, fy, px, py) < visionRange) { isVisible = true; break; }
                            }
                        }
                    }
                }
                
                // 2.5 隐身检测：隐身舰队被敌方索敌单位发现 → 破隐
                if (fl.stance === 'stealth') {
                    let stealthBroken = false;
                    const enemyFleets = this.globalFleets.filter(
                        ef => ef.factionId !== fl.factionId && ef.stance === 'search' && ef.units.length > 0
                    );
                    for (const ef of enemyFleets) {
                        const ex = ef.units[0].sprite.x;
                        const ey = ef.units[0].sprite.y;
                        const detectRange = 450;
                        if (Phaser.Math.Distance.Between(flagship.sprite.x, flagship.sprite.y, ex, ey) < detectRange) {
                            stealthBroken = true;
                            break;
                        }
                    }
                    if (stealthBroken) {
                        fl.stance = 'search';
                        fl.formation = 'spindle';
                        (fl as any).ambushReady = true;
                        this.store.triggerToast?.('敌踪暴露！隐身舰队被发现，转入索敌状态。');
                    }
                    // 隐身中可视化：己方半透明，敌方不可见
                    if (fac && fac.team === playerFac?.team) {
                        fl.units.forEach((u: any) => u.sprite.setAlpha(0.25));
                    } else if (!isVisible) {
                        fl.units.forEach((u: any) => u.sprite.setVisible(false));
                    }
                }
                
                // 3. 根据视野状态处理模型隐身与 UI 渲染
                if (fac && isVisible) {
                    fl.units.forEach((u: any) => { u.sprite.setVisible(true); });
                    if (fac.type !== 'player') fac.inVision = true;

                    const screenX = (flagship.sprite.x - cam.worldView.x) * cam.zoom;
                    const screenY = (flagship.sprite.y - cam.worldView.y) * cam.zoom;
                    uiData.push({
                        id: fl.id, x: screenX, y: screenY, name: fac.name, imageId: fac.imageId,
                        hp: flagship.hp, maxHp: flagship.maxHp, unitCount: fl.units.length,
                        supply: flagship.supply, team: fac.team, stance: fl.stance
                    });
                } else if (fac && fac.team !== playerFac?.team) {
                    fl.units.forEach((u: any) => { 
                        u.sprite.setVisible(false); 
                        // 强制隐藏挂载的血条或文本对象
                        if (u.hpBar) u.hpBar.setVisible(false);
                        if (u.text) u.text.setVisible(false);
                        // 如果游戏底层是全局统一 Graphics 绘制血条，需在此处将其 scale 或 alpha 设为 0
                    });
                }
            }
        });

        // 4. 将阵营绝对血量转换为 Vue 顶部 UI 进度条所需的百分比
        this.store.factions.forEach((f: any) => {
            if (f.maxHp > 0) { f.hp = (f.hp / f.maxHp) * 100; }
            else { f.hp = 0; }
        });
        
        this.store.fleetsUI = uiData;

        // CRT模式：将迷雾计算的可见性存入标记，然后强制隐藏所有实体sprite
        // redrawCRTFleets 使用 _fogVisible 标记判断是否绘制线框舰队
        if (this.mapStyle === 'crt') {
            this.globalFleets.forEach(fl => {
                if (fl.units.length > 0) {
                    fl._fogVisible = fl.units[0].sprite?.visible ?? false;
                }
                fl.units.forEach((u: any) => {
                    if (u.sprite) u.sprite.setVisible(false);
                });
            });
        }

        // 实时覆盖地块迷雾：不在玩家视野内的地块统一涂暗
        // CRT模式：使用CRT兼容alpha值而非完全跳过
        this.tilesList.forEach(t => {
            let tileVisible = false;
            for (const node of allyVisionNodes) {
                if (Phaser.Math.Distance.Between(t.x, t.y, node.x, node.y) < 350) { tileVisible = true; break; }
            }
            if (!tileVisible) {
                for (const pFl of allyFleets) {
                    if (pFl.units.length > 0) {
                        const px = pFl.units[0].sprite.x; const py = pFl.units[0].sprite.y;
                        const vRange = pFl.stance === 'search' ? 450 : 250;
                        if (Phaser.Math.Distance.Between(t.x, t.y, px, py) < vRange) { tileVisible = true; break; }
                    }
                }
            }

            if (tileVisible) t.explored = true;
            const isCRT = this.mapStyle === 'crt';

            if (!t.explored) {
                t.sprite.setFillStyle(0x0f172a, isCRT ? 0.01 : 1.0);
                t.sprite.setStrokeStyle(1, 0x0f172a, isCRT ? 0.01 : 1);
                if (t.text) t.text.setAlpha(0);
            } else {
                let fillColor = 0x2d3446; let strokeColor = 0x475569; let sWidth = 1;
                const ownerFac = t.ownerId !== 0 ? this.factionMap.get(t.ownerId) : undefined;
                if (ownerFac) { fillColor = ownerFac.color; strokeColor = ownerFac.color; sWidth = 2; }
                else if (t.type === 'sea') { fillColor = 0x1e3a8a; strokeColor = 0x2563eb; }
                else if (t.type === 'ruined') { fillColor = 0x1c1917; strokeColor = 0x44403c; }
                else if (t.type === 'pier') { fillColor = 0x0284c7; strokeColor = 0x0ea5e9; }
                else if (t.type === 'planet') { fillColor = 0x92400e; strokeColor = 0xf59e0b; }
                else if (t.type === 'fortress') { fillColor = 0x3a3a4a; strokeColor = 0x8a8a9a; sWidth = 2; }
                else if (t.type === 'mine') { fillColor = 0x8B6914; strokeColor = 0xd4a017; }
                else if (t.type === 'tower') { fillColor = 0x4a3a6a; strokeColor = 0x9a7acc; sWidth = 2; }

                // CRT兼容alpha映射：对象alpha和填充alpha需要同步，避免乘法吞噬
                const crtAlpha = (a: number) => isCRT ? a * 0.4 : a;

                if (!tileVisible) {
                    t.sprite.setAlpha(isCRT ? 0.22 : 1.0);
                    t.sprite.setFillStyle(fillColor, isCRT ? 1.0 : 0.4);
                    t.sprite.setStrokeStyle(sWidth, strokeColor, isCRT ? 0.5 : 0.4);
                    if (!isCRT && t.text) t.text.setAlpha(0.25);
                } else {
                    if (t.ownerId !== 0 && !t.connected && t.type !== 'castle' && t.type !== 'planet') {
                        t.sprite.setAlpha(isCRT ? 0.3 : 1.0);
                        t.sprite.setFillStyle(fillColor, isCRT ? 1.0 : 0.3);
                        t.sprite.setStrokeStyle(2, 0xff0000, isCRT ? 0.7 : 0.7);
                    } else {
                        const baseAlpha = isCRT ? (t.ownerId !== 0 ? 0.35 : 0.01) : 0.9;
                        t.sprite.setAlpha(baseAlpha);
                        t.sprite.setFillStyle(fillColor, 1.0);
                        t.sprite.setStrokeStyle(sWidth, strokeColor, isCRT ? 0.6 : 1.0);
                    }

                    if (!isCRT && t.text) {
                        const txtAlpha = (t.type === 'sea' || t.type === 'ruined' || t.type === 'pending') ? 0.0 : 0.8;
                        t.text.setAlpha(t.type === 'castle' ? 1.0 : txtAlpha);
                    }
                }
            }
        });

        // 接壤高亮：CRT和hex模式均需运行
        if (pFac) {
            this.tilesList.forEach(t => {
                if (t.ownerId === 0 && t.type !== 'sea' && t.type !== 'ruined' && t.type !== 'planet') {
                    if (this.isAdjacentToTeam(t, pFac.team) && pFac.gold >= t.cost) {
                        const glowAlpha = 0.2 + 0.3 * Math.abs(Math.sin(time * 0.002));
                        if (this.mapStyle === 'crt') {
                            t.sprite.setAlpha(glowAlpha);
                            t.sprite.setStrokeStyle(1.5, 0x0ea5e9, glowAlpha * 1.5);
                        } else {
                            t.sprite.setStrokeStyle(2, 0x0ea5e9, glowAlpha);
                        }
                    } else if (this.mapStyle === 'crt') {
                        t.sprite.setAlpha(0.01);
                    }
                }
            });
        }

        // 要塞武器更新
        const state = (this.store as any).tacticalState;
        const isCampaign = state && state.mode === 'campaign';
        if (isCampaign && this.fortressWeapon && !this.fortressWeapon.destroyed) {
            this.updateFortressWeapon(this.game.loop.delta);
        }

        this.checkGameEnd();
    
    }

    // 渲染漫画风对话气泡（固定于头像框右侧）
    private showFleetDialogue(fleet: any, eventType: string, isDefeat: boolean = false) {
        const myFac = this.factionMap.get(fleet.factionId);
        if (!myFac) return;
        if (myFac.team !== 1 && !myFac.inVision) return;

        const admName = myFac.name.replace('舰队', ''); 
        let pool = battleDialogues[admName]?.[eventType] || battleDialogues['general']?.[eventType];
        if (!pool || pool.length === 0) return;

        const text = pool[Math.floor(Math.random() * pool.length)];
        const targetShip = isDefeat ? null : fleet.units[0];
        
        const cam = this.cameras.main;
        const targetZoom = 1 / cam.zoom; // 目标 UI 缩放级
        
        // 初始坐标（若是击毁状态则固定在原地）
        const px = isDefeat ? fleet.x + (90 * targetZoom) : targetShip?.sprite?.x;
        const py = isDefeat ? fleet.y - (40 * targetZoom) : targetShip?.sprite?.y;
        if (px === undefined || py === undefined) return;

        const bubble = this.add.container(px, py).setDepth(100); // 调高层级避免被挡
        const bg = this.add.graphics();
        
        const bgColor = 0x0f172a; 
        bg.fillStyle(bgColor, 0.95).lineStyle(2, myFac.color, 1);
        
        const txt = this.add.text(0, 0, text, {
            fontSize: '12px', color: '#f8fafc', padding: { x: 10, y: 6 },
            wordWrap: { width: 140 }, align: 'center', fontFamily: 'sans-serif', fontStyle: 'bold'
        }).setOrigin(0.5);

        const bW = txt.width + 16; const bH = txt.height + 12;
        
        // 绘制带圆角的气泡主体
        bg.fillRoundedRect(-bW/2, -bH/2, bW, bH, 6).strokeRoundedRect(-bW/2, -bH/2, bW, bH, 6);
        
        // 绘制指向左侧（头像框方向）的对话尾巴
        bg.fillTriangle(-bW/2, 0, -bW/2 - 12, 6, -bW/2, 12);
        bg.strokeTriangle(-bW/2, 0, -bW/2 - 12, 6, -bW/2, 12);
        // 擦除连接处的线条
        bg.lineStyle(3, bgColor, 1).beginPath().moveTo(-bW/2, 1).lineTo(-bW/2, 11).strokePath();
        
        bubble.add([bg, txt]);

        if (!isDefeat && targetShip) {
            bubble.setData('targetShip', targetShip);
            this.activeDialogues.push(bubble);
        } else if (isDefeat) {
            bubble.setScale(targetZoom);
        }

        bubble.setScale(0);
        this.tweens.add({
            targets: bubble, scale: targetZoom, duration: 300, ease: 'Back.easeOut', // 弹到 UI 对应的大小
            onComplete: () => {
                this.tweens.add({
                    targets: bubble, alpha: 0, delay: 2500, duration: 400,
                    onComplete: () => {
                        bubble.destroy();
                        this.activeDialogues = this.activeDialogues.filter(b => b !== bubble);
                    }
                });
            }
        });
    }

    // ===== 伊谢尔伦要塞武器系统 =====
    private updateFortressWeapon(deltaMs: number) {
        if (!this.fortressWeapon || this.fortressWeapon.destroyed) return;
        const fw = this.fortressWeapon;

        // 显示 HP 条（受损时）
        if (fw.fortressHp < fw.fortressMaxHp) {
            fw.hpBarBg.setVisible(true);
            fw.hpBarFill.setVisible(true);
            const pct = Math.max(0, fw.fortressHp / fw.fortressMaxHp);
            fw.hpBarFill.width = 80 * pct;
        }

        // 速度因子
        const speedFactor = (this.store.currentSpeedFactor?.value ?? this.store.currentSpeedFactor) ?? 1;
        fw.chargeTimer += deltaMs * speedFactor;

        // 首次发射前等待 firstFireDelay，后续等 chargeInterval
        const threshold = fw.chargeTimer < fw.firstFireDelay ? fw.firstFireDelay : fw.chargeInterval;
        // 修正：如果已经超过首次，用 interval 判断
        const totalTimer = fw.chargeTimer;
        const shouldFire = totalTimer >= fw.firstFireDelay && (totalTimer - fw.firstFireDelay) % fw.chargeInterval < deltaMs * speedFactor + 1;

        // 更简单：用离散计数
        if (fw.chargeTimer >= fw.firstFireDelay && !fw.isCharging) {
            // 检查是否到了发射周期（首次或每 interval）
            const elapsedSinceFirst = fw.chargeTimer - fw.firstFireDelay;
            if (elapsedSinceFirst < deltaMs * speedFactor + 1 || (elapsedSinceFirst > 0 && elapsedSinceFirst % fw.chargeInterval < deltaMs * speedFactor + 1)) {
                fw.isCharging = true;
                this.startFortressCharge();
            }
        }
    }

    private startFortressCharge() {
        const fw = this.fortressWeapon!;
        const chargeDuration = 5000; // 5秒充能
        // === 充能 VFX：三层效果 ===
        // 1. 核心聚能光球（快速膨胀 + 脉冲）
        const corePulse = this.add.circle(fw.fortressX, fw.fortressY, 5, 0x60a5fa, 0.4)
            .setDepth(49).setBlendMode(Phaser.BlendModes.ADD);
        // 2. 外围能量环（缓慢扩大）
        const outerRing = this.add.circle(fw.fortressX, fw.fortressY, 10, 0x000000, 0)
            .setDepth(48);
        outerRing.setStrokeStyle(2, 0x3b82f6, 0.6);
        // 3. 粒子向内汇聚
        const particles: Phaser.GameObjects.Arc[] = [];
        for (let i = 0; i < 8; i++) {
            const pAngle = (Math.PI * 2 * i) / 8;
            const pDist = 40 + Math.random() * 30;
            const p = this.add.circle(
                fw.fortressX + Math.cos(pAngle) * pDist,
                fw.fortressY + Math.sin(pAngle) * pDist,
                2, 0x93c5fd, 0.7
            ).setDepth(49).setBlendMode(Phaser.BlendModes.ADD);
            particles.push(p);
        }

        this.tweens.addCounter({
            from: 0, to: 1, duration: chargeDuration,
            ease: 'Quad.easeIn',
            onUpdate: (tween: Phaser.Tweens.Tween) => {
                const p = tween.getValue() ?? 0;
                // 核心脉冲：呼吸效果
                const pulse = 1 + Math.sin(p * 12) * 0.2;
                const coreRadius = 5 + p * 35 * pulse;
                corePulse.setRadius(coreRadius);
                corePulse.setAlpha(0.3 + p * 0.5);
                corePulse.setFillStyle(p > 0.7 ? 0xfbbf24 : 0x60a5fa, corePulse.alpha);

                // 外环扩大
                const ringRadius = 10 + p * 80;
                outerRing.setRadius(ringRadius);
                outerRing.setStrokeStyle(2 + p * 1.5, p > 0.6 ? 0xfbbf24 : 0x3b82f6, 0.3 + p * 0.5);

                // 粒子向内移动
                particles.forEach((pt, idx) => {
                    const baseAngle = (Math.PI * 2 * idx) / particles.length;
                    const curDist = 60 - p * 50; // 从60缩减到10
                    pt.x = fw.fortressX + Math.cos(baseAngle) * curDist;
                    pt.y = fw.fortressY + Math.sin(baseAngle) * curDist;
                    pt.setScale(1 + p * 1.5);
                    pt.setAlpha(p > 0.8 ? 0.9 : 0.4 + p * 0.5);
                });
            },
            onComplete: () => {
                corePulse.destroy(); outerRing.destroy();
                particles.forEach(pt => pt.destroy());
                // 充能完毕瞬间：要塞位置剧烈白光
                const chargeFlash = this.add.circle(fw.fortressX, fw.fortressY, 60, 0xffffff, 0.9)
                    .setDepth(55).setBlendMode(Phaser.BlendModes.ADD);
                this.tweens.add({
                    targets: chargeFlash, scale: 3, alpha: 0,
                    duration: 300, ease: 'Quad.easeOut',
                    onComplete: () => chargeFlash.destroy(),
                });
                this.fireFortressLaser();
                fw.isCharging = false;
                fw.chargeTimer = fw.firstFireDelay;
            },
        });
    }

    private fireFortressLaser() {
        const fw = this.fortressWeapon!;
        const target = this.selectFortressTarget();
        if (!target) return;

        const fx = fw.fortressX, fy = fw.fortressY;
        const tx = target.x, ty = target.y;
        const angle = Math.atan2(ty - fy, tx - fx);
        const dist = Math.sqrt((tx - fx) ** 2 + (ty - fy) ** 2);

        // === 屏幕震动：发射瞬间强烈震感 ===
        this.cameras.main.shake(600, 0.025);

        // === 全屏白闪：立即猛烈变白，然后缓慢消退 ===
        const flash = this.add.rectangle(
            this.cameras.main.worldView.centerX, this.cameras.main.worldView.centerY,
            this.cameras.main.width / this.cameras.main.zoom * 2,
            this.cameras.main.height / this.cameras.main.zoom * 2,
            0xffffff, 0.8
        ).setDepth(60).setScrollFactor(0);
        this.tweens.add({
            targets: flash, alpha: 0,
            duration: 600, ease: 'Cubic.easeOut',
            onComplete: () => flash.destroy(),
        });

        // === 多层同心光束（从粗到细、从外到内）===
        const createBeamLayer = (width: number, color: number, alpha: number, fadeDuration: number, delay: number) => {
            const beam = this.add.graphics().setDepth(50);
            beam.lineStyle(width, color, alpha);
            beam.lineBetween(fx, fy, tx, ty);
            // 光束两端加圆帽
            beam.fillStyle(color, alpha * 0.5);
            beam.fillCircle(fx, fy, width / 2);
            beam.fillCircle(tx, ty, width / 2);
            // 光晕：沿光束铺一层半透明粗线
            beam.lineStyle(width * 2.5, color, alpha * 0.15);
            beam.lineBetween(fx, fy, tx, ty);
            this.tweens.add({
                targets: beam, alpha: 0,
                duration: fadeDuration, delay: delay,
                ease: 'Cubic.easeIn',
                onComplete: () => beam.destroy(),
            });
            return beam;
        };

        // 外层光晕：极粗，橘红色，缓慢消散
        createBeamLayer(70, 0xf97316, 0.7, 2500, 0);
        // 中层光束：金色，中等粗细
        createBeamLayer(32, 0xfbbf24, 0.85, 1800, 100);
        // 内层核心：白热色，最亮
        createBeamLayer(14, 0xffffff, 0.95, 1200, 200);
        // 极细激光轨：纯白，先闪现再消失
        const tracer = this.add.graphics().setDepth(51);
        tracer.lineStyle(3, 0xffffff, 1);
        tracer.lineBetween(fx, fy, tx, ty);
        this.tweens.add({
            targets: tracer, alpha: 0,
            duration: 400, delay: 50,
            onComplete: () => tracer.destroy(),
        });

        // === 光束 "迸发" 动效 ===
        // 一束极宽的能量柱从要塞向前推进
        const burst = this.add.graphics().setDepth(52);
        const burstLength = Math.min(200, dist * 0.3);
        const burstEndX = fx + Math.cos(angle) * burstLength;
        const burstEndY = fy + Math.sin(angle) * burstLength;
        burst.fillStyle(0xffffff, 0.9);
        burst.fillCircle(burstEndX, burstEndY, 40);
        burst.fillStyle(0xfbbf24, 0.6);
        burst.fillCircle(burstEndX, burstEndY, 60);
        this.tweens.add({
            targets: burst, alpha: 0,
            duration: 350, delay: 50,
            ease: 'Quad.easeOut',
            onComplete: () => burst.destroy(),
        });

        // === 命中爆炸：多层冲击波 ===
        // 核心爆心
        const coreBoom = this.add.circle(tx, ty, 20, 0xffffff, 1)
            .setDepth(53).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: coreBoom, scale: 4, alpha: 0, duration: 1200, ease: 'Cubic.easeOut', onComplete: () => coreBoom.destroy() });

        // 冲击波圆环（第一道）
        for (let i = 1; i <= 3; i++) {
            const ring = this.add.circle(tx, ty, 30, 0x000000, 0) // 透明填充
                .setDepth(52);
            ring.setStrokeStyle(3 + i, i === 1 ? 0xfbbf24 : i === 2 ? 0xf97316 : 0xef4444, 0.8);
            this.tweens.add({
                targets: ring, scale: i + 2, alpha: 0,
                duration: 600 + i * 400, delay: i * 150, ease: 'Quad.easeOut',
                onComplete: () => ring.destroy(),
            });
        }

        // 碎片粒子飞散
        for (let i = 0; i < 12; i++) {
            const particleAngle = (Math.PI * 2 * i) / 12;
            const particle = this.add.rectangle(
                tx, ty, 3 + Math.random() * 3, 8 + Math.random() * 6,
                Math.random() > 0.5 ? 0xfbbf24 : 0xef4444, 0.9
            ).setDepth(53).setRotation(particleAngle);
            const speed = 80 + Math.random() * 120;
            this.tweens.add({
                targets: particle,
                x: tx + Math.cos(particleAngle) * speed,
                y: ty + Math.sin(particleAngle) * speed,
                alpha: 0, scale: 0.2,
                duration: 400 + Math.random() * 600,
                ease: 'Quad.easeOut',
                onComplete: () => particle.destroy(),
            });
        }

        // === 范围伤害（半径 2 格 = 2 * hexRadius 像素）===
        const damageRadius = this.hexRadius * 2;
        this.globalFleets.forEach(fl => {
            fl.units.forEach((u: any) => {
                if (u.hp <= 0) return;
                const dx = u.sprite.x - tx;
                const dy = u.sprite.y - ty;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist <= damageRadius) {
                    u.hp -= 1500;
                    if (u.sprite) {
                        const origAlpha = u.sprite.alpha;
                        u.sprite.setAlpha(0.3);
                        this.time.delayedCall(200, () => { if (u.sprite) u.sprite.setAlpha(origAlpha); });
                    }
                    if (u.hp <= 0) {
                        u.hp = 0;
                        if (u.sprite) {
                            const deathExp = this.add.circle(u.sprite.x, u.sprite.y, 15, 0xef4444, 0.7).setDepth(40);
                            this.tweens.add({ targets: deathExp, scale: 2, alpha: 0, duration: 500, onComplete: () => deathExp.destroy() });
                            u.sprite.setVisible(false);
                        }
                    }
                }
            });
        });
    }

    private selectFortressTarget(): { x: number, y: number } | null {
        const fw = this.fortressWeapon!;
        const enemyUnits: { x: number; y: number; hp: number }[] = [];
        const friendlyUnits: { x: number; y: number }[] = [];

        this.globalFleets.forEach(fl => {
            fl.units.forEach((u: any) => {
                if (u.hp <= 0 || !u.sprite) return;
                const pos = { x: u.sprite.x, y: u.sprite.y, hp: u.hp };
                if (fl.factionId === fw.ownerFactionId) friendlyUnits.push(pos);
                else enemyUnits.push(pos);
            });
        });
        if (enemyUnits.length === 0) return null;

        // 筛出有效目标：在射程内 + 在要塞正前方（右侧，x > fortressX）
        // 雷神之锤固定向左→右开火（回廊方向），只打要塞东侧的敌军
        const validTargets = enemyUnits.filter(e => {
            const dx = e.x - fw.fortressX;
            const dy = e.y - fw.fortressY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            return dist <= fw.maxRange && e.x > fw.fortressX;
        });
        if (validTargets.length === 0) return null;

        // 按密度评分选最佳目标（HP 加权集群）
        const scanRadius = this.hexRadius * 2;
        const friendlyPenaltyRadius = this.hexRadius * 3;
        const BEAM_AVOID_WIDTH = 50; // 光束避让宽度，友军在此范围内则不射击

        let bestScore = -Infinity;
        let bestTarget: { x: number; y: number } | null = null;

        validTargets.forEach(enemy => {
            let score = 0;
            // 敌方密度加分
            enemyUnits.forEach(other => {
                const d = Math.sqrt((other.x - enemy.x) ** 2 + (other.y - enemy.y) ** 2);
                if (d <= scanRadius) score += other.hp * 0.01;
            });

            // 友方惩罚
            friendlyUnits.forEach(friend => {
                const d = Math.sqrt((friend.x - enemy.x) ** 2 + (friend.y - enemy.y) ** 2);
                if (d <= friendlyPenaltyRadius) score -= 0.5;
            });

            // 核心检查：光束是否穿过友军？
            // 从要塞到目标的线段，检查是否有友军单位在 BEAM_AVOID_WIDTH 范围内
            const beamBlocked = friendlyUnits.some(friend => {
                return this.pointToSegmentDist(
                    friend.x, friend.y,
                    fw.fortressX, fw.fortressY,
                    enemy.x, enemy.y
                ) < BEAM_AVOID_WIDTH;
            });
            // 友军在光束路径上 → 大幅降分，基本不选
            if (beamBlocked) score -= 50;

            if (score > bestScore) {
                bestScore = score;
                bestTarget = enemy;
            }
        });

        // 若最佳目标仍有友军在光路上 → 本轮不发射
        if (bestTarget) {
            const blocked = friendlyUnits.some(friend =>
                this.pointToSegmentDist(friend.x, friend.y, fw.fortressX, fw.fortressY, bestTarget!.x, bestTarget!.y) < BEAM_AVOID_WIDTH
            );
            if (blocked) return null;
        }
        return bestTarget;
    }

    /** 点到线段的最短距离（用于光路友军检测） */
    private pointToSegmentDist_(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
        const dx = x2 - x1, dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const nearX = x1 + t * dx, nearY = y1 + t * dy;
        return Math.sqrt((px - nearX) ** 2 + (py - nearY) ** 2);
    }
    private pointToSegmentDist = this.pointToSegmentDist_;

    private checkGameEnd() {
        if (this.store.gameOver) return;

        // 防御：战斗尚未初始化（舰队还没部署完）
        if (this.globalFleets.length === 0) return;

        // 1. 统计当前存活的阵营
        let aliveFactions = new Set<number>();
        this.globalFleets.forEach(fl => {
            if (fl.units.some((u: any) => u.hp > 0)) aliveFactions.add(fl.factionId);
        });

        const state = (this.store as any).tacticalState;
        const isCampaign = state && state.mode === 'campaign';

        // =======================================================
        // 轨道 A：大地图战役模式的独有结算（微观战损 -> 宏观回写）
        // =======================================================
        if (isCampaign) {
            if (aliveFactions.size <= 1) {
                this.store.gameOver = true;
                const winnerId = aliveFactions.size === 1 ? Array.from(aliveFactions)[0] : 0;
                
                // 战后清点：收集存活兵力并反推舰船数量
                const survivors: any[] = [];
                this.globalFleets.forEach(fl => {
                    const remainingSlots: any[] = [];
                    fl.units.forEach((u: any) => {
                        if (u.hp > 0) {
                            // 规模换算系数的反向推导
                            const baseHp = u.classType === 'battleship' ? 2000 : (u.classType === 'cruiser' ? 1200 : 800);
                            const count = Math.ceil((u.hp / baseHp) * 500); 
                            
                            remainingSlots.push({
                                x: u.gridX, // 注意：前面让你在 spawnStrategicFleets 里存的 gridX 和 gridY
                                y: u.gridY,
                                type: u.classType,
                                count: count
                            });
                        }
                    });
                    survivors.push({ fleetId: fl.id, remainingSlots });
                });

                // 呼叫 Store 战略中枢进行宏观回写
                if (typeof this.store.resolveCampaignBattle === 'function') {
                    this.store.resolveCampaignBattle(winnerId, survivors);
                }
                
                // 彻底卸载战术物理引擎，平滑切回大地图
                this.scene.stop();
                return;
            }
        } 
        // =======================================================
        // 轨道 B：演习小游戏模式的结算逻辑 (保留原版 UI 弹窗)
        // =======================================================
        else {
            if (aliveFactions.size <= 1) {
                this.store.gameOver = true;
                const playerFac = this.store.factions.find((f: any) => f.type === 'player');
                this.store.isWin = playerFac ? aliveFactions.has(playerFac.id) : false;

                // 如果是战败，走原有逻辑
                if (!this.store.isWin) {
                    this.store.winStatus = 'defeat';
                } else {
                    // ── P3 战损结算：胜利奖励按战损率加权 ──
                    // 战损率 = 本场玩家损失舰数 / (损失 + 存活)；完胜上浮50%，惨胜下浮30%
                    const playerFleet = this.globalFleets.find(fl => fl.factionId === playerFac?.id);
                    const survivingShips = playerFleet ? playerFleet.units.length : 0;
                    const totalCommitted = survivingShips + this.battleLosses.ships;
                    const lossRate = totalCommitted > 0 ? this.battleLosses.ships / totalCommitted : 0;
                    const baseGold = this.store.rewardGold || 350;
                    if (lossRate < 0.1 && this.battleLosses.ships === 0) {
                        // 完胜：一舰未失
                        this.store.rewardGold = Math.round(baseGold * 1.5);
                        (this.store as any).triggerToast?.('完胜！舰队无一损失，军费奖励上浮50%。');
                    } else if (lossRate > 0.5) {
                        // 惨胜：过半战舰有去无回
                        this.store.rewardGold = Math.max(10, Math.round(baseGold * 0.7));
                        (this.store as any).triggerToast?.(`因舰队损失惨重（${this.battleLosses.ships} 艘），军费奖励削减30%。`);
                    }
                    if ((this.store as any).addBattleLog) {
                        (this.store as any).addBattleLog({ text: `战损结算：损失 ${this.battleLosses.ships} 舰 · 抚恤 ₮${Math.round(this.battleLosses.pension / 10000)}万 · 战损率 ${(lossRate * 100).toFixed(0)}%`, type: 'battle' });
                    }
                }
            }
        }
    }

    // ===== CRT 全息战术投影渲染（委托到 crt/CrtRenderer.ts）=====

    private drawCRTBackground() { drawCRTBackground(this.cameras.main, this.crtGraphics); }

    private renderCRTWireframeMap(mapDataMatrix: any[]) {
        const ctx: CrtContext = { hexRadius: this.hexRadius, factionMap: this.factionMap, store: this.store };
        renderCRTWireframeMap(this.crtWireframe, mapDataMatrix, ctx);
    }

    private updateCRTEffects(time: number) {
        updateCRTEffects(this, time, this.crtGlowTime, this.crtFleetRedrawTimer,
            this.crtOverlay, this.store, this.tilesList, this.factionMap,
            this.globalFleets, this.mapStyle, () => this.redrawCRTFleets());
    }

    private redrawCRTFleets() {
        redrawCRTFleets(this.crtFleets, this.crtGlowTime, this.store, this.globalFleets);
    }

    private drawCRTOverlays() {
        const cam = this.cameras.main;
        const g = this.crtOverlay;
        const zoom = cam.zoom;
        const vw = (cam.width || 1200) / zoom;
        const vh = (cam.height || 800) / zoom;
        const cx = cam.scrollX + vw / 2, cy = cam.scrollY + vh / 2;
        const left = cx - vw / 2, right = cx + vw / 2, top = cy - vh / 2, bottom = cy + vh / 2;
        const m = 12, cl = 22;

        g.lineStyle(2.5, CRT_ACCENT, 0.65);
        g.lineBetween(left + m, top + m + cl, left + m, top + m);
        g.lineBetween(left + m, top + m, left + m + cl, top + m);
        g.lineBetween(right - m, top + m + cl, right - m, top + m);
        g.lineBetween(right - m, top + m, right - m - cl, top + m);
        g.lineBetween(left + m, bottom - m - cl, left + m, bottom - m);
        g.lineBetween(left + m, bottom - m, left + m + cl, bottom - m);
        g.lineBetween(right - m, bottom - m - cl, right - m, bottom - m);
        g.lineBetween(right - m, bottom - m, right - m - cl, bottom - m);

        if (!this.crtHudLabel) {
            this.crtHudLabel = this.add.text(0, 0, `TACTICAL DISPLAY // ${this.mapStyle.toUpperCase()} MODE`, {
                fontSize: '9px', fontFamily: 'monospace', color: '#00cc66',
            }).setDepth(101).setAlpha(0.6);
        }
        this.crtHudLabel.setPosition(left + m + 8, top + m + 6);
    }
}

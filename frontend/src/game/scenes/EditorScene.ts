import * as Phaser from 'phaser';
import { useGameStore } from '../../store/gameStore';

export class EditorScene extends Phaser.Scene {
    private store: any;
    private hexRadius: number = 24;
    private brushColors: Record<string, number> = {
        pending: 0x334155,
        sea: 0x1e3a8a,
        ruined: 0x1c1917,
        pier: 0x0284c7,
        castle: 0x00ffff,
        planet: 0xfbbf24
    };
    private hexPolygons: Phaser.GameObjects.Polygon[] = [];

    constructor() {
        super({ key: 'EditorScene' });
    }

    create() {
        this.store = useGameStore();
        this.cameras.main.centerOn(0, 0);
        this.cameras.main.setZoom(0.8);

        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (pointer.isDown) {
                this.cameras.main.scrollX -= (pointer.x - pointer.prevPosition.x) / this.cameras.main.zoom;
                this.cameras.main.scrollY -= (pointer.y - pointer.prevPosition.y) / this.cameras.main.zoom;
            }
        });

        this.input.on('wheel', (pointer: any, gameObjects: any, deltaX: number, deltaY: number) => {
            this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom - deltaY * 0.001, 0.3, 2.0));
        });

        this.renderMap();
    }

    // 暴露给 Vue 调用的重绘方法（用于撤销/重做或新建地图时）
    public renderMap() {
        this.hexPolygons.forEach(p => p.destroy());
        this.hexPolygons = [];

        this.store.editorTilesData.forEach((node: any) => {
            const px = this.hexRadius * (Math.sqrt(3) * node.q + Math.sqrt(3) / 2 * node.r);
            const py = this.hexRadius * (3 / 2 * node.r);
            const points: number[] = [];

            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 180) * (60 * i - 30);
                points.push(px + this.hexRadius * Math.cos(angle));
                points.push(py + this.hexRadius * Math.sin(angle));
            }

            const poly = this.add.polygon(0, 0, points, this.brushColors[node.type] || 0x334155).setAlpha(0.9);
            poly.setStrokeStyle(2, 0x475569, 1.0);
            poly.setOrigin(0).setInteractive(new Phaser.Geom.Polygon(points), Phaser.Geom.Polygon.Contains);

            poly.on('pointerup', (pointer: Phaser.Input.Pointer) => {
                if (pointer.getDistance() > 15) return;
                node.type = this.store.currentBrush;
                poly.setFillStyle(this.brushColors[this.store.currentBrush]);
                
                // 触发 Store 记录历史状态
                this.store.editorHistory.push(JSON.stringify(this.store.editorTilesData));
            });

            this.hexPolygons.push(poly);
        });
    }
}
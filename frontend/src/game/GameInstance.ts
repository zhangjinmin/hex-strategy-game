import * as Phaser from 'phaser';
import { BattleScene } from './scenes/BattleScene';

let game: Phaser.Game | null = null;

export const mountGame = (containerId: string) => {
    if (game) {
        console.warn(`[GameInstance.mountGame] Phaser already mounted, skipping.`);
        return;
    }
    
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`[GameInstance.mountGame] Container #${containerId} not found in DOM. Phaser cannot mount.`);
        return;
    }
    if (container.clientWidth === 0 || container.clientHeight === 0) {
        console.error(`[GameInstance.mountGame] Container #${containerId} has 0 dimensions: ${container.clientWidth}x${container.clientHeight}. Phaser may fail to render.`);
        return;
    }
    console.log(`[GameInstance.mountGame] Mounting Phaser to #${containerId} (${container.clientWidth}x${container.clientHeight})`);
    
    try {
        game = new Phaser.Game({
            type: Phaser.AUTO,
            parent: containerId,
            backgroundColor: 'transparent',
            transparent: true,
            scale: {
                mode: Phaser.Scale.RESIZE,
                width: '100%',
                height: '100%'
            },
            scene: [BattleScene]
        });
        console.log(`[GameInstance.mountGame] Phaser game instance created successfully.`);
    } catch (err) {
        console.error(`[GameInstance.mountGame] Failed to create Phaser.Game:`, err);
        game = null;
    }
};

export const unmountGame = () => {
    if (game) {
        console.log(`[GameInstance.unmountGame] Destroying Phaser instance.`);
        game.destroy(true);
        game = null;
    }
};

export const getGameInstance = () => game;

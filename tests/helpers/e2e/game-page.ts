/**
 * Consolidated game page helpers for E2E tests
 * Combines and improves upon existing game-interactions.ts and threejs-helpers.ts
 */

import { Page, Locator, ElementHandle } from '@playwright/test';
import type { Vector3 } from '@/core';

export interface GamePageHelpers {
  // === Board Interaction ===
  clickGridNode(x: number, y: number, z: number): Promise<void>;
  placePiece(position: Vector3): Promise<void>;
  rotateBoard(deltaX: number, deltaY: number): Promise<void>;
  zoomBoard(delta: number): Promise<void>;
  panBoard(deltaX: number, deltaY: number): Promise<void>;
  
  // === Validation ===
  hasPieceAt(position: Vector3): Promise<boolean>;
  validatePieceAt(position: Vector3, expectedColor: 'black' | 'white'): Promise<void>;
  isNodeHighlighted(position: Vector3): Promise<boolean>;
  getVisiblePieces(): Promise<Array<{ position: Vector3; color: 'black' | 'white'; isTemporary?: boolean }>>;
  waitForPieceAt(position: Vector3, timeout?: number): Promise<void>;
  
  // === UI Interaction ===
  clickButton(labelOrId: string): Promise<void>;
  openMenu(): Promise<void>;
  isModalVisible(title?: string): Promise<boolean>;
  closeModal(): Promise<void>;
  waitForModal(title: string, timeout?: number): Promise<void>;
  
  // === Game State ===
  getCurrentPlayer(): Promise<'black' | 'white'>;
  getMoveCount(): Promise<number>;
  getBoard(): Promise<{ pieces: Array<{ position: Vector3; color: 'black' | 'white' }> }>;
  getCaptureCount(): Promise<{ black: number; white: number }>;
  isGameOver(): Promise<boolean>;
  getWinner(): Promise<'black' | 'white' | null>;
  
  // === Game Actions ===
  undoMove(): Promise<void>;
  redoMove(): Promise<void>;
  resetGame(): Promise<void>;
  
  // === Camera ===
  getCameraState(): Promise<{
    position: Vector3;
    target: Vector3;
    distance: number;
    azimuth: number;
    polar: number;
  }>;
  resetCamera(): Promise<void>;
  
  // === Three.js Helpers ===
  waitForSceneReady(timeout?: number): Promise<void>;
  getCanvas(): Promise<ElementHandle>;
  isWebGLSupported(): Promise<boolean>;
  getRendererInfo(): Promise<{
    vendor: string;
    renderer: string;
    memory: { geometries: number; textures: number };
  }>;
  
  // === Network Game ===
  hostGame(): Promise<string>;
  joinGame(code: string): Promise<void>;
  getNetworkStatus(): Promise<'connected' | 'disconnected' | 'connecting' | 'error'>;
  getGameCode(): Promise<string | null>;
  isHost(): Promise<boolean>;
}

/**
 * Create game page helpers for E2E testing
 */
export function createGamePage(page: Page): GamePageHelpers {
  // Helper to ensure modals are closed before interactions
  async function ensureNoBlockingUI(): Promise<void> {
    // Close any visible modals
    const modal = page.locator('.modal:visible');
    if (await modal.count() > 0) {
      const closeButton = page.locator('.modal button:has-text("Close"), .modal button:has-text("×")');
      if (await closeButton.count() > 0) {
        await closeButton.first().click();
        await page.waitForTimeout(200);
      }
    }
    
    // Close any conflict notifications
    const conflictNotification = page.locator('.conflict-notification.visible');
    if (await conflictNotification.count() > 0) {
      const conflictClose = page.locator('.conflict-close');
      if (await conflictClose.count() > 0) {
        await conflictClose.click();
        await page.waitForTimeout(200);
      }
    }
  }

  // Helper to convert Vector3 to screen coordinates
  async function worldToScreen(position: Vector3): Promise<{ x: number; y: number }> {
    return await page.evaluate((pos) => {
      const renderer = (window as any).renderer;
      if (!renderer) throw new Error('Renderer not found');
      
      const camera = renderer.getCamera();
      const canvas = document.querySelector('canvas');
      if (!canvas) throw new Error('Canvas not found');
      
      // Manual projection
      const viewMatrix = camera.matrixWorldInverse.elements;
      const projMatrix = camera.projectionMatrix.elements;
      
      // Transform to view space
      const vx = pos.x * viewMatrix[0] + pos.y * viewMatrix[4] + pos.z * viewMatrix[8] + viewMatrix[12];
      const vy = pos.x * viewMatrix[1] + pos.y * viewMatrix[5] + pos.z * viewMatrix[9] + viewMatrix[13];
      const vz = pos.x * viewMatrix[2] + pos.y * viewMatrix[6] + pos.z * viewMatrix[10] + viewMatrix[14];
      const vw = pos.x * viewMatrix[3] + pos.y * viewMatrix[7] + pos.z * viewMatrix[11] + viewMatrix[15];
      
      // Transform to clip space
      const cx = vx * projMatrix[0] + vy * projMatrix[4] + vz * projMatrix[8] + vw * projMatrix[12];
      const cy = vx * projMatrix[1] + vy * projMatrix[5] + vz * projMatrix[9] + vw * projMatrix[13];
      const cw = vx * projMatrix[3] + vy * projMatrix[7] + vz * projMatrix[11] + vw * projMatrix[15];
      
      // Convert to screen coordinates
      const ndcX = cx / cw;
      const ndcY = cy / cw;
      
      return {
        x: (ndcX + 1) * canvas.width / 2,
        y: (1 - ndcY) * canvas.height / 2
      };
    }, position);
  }

  const helpers: GamePageHelpers = {
    // === Board Interaction ===
    async clickGridNode(x: number, y: number, z: number): Promise<void> {
      await helpers.placePiece({ x, y, z });
    },

    async placePiece(position: Vector3): Promise<void> {
      await ensureNoBlockingUI();
      
      const canvas = await helpers.getCanvas();
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Canvas not found');

      // Get screen coordinates for the position
      const screenPos = await worldToScreen(position);
      const targetX = box.x + screenPos.x;
      const targetY = box.y + screenPos.y;

      // Smooth mouse movement
      await page.mouse.move(targetX, targetY, { steps: 5 });
      await page.waitForTimeout(100);
      
      // Click
      await page.mouse.click(targetX, targetY);
      await page.waitForTimeout(200);
    },

    async rotateBoard(deltaX: number, deltaY: number): Promise<void> {
      const canvas = await helpers.getCanvas();
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Canvas not found');
      
      const startX = box.x + box.width * 0.6;
      const startY = box.y + box.height * 0.5;
      
      await page.mouse.move(startX, startY, { steps: 5 });
      await page.mouse.down();
      await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(100);
    },

    async zoomBoard(delta: number): Promise<void> {
      const canvas = await helpers.getCanvas();
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Canvas not found');
      
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      
      await page.mouse.move(centerX, centerY);
      await page.mouse.wheel(0, -delta); // Invert for intuitive zoom
      await page.waitForTimeout(200);
    },

    async panBoard(deltaX: number, deltaY: number): Promise<void> {
      const canvas = await helpers.getCanvas();
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Canvas not found');
      
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      
      await page.mouse.move(startX, startY);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 10 });
      await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(100);
    },

    // === Validation ===
    async hasPieceAt(position: Vector3): Promise<boolean> {
      return await page.evaluate((pos) => {
        const game = (window as any).game;
        const board = game.getBoard();
        return board.getPieceAt(pos) !== null;
      }, position);
    },

    async validatePieceAt(position: Vector3, expectedColor: 'black' | 'white'): Promise<void> {
      const piece = await page.evaluate((pos) => {
        const game = (window as any).game;
        const board = game.getBoard();
        const p = board.getPieceAt(pos);
        return p ? { color: p.player.color, isTemporary: p.isTemporary } : null;
      }, position);
      
      if (!piece) {
        throw new Error(`No piece found at position (${position.x}, ${position.y}, ${position.z})`);
      }
      
      if (piece.color !== expectedColor) {
        throw new Error(`Expected ${expectedColor} piece at (${position.x}, ${position.y}, ${position.z}), but found ${piece.color}`);
      }
    },

    async isNodeHighlighted(position: Vector3): Promise<boolean> {
      return await page.evaluate((pos) => {
        const renderer = (window as any).renderer;
        const scene = renderer.getScene();
        
        let targetNode: any = null;
        scene.traverse((child: any) => {
          if (child.userData?.type === 'intersection' && 
              child.userData?.position?.x === pos.x &&
              child.userData?.position?.y === pos.y &&
              child.userData?.position?.z === pos.z) {
            targetNode = child;
          }
        });
        
        if (!targetNode) return false;
        
        // Check various highlight indicators
        return targetNode.scale.x > 1.01 || 
               (targetNode.material?.emissive?.r > 0);
      }, position);
    },

    async getVisiblePieces(): Promise<Array<{ position: Vector3; color: 'black' | 'white'; isTemporary?: boolean }>> {
      return await page.evaluate(() => {
        const game = (window as any).game;
        const board = game.getBoard();
        const pieces = board.getAllPieces();
        
        return pieces.map((piece: any) => ({
          position: piece.coords,
          color: piece.player.color,
          isTemporary: piece.isTemporary || false
        }));
      });
    },

    async waitForPieceAt(position: Vector3, timeout = 5000): Promise<void> {
      await page.waitForFunction(
        (pos) => {
          const game = (window as any).game;
          const board = game.getBoard();
          return board.getPieceAt(pos) !== null;
        },
        position,
        { timeout }
      );
    },

    // === UI Interaction ===
    async clickButton(labelOrId: string): Promise<void> {
      // Try by label first
      let button = page.locator(`button:has-text("${labelOrId}")`);
      if (await button.count() === 0) {
        // Try by ID
        button = page.locator(`#${labelOrId}`);
      }
      
      await button.waitFor({ state: 'visible' });
      await button.hover();
      await page.waitForTimeout(50);
      await button.click();
    },

    async openMenu(): Promise<void> {
      await helpers.clickButton('Menu');
    },

    async isModalVisible(title?: string): Promise<boolean> {
      if (title) {
        const modal = page.locator(`.modal:has(h2:has-text("${title}"))`);
        return await modal.isVisible();
      } else {
        const modal = page.locator('.modal');
        return await modal.isVisible();
      }
    },

    async closeModal(): Promise<void> {
      const closeButton = page.locator('.modal button:has-text("Close"), .modal button:has-text("×"), .modal .close-button');
      if (await closeButton.isVisible()) {
        await closeButton.click();
      } else {
        await page.keyboard.press('Escape');
      }
      await page.waitForTimeout(200);
    },

    async waitForModal(title: string, timeout = 5000): Promise<void> {
      const modal = page.locator(`.modal:has(h2:has-text("${title}"))`);
      await modal.waitFor({ state: 'visible', timeout });
    },

    // === Game State ===
    async getCurrentPlayer(): Promise<'black' | 'white'> {
      return await page.evaluate(() => {
        const game = (window as any).game;
        return game.getCurrentPlayer().color;
      });
    },

    async getMoveCount(): Promise<number> {
      return await page.evaluate(() => {
        const game = (window as any).game;
        return game.getMoveCount();
      });
    },

    async getBoard(): Promise<{ pieces: Array<{ position: Vector3; color: 'black' | 'white' }> }> {
      return await page.evaluate(() => {
        const game = (window as any).game;
        const board = game.getBoard();
        const pieces = board.getAllPieces();
        
        return {
          pieces: pieces.map((p: any) => ({
            position: p.coords,
            color: p.player.color
          }))
        };
      });
    },

    async getCaptureCount(): Promise<{ black: number; white: number }> {
      return await page.evaluate(() => {
        const game = (window as any).game;
        const state = game.getCurrentState();
        const blackPlayer = state.getPlayerByColor('black');
        const whitePlayer = state.getPlayerByColor('white');
        
        return {
          black: blackPlayer.captures,
          white: whitePlayer.captures
        };
      });
    },

    async isGameOver(): Promise<boolean> {
      return await page.evaluate(() => {
        const game = (window as any).game;
        return game.isGameOver();
      });
    },

    async getWinner(): Promise<'black' | 'white' | null> {
      return await page.evaluate(() => {
        const game = (window as any).game;
        return game.getWinner();
      });
    },

    // === Game Actions ===
    async undoMove(): Promise<void> {
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(200);
    },

    async redoMove(): Promise<void> {
      await page.keyboard.press('Control+y');
      await page.waitForTimeout(200);
    },

    async resetGame(): Promise<void> {
      await helpers.openMenu();
      await helpers.clickButton('New Game');
      await page.waitForTimeout(300);
    },

    // === Camera ===
    async getCameraState(): Promise<{
      position: Vector3;
      target: Vector3;
      distance: number;
      azimuth: number;
      polar: number;
    }> {
      return await page.evaluate(() => {
        const renderer = (window as any).renderer;
        const camera = renderer.getCamera();
        const controls = renderer.getControls();
        
        return {
          position: {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z
          },
          target: {
            x: controls.target.x,
            y: controls.target.y,
            z: controls.target.z
          },
          distance: camera.position.length(),
          azimuth: controls.getAzimuthalAngle(),
          polar: controls.getPolarAngle()
        };
      });
    },

    async resetCamera(): Promise<void> {
      await page.keyboard.press('r');
      await page.waitForTimeout(300);
    },

    // === Three.js Helpers ===
    async waitForSceneReady(timeout = 10000): Promise<void> {
      // Wait for Three.js
      await page.waitForFunction(
        () => window.THREE !== undefined,
        { timeout }
      );

      // Wait for renderer
      await page.waitForFunction(
        () => {
          const renderer = (window as any).renderer;
          const canvas = document.querySelector('canvas');
          return renderer && canvas && canvas.width > 0 && canvas.height > 0;
        },
        { timeout }
      );

      // Wait for first render
      await page.waitForTimeout(100);
    },

    async getCanvas(): Promise<ElementHandle> {
      const canvas = await page.waitForSelector('#game-canvas', { timeout: 5000 });
      if (!canvas) {
        throw new Error('Canvas element not found');
      }
      return canvas;
    },

    async isWebGLSupported(): Promise<boolean> {
      return await page.evaluate(() => {
        try {
          const canvas = document.createElement('canvas');
          const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
          return !!gl;
        } catch (e) {
          return false;
        }
      });
    },

    async getRendererInfo(): Promise<{
      vendor: string;
      renderer: string;
      memory: { geometries: number; textures: number };
    }> {
      return await page.evaluate(() => {
        const renderer = (window as any).renderer;
        if (!renderer) throw new Error('Renderer not found');
        
        const gl = renderer.getRenderer().getContext();
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        
        return {
          vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'Unknown',
          renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'Unknown',
          memory: renderer.getRenderer().info.memory
        };
      });
    },

    // === Network Game ===
    async hostGame(): Promise<string> {
      await helpers.openMenu();
      await helpers.clickButton('Host Game');
      await helpers.waitForModal('Host Network Game');
      
      // Get the game code
      const gameCode = await page.evaluate(() => {
        const codeElement = document.querySelector('.game-code-display');
        return codeElement?.textContent || '';
      });
      
      return gameCode;
    },

    async joinGame(code: string): Promise<void> {
      await helpers.openMenu();
      await helpers.clickButton('Join Game');
      await helpers.waitForModal('Join Network Game');
      
      const input = page.locator('input[placeholder*="game code"]');
      await input.fill(code);
      await helpers.clickButton('Connect');
      
      // Wait for connection
      await page.waitForFunction(
        () => {
          const networkManager = (window as any).networkManager;
          return networkManager?.getStatus() === 'connected';
        },
        { timeout: 10000 }
      );
    },

    async getNetworkStatus(): Promise<'connected' | 'disconnected' | 'connecting' | 'error'> {
      return await page.evaluate(() => {
        const networkManager = (window as any).networkManager;
        return networkManager?.getStatus() || 'disconnected';
      });
    },

    async getGameCode(): Promise<string | null> {
      return await page.evaluate(() => {
        const networkManager = (window as any).networkManager;
        return networkManager?.getConnectionInfo()?.gameCode || null;
      });
    },

    async isHost(): Promise<boolean> {
      return await page.evaluate(() => {
        const networkManager = (window as any).networkManager;
        return networkManager?.getConnectionInfo()?.isHost || false;
      });
    }
  };

  return helpers;
}
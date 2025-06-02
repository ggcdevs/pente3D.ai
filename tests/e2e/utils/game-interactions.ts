import { Page, Locator } from '@playwright/test';

export interface GameTestHelpers {
  /**
   * Click on a grid intersection node at the specified board coordinates
   * Simulates real user interaction: move mouse to node, hover, then click
   */
  clickGridNode(x: number, y: number, z: number): Promise<void>;
  
  /**
   * Click a button by its label text
   */
  clickButtonWithLabel(label: string): Promise<void>;
  
  /**
   * Click the menu button (wrapper around clickButtonWithLabel)
   */
  clickMenuButton(): Promise<void>;
  
  /**
   * Get the current game state including piece positions
   */
  getGameState(): Promise<GameState>;
  
  /**
   * Wait for a piece to be placed at the specified position
   */
  waitForPieceAt(x: number, y: number, z: number, timeout?: number): Promise<void>;
  
  /**
   * Get all visible pieces on the board
   */
  getVisiblePieces(): Promise<PieceInfo[]>;
  
  /**
   * Rotate the board by dragging
   */
  rotateBoard(deltaX: number, deltaY: number): Promise<void>;
  
  /**
   * Zoom the board using mouse wheel
   */
  zoomBoard(delta: number): Promise<void>;
}

export interface GameState {
  pieceCount: number;
  currentPlayer: 'black' | 'white';
  moveCount: number;
  pieces: PieceInfo[];
}

export interface PieceInfo {
  position: { x: number; y: number; z: number };
  color: 'black' | 'white';
  isTemporary?: boolean;
}

export function createGameHelpers(page: Page): GameTestHelpers {
  return {
    async clickGridNode(x: number, y: number, z: number): Promise<void> {
      // First, we need to find the screen position of this node
      const screenPos = await page.evaluate(({ x, y, z }) => {
        const renderer = (window as any).renderer;
        const camera = renderer.getCamera();
        const scene = renderer.getScene();
        
        // Find the intersection node at this position
        let targetNode: any = null;
        scene.traverse((child: any) => {
          if (child.userData?.type === 'intersection' && 
              child.userData?.position?.x === x &&
              child.userData?.position?.y === y &&
              child.userData?.position?.z === z) {
            targetNode = child;
          }
        });
        
        if (!targetNode) {
          throw new Error(`No intersection node found at position (${x}, ${y}, ${z})`);
        }
        
        // Convert 3D position to screen coordinates using Three.js internals
        const canvas = document.querySelector('canvas');
        if (!canvas) throw new Error('Canvas not found');
        
        // Get the world position of the node
        const worldPos = {
          x: targetNode.matrixWorld.elements[12],
          y: targetNode.matrixWorld.elements[13],
          z: targetNode.matrixWorld.elements[14]
        };
        
        // Project to camera space (simplified projection)
        // This is a rough approximation - might need refinement
        const cameraMatrix = camera.matrixWorldInverse;
        const projMatrix = camera.projectionMatrix;
        
        // Transform to camera space
        const camX = worldPos.x * cameraMatrix.elements[0] + worldPos.y * cameraMatrix.elements[4] + worldPos.z * cameraMatrix.elements[8] + cameraMatrix.elements[12];
        const camY = worldPos.x * cameraMatrix.elements[1] + worldPos.y * cameraMatrix.elements[5] + worldPos.z * cameraMatrix.elements[9] + cameraMatrix.elements[13];
        const camZ = worldPos.x * cameraMatrix.elements[2] + worldPos.y * cameraMatrix.elements[6] + worldPos.z * cameraMatrix.elements[10] + cameraMatrix.elements[14];
        
        // Simple perspective projection
        const screenX = (camX / -camZ) * canvas.width / 2 + canvas.width / 2;
        const screenY = -(camY / -camZ) * canvas.height / 2 + canvas.height / 2;
        
        return { x: screenX, y: screenY };
      }, { x, y, z });
      
      // Get canvas bounding box for absolute positioning
      const canvas = page.locator('#game-canvas');
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Canvas bounding box not found');
      
      // Calculate absolute screen coordinates
      const absoluteX = box.x + screenPos.x;
      const absoluteY = box.y + screenPos.y;
      
      // Simulate realistic interaction: move, hover, click
      await page.mouse.move(absoluteX, absoluteY);
      await page.waitForTimeout(100); // Brief pause to simulate human movement
      await page.mouse.click(absoluteX, absoluteY);
      await page.waitForTimeout(200); // Wait for click to register
    },
    
    async clickButtonWithLabel(label: string): Promise<void> {
      const button = page.locator(`button:has-text("${label}")`);
      await button.waitFor({ state: 'visible' });
      await button.hover();
      await page.waitForTimeout(50);
      await button.click();
    },
    
    async clickMenuButton(): Promise<void> {
      await this.clickButtonWithLabel('Menu');
    },
    
    async getGameState(): Promise<GameState> {
      return await page.evaluate(() => {
        const game = (window as any).game;
        const board = game.getBoard();
        const pieces = board.getAllPieces();
        
        return {
          pieceCount: pieces.length,
          currentPlayer: game.getCurrentPlayer().color,
          moveCount: game.getHistoryLength() - 1,
          pieces: pieces.map((p: any) => ({
            position: { x: p.coords.x, y: p.coords.y, z: p.coords.z },
            color: p.player.color,
            isTemporary: p.isTemporary || false
          }))
        };
      });
    },
    
    async waitForPieceAt(x: number, y: number, z: number, timeout = 5000): Promise<void> {
      await page.waitForFunction(
        ({ x, y, z }) => {
          const game = (window as any).game;
          const board = game.getBoard();
          const piece = board.getPieceAt({ x, y, z });
          return piece !== null;
        },
        { x, y, z },
        { timeout }
      );
    },
    
    async getVisiblePieces(): Promise<PieceInfo[]> {
      return await page.evaluate(() => {
        const renderer = (window as any).renderer;
        const scene = renderer.getScene();
        const pieces: any[] = [];
        
        scene.traverse((child: any) => {
          if (child.userData?.type === 'piece' && child.visible) {
            pieces.push({
              position: child.userData.position,
              color: child.userData.color,
              isTemporary: child.userData.isTemporary || false
            });
          }
        });
        
        return pieces;
      });
    },
    
    async rotateBoard(deltaX: number, deltaY: number): Promise<void> {
      const canvas = page.locator('#game-canvas');
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Canvas bounding box not found');
      
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX + deltaX, centerY + deltaY, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(200);
    },
    
    async zoomBoard(delta: number): Promise<void> {
      const canvas = page.locator('#game-canvas');
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Canvas bounding box not found');
      
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      
      await page.mouse.move(centerX, centerY);
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(200);
    }
  };
}
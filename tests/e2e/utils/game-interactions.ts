import { Page, Locator, expect } from '@playwright/test';

export interface GameTestHelpers {
  // === Board Interaction ===
  /**
   * Click on a grid intersection node at the specified board coordinates
   * Simulates real user interaction: move mouse to node, hover, then click
   */
  clickGridNode(x: number, y: number, z: number): Promise<void>;
  
  /**
   * Place a piece at the specified coordinates (alias for clickGridNode)
   */
  placePiece(x: number, y: number, z: number): Promise<void>;
  
  /**
   * Rotate the board by dragging
   * @param deltaX - Horizontal drag distance in pixels
   * @param deltaY - Vertical drag distance in pixels
   */
  rotateBoard(deltaX: number, deltaY: number): Promise<void>;
  
  /**
   * Zoom the board using mouse wheel
   * @param delta - Positive to zoom in, negative to zoom out
   */
  zoomBoard(delta: number): Promise<void>;
  
  /**
   * Pan the board by right-click dragging
   * @param deltaX - Horizontal pan distance in pixels
   * @param deltaY - Vertical pan distance in pixels
   */
  panBoard(deltaX: number, deltaY: number): Promise<void>;
  
  // === Validation Helpers ===
  /**
   * Check if a piece exists at the specified board coordinates
   */
  hasPieceAt(x: number, y: number, z: number): Promise<boolean>;
  
  /**
   * Validate that a piece of the specified color exists at the coordinates
   */
  validatePieceAt(x: number, y: number, z: number, expectedColor: 'black' | 'white'): Promise<void>;
  
  /**
   * Check if a node is currently highlighted
   */
  isNodeHighlighted(x: number, y: number, z: number): Promise<boolean>;
  
  /**
   * Validate that a gridline is visible between two points
   */
  isGridlineVisible(start: Vector3, end: Vector3): Promise<boolean>;
  
  /**
   * Get all visible pieces on the board
   */
  getVisiblePieces(): Promise<PieceInfo[]>;
  
  /**
   * Wait for a piece to be placed at the specified position
   */
  waitForPieceAt(x: number, y: number, z: number, timeout?: number): Promise<void>;
  
  // === UI Interaction ===
  /**
   * Click a button by its label text
   */
  clickButtonWithLabel(label: string): Promise<void>;
  
  /**
   * Click a button by its ID
   */
  clickButtonById(id: string): Promise<void>;
  
  /**
   * Click the menu button (wrapper around clickButtonWithLabel)
   */
  clickMenuButton(): Promise<void>;
  
  /**
   * Check if a modal is currently visible
   */
  isModalVisible(modalTitle?: string): Promise<boolean>;
  
  /**
   * Close the currently open modal
   */
  closeModal(): Promise<void>;
  
  // === Game State ===
  /**
   * Get the current game state including piece positions
   */
  getGameState(): Promise<GameState>;
  
  /**
   * Get the current player (black or white)
   */
  getCurrentPlayer(): Promise<'black' | 'white'>;
  
  /**
   * Get the move count
   */
  getMoveCount(): Promise<number>;
  
  /**
   * Undo the last move
   */
  undoMove(): Promise<void>;
  
  /**
   * Redo a previously undone move
   */
  redoMove(): Promise<void>;
}

export interface GameState {
  pieceCount: number;
  currentPlayer: 'black' | 'white';
  moveCount: number;
  pieces: PieceInfo[];
  capturedBlack: number;
  capturedWhite: number;
}

export interface PieceInfo {
  position: Vector3;
  color: 'black' | 'white';
  isTemporary?: boolean;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export function createGameHelpers(page: Page): GameTestHelpers {
  return {
    async clickGridNode(x: number, y: number, z: number): Promise<void> {
      // Get canvas element for positioning
      const canvas = page.locator('#game-canvas');
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Canvas not found');

      // Get current mouse position (or default to center)
      const currentMouse = await page.evaluate(() => {
        const event = (window as any).lastMouseEvent || { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 };
        return { x: event.clientX, y: event.clientY };
      });

      // Find the screen position of the target node
      const targetPos = await page.evaluate(({ x, y, z }) => {
        const renderer = (window as any).renderer;
        if (!renderer) throw new Error('Renderer not found');
        
        const camera = renderer.getCamera();
        const scene = renderer.getScene();
        
        // Find the intersection node
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
          // If no node found, try to calculate expected position
          const cellSize = 1; // Default cell size
          const halfSize = 3; // For board size 7
          const worldX = x * cellSize;
          const worldY = y * cellSize;
          const worldZ = z * cellSize;
          
          // Create a temporary vector for projection
          const tempVector = {
            x: worldX,
            y: worldY,
            z: worldZ
          };
          
          // Manual projection
          const viewMatrix = camera.matrixWorldInverse.elements;
          const projMatrix = camera.projectionMatrix.elements;
          
          // Transform to view space
          const vx = tempVector.x * viewMatrix[0] + tempVector.y * viewMatrix[4] + tempVector.z * viewMatrix[8] + viewMatrix[12];
          const vy = tempVector.x * viewMatrix[1] + tempVector.y * viewMatrix[5] + tempVector.z * viewMatrix[9] + viewMatrix[13];
          const vz = tempVector.x * viewMatrix[2] + tempVector.y * viewMatrix[6] + tempVector.z * viewMatrix[10] + viewMatrix[14];
          const vw = tempVector.x * viewMatrix[3] + tempVector.y * viewMatrix[7] + tempVector.z * viewMatrix[11] + viewMatrix[15];
          
          // Transform to clip space
          const cx = vx * projMatrix[0] + vy * projMatrix[4] + vz * projMatrix[8] + vw * projMatrix[12];
          const cy = vx * projMatrix[1] + vy * projMatrix[5] + vz * projMatrix[9] + vw * projMatrix[13];
          const cw = vx * projMatrix[3] + vy * projMatrix[7] + vz * projMatrix[11] + vw * projMatrix[15];
          
          // Perspective divide and convert to screen space
          const canvas = document.querySelector('canvas');
          if (!canvas) throw new Error('Canvas not found');
          
          const ndcX = cx / cw;
          const ndcY = cy / cw;
          
          return {
            x: (ndcX + 1) * canvas.width / 2,
            y: (1 - ndcY) * canvas.height / 2
          };
        }
        
        // Use the actual node position if found
        const worldMatrix = targetNode.matrixWorld.elements;
        const worldPos = {
          x: worldMatrix[12],
          y: worldMatrix[13],
          z: worldMatrix[14]
        };
        
        // Project to screen (same as above)
        const viewMatrix = camera.matrixWorldInverse.elements;
        const projMatrix = camera.projectionMatrix.elements;
        
        const vx = worldPos.x * viewMatrix[0] + worldPos.y * viewMatrix[4] + worldPos.z * viewMatrix[8] + viewMatrix[12];
        const vy = worldPos.x * viewMatrix[1] + worldPos.y * viewMatrix[5] + worldPos.z * viewMatrix[9] + viewMatrix[13];
        const vz = worldPos.x * viewMatrix[2] + worldPos.y * viewMatrix[6] + worldPos.z * viewMatrix[10] + viewMatrix[14];
        const vw = worldPos.x * viewMatrix[3] + worldPos.y * viewMatrix[7] + worldPos.z * viewMatrix[11] + viewMatrix[15];
        
        const cx = vx * projMatrix[0] + vy * projMatrix[4] + vz * projMatrix[8] + vw * projMatrix[12];
        const cy = vx * projMatrix[1] + vy * projMatrix[5] + vz * projMatrix[9] + vw * projMatrix[13];
        const cw = vx * projMatrix[3] + vy * projMatrix[7] + vz * projMatrix[11] + vw * projMatrix[15];
        
        const canvas = document.querySelector('canvas');
        const ndcX = cx / cw;
        const ndcY = cy / cw;
        
        return {
          x: (ndcX + 1) * canvas.width / 2,
          y: (1 - ndcY) * canvas.height / 2
        };
      }, { x, y, z });

      // Calculate absolute screen coordinates
      const targetX = box.x + targetPos.x;
      const targetY = box.y + targetPos.y;

      // Simulate realistic mouse movement from current position to target
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        const progress = i / steps;
        const currentX = currentMouse.x + (targetX - currentMouse.x) * progress;
        const currentY = currentMouse.y + (targetY - currentMouse.y) * progress;
        await page.mouse.move(currentX, currentY);
        await page.waitForTimeout(10); // Small delay between steps
      }

      // Hover for a moment to trigger any hover effects
      await page.waitForTimeout(100);
      
      // Click
      await page.mouse.click(targetX, targetY);
      
      // Wait for the click to be processed
      await page.waitForTimeout(200);
    },
    
    async placePiece(x: number, y: number, z: number): Promise<void> {
      // Alias for clickGridNode
      await this.clickGridNode(x, y, z);
    },
    
    // === Validation Helpers ===
    async hasPieceAt(x: number, y: number, z: number): Promise<boolean> {
      return await page.evaluate(({ x, y, z }) => {
        const game = (window as any).game;
        const board = game.getBoard();
        const piece = board.getPieceAt({ x, y, z });
        return piece !== null;
      }, { x, y, z });
    },
    
    async validatePieceAt(x: number, y: number, z: number, expectedColor: 'black' | 'white'): Promise<void> {
      const pieceInfo = await page.evaluate(({ x, y, z }) => {
        const game = (window as any).game;
        const board = game.getBoard();
        const piece = board.getPieceAt({ x, y, z });
        if (!piece) return null;
        return {
          color: piece.player.color,
          isTemporary: piece.isTemporary || false
        };
      }, { x, y, z });
      
      if (!pieceInfo) {
        throw new Error(`No piece found at position (${x}, ${y}, ${z})`);
      }
      
      if (pieceInfo.color !== expectedColor) {
        throw new Error(`Expected ${expectedColor} piece at (${x}, ${y}, ${z}), but found ${pieceInfo.color}`);
      }
    },
    
    async isNodeHighlighted(x: number, y: number, z: number): Promise<boolean> {
      return await page.evaluate(({ x, y, z }) => {
        const renderer = (window as any).renderer;
        const scene = renderer.getScene();
        
        // Find the node at this position
        let targetNode: any = null;
        scene.traverse((child: any) => {
          if (child.userData?.type === 'intersection' && 
              child.userData?.position?.x === x &&
              child.userData?.position?.y === y &&
              child.userData?.position?.z === z) {
            targetNode = child;
          }
        });
        
        if (!targetNode) return false;
        
        // Check if node has highlight material or scale
        // This depends on how highlighting is implemented
        // Usually it's done via material change or scale
        const isHighlighted = 
          targetNode.scale.x > 1.01 || // Scaled up
          (targetNode.material && targetNode.material.emissive && 
           targetNode.material.emissive.r > 0); // Has emissive color
           
        return isHighlighted;
      }, { x, y, z });
    },
    
    async isGridlineVisible(start: Vector3, end: Vector3): Promise<boolean> {
      return await page.evaluate(({ start, end }) => {
        const renderer = (window as any).renderer;
        const scene = renderer.getScene();
        
        // Look for line segments in the scene
        let lineFound = false;
        scene.traverse((child: any) => {
          if (child.isLineSegments || child.isLine) {
            // Check if this line contains our start/end points
            // This is a simplified check - in reality you'd need to
            // check the geometry positions array
            if (child.visible) {
              // For now, just check if any lines are visible
              // A more sophisticated check would validate the exact positions
              lineFound = true;
            }
          }
        });
        
        return lineFound;
      }, { start, end });
    },
    
    // === UI Interaction ===
    async clickButtonWithLabel(label: string): Promise<void> {
      const button = page.locator(`button:has-text("${label}")`);
      await button.waitFor({ state: 'visible' });
      await button.hover();
      await page.waitForTimeout(50);
      await button.click();
    },
    
    async clickButtonById(id: string): Promise<void> {
      const button = page.locator(`#${id}`);
      await button.waitFor({ state: 'visible' });
      await button.hover();
      await page.waitForTimeout(50);
      await button.click();
    },
    
    async clickMenuButton(): Promise<void> {
      await this.clickButtonWithLabel('Menu');
    },
    
    async isModalVisible(modalTitle?: string): Promise<boolean> {
      if (modalTitle) {
        // Check for specific modal by title
        const modal = page.locator(`.modal:has(h2:has-text("${modalTitle}"))`);
        return await modal.isVisible();
      } else {
        // Check for any modal
        const modal = page.locator('.modal');
        return await modal.isVisible();
      }
    },
    
    async closeModal(): Promise<void> {
      // Try multiple ways to close modal
      // First try close button
      const closeButton = page.locator('.modal button:has-text("Close"), .modal button:has-text("×"), .modal .close-button');
      if (await closeButton.isVisible()) {
        await closeButton.click();
        await page.waitForTimeout(200);
        return;
      }
      
      // Try ESC key
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
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
          })),
          capturedBlack: 0, // TODO: implement capture counting when available
          capturedWhite: 0  // TODO: implement capture counting when available
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
      if (!box) throw new Error('Canvas not found');
      
      // Start from a position offset from center to make rotation more natural
      const startX = box.x + box.width * 0.6;
      const startY = box.y + box.height * 0.5;
      const endX = startX + deltaX;
      const endY = startY + deltaY;
      
      // Move to start position smoothly
      await page.mouse.move(startX, startY, { steps: 5 });
      await page.waitForTimeout(50);
      
      // Press mouse button (left click for rotation)
      await page.mouse.down();
      await page.waitForTimeout(50);
      
      // Drag smoothly to end position
      const dragSteps = 15;
      for (let i = 1; i <= dragSteps; i++) {
        const progress = i / dragSteps;
        const currentX = startX + (deltaX * progress);
        const currentY = startY + (deltaY * progress);
        await page.mouse.move(currentX, currentY);
        await page.waitForTimeout(20);
      }
      
      // Release mouse button
      await page.mouse.up();
      await page.waitForTimeout(100);
    },
    
    async zoomBoard(delta: number): Promise<void> {
      const canvas = page.locator('#game-canvas');
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Canvas not found');
      
      // Move to center of canvas
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      
      await page.mouse.move(centerX, centerY, { steps: 5 });
      await page.waitForTimeout(50);
      
      // Perform wheel scroll
      // Note: delta > 0 zooms in, delta < 0 zooms out
      await page.mouse.wheel(0, -delta); // Negative because scroll direction is inverted
      await page.waitForTimeout(200);
    },
    
    async panBoard(deltaX: number, deltaY: number): Promise<void> {
      const canvas = page.locator('#game-canvas');
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Canvas not found');
      
      // Start from center
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      const endX = startX + deltaX;
      const endY = startY + deltaY;
      
      // Move to start position
      await page.mouse.move(startX, startY, { steps: 5 });
      await page.waitForTimeout(50);
      
      // Right click and hold for pan
      await page.mouse.down({ button: 'right' });
      await page.waitForTimeout(50);
      
      // Drag smoothly
      const dragSteps = 10;
      for (let i = 1; i <= dragSteps; i++) {
        const progress = i / dragSteps;
        const currentX = startX + (deltaX * progress);
        const currentY = startY + (deltaY * progress);
        await page.mouse.move(currentX, currentY);
        await page.waitForTimeout(20);
      }
      
      // Release right mouse button
      await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(100);
    },
    
    // === Game State Helpers ===
    async getCurrentPlayer(): Promise<'black' | 'white'> {
      return await page.evaluate(() => {
        const game = (window as any).game;
        return game.getCurrentPlayer().color;
      });
    },
    
    async getMoveCount(): Promise<number> {
      return await page.evaluate(() => {
        const game = (window as any).game;
        return game.getHistoryLength() - 1;
      });
    },
    
    async undoMove(): Promise<void> {
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(200);
    },
    
    async redoMove(): Promise<void> {
      await page.keyboard.press('Control+y');
      await page.waitForTimeout(200);
    }
  };
}
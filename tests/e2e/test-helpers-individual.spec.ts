import { test, expect } from '@playwright/test';
import { createGameHelpers } from './utils/game-interactions';

test.describe('Test Helpers - Individual Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000); // Ensure scene is loaded
  });

  test('piece placement and validation', async ({ page }) => {
    const game = createGameHelpers(page);
    
    // Place piece using our helper
    await game.placePiece(0, 0, 0);
    await page.waitForTimeout(500);
    
    // Verify using raw evaluation (not helper)
    const rawCheck = await page.evaluate(() => {
      const g = (window as any).game;
      const board = g.getBoard();
      const piece = board.getPieceAt({ x: 0, y: 0, z: 0 });
      return {
        exists: piece !== null,
        color: piece?.player?.color
      };
    });
    
    expect(rawCheck.exists).toBe(true);
    expect(rawCheck.color).toBe('black');
    
    // Now test our validation helpers
    const hasPiece = await game.hasPieceAt(0, 0, 0);
    expect(hasPiece).toBe(true);
    
    // This should not throw
    await game.validatePieceAt(0, 0, 0, 'black');
    
    // This should throw
    await expect(game.validatePieceAt(0, 0, 0, 'white')).rejects.toThrow();
  });

  test('board rotation with validation', async ({ page }) => {
    const game = createGameHelpers(page);
    
    // Place a reference piece at a known position
    await game.placePiece(3, 0, 0);
    await page.waitForTimeout(500);
    
    // Get the screen position of this piece before rotation
    const positionBefore = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const scene = renderer.getScene();
      const camera = renderer.getCamera();
      
      // Find the piece at (3, 0, 0)
      let pieceNode: any = null;
      scene.traverse((child: any) => {
        if (child.userData?.type === 'piece' && 
            child.userData?.position?.x === 3 &&
            child.userData?.position?.y === 0 &&
            child.userData?.position?.z === 0) {
          pieceNode = child;
        }
      });
      
      if (!pieceNode) {
        // If no piece mesh with userData, look for actual piece position
        const game = (window as any).game;
        const board = game.getBoard();
        const piece = board.getPieceAt({ x: 3, y: 0, z: 0 });
        if (piece) {
          // Find mesh at this world position
          scene.traverse((child: any) => {
            if (child.isMesh && child.material && 
                Math.abs(child.position.x - 3) < 0.1 &&
                Math.abs(child.position.y - 0) < 0.1 &&
                Math.abs(child.position.z - 0) < 0.1) {
              pieceNode = child;
            }
          });
        }
      }
      
      if (!pieceNode) return null;
      
      // Get world position
      const worldPos = new (window as any).THREE.Vector3();
      pieceNode.getWorldPosition(worldPos);
      
      // Project to screen
      const screenPos = worldPos.clone();
      screenPos.project(camera);
      
      const canvas = document.querySelector('canvas')!;
      return {
        world: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
        screen: {
          x: (screenPos.x + 1) * canvas.width / 2,
          y: (1 - screenPos.y) * canvas.height / 2
        }
      };
    });
    
    console.log('Position before rotation:', positionBefore);
    
    // Rotate the board 90 degrees to the right
    await game.rotateBoard(150, 0);
    await page.waitForTimeout(1000);
    
    // Get position after rotation
    const positionAfter = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const scene = renderer.getScene();
      const camera = renderer.getCamera();
      
      // Same logic to find piece
      let pieceNode: any = null;
      scene.traverse((child: any) => {
        if (child.isMesh && child.material && 
            Math.abs(child.position.x - 3) < 0.1 &&
            Math.abs(child.position.y - 0) < 0.1 &&
            Math.abs(child.position.z - 0) < 0.1) {
          pieceNode = child;
        }
      });
      
      if (!pieceNode) return null;
      
      const worldPos = new (window as any).THREE.Vector3();
      pieceNode.getWorldPosition(worldPos);
      
      const screenPos = worldPos.clone();
      screenPos.project(camera);
      
      const canvas = document.querySelector('canvas')!;
      return {
        world: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
        screen: {
          x: (screenPos.x + 1) * canvas.width / 2,
          y: (1 - screenPos.y) * canvas.height / 2
        }
      };
    });
    
    console.log('Position after rotation:', positionAfter);
    
    // Validate rotation occurred
    if (positionBefore && positionAfter) {
      // Screen position should have changed
      const screenDelta = Math.sqrt(
        Math.pow(positionAfter.screen.x - positionBefore.screen.x, 2) +
        Math.pow(positionAfter.screen.y - positionBefore.screen.y, 2)
      );
      
      console.log(`Screen position changed by ${screenDelta} pixels`);
      expect(screenDelta).toBeGreaterThan(50); // Should move significantly
      
      // World position should remain the same (piece didn't move)
      expect(positionAfter.world.x).toBeCloseTo(positionBefore.world.x, 1);
      expect(positionAfter.world.y).toBeCloseTo(positionBefore.world.y, 1);
      expect(positionAfter.world.z).toBeCloseTo(positionBefore.world.z, 1);
    }
  });

  test('zoom functionality', async ({ page }) => {
    const game = createGameHelpers(page);
    
    // Get initial camera distance
    const distanceBefore = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const camera = renderer.getCamera();
      return camera.position.length(); // Distance from origin
    });
    
    console.log('Camera distance before zoom:', distanceBefore);
    
    // Zoom in
    await game.zoomBoard(500);
    await page.waitForTimeout(500);
    
    const distanceAfterZoomIn = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const camera = renderer.getCamera();
      return camera.position.length();
    });
    
    console.log('Camera distance after zoom in:', distanceAfterZoomIn);
    expect(distanceAfterZoomIn).toBeLessThan(distanceBefore);
    
    // Zoom out
    await game.zoomBoard(-1000);
    await page.waitForTimeout(500);
    
    const distanceAfterZoomOut = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const camera = renderer.getCamera();
      return camera.position.length();
    });
    
    console.log('Camera distance after zoom out:', distanceAfterZoomOut);
    expect(distanceAfterZoomOut).toBeGreaterThan(distanceAfterZoomIn);
  });

  test('UI interactions', async ({ page }) => {
    const game = createGameHelpers(page);
    
    // Check initial state - no modal
    let modalVisible = await game.isModalVisible();
    expect(modalVisible).toBe(false);
    
    // Open menu
    await game.clickMenuButton();
    await page.waitForTimeout(500);
    
    // Check modal is now visible
    modalVisible = await game.isModalVisible();
    expect(modalVisible).toBe(true);
    
    // Close modal
    await game.closeModal();
    await page.waitForTimeout(500);
    
    // Check modal is closed
    modalVisible = await game.isModalVisible();
    expect(modalVisible).toBe(false);
  });

  test('game state helpers', async ({ page }) => {
    const game = createGameHelpers(page);
    
    // Initial state
    let player = await game.getCurrentPlayer();
    expect(player).toBe('black');
    
    let moveCount = await game.getMoveCount();
    expect(moveCount).toBe(0);
    
    // Place a piece
    await game.placePiece(0, 0, 0);
    await page.waitForTimeout(500);
    
    // Check updated state
    player = await game.getCurrentPlayer();
    expect(player).toBe('white');
    
    moveCount = await game.getMoveCount();
    expect(moveCount).toBe(1);
    
    // Get full game state
    const state = await game.getGameState();
    expect(state.pieceCount).toBe(1);
    expect(state.currentPlayer).toBe('white');
    expect(state.moveCount).toBe(1);
    expect(state.pieces).toHaveLength(1);
    expect(state.pieces[0].color).toBe('black');
  });
});
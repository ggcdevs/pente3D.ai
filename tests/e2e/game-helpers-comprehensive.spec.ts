import { test, expect } from '@playwright/test';
import { setupTest } from '../helpers/e2e';
import { Vector3Builder } from '../helpers/builders';

test.describe('Game Functionality - Comprehensive Test', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('comprehensive game functionality test', async ({ page }) => {
    await setupTest(page);
    
    // === Test 1: Basic piece placement ===
    console.log('Test 1: Placing pieces');
    
    // Build test positions
    const center = new Vector3Builder().zero().build();
    const pos1 = new Vector3Builder().withCoords(1, 0, 0).build();
    const pos2 = new Vector3Builder().withCoords(-1, 0, 0).build();
    
    // Place pieces using direct evaluation (since helpers aren't fully implemented)
    await page.evaluate((coords) => {
      const game = (window as any).game;
      const inputHandler = (window as any).inputHandler;
      if (!game || !inputHandler) return;
      
      // Simulate placing piece at center
      const board = game.getBoard();
      const player = game.getCurrentPlayer();
      game.placePiece(coords);
    }, center);
    
    await page.waitForTimeout(100);
    
    // Verify piece was placed
    const hasPiece = await page.evaluate((coords) => {
      const game = (window as any).game;
      if (!game) return false;
      const board = game.getBoard();
      return board.hasPiece(coords);
    }, center);
    
    expect(hasPiece).toBe(true);
    
    // Get piece color
    const pieceColor = await page.evaluate((coords) => {
      const game = (window as any).game;
      if (!game) return null;
      const board = game.getBoard();
      const piece = board.getPiece(coords);
      return piece ? piece.player.getColor() : null;
    }, center);
    
    expect(pieceColor).toBe('black');
    
    // Place a white piece
    await page.evaluate((coords) => {
      const game = (window as any).game;
      if (!game) return;
      game.placePiece(coords);
    }, pos1);
    
    await page.waitForTimeout(100);
    
    // Verify game state
    const gameState = await page.evaluate(() => {
      const game = (window as any).game;
      if (!game) return null;
      const board = game.getBoard();
      return {
        pieceCount: board.getPieceCount(),
        currentPlayer: game.getCurrentPlayer().getColor(),
        moveCount: game.getHistory().length
      };
    });
    
    expect(gameState.pieceCount).toBe(2);
    expect(gameState.currentPlayer).toBe('black'); // Back to black's turn
    expect(gameState.moveCount).toBe(2);
    
    // === Test 2: Board rotation ===
    console.log('Test 2: Rotating board');
    
    // Get initial camera position
    const initialCameraPos = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      if (!renderer) return null;
      const camera = renderer.getCamera();
      return { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    });
    
    // Rotate board
    const canvas = page.locator('canvas');
    await canvas.hover({ position: { x: 640, y: 360 } });
    await page.mouse.down();
    await page.mouse.move(740, 360, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    
    // Verify camera moved
    const newCameraPos = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      if (!renderer) return null;
      const camera = renderer.getCamera();
      return { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    });
    
    expect(
      Math.abs(newCameraPos.x - initialCameraPos.x) > 0.1 ||
      Math.abs(newCameraPos.y - initialCameraPos.y) > 0.1 ||
      Math.abs(newCameraPos.z - initialCameraPos.z) > 0.1
    ).toBe(true);
    
    // Place another piece to ensure rotation didn't break interaction
    await page.evaluate((coords) => {
      const game = (window as any).game;
      if (!game) return;
      game.placePiece(coords);
    }, pos2);
    
    await page.waitForTimeout(100);
    
    const hasPiece2 = await page.evaluate((coords) => {
      const game = (window as any).game;
      if (!game) return false;
      const board = game.getBoard();
      return board.hasPiece(coords);
    }, pos2);
    
    expect(hasPiece2).toBe(true);
    
    // === Test 3: Zoom functionality ===
    console.log('Test 3: Testing zoom');
    
    // Get initial distance
    const initialDistance = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      if (!renderer) return null;
      const camera = renderer.getCamera();
      return Math.sqrt(
        camera.position.x ** 2 + 
        camera.position.y ** 2 + 
        camera.position.z ** 2
      );
    });
    
    // Zoom in
    await canvas.hover();
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(200);
    
    const zoomedInDistance = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      if (!renderer) return null;
      const camera = renderer.getCamera();
      return Math.sqrt(
        camera.position.x ** 2 + 
        camera.position.y ** 2 + 
        camera.position.z ** 2
      );
    });
    
    expect(zoomedInDistance).toBeLessThan(initialDistance);
    
    // Zoom out
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(200);
    
    const zoomedOutDistance = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      if (!renderer) return null;
      const camera = renderer.getCamera();
      return Math.sqrt(
        camera.position.x ** 2 + 
        camera.position.y ** 2 + 
        camera.position.z ** 2
      );
    });
    
    expect(zoomedOutDistance).toBeGreaterThan(zoomedInDistance);
    
    // === Test 4: Console errors check ===
    console.log('Test 4: Checking for console errors');
    
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    
    // Perform various interactions
    await canvas.click({ position: { x: 100, y: 100 } });
    await page.waitForTimeout(50);
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(50);
    
    // No errors should have occurred
    expect(errors).toHaveLength(0);
    
    // === Test 5: Game state persistence ===
    console.log('Test 5: Testing game state');
    
    // Get final game state
    const finalState = await page.evaluate(() => {
      const game = (window as any).game;
      if (!game) return null;
      const board = game.getBoard();
      const history = game.getHistory();
      return {
        pieceCount: board.getPieceCount(),
        historyLength: history.length,
        isGameOver: game.isGameOver(),
        allPieces: board.getAllPieces().map(p => ({
          x: p.coords.x,
          y: p.coords.y,
          z: p.coords.z,
          color: p.player.getColor()
        }))
      };
    });
    
    expect(finalState.pieceCount).toBe(3);
    expect(finalState.historyLength).toBe(3);
    expect(finalState.isGameOver).toBe(false);
    expect(finalState.allPieces).toHaveLength(3);
    
    // Verify piece colors alternate correctly
    expect(finalState.allPieces[0].color).toBe('black');
    expect(finalState.allPieces[1].color).toBe('white');
    expect(finalState.allPieces[2].color).toBe('black');
  });

  test('rapid interaction stress test', async ({ page }) => {
    await setupTest(page);
    
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    
    // Rapid piece placement attempts
    const positions = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: -1 }
    ];
    
    // Place pieces rapidly
    for (const pos of positions) {
      await page.evaluate((coords) => {
        const game = (window as any).game;
        if (!game) return;
        try {
          game.placePiece(coords);
        } catch (e) {
          // Expected for invalid moves
        }
      }, pos);
      // Minimal wait to stress test
      await page.waitForTimeout(10);
    }
    
    // Should handle rapid interactions gracefully
    const finalPieceCount = await page.evaluate(() => {
      const game = (window as any).game;
      if (!game) return 0;
      return game.getBoard().getPieceCount();
    });
    
    expect(finalPieceCount).toBeGreaterThan(0);
    expect(finalPieceCount).toBeLessThanOrEqual(positions.length);
    
    // No critical errors should have occurred
    const criticalErrors = errors.filter(e => 
      !e.includes('Invalid move') && 
      !e.includes('Position occupied')
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
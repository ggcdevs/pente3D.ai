import { test, expect } from '@playwright/test';
import { createGameHelpers } from '../utils/game-interactions';

test.describe('Issue #012: Temporary Piece Click Not Placing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000); // Wait for game to load
    
    // Ensure clean state
    const pieceCount = await page.evaluate(() => {
      const game = (window as any).game;
      if (game && game.getBoard) {
        return game.getBoard().getAllPieces().length;
      }
      return -1;
    });
    
    if (pieceCount > 0) {
      console.warn(`Warning: Board not clean, found ${pieceCount} pieces`);
      await page.reload();
      await page.waitForTimeout(2000);
    }
  });

  test('temporary piece mode should work correctly', async ({ page }) => {
    const game = createGameHelpers(page);
    
    // Focus canvas and enter temporary mode
    await page.focus('#game-canvas');
    await page.waitForTimeout(100);
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    
    // Check if we're in temporary mode
    const tempModeState = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      return {
        isTemporaryMode: inputHandler?.state?.temporaryPieceMode || false
      };
    });
    
    expect(tempModeState.isTemporaryMode).toBe(true);
    console.log('✓ Temporary mode activated');
    
    // Click to set temporary piece position
    await game.clickGridNode(0, 1, 0);
    await page.waitForTimeout(500);
    
    // Check that temporary position is set
    const afterClick = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      return {
        isTemporaryMode: inputHandler?.state?.temporaryPieceMode || false,
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition
      };
    });
    
    expect(afterClick.isTemporaryMode).toBe(true);
    expect(afterClick.hasTemporaryPosition).toBe(true);
    console.log('✓ Temporary piece position set');
    
    // Test Enter key to confirm piece
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    
    // Check that we exited temporary mode
    const afterEnter = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      const game = (window as any).game;
      return {
        isTemporaryMode: inputHandler?.state?.temporaryPieceMode || false,
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition,
        totalPieces: game.getBoard().getAllPieces().length
      };
    });
    
    expect(afterEnter.isTemporaryMode).toBe(false);
    expect(afterEnter.hasTemporaryPosition).toBe(false);
    expect(afterEnter.totalPieces).toBe(1); // One piece should be placed
    console.log('✓ Temporary piece confirmed and placed');
  });
  
  test('temporary piece should become permanent on Enter', async ({ page }) => {
    const game = createGameHelpers(page);
    
    // Enter temporary mode
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    
    // Place a temporary piece
    await game.clickGridNode(0, 0, 0);
    await page.waitForTimeout(500);
    
    // Check that it's temporary
    const beforeEnter = await page.evaluate(() => {
      const game = (window as any).game;
      const piece = game.getBoard().getPieceAt({ x: 0, y: 0, z: 0 });
      return piece ? {
        exists: true,
        isTemporary: piece.isTemporary || false,
        color: piece.player.color
      } : { exists: false };
    });
    
    expect(beforeEnter.exists).toBe(true);
    expect(beforeEnter.isTemporary).toBe(true);
    
    // Press Enter to make it permanent
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    
    // Check that it's now permanent
    const afterEnter = await page.evaluate(() => {
      const game = (window as any).game;
      const piece = game.getBoard().getPieceAt({ x: 0, y: 0, z: 0 });
      return piece ? {
        exists: true,
        isTemporary: piece.isTemporary || false,
        color: piece.player.color
      } : { exists: false };
    });
    
    expect(afterEnter.exists).toBe(true);
    expect(afterEnter.isTemporary).toBe(false);
    
    console.log('Piece became permanent after Enter ✓');
  });
  
  test('pressing t again should remove temporary pieces', async ({ page }) => {
    const game = createGameHelpers(page);
    
    // Enter temporary mode
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    
    // Place a temporary piece
    await game.clickGridNode(2, 0, 0);
    await page.waitForTimeout(500);
    
    // Verify it exists
    const hasTempPiece = await game.hasPieceAt(2, 0, 0);
    expect(hasTempPiece).toBe(true);
    
    // Press 't' again to exit temporary mode
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    
    // Verify the temporary piece is removed
    const afterSecondT = await game.hasPieceAt(2, 0, 0);
    expect(afterSecondT).toBe(false);
    
    console.log('Temporary piece removed on second t press ✓');
  });
});
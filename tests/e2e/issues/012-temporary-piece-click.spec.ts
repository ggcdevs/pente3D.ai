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

  test('temporary piece mode should place piece on click', async ({ page }) => {
    const game = createGameHelpers(page);
    
    // Test regular piece placement first to ensure baseline works
    console.log('Testing regular piece placement...');
    await game.placePiece(1, 0, 0);
    await page.waitForTimeout(500);
    
    const hasRegularPiece = await game.hasPieceAt(1, 0, 0);
    expect(hasRegularPiece).toBe(true);
    console.log('Regular placement works ✓');
    
    // Now test temporary mode
    console.log('Entering temporary mode...');
    // Focus canvas without clicking on game area
    await page.focus('#game-canvas');
    await page.waitForTimeout(100);
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    
    // Check if we're in temporary mode
    const gameState = await page.evaluate(() => {
      const game = (window as any).game;
      const inputHandler = (window as any).inputHandler;
      return {
        isTemporaryMode: inputHandler?.state?.temporaryPieceMode || false,
        currentPlayer: game.getCurrentPlayer().color,
        totalPieces: game.getBoard().getAllPieces().length
      };
    });
    console.log('Game state after pressing t:', gameState);
    
    // Try to place a temporary piece by clicking
    console.log('Attempting to place temporary piece at (0, 1, 0)...');
    await game.clickGridNode(0, 1, 0);
    await page.waitForTimeout(500);
    
    // Check if a piece was placed
    const afterClick = await page.evaluate(() => {
      const game = (window as any).game;
      const board = game.getBoard();
      const allPieces = board.getAllPieces();
      return {
        totalPieces: allPieces.length,
        pieces: allPieces.map((p: any) => ({
          position: p.position ? { x: p.position.x, y: p.position.y, z: p.position.z } : 'undefined',
          color: p.player.color,
          isTemporary: p.isTemporary || false
        })),
        hasPieceAt010: !!board.getPieceAt({ x: 0, y: 1, z: 0 })
      };
    });
    
    console.log('After temporary click:', afterClick);
    
    // The issue is that clicking should place a temporary piece
    // Either the piece count should increase, or there should be a temporary piece at (0,1,0)
    expect(afterClick.totalPieces).toBeGreaterThan(gameState.totalPieces);
    expect(afterClick.hasPieceAt010).toBe(true);
    
    // The new piece should be marked as temporary
    const temporaryPieces = afterClick.pieces.filter((p: any) => p.isTemporary);
    expect(temporaryPieces.length).toBeGreaterThan(0);
    
    console.log('Temporary pieces found:', temporaryPieces);
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
import { test, expect } from '@playwright/test';

test.describe('Issue #005 Simple Click Test', () => {
  test('verify clicking places pieces on board', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Get initial state
    const initialState = await page.evaluate(() => {
      const game = (window as any).game;
      const board = game.getBoard();
      return {
        pieceCount: board.getAllPieces().length,
        moveCount: game.getHistoryLength() - 1 // -1 because initial state is at index 0
      };
    });
    
    console.log('Initial state:', initialState);
    expect(initialState.pieceCount).toBe(0);
    expect(initialState.moveCount).toBe(0);
    
    // Click on the center of the canvas
    await page.click('#game-canvas');
    await page.waitForTimeout(500);
    
    // Check if a piece was placed
    const afterClick = await page.evaluate(() => {
      const game = (window as any).game;
      const board = game.getBoard();
      const pieces = board.getAllPieces();
      return {
        pieceCount: pieces.length,
        moveCount: game.getHistoryLength() - 1,
        firstPiece: pieces.length > 0 ? {
          position: pieces[0].coords,
          color: pieces[0].player.color
        } : null
      };
    });
    
    console.log('After click:', afterClick);
    expect(afterClick.pieceCount).toBe(1);
    expect(afterClick.moveCount).toBe(1);
    expect(afterClick.firstPiece).toBeTruthy();
    expect(afterClick.firstPiece.color).toBe('black'); // Black plays first
    
    // Click another spot
    const canvas = await page.locator('#game-canvas');
    const box = await canvas.boundingBox();
    if (box) {
      // Click slightly off-center
      await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5);
      await page.waitForTimeout(500);
    }
    
    // Check second piece
    const afterSecondClick = await page.evaluate(() => {
      const game = (window as any).game;
      const board = game.getBoard();
      const pieces = board.getAllPieces();
      return {
        pieceCount: pieces.length,
        moveCount: game.getHistoryLength() - 1,
        pieces: pieces.map((p: any) => ({ position: p.coords, color: p.player.color }))
      };
    });
    
    console.log('After second click:', afterSecondClick);
    expect(afterSecondClick.pieceCount).toBe(2);
    expect(afterSecondClick.moveCount).toBe(2);
    
    // Verify we have one black and one white piece
    const colors = afterSecondClick.pieces.map((p: any) => p.color).sort();
    expect(colors).toEqual(['black', 'white']);
  });
});
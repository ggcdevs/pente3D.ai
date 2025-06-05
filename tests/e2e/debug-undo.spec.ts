import { test, expect } from '@playwright/test';
import { createGameHelpers } from './utils/game-interactions';

test.describe('Debug Undo', () => {
  test('debug undo behavior', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    
    const game = createGameHelpers(page);
    
    console.log('=== Initial State ===');
    let state = await page.evaluate(() => {
      const g = (window as any).game;
      return {
        moveCount: g.getHistoryLength() - 1,
        currentPlayer: g.getCurrentPlayer().color,
        pieces: g.getBoard().getAllPieces().length
      };
    });
    console.log('Initial:', state);
    
    console.log('\n=== After placing piece ===');
    await game.placePiece(1, 0, 0);
    await page.waitForTimeout(500);
    
    state = await page.evaluate(() => {
      const g = (window as any).game;
      return {
        moveCount: g.getHistoryLength() - 1,
        historyLength: g.getHistoryLength(),
        currentPlayer: g.getCurrentPlayer().color,
        pieces: g.getBoard().getAllPieces().length
      };
    });
    console.log('After place:', state);
    
    console.log('\n=== After undo ===');
    await game.undoMove();
    await page.waitForTimeout(500);
    
    state = await page.evaluate(() => {
      const g = (window as any).game;
      return {
        moveCount: g.getHistoryLength() - 1,
        historyLength: g.getHistoryLength(),
        currentPlayer: g.getCurrentPlayer().color,
        pieces: g.getBoard().getAllPieces().length,
        canUndo: g.canUndo(),
        canRedo: g.canRedo()
      };
    });
    console.log('After undo:', state);
  });
});
import { test, expect } from '@playwright/test';
import { createGameHelpers } from '../utils/game-interactions';

test.describe('Issue #019: Simple Persistence Test', () => {
  test('temporary piece persistence validation', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    
    const game = createGameHelpers(page);
    
    // Focus and enter temporary mode
    await page.focus('#game-canvas');
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    
    console.log('✅ Temporary mode activated');
    
    // Click to place temporary piece
    await game.clickGridNode(1, 1, 1);
    await page.waitForTimeout(500);
    
    // Check initial temporary position
    const afterClick = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      return {
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition,
        temporaryPosition: inputHandler?.state?.temporaryPosition
      };
    });
    
    console.log('After click - temporary position:', afterClick.temporaryPosition);
    expect(afterClick.hasTemporaryPosition).toBe(true);
    
    // Simulate mouse movement by moving to center of canvas
    const canvas = page.locator('#game-canvas');
    const box = await canvas.boundingBox();
    if (box) {
      console.log('Moving mouse to canvas center...');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(500);
      
      // Check if temporary position changed
      const afterMouseMove = await page.evaluate(() => {
        const inputHandler = (window as any).inputHandler;
        return {
          hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition,
          temporaryPosition: inputHandler?.state?.temporaryPosition
        };
      });
      
      console.log('After mouse move - temporary position:', afterMouseMove.temporaryPosition);
      
      // Temporary position should be the same
      const positionsMatch = 
        afterClick.temporaryPosition.x === afterMouseMove.temporaryPosition.x &&
        afterClick.temporaryPosition.y === afterMouseMove.temporaryPosition.y &&
        afterClick.temporaryPosition.z === afterMouseMove.temporaryPosition.z;
      
      if (positionsMatch) {
        console.log('✅ SUCCESS: Temporary piece persisted after mouse movement!');
      } else {
        console.log('❌ FAILED: Temporary piece moved with mouse');
      }
      
      expect(positionsMatch).toBe(true);
    }
    
    // Test confirmation still works
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    
    const finalState = await page.evaluate(() => {
      const game = (window as any).game;
      const inputHandler = (window as any).inputHandler;
      return {
        pieceCount: game.getBoard().getAllPieces().length,
        temporaryMode: inputHandler?.state?.temporaryPieceMode
      };
    });
    
    expect(finalState.pieceCount).toBe(1);
    expect(finalState.temporaryMode).toBe(false);
    console.log('✅ Confirmation with Enter key still works');
  });
});
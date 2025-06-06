import { test, expect } from '@playwright/test';

test.describe('Issue #019: Basic Test', () => {
  test('temporary piece position tracking', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    
    // Focus and enter temporary mode
    await page.focus('#game-canvas');
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    
    console.log('✅ Temporary mode activated');
    
    // Click at specific screen coordinates (center of canvas)
    await page.mouse.click(640, 360);
    await page.waitForTimeout(500);
    
    // Check temporary position after click
    const afterClick = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      return {
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition,
        temporaryPosition: inputHandler?.state?.temporaryPosition
      };
    });
    
    console.log('After click - temporary position:', afterClick.temporaryPosition);
    expect(afterClick.hasTemporaryPosition).toBe(true);
    
    // Move mouse to a different position
    console.log('Moving mouse to different position...');
    await page.mouse.move(400, 200);
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
    
    // Compare positions
    const positionsMatch = JSON.stringify(afterClick.temporaryPosition) === JSON.stringify(afterMouseMove.temporaryPosition);
    
    if (positionsMatch) {
      console.log('✅ SUCCESS: Temporary piece persisted after mouse movement!');
    } else {
      console.log('❌ FAILED: Temporary piece changed position');
    }
    
    expect(positionsMatch).toBe(true);
    
    // Test Enter key confirmation
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    
    const finalState = await page.evaluate(() => {
      const game = (window as any).game;
      const inputHandler = (window as any).inputHandler;
      return {
        pieceCount: game.getBoard().getAllPieces().length,
        temporaryMode: inputHandler?.state?.temporaryPieceMode,
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition
      };
    });
    
    expect(finalState.pieceCount).toBe(1);
    expect(finalState.temporaryMode).toBe(false);
    expect(finalState.hasTemporaryPosition).toBe(false);
    console.log('✅ Confirmation works - piece placed permanently');
  });
});
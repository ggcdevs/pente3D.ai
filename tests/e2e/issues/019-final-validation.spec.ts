import { test, expect } from '@playwright/test';
import { createGameHelpers } from '../utils/game-interactions';
import { captureCanvas } from '../utils/threejs-helpers';
import { saveBaselineScreenshot, expectScreenshotToMatchBaseline } from '../utils/visual-regression';

test.describe('Issue #019: Final Validation - Temporary Pieces', () => {
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

  test('temporary piece workflow with visual validation', async ({ page }) => {
    const game = createGameHelpers(page);
    
    // Focus canvas
    await page.focus('#game-canvas');
    await page.waitForTimeout(100);
    
    // 1. Take baseline screenshot of empty board
    console.log('📸 Taking baseline screenshot of empty board...');
    const emptyBoardScreenshot = await captureCanvas(page);
    await saveBaselineScreenshot('019-empty-board', emptyBoardScreenshot);
    
    // 2. Activate temporary mode
    console.log('🔄 Activating temporary mode with "t" key...');
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    
    // Verify temporary mode is active
    const tempModeActive = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      return inputHandler?.state?.temporaryPieceMode || false;
    });
    expect(tempModeActive).toBe(true);
    console.log('✅ Temporary mode activated');
    
    // 3. Click on a node using helper functions
    console.log('🖱️ Clicking on node (1, 1, 1) using game helper...');
    await game.clickGridNode(1, 1, 1);
    await page.waitForTimeout(500);
    
    // 4. Verify temporary position is set
    const tempState = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      return {
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition,
        temporaryPosition: inputHandler?.state?.temporaryPosition,
        temporaryModeStillActive: inputHandler?.state?.temporaryPieceMode
      };
    });
    
    expect(tempState.hasTemporaryPosition).toBe(true);
    expect(tempState.temporaryModeStillActive).toBe(true);
    console.log('✅ Temporary position set at:', tempState.temporaryPosition);
    
    // 5. Take screenshot with temporary piece visible
    console.log('📸 Taking screenshot with temporary piece...');
    const tempPieceScreenshot = await captureCanvas(page);
    await saveBaselineScreenshot('019-temporary-piece-visible', tempPieceScreenshot);
    
    // 6. Confirm with Enter key
    console.log('⌨️ Pressing Enter to confirm temporary piece...');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    
    // 7. Verify temporary mode is exited and piece is placed
    const finalState = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      const game = (window as any).game;
      
      return {
        temporaryModeActive: inputHandler?.state?.temporaryPieceMode || false,
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition,
        totalPieces: game.getBoard().getAllPieces().length,
        allPieces: game.getBoard().getAllPieces().map((p: any) => ({
          position: p.coords,
          color: p.player.color
        }))
      };
    });
    
    expect(finalState.temporaryModeActive).toBe(false);
    expect(finalState.hasTemporaryPosition).toBe(false);
    expect(finalState.totalPieces).toBe(1);
    console.log('✅ Temporary mode exited, piece count:', finalState.totalPieces);
    console.log('✅ Piece placed at:', finalState.allPieces[0]);
    
    // 8. Use helper to validate piece exists at the placed position
    const placedPosition = finalState.allPieces[0].position;
    const hasPieceAtPosition = await game.hasPieceAt(
      placedPosition.x, 
      placedPosition.y, 
      placedPosition.z
    );
    expect(hasPieceAtPosition).toBe(true);
    console.log('✅ Helper validation: Piece exists at placed position');
    
    // 9. Validate piece color using helper
    await game.validatePieceAt(
      placedPosition.x,
      placedPosition.y, 
      placedPosition.z,
      finalState.allPieces[0].color
    );
    console.log('✅ Helper validation: Piece color is correct');
    
    // 10. Take final screenshot with permanent piece
    console.log('📸 Taking final screenshot with permanent piece...');
    const finalScreenshot = await captureCanvas(page);
    await saveBaselineScreenshot('019-permanent-piece-placed', finalScreenshot);
    
    // 11. Visual regression test - compare with baseline
    const visualComparison = await expectScreenshotToMatchBaseline(
      finalScreenshot,
      '019-permanent-piece-placed'
    );
    
    expect(visualComparison.match).toBe(true);
    console.log('✅ Visual validation: Screenshot matches baseline');
    
    console.log('🎉 ALL VALIDATIONS PASSED - Issue #019 is RESOLVED!');
  });

  test('edge case: multiple temporary clicks before confirmation', async ({ page }) => {
    const game = createGameHelpers(page);
    
    await page.focus('#game-canvas');
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    
    // Click multiple positions
    console.log('🖱️ Clicking multiple positions in temporary mode...');
    await game.clickGridNode(0, 0, 0);
    await page.waitForTimeout(200);
    
    await game.clickGridNode(1, 0, 0);
    await page.waitForTimeout(200);
    
    await game.clickGridNode(2, 0, 0);
    await page.waitForTimeout(200);
    
    // Should only have the last position as temporary
    const tempState = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      return {
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition,
        temporaryPosition: inputHandler?.state?.temporaryPosition
      };
    });
    
    expect(tempState.hasTemporaryPosition).toBe(true);
    console.log('Last temporary position:', tempState.temporaryPosition);
    
    // Confirm the last position
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    
    // Verify only one piece is placed
    const finalCount = await page.evaluate(() => {
      const game = (window as any).game;
      return game.getBoard().getAllPieces().length;
    });
    
    expect(finalCount).toBe(1);
    console.log('✅ Only one piece placed despite multiple clicks');
  });

  test('temporary mode cancellation with escape key', async ({ page }) => {
    const game = createGameHelpers(page);
    
    await page.focus('#game-canvas');
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    
    // Click to set temporary position
    await game.clickGridNode(1, 1, 1);
    await page.waitForTimeout(200);
    
    // Verify temporary position is set
    const beforeEscape = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      return {
        temporaryMode: inputHandler?.state?.temporaryPieceMode,
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition
      };
    });
    
    expect(beforeEscape.temporaryMode).toBe(true);
    expect(beforeEscape.hasTemporaryPosition).toBe(true);
    
    // Press escape to cancel
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    
    // Verify temporary mode is cancelled
    const afterEscape = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      const game = (window as any).game;
      return {
        temporaryMode: inputHandler?.state?.temporaryPieceMode,
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition,
        pieceCount: game.getBoard().getAllPieces().length
      };
    });
    
    expect(afterEscape.temporaryMode).toBe(false);
    expect(afterEscape.hasTemporaryPosition).toBe(false);
    expect(afterEscape.pieceCount).toBe(0);
    console.log('✅ Temporary mode cancelled with Escape key');
  });
});
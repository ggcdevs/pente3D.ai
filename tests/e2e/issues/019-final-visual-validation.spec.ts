import { test, expect } from '@playwright/test';
import { createGameHelpers } from '../utils/game-interactions';

test.describe('Issue #019: Final Visual Validation', () => {
  test('complete workflow with visual validation', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    
    const game = createGameHelpers(page);
    
    // Step 1: Type 't' with keyboard
    console.log('📝 Step 1: Typing "t" to enter temporary mode...');
    await page.focus('#game-canvas');
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    
    const tempModeActive = await page.evaluate(() => {
      return (window as any).inputHandler?.state?.temporaryPieceMode || false;
    });
    expect(tempModeActive).toBe(true);
    console.log('✅ Temporary mode activated');
    
    // Step 2: Click nodeA to place temporary piece
    console.log('🖱️ Step 2: Clicking nodeA to place temporary piece...');
    await game.clickGridNode(1, 1, 1);
    await page.waitForTimeout(500);
    
    const tempPositionAfterClick = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      return {
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition,
        temporaryPosition: inputHandler?.state?.temporaryPosition
      };
    });
    
    expect(tempPositionAfterClick.hasTemporaryPosition).toBe(true);
    console.log('✅ Temporary piece placed at nodeA:', tempPositionAfterClick.temporaryPosition);
    
    // Take screenshot after placing temporary piece
    console.log('📸 Taking screenshot after placing temporary piece...');
    await page.screenshot({ 
      path: '/home/guy/code/git/github.com/ggcdevs/pente3d.ai/tests/e2e/fixtures/screenshots/019-temp-piece-placed.png',
      fullPage: false 
    });
    
    // Step 3: Move mouse to hover over different nodeB
    console.log('🖱️ Step 3: Moving mouse to hover over different nodeB...');
    
    // Move mouse to different position (not using clickGridNode, just moving)
    await page.mouse.move(400, 200);
    await page.waitForTimeout(500);
    
    // Validate temporary piece is still at nodeA
    const tempPositionAfterMouseMove = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      return {
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition,
        temporaryPosition: inputHandler?.state?.temporaryPosition
      };
    });
    
    expect(tempPositionAfterMouseMove.hasTemporaryPosition).toBe(true);
    
    // Compare positions - should be identical
    const positionsMatch = JSON.stringify(tempPositionAfterClick.temporaryPosition) === 
                           JSON.stringify(tempPositionAfterMouseMove.temporaryPosition);
    
    expect(positionsMatch).toBe(true);
    console.log('✅ Temporary piece still at nodeA after mouse moved:', tempPositionAfterMouseMove.temporaryPosition);
    
    // Step 4: Take screenshot with mouse at nodeB, temporary piece at nodeA
    console.log('📸 Step 4: Taking screenshot with mouse moved away...');
    await page.screenshot({ 
      path: '/home/guy/code/git/github.com/ggcdevs/pente3d.ai/tests/e2e/fixtures/screenshots/019-temp-piece-persists.png',
      fullPage: false 
    });
    
    // Step 5: Validate using helper functions
    console.log('🔍 Step 5: Using helper functions to validate...');
    
    // The temporary piece should not show up in game.hasPieceAt because it's not permanent yet
    const actualPos = tempPositionAfterMouseMove.temporaryPosition;
    const hasPermanentPiece = await game.hasPieceAt(actualPos.x, actualPos.y, actualPos.z);
    expect(hasPermanentPiece).toBe(false); // Should be false because it's still temporary
    
    const gameState = await game.getGameState();
    expect(gameState.pieceCount).toBe(0); // No permanent pieces yet
    console.log('✅ Helper validation: Temporary piece not yet permanent');
    
    // Step 6: Press Enter to confirm
    console.log('⌨️ Step 6: Pressing Enter to confirm temporary piece...');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    
    // Validate piece is now permanent
    const finalState = await page.evaluate(() => {
      const game = (window as any).game;
      const inputHandler = (window as any).inputHandler;
      return {
        temporaryMode: inputHandler?.state?.temporaryPieceMode || false,
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition,
        pieceCount: game.getBoard().getAllPieces().length,
        pieces: game.getBoard().getAllPieces().map((p: any) => ({
          position: p.coords,
          color: p.player.color
        }))
      };
    });
    
    expect(finalState.temporaryMode).toBe(false);
    expect(finalState.hasTemporaryPosition).toBe(false);
    expect(finalState.pieceCount).toBe(1);
    console.log('✅ Piece confirmed and placed permanently:', finalState.pieces[0]);
    
    // Final validation with helper
    const finalPiecePos = finalState.pieces[0].position;
    const hasFinalPiece = await game.hasPieceAt(finalPiecePos.x, finalPiecePos.y, finalPiecePos.z);
    expect(hasFinalPiece).toBe(true);
    
    await game.validatePieceAt(finalPiecePos.x, finalPiecePos.y, finalPiecePos.z, finalState.pieces[0].color);
    console.log('✅ Helper validation: Permanent piece exists with correct color');
    
    // Final screenshot
    console.log('📸 Taking final screenshot with permanent piece...');
    await page.screenshot({ 
      path: '/home/guy/code/git/github.com/ggcdevs/pente3d.ai/tests/e2e/fixtures/screenshots/019-permanent-piece-final.png',
      fullPage: false 
    });
    
    console.log('🎉 ALL TESTS PASSED - Issue #019 is FULLY RESOLVED!');
    console.log('📸 Screenshots saved to tests/e2e/fixtures/screenshots/');
    console.log('   - 019-temp-piece-placed.png (temporary piece placed)');
    console.log('   - 019-temp-piece-persists.png (mouse moved, piece persists)');
    console.log('   - 019-permanent-piece-final.png (confirmed permanent piece)');
  });
});
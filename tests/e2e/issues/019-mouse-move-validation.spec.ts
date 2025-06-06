import { test, expect } from '@playwright/test';
import { createGameHelpers } from '../utils/game-interactions';
import { captureCanvas } from '../utils/threejs-helpers';
import { saveBaselineScreenshot } from '../utils/visual-regression';

test.describe('Issue #019: Mouse Move Away Validation', () => {
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

  test('temporary piece should persist after moving mouse away', async ({ page }) => {
    const game = createGameHelpers(page);
    
    // Focus canvas
    await page.focus('#game-canvas');
    await page.waitForTimeout(100);
    
    // 1. Type 't' to enter temporary mode
    console.log('🔄 Step 1: Entering temporary mode with "t" key...');
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    
    // Verify temporary mode is active
    const tempModeActive = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      return inputHandler?.state?.temporaryPieceMode || false;
    });
    expect(tempModeActive).toBe(true);
    console.log('✅ Temporary mode activated');
    
    // 2. Click on nodeA to place temporary piece
    console.log('🖱️ Step 2: Clicking on nodeA (1, 1, 1) to place temporary piece...');
    await game.clickGridNode(1, 1, 1);
    await page.waitForTimeout(500);
    
    // Verify temporary piece is placed at nodeA
    const afterClick = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      return {
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition,
        temporaryPosition: inputHandler?.state?.temporaryPosition,
        temporaryModeStillActive: inputHandler?.state?.temporaryPieceMode
      };
    });
    
    expect(afterClick.hasTemporaryPosition).toBe(true);
    expect(afterClick.temporaryModeStillActive).toBe(true);
    console.log('✅ Temporary position set at nodeA:', afterClick.temporaryPosition);
    
    // Get canvas for mouse movement
    const canvas = page.locator('#game-canvas');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('Canvas not found');
    
    // 3. Move mouse to hover over different nodeB
    console.log('🖱️ Step 3: Moving mouse to hover over different nodeB (2, 2, 2)...');
    
    // Get screen position of nodeB using helper
    const nodeBScreenPos = await game.getWorldToScreen({ x: 2, y: 2, z: 2 });
    const nodeBAbsoluteX = canvasBox.x + nodeBScreenPos.x;
    const nodeBAbsoluteY = canvasBox.y + nodeBScreenPos.y;
    
    console.log(`Moving mouse to nodeB at screen position: (${nodeBAbsoluteX}, ${nodeBAbsoluteY})`);
    
    // Move mouse gradually to nodeB to simulate realistic movement
    const currentMousePos = await page.evaluate(() => {
      const event = (window as any).lastMouseEvent || { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 };
      return { x: event.clientX, y: event.clientY };
    });
    
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      const currentX = currentMousePos.x + (nodeBAbsoluteX - currentMousePos.x) * progress;
      const currentY = currentMousePos.y + (nodeBAbsoluteY - currentMousePos.y) * progress;
      await page.mouse.move(currentX, currentY);
      await page.waitForTimeout(20);
    }
    
    // Wait a moment for hover effects to settle
    await page.waitForTimeout(300);
    console.log('✅ Mouse moved to nodeB');
    
    // 4. Validate that temporary piece is still at nodeA (not following mouse)
    console.log('🔍 Step 4: Validating temporary piece is still at nodeA...');
    
    // Check that temporary position hasn't changed
    const afterMouseMove = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      return {
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition,
        temporaryPosition: inputHandler?.state?.temporaryPosition,
        temporaryModeStillActive: inputHandler?.state?.temporaryPieceMode
      };
    });
    
    expect(afterMouseMove.hasTemporaryPosition).toBe(true);
    expect(afterMouseMove.temporaryModeStillActive).toBe(true);
    
    // The temporary position should still be at nodeA, not at nodeB
    expect(afterMouseMove.temporaryPosition).toEqual(afterClick.temporaryPosition);
    console.log('✅ Helper validation: Temporary piece still at nodeA:', afterMouseMove.temporaryPosition);
    
    // 5. Take visual screenshot to confirm temporary piece is at nodeA while hovering nodeB
    console.log('📸 Step 5: Taking screenshot with mouse at nodeB, temporary piece at nodeA...');
    const screenshotAfterMove = await captureCanvas(page);
    await saveBaselineScreenshot('019-temp-piece-persists-mouse-moved', screenshotAfterMove);
    console.log('✅ Visual screenshot saved');
    
    // 6. Additional validation: Check game state doesn't show permanent piece yet
    const gameState = await page.evaluate(() => {
      const game = (window as any).game;
      return {
        totalPermanentPieces: game.getBoard().getAllPieces().length,
        hasPermanentPieceAtNodeA: !!game.getBoard().getPieceAt(afterClick.temporaryPosition),
        hasPermanentPieceAtNodeB: !!game.getBoard().getPieceAt({ x: 2, y: 2, z: 2 })
      };
    });
    
    expect(gameState.totalPermanentPieces).toBe(0); // No permanent pieces yet
    expect(gameState.hasPermanentPieceAtNodeA).toBe(false); // Temporary piece shouldn't be in game board
    expect(gameState.hasPermanentPieceAtNodeB).toBe(false); // No piece at nodeB either
    console.log('✅ Game state validation: No permanent pieces yet');
    
    // 7. Confirm with Enter to verify the temporary piece becomes permanent at nodeA
    console.log('⌨️ Step 6: Pressing Enter to confirm temporary piece...');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    
    const finalState = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      const game = (window as any).game;
      const pieces = game.getBoard().getAllPieces();
      
      return {
        temporaryModeActive: inputHandler?.state?.temporaryPieceMode || false,
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition,
        totalPermanentPieces: pieces.length,
        permanentPiecePositions: pieces.map((p: any) => p.coords)
      };
    });
    
    expect(finalState.temporaryModeActive).toBe(false);
    expect(finalState.hasTemporaryPosition).toBe(false);
    expect(finalState.totalPermanentPieces).toBe(1);
    
    // The permanent piece should be at the original temporary position (nodeA)
    const permanentPiecePos = finalState.permanentPiecePositions[0];
    expect(permanentPiecePos).toEqual(afterClick.temporaryPosition);
    console.log('✅ Final validation: Permanent piece placed at original temporary position');
    
    // Take final screenshot
    const finalScreenshot = await captureCanvas(page);
    await saveBaselineScreenshot('019-permanent-piece-at-nodeA', finalScreenshot);
    
    console.log('🎉 ALL VALIDATIONS PASSED!');
    console.log('✅ Temporary piece stayed at nodeA even when mouse moved to nodeB');
    console.log('✅ Enter key placed permanent piece at correct location (nodeA)');
  });

  test('hover vs click behavior difference', async ({ page }) => {
    const game = createGameHelpers(page);
    
    await page.focus('#game-canvas');
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    
    // Get canvas for direct mouse control
    const canvas = page.locator('#game-canvas');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('Canvas not found');
    
    // Test 1: Just hover (no click) - should show preview but not set temporary position
    console.log('🖱️ Test 1: Hovering over node without clicking...');
    const nodePos = await game.getWorldToScreen({ x: 1, y: 1, z: 1 });
    await page.mouse.move(canvasBox.x + nodePos.x, canvasBox.y + nodePos.y);
    await page.waitForTimeout(300);
    
    const afterHover = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      return {
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition,
        temporaryPosition: inputHandler?.state?.temporaryPosition
      };
    });
    
    console.log('After hover only - temporary position:', afterHover.temporaryPosition);
    
    // Test 2: Click to actually place temporary piece
    console.log('🖱️ Test 2: Clicking to place temporary piece...');
    await page.mouse.click(canvasBox.x + nodePos.x, canvasBox.y + nodePos.y);
    await page.waitForTimeout(300);
    
    const afterClick = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      return {
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition,
        temporaryPosition: inputHandler?.state?.temporaryPosition
      };
    });
    
    console.log('After click - temporary position:', afterClick.temporaryPosition);
    
    // The click should have set a temporary position
    expect(afterClick.hasTemporaryPosition).toBe(true);
    
    // Test 3: Move mouse away and verify temporary piece persists
    console.log('🖱️ Test 3: Moving mouse away from clicked position...');
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.8, canvasBox.y + canvasBox.height * 0.8);
    await page.waitForTimeout(300);
    
    const afterMoveAway = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      return {
        hasTemporaryPosition: !!inputHandler?.state?.temporaryPosition,
        temporaryPosition: inputHandler?.state?.temporaryPosition
      };
    });
    
    // Temporary position should still be the same
    expect(afterMoveAway.hasTemporaryPosition).toBe(true);
    expect(afterMoveAway.temporaryPosition).toEqual(afterClick.temporaryPosition);
    console.log('✅ Temporary piece persisted after mouse moved away');
  });
});
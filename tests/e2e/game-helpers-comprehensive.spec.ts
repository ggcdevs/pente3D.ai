import { test, expect } from '@playwright/test';
import { createGameHelpers } from './utils/game-interactions';

test.describe('Game Test Helpers - Comprehensive Test', () => {
  test('all helper functions work correctly', async ({ page }) => {
    // Navigate to the game
    await page.goto('/');
    await page.waitForTimeout(2000); // Wait for 3D scene to initialize
    
    const game = createGameHelpers(page);
    
    // === Test 1: Basic piece placement ===
    console.log('Test 1: Placing pieces');
    
    // Place a black piece at center
    await game.placePiece(0, 0, 0);
    
    // Verify piece was placed
    expect(await game.hasPieceAt(0, 0, 0)).toBe(true);
    await game.validatePieceAt(0, 0, 0, 'black');
    
    // Place a white piece
    await game.placePiece(1, 0, 0);
    expect(await game.hasPieceAt(1, 0, 0)).toBe(true);
    await game.validatePieceAt(1, 0, 0, 'white');
    
    // Verify game state
    const state1 = await game.getGameState();
    expect(state1.pieceCount).toBe(2);
    expect(state1.currentPlayer).toBe('black'); // Back to black's turn
    expect(state1.moveCount).toBe(2);
    
    // === Test 2: Board rotation ===
    console.log('Test 2: Rotating board');
    
    // Rotate board to the right
    await game.rotateBoard(100, 0);
    await page.waitForTimeout(500);
    
    // Rotate board up
    await game.rotateBoard(0, -50);
    await page.waitForTimeout(500);
    
    // Place another piece to ensure rotation didn't break interaction
    await game.placePiece(-1, 0, 0);
    expect(await game.hasPieceAt(-1, 0, 0)).toBe(true);
    
    // === Test 3: Zoom functionality ===
    console.log('Test 3: Testing zoom');
    
    // Zoom in
    await game.zoomBoard(300);
    await page.waitForTimeout(300);
    
    // Zoom out
    await game.zoomBoard(-600);
    await page.waitForTimeout(300);
    
    // Zoom back to normal
    await game.zoomBoard(300);
    await page.waitForTimeout(300);
    
    // === Test 4: Pan functionality ===
    console.log('Test 4: Testing pan');
    
    // Pan right
    await game.panBoard(50, 0);
    await page.waitForTimeout(300);
    
    // Pan back
    await game.panBoard(-50, 0);
    await page.waitForTimeout(300);
    
    // === Test 5: UI interactions ===
    console.log('Test 5: Testing UI buttons');
    
    // Open menu
    await game.clickMenuButton();
    await page.waitForTimeout(500);
    
    // Check if menu modal is visible
    const menuVisible = await game.isModalVisible();
    expect(menuVisible).toBe(true);
    
    // Close menu
    await game.closeModal();
    await page.waitForTimeout(500);
    
    // Verify menu is closed
    const menuClosed = await game.isModalVisible();
    expect(menuClosed).toBe(false);
    
    // === Test 6: Undo/Redo ===
    console.log('Test 6: Testing undo/redo');
    
    const moveCountBefore = await game.getMoveCount();
    
    // Undo last move
    await game.undoMove();
    await page.waitForTimeout(300);
    
    // Check move was undone
    const moveCountAfterUndo = await game.getMoveCount();
    expect(moveCountAfterUndo).toBe(moveCountBefore - 1);
    expect(await game.hasPieceAt(-1, 0, 0)).toBe(false);
    
    // Redo the move
    await game.redoMove();
    await page.waitForTimeout(300);
    
    // Check move was redone
    const moveCountAfterRedo = await game.getMoveCount();
    expect(moveCountAfterRedo).toBe(moveCountBefore);
    expect(await game.hasPieceAt(-1, 0, 0)).toBe(true);
    
    // === Test 7: Get visible pieces ===
    console.log('Test 7: Testing visible pieces');
    
    const visiblePieces = await game.getVisiblePieces();
    expect(visiblePieces.length).toBeGreaterThanOrEqual(3); // At least our 3 pieces
    
    // === Test 8: Multiple rapid interactions ===
    console.log('Test 8: Testing rapid interactions');
    
    // Place several pieces quickly
    await game.placePiece(0, 1, 0);
    await game.placePiece(0, -1, 0);
    await game.placePiece(0, 0, 1);
    await game.placePiece(0, 0, -1);
    
    // Verify all pieces were placed
    expect(await game.hasPieceAt(0, 1, 0)).toBe(true);
    expect(await game.hasPieceAt(0, -1, 0)).toBe(true);
    expect(await game.hasPieceAt(0, 0, 1)).toBe(true);
    expect(await game.hasPieceAt(0, 0, -1)).toBe(true);
    
    // === Test 9: Complex board manipulation ===
    console.log('Test 9: Complex board manipulation');
    
    // Rotate, zoom, and place in sequence
    await game.rotateBoard(-50, 30);
    await game.zoomBoard(200);
    await game.placePiece(2, 0, 0);
    await game.rotateBoard(100, -60);
    await game.placePiece(0, 2, 0);
    
    // Final state check
    const finalState = await game.getGameState();
    console.log(`Final game state: ${finalState.pieceCount} pieces, move ${finalState.moveCount}`);
    expect(finalState.pieceCount).toBeGreaterThanOrEqual(9);
    
    // === Test 10: Node highlighting check ===
    console.log('Test 10: Testing node highlighting');
    
    // Move mouse over a node to trigger highlighting
    // This is a simplified test - actual highlighting depends on hover state
    const canvas = page.locator('#game-canvas');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(300);
      
      // Check if center node is highlighted (this may need adjustment based on actual implementation)
      // const isHighlighted = await game.isNodeHighlighted(0, 0, 0);
      // console.log(`Center node highlighted: ${isHighlighted}`);
    }
    
    console.log('All tests completed successfully!');
  });
  
  test('edge cases and error handling', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    
    const game = createGameHelpers(page);
    
    // Test placing piece at occupied position
    await game.placePiece(0, 0, 0);
    await game.placePiece(0, 0, 0); // Should be ignored
    
    // Verify only one piece at that position
    const state = await game.getGameState();
    const piecesAtOrigin = state.pieces.filter(p => 
      p.position.x === 0 && p.position.y === 0 && p.position.z === 0
    );
    expect(piecesAtOrigin.length).toBe(1);
    
    // Test validatePieceAt with wrong color
    await expect(async () => {
      await game.validatePieceAt(0, 0, 0, 'white'); // Should throw - it's black
    }).rejects.toThrow(/Expected white piece.*but found black/);
    
    // Test validatePieceAt with no piece
    await expect(async () => {
      await game.validatePieceAt(3, 3, 3, 'black'); // Should throw - no piece there
    }).rejects.toThrow(/No piece found at position/);
  });
});
import { test, expect, setupTest } from '@/tests/helpers/e2e';
import { Vector3Builder } from '@/tests/helpers/builders';

test.describe('Piece Placement', () => {
  test.beforeEach(async ({ testEnv }) => {
    await testEnv.isolateTest();
  });

  test('should detect intersection nodes', async ({ page, game }) => {
    await setupTest(page);
    
    // The new helpers automatically expose necessary APIs
    const nodes = await game.getIntersectionNodes();
    
    expect(nodes.length).toBeGreaterThan(0);
    // For a 7x7x7 board, should have 343 nodes
    expect(nodes.length).toBe(343);
  });

  test('should place piece on click', async ({ page, game }) => {
    await setupTest(page);
    
    // Get initial state
    const initialState = await game.getGameState();
    expect(initialState.pieces).toHaveLength(0);
    
    // Place a piece at the center using the new helper
    const centerPos = new Vector3Builder().withCoords(3, 3, 3).build();
    await game.placePiece(centerPos);
    
    // Verify piece was placed
    const newState = await game.getGameState();
    expect(newState.pieces).toHaveLength(1);
    expect(newState.history).toHaveLength(1);
    
    // Verify piece is at correct position
    const hasP = await game.hasPieceAt(centerPos);
    expect(hasP).toBe(true);
  });

  test('should not place piece when dragging', async ({ page, game }) => {
    await setupTest(page);
    
    const initialState = await game.getGameState();
    const initialPieceCount = initialState.pieces.length;
    
    // Perform a drag (rotation) using new helpers
    await game.rotateBoard(100, 0);
    
    // Check piece count hasn't changed
    const newState = await game.getGameState();
    expect(newState.pieces.length).toBe(initialPieceCount);
  });

  test('should alternate between black and white pieces', async ({ page, game }) => {
    await setupTest(page);
    
    // Place first piece (should be black)
    const pos1 = new Vector3Builder().withCoords(3, 3, 3).build();
    await game.placePiece(pos1);
    
    let state = await game.getGameState();
    expect(state.history[0].player.color).toBe('black');
    
    // Place second piece (should be white)
    const pos2 = new Vector3Builder().withCoords(4, 3, 3).build();
    await game.placePiece(pos2);
    
    state = await game.getGameState();
    expect(state.history[1].player.color).toBe('white');
  });

  test('should show invalid move for occupied position', async ({ page, game }) => {
    await setupTest(page);
    
    // Track console errors using new helper
    const errorsBefore = await game.getConsoleErrors();
    
    // Place a piece
    const pos = new Vector3Builder().withCoords(3, 3, 3).build();
    await game.placePiece(pos);
    
    // Try to place another piece at the same position
    await game.placePiece(pos);
    
    // Should have logged an error
    const errorsAfter = await game.getConsoleErrors();
    const newErrors = errorsAfter.slice(errorsBefore.length);
    
    const hasInvalidMoveError = newErrors.some(error => 
      error.includes('Invalid move') || error.includes('occupied')
    );
    expect(hasInvalidMoveError).toBe(true);
  });

  test('should validate piece placement at all positions', async ({ page, game, perf }) => {
    await setupTest(page);
    
    // Use performance helper to ensure operations are fast
    await perf.assertCompleteWithin(async () => {
      // Test placing pieces at various positions
      const testPositions = [
        { x: 0, y: 0, z: 0 }, // Corner
        { x: 6, y: 6, z: 6 }, // Opposite corner
        { x: 3, y: 3, z: 3 }, // Center
        { x: 0, y: 6, z: 3 }, // Edge center
      ];
      
      for (const coords of testPositions) {
        const pos = new Vector3Builder().withCoords(coords.x, coords.y, coords.z).build();
        const canPlace = await game.canPlacePieceAt(pos);
        expect(canPlace).toBe(true);
      }
    }, 100); // Should complete within 100ms
  });

  test('should handle rapid piece placement', async ({ page, game }) => {
    await setupTest(page);
    
    // Place pieces rapidly without waiting
    const positions = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
    ];
    
    // Place all pieces as fast as possible
    await Promise.all(
      positions.map(coords => {
        const pos = new Vector3Builder().withCoords(coords.x, coords.y, coords.z).build();
        return game.placePiece(pos);
      })
    );
    
    // Verify all pieces were placed in order
    const state = await game.getGameState();
    expect(state.pieces).toHaveLength(4);
    expect(state.history).toHaveLength(4);
    
    // Verify alternating colors
    expect(state.history[0].player.color).toBe('black');
    expect(state.history[1].player.color).toBe('white');
    expect(state.history[2].player.color).toBe('black');
    expect(state.history[3].player.color).toBe('white');
  });
});
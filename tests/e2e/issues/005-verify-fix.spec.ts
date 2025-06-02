import { test, expect } from '@playwright/test';

test.describe('Issue #005 Fix Verification', () => {
  test('verify pieces can be placed', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Place multiple pieces to verify the game works
    const positions = [
      { x: 0, y: 0, z: 0 },    // Center
      { x: 1, y: 0, z: 0 },    // Adjacent
      { x: -1, y: 0, z: 0 },   // Other side
      { x: 0, y: 1, z: 0 },    // Above
      { x: 0, y: 0, z: 1 },    // Behind
    ];
    
    let placedCount = 0;
    
    for (const pos of positions) {
      const result = await page.evaluate((position) => {
        const game = (window as any).game;
        const board = game.getBoard();
        
        // Check if position is empty
        const piece = board.getPieceAt(position);
        if (piece) {
          return { placed: false, reason: 'occupied' };
        }
        
        // Try to place piece
        const success = game.placePiece(position);
        return { 
          placed: success, 
          pieceCount: board.getAllPieces().length,
          currentPlayer: game.getCurrentPlayer().getColor()
        };
      }, pos);
      
      console.log(`Position (${pos.x},${pos.y},${pos.z}):`, result);
      
      if (result.placed) {
        placedCount++;
        expect(result.pieceCount).toBe(placedCount);
        // Verify alternating colors
        const expectedColor = placedCount % 2 === 1 ? 'white' : 'black';
        expect(result.currentPlayer).toBe(expectedColor);
      }
    }
    
    // Should have placed all 5 pieces
    expect(placedCount).toBe(5);
    
    // Verify visual pieces exist
    const visualPieces = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const scene = renderer.getScene();
      let pieceCount = 0;
      
      scene.traverse((child: any) => {
        if (child.type === 'Mesh' && child.geometry?.type === 'SphereGeometry') {
          // Check if it's a piece (not a node)
          const radius = child.geometry.parameters.radius;
          if (radius > 0.3) { // Pieces are 0.4, nodes are 0.08
            pieceCount++;
          }
        }
      });
      
      return pieceCount;
    });
    
    console.log('Visual pieces in scene:', visualPieces);
    expect(visualPieces).toBeGreaterThanOrEqual(5);
  });
});
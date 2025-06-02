import { test, expect } from '@playwright/test';

test.describe('Issue #005: Coordinate System Test', () => {
  test('check board coordinate system', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', msg => {
      logs.push(`[${msg.type()}] ${msg.text()}`);
    });

    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Test board coordinate system
    const coordInfo = await page.evaluate(() => {
      const game = (window as any).game;
      const board = game.getBoard();
      const size = board.getSize();
      
      // Test various positions
      const testPositions = [
        { x: 0, y: 0, z: 0 },    // Center
        { x: 3, y: 3, z: 3 },    // Corner (if 0-6 range)
        { x: -3, y: -3, z: -3 }, // Corner (if centered range)
        { x: 6, y: 6, z: 6 },    // Out of bounds for size 7
      ];
      
      const results = testPositions.map(pos => ({
        position: pos,
        inBounds: board.isInBounds(pos),
        canPlace: game.placePiece(pos)
      }));
      
      return {
        boardSize: size,
        results
      };
    });
    
    console.log('Coordinate system test:', coordInfo);
    
    // The board should use centered coordinates (-3 to 3 for size 7)
    expect(coordInfo.boardSize).toBe(7);
    expect(coordInfo.results[0].inBounds).toBe(true);  // (0,0,0) should be in bounds
    expect(coordInfo.results[1].inBounds).toBe(false); // (3,3,3) should be at edge/out
    expect(coordInfo.results[2].inBounds).toBe(true);  // (-3,-3,-3) should be in bounds
    expect(coordInfo.results[3].inBounds).toBe(false); // (6,6,6) should be out of bounds
  });

  test('check renderer coordinate mapping', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    
    const nodeInfo = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const scene = renderer.getScene();
      
      // Find all intersection nodes
      const nodes: any[] = [];
      scene.traverse((child: any) => {
        if (child.userData?.type === 'intersection') {
          nodes.push({
            worldPosition: {
              x: child.position.x,
              y: child.position.y,
              z: child.position.z
            },
            storedPosition: child.userData.position
          });
        }
      });
      
      return {
        nodeCount: nodes.length,
        sampleNodes: nodes.slice(0, 5),
        centerNode: nodes.find(n => 
          n.storedPosition.x === 0 && 
          n.storedPosition.y === 0 && 
          n.storedPosition.z === 0
        )
      };
    });
    
    console.log('Renderer coordinate mapping:', nodeInfo);
    
    // Should have 7^3 = 343 nodes
    expect(nodeInfo.nodeCount).toBe(343);
    
    // Check if stored positions are in 0-6 range but board expects -3 to 3
    console.log('Sample nodes:', nodeInfo.sampleNodes);
    console.log('Center node:', nodeInfo.centerNode);
  });
});
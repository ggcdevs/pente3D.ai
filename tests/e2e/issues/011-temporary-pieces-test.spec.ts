import { test, expect } from '@playwright/test';

test.describe('Issue #011: Temporary Pieces Position Test', () => {
  test('verify temporary pieces appear at correct position', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Press 't' to enter temporary mode
    await page.keyboard.press('t');
    await page.waitForTimeout(100);
    
    // Get a specific node position and hover over it
    const nodeTest = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const inputHandler = (window as any).inputHandler;
      const scene = renderer.getScene();
      
      // Find a specific node (e.g., at board position 0,0,0)
      let targetNode: any = null;
      let nodeWorldPos: any = null;
      
      scene.traverse((child: any) => {
        if (child.userData?.type === 'intersection') {
          const pos = child.userData.position;
          if (pos && pos.x === 0 && pos.y === 0 && pos.z === 0) {
            targetNode = child;
            nodeWorldPos = {
              x: child.position.x,
              y: child.position.y,
              z: child.position.z
            };
          }
        }
      });
      
      return {
        foundNode: !!targetNode,
        nodeWorldPos,
        boardPos: targetNode?.userData?.position,
        temporaryMode: inputHandler.getState().temporaryPieceMode
      };
    });
    
    console.log('Node test:', nodeTest);
    expect(nodeTest.foundNode).toBe(true);
    expect(nodeTest.temporaryMode).toBe(true);
    
    // Simulate hovering over the center node by triggering the hover event
    await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const game = (window as any).game;
      const centerPos = { x: 0, y: 0, z: 0 };
      
      // Manually call setTemporaryPiece to test positioning
      renderer.setTemporaryPiece(centerPos, game.getCurrentPlayer());
    });
    
    await page.waitForTimeout(100);
    
    // Check if temporary piece is at the correct position
    const tempPieceTest = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const scene = renderer.getScene();
      
      // Find the temporary piece
      let tempPiece: any = null;
      let tempPieceWorldPos: any = null;
      
      // Check the renderer's temporary piece reference
      if (renderer.temporaryPiece) {
        tempPiece = renderer.temporaryPiece;
        tempPieceWorldPos = {
          x: tempPiece.position.x,
          y: tempPiece.position.y,
          z: tempPiece.position.z
        };
      }
      
      // Also check temporaryPiecesGroup
      const tempGroup = renderer.temporaryPiecesGroup || scene.children.find((c: any) => 
        c.type === 'Group' && c.children.some((child: any) => 
          child.type === 'Mesh' && child.geometry?.type === 'SphereGeometry'
        )
      );
      
      return {
        hasTempPiece: !!tempPiece,
        tempPieceWorldPos,
        tempGroupChildCount: tempGroup?.children.length || 0
      };
    });
    
    console.log('Temporary piece test:', tempPieceTest);
    expect(tempPieceTest.hasTempPiece).toBe(true);
    
    // The temporary piece should be at the same world position as the node
    expect(tempPieceTest.tempPieceWorldPos.x).toBeCloseTo(nodeTest.nodeWorldPos.x);
    expect(tempPieceTest.tempPieceWorldPos.y).toBeCloseTo(nodeTest.nodeWorldPos.y);
    expect(tempPieceTest.tempPieceWorldPos.z).toBeCloseTo(nodeTest.nodeWorldPos.z);
  });
  
  test('verify temporary pieces work at different positions', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Press 't' to enter temporary mode
    await page.keyboard.press('t');
    
    // Test multiple positions
    const positions = [
      { x: -3, y: -3, z: -3 }, // Corner
      { x: 0, y: 0, z: 0 },     // Center
      { x: 3, y: 3, z: 3 },     // Opposite corner
      { x: -2, y: 1, z: 3 },    // Random position
    ];
    
    for (const pos of positions) {
      const result = await page.evaluate(async (testPos) => {
        const renderer = (window as any).renderer;
        const game = (window as any).game;
        const scene = renderer.getScene();
        
        // Clear any existing temporary piece
        renderer.clearTemporaryPiece();
        
        // Find the node at this position
        let nodeWorldPos: any = null;
        scene.traverse((child: any) => {
          if (child.userData?.type === 'intersection') {
            const nodePos = child.userData.position;
            if (nodePos && nodePos.x === testPos.x && nodePos.y === testPos.y && nodePos.z === testPos.z) {
              nodeWorldPos = {
                x: child.position.x,
                y: child.position.y,
                z: child.position.z
              };
            }
          }
        });
        
        // Set temporary piece
        renderer.setTemporaryPiece(testPos, game.getCurrentPlayer());
        
        // Get temporary piece position
        const tempPiece = renderer.temporaryPiece;
        const tempWorldPos = tempPiece ? {
          x: tempPiece.position.x,
          y: tempPiece.position.y,
          z: tempPiece.position.z
        } : null;
        
        return {
          boardPos: testPos,
          nodeWorldPos,
          tempWorldPos,
          matches: nodeWorldPos && tempWorldPos && 
            Math.abs(nodeWorldPos.x - tempWorldPos.x) < 0.001 &&
            Math.abs(nodeWorldPos.y - tempWorldPos.y) < 0.001 &&
            Math.abs(nodeWorldPos.z - tempWorldPos.z) < 0.001
        };
      }, pos);
      
      console.log(`Position (${pos.x},${pos.y},${pos.z}):`, result);
      expect(result.matches).toBe(true);
    }
  });
});
import { test, expect } from '@playwright/test';

test.describe('Issue #005: Visual Piece Rendering Test', () => {
  test('verify pieces appear visually in the 3D scene', async ({ page }) => {
    // Set up console logging
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // First, verify the scene structure
    const sceneInfo = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const scene = renderer.getScene();
      const game = (window as any).game;
      
      // Count different types of objects in the scene
      let nodeCount = 0;
      let pieceCount = 0;
      let groupInfo: any = {};
      
      scene.traverse((child: any) => {
        if (child.type === 'Group' && child.name) {
          groupInfo[child.name] = child.children.length;
        }
        
        if (child.userData?.type === 'intersection') {
          nodeCount++;
        }
        
        // Check for sphere meshes that could be pieces
        if (child.type === 'Mesh' && child.geometry?.type === 'SphereGeometry') {
          const radius = child.geometry.parameters.radius;
          // Pieces are larger (0.4) than nodes (0.08)
          if (radius > 0.3) {
            pieceCount++;
          }
        }
      });
      
      // Also check the piecesGroup specifically
      const piecesGroup = scene.children.find((c: any) => c.type === 'Group' && c.children.some((child: any) => 
        child.type === 'Mesh' && child.geometry?.type === 'SphereGeometry' && child.geometry.parameters.radius > 0.3
      ));
      
      return {
        nodeCount,
        pieceCount,
        groupInfo,
        piecesGroupFound: !!piecesGroup,
        piecesGroupChildCount: piecesGroup ? piecesGroup.children.length : 0,
        gameState: {
          pieceCount: game.getBoard().getAllPieces().length,
          moveCount: game.getHistoryLength() - 1
        }
      };
    });
    
    console.log('Initial scene info:', sceneInfo);
    expect(sceneInfo.nodeCount).toBe(343); // 7^3 nodes
    expect(sceneInfo.pieceCount).toBe(0);
    expect(sceneInfo.gameState.pieceCount).toBe(0);
    
    // Click to place a piece
    await page.click('#game-canvas');
    await page.waitForTimeout(1000);
    
    // Check for the piecePlaced event and updatePieces call
    const relevantLogs = consoleLogs.filter(log => 
      log.includes('placePiece') || 
      log.includes('updatePieces') ||
      log.includes('piecePlaced')
    );
    console.log('Relevant logs:', relevantLogs);
    
    // Check the scene after clicking
    const afterClick = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const scene = renderer.getScene();
      const game = (window as any).game;
      
      // Debug: Check if updatePieces was called
      const updatePiecesCalled = (renderer as any)._updatePiecesCalled || false;
      
      // Count pieces in the scene
      let visualPieces: any[] = [];
      scene.traverse((child: any) => {
        if (child.type === 'Mesh' && child.geometry?.type === 'SphereGeometry') {
          const radius = child.geometry.parameters.radius;
          if (radius > 0.3) {
            visualPieces.push({
              position: child.position,
              material: {
                type: child.material.type,
                color: child.material.color?.getHex()
              },
              visible: child.visible,
              parent: child.parent?.type
            });
          }
        }
      });
      
      // Get the piecesGroup
      let piecesGroup = null;
      scene.children.forEach((child: any) => {
        if (child.type === 'Group') {
          // Check if this might be the pieces group by looking for the renderer's reference
          const hasPieces = child.children.some((c: any) => 
            c.type === 'Mesh' && c.geometry?.type === 'SphereGeometry'
          );
          if (hasPieces || child === (renderer as any).piecesGroup) {
            piecesGroup = {
              type: child.type,
              childCount: child.children.length,
              visible: child.visible,
              children: child.children.map((c: any) => ({
                type: c.type,
                geometry: c.geometry?.type,
                radius: c.geometry?.parameters?.radius
              }))
            };
          }
        }
      });
      
      return {
        updatePiecesCalled,
        visualPieceCount: visualPieces.length,
        visualPieces,
        piecesGroup,
        gameState: {
          pieces: game.getBoard().getAllPieces().map((p: any) => ({
            position: p.coords,
            color: p.player.color
          })),
          moveCount: game.getHistoryLength() - 1,
          currentPlayer: game.getCurrentPlayer().getColor()
        }
      };
    });
    
    console.log('After click:', JSON.stringify(afterClick, null, 2));
    
    // Game state should show a piece
    expect(afterClick.gameState.pieces.length).toBe(1);
    expect(afterClick.gameState.moveCount).toBe(1);
    
    // Visual pieces should also exist
    expect(afterClick.visualPieceCount).toBeGreaterThan(0);
    
    // If no visual pieces, let's debug the renderer
    if (afterClick.visualPieceCount === 0) {
      const debugInfo = await page.evaluate(() => {
        const renderer = (window as any).renderer;
        
        // Try to manually call updatePieces
        renderer.updatePieces();
        
        // Check the board reference
        const board = renderer.board || (renderer as any)._board;
        
        return {
          hasBoard: !!board,
          boardSize: board?.getSize(),
          rendererState: {
            animationId: (renderer as any).animationId,
            sceneChildCount: renderer.getScene().children.length
          }
        };
      });
      
      console.log('Debug info:', debugInfo);
    }
  });
  
  test('check if renderer.updatePieces is being called', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Instrument the renderer
    await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const originalUpdatePieces = renderer.updatePieces.bind(renderer);
      let callCount = 0;
      
      renderer.updatePieces = function() {
        callCount++;
        console.log(`updatePieces called (${callCount} times)`);
        const result = originalUpdatePieces();
        console.log('updatePieces completed');
        return result;
      };
      
      (window as any).updatePiecesCallCount = () => callCount;
    });
    
    // Click to place a piece
    await page.click('#game-canvas');
    await page.waitForTimeout(500);
    
    // Check if updatePieces was called
    const callCount = await page.evaluate(() => (window as any).updatePiecesCallCount());
    console.log('updatePieces call count:', callCount);
    
    expect(callCount).toBeGreaterThan(0);
  });
});
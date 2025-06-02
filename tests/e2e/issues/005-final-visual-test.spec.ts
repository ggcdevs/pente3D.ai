import { test, expect } from '@playwright/test';

test.describe('Issue #005: Final Visual Test', () => {
  test('verify pieces appear visually after fix', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Place a piece manually via game API
    const placementResult = await page.evaluate(() => {
      const game = (window as any).game;
      const renderer = (window as any).renderer;
      const position = { x: 0, y: 0, z: 0 };
      
      // Count visual pieces before
      let beforeCount = 0;
      renderer.getScene().traverse((child: any) => {
        if (child.type === 'Mesh' && child.geometry?.type === 'SphereGeometry') {
          if (child.geometry.parameters.radius > 0.3) {
            beforeCount++;
          }
        }
      });
      
      // Place piece
      const success = game.placePiece(position);
      
      // Wait a moment for updates
      return new Promise(resolve => {
        setTimeout(() => {
          // Count visual pieces after
          let afterCount = 0;
          const pieces: any[] = [];
          renderer.getScene().traverse((child: any) => {
            if (child.type === 'Mesh' && child.geometry?.type === 'SphereGeometry') {
              if (child.geometry.parameters.radius > 0.3) {
                afterCount++;
                pieces.push({
                  position: {
                    x: child.position.x,
                    y: child.position.y,
                    z: child.position.z
                  },
                  materialColor: child.material.color?.getHex()
                });
              }
            }
          });
          
          // Also check the pieces group directly
          const piecesGroup = renderer.piecesGroup || (renderer as any)._piecesGroup;
          
          resolve({
            success,
            beforeCount,
            afterCount,
            pieces,
            piecesGroupInfo: {
              exists: !!piecesGroup,
              childCount: piecesGroup?.children.length || 0
            },
            gameState: {
              pieces: game.getBoard().getAllPieces().length
            }
          });
        }, 100);
      });
    });
    
    console.log('Placement result:', placementResult);
    
    expect(placementResult.success).toBe(true);
    expect(placementResult.gameState.pieces).toBe(1);
    expect(placementResult.afterCount).toBe(1);
    expect(placementResult.pieces.length).toBe(1);
    
    // The piece should be at world position (0,0,0) since board center is (0,0,0)
    const piece = placementResult.pieces[0];
    expect(piece.position.x).toBeCloseTo(0);
    expect(piece.position.y).toBeCloseTo(0);
    expect(piece.position.z).toBeCloseTo(0);
    
    // Material color should be black (0x000000)
    expect(piece.materialColor).toBe(0x000000);
  });
  
  test('verify click places visual piece', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Click and check
    await page.click('#game-canvas');
    await page.waitForTimeout(500);
    
    const result = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const game = (window as any).game;
      
      let visualPieces = 0;
      renderer.getScene().traverse((child: any) => {
        if (child.type === 'Mesh' && 
            child.geometry?.type === 'SphereGeometry' &&
            child.geometry.parameters.radius > 0.3) {
          visualPieces++;
        }
      });
      
      return {
        visualPieces,
        gamePieces: game.getBoard().getAllPieces().length
      };
    });
    
    console.log('Click result:', result);
    expect(result.gamePieces).toBe(1);
    expect(result.visualPieces).toBe(1);
  });
});
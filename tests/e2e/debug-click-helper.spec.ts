import { test, expect } from '@playwright/test';
import { createGameHelpers } from './utils/game-interactions';

test.describe('Debug Click Helper', () => {
  test('debug why clicks are not working', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000); // Extra time for scene to load
    
    const game = createGameHelpers(page);
    
    console.log('=== Starting debug test ===');
    
    // First, let's try a simple center click like other working tests
    console.log('Test 1: Simple center click');
    await page.click('#game-canvas');
    await page.waitForTimeout(1000);
    
    // Check if that worked
    const simpleClickResult = await page.evaluate(() => {
      const game = (window as any).game;
      const board = game.getBoard();
      const pieces = board.getAllPieces();
      return {
        pieceCount: pieces.length,
        pieces: pieces.map((p: any) => ({
          x: p.coords.x,
          y: p.coords.y,
          z: p.coords.z,
          color: p.player.color
        }))
      };
    });
    
    console.log('Simple click result:', JSON.stringify(simpleClickResult, null, 2));
    
    // Now try our helper
    console.log('\nTest 2: Using clickGridNode helper');
    try {
      await game.clickGridNode(1, 0, 0);
      console.log('clickGridNode completed without error');
    } catch (error) {
      console.error('clickGridNode failed:', error);
    }
    
    await page.waitForTimeout(1000);
    
    // Check result
    const helperClickResult = await page.evaluate(() => {
      const game = (window as any).game;
      const board = game.getBoard();
      const pieces = board.getAllPieces();
      return {
        pieceCount: pieces.length,
        pieces: pieces.map((p: any) => ({
          x: p.coords.x,
          y: p.coords.y,
          z: p.coords.z,
          color: p.player.color
        }))
      };
    });
    
    console.log('Helper click result:', JSON.stringify(helperClickResult, null, 2));
    
    // Let's also check what nodes exist in the scene
    console.log('\nTest 3: Checking scene nodes');
    const sceneInfo = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const scene = renderer.getScene();
      let nodeCount = 0;
      let sampleNodes: any[] = [];
      
      scene.traverse((child: any) => {
        if (child.userData?.type === 'intersection') {
          nodeCount++;
          if (nodeCount <= 5) {
            sampleNodes.push({
              position: child.userData.position,
              worldPos: {
                x: child.position.x,
                y: child.position.y,
                z: child.position.z
              }
            });
          }
        }
      });
      
      return {
        totalNodes: nodeCount,
        sampleNodes: sampleNodes,
        cameraPos: {
          x: renderer.getCamera().position.x,
          y: renderer.getCamera().position.y,
          z: renderer.getCamera().position.z
        }
      };
    });
    
    console.log('Scene info:', JSON.stringify(sceneInfo, null, 2));
    
    // Test if we can at least hover over a node
    console.log('\nTest 4: Testing hover');
    const canvas = page.locator('#game-canvas');
    const box = await canvas.boundingBox();
    if (box) {
      // Move to center
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(500);
      
      // Check hover state
      const hoverInfo = await page.evaluate(() => {
        return (window as any).lastHoveredPosition || 'No hover detected';
      });
      console.log('Hover info:', hoverInfo);
    }
  });
});
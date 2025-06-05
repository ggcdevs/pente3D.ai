import { test, expect } from '@playwright/test';
import { createGameHelpers } from './utils/game-interactions';

test.describe('Debug Piece Placement', () => {
  test('debug placePiece function', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    
    const game = createGameHelpers(page);
    
    console.log('=== Test 1: Direct placePiece call ===');
    await game.placePiece(0, 0, 0);
    await page.waitForTimeout(1000);
    
    const result1 = await page.evaluate(() => {
      const g = (window as any).game;
      const board = g.getBoard();
      const pieces = board.getAllPieces();
      const pieceAt000 = board.getPieceAt({ x: 0, y: 0, z: 0 });
      return {
        totalPieces: pieces.length,
        pieceAt000: pieceAt000 ? { pos: pieceAt000.coords, color: pieceAt000.player.color } : null,
        allPieces: pieces.map((p: any) => ({ pos: p.coords, color: p.player.color }))
      };
    });
    
    console.log('After placePiece(0,0,0):', JSON.stringify(result1, null, 2));
    
    console.log('\n=== Test 2: Another placement ===');
    await game.placePiece(1, 0, 0);
    await page.waitForTimeout(1000);
    
    const result2 = await page.evaluate(() => {
      const g = (window as any).game;
      const board = g.getBoard();
      const pieces = board.getAllPieces();
      return {
        totalPieces: pieces.length,
        allPieces: pieces.map((p: any) => ({ pos: p.coords, color: p.player.color }))
      };
    });
    
    console.log('After placePiece(1,0,0):', JSON.stringify(result2, null, 2));
    
    // Test if canvas clicks are being intercepted
    console.log('\n=== Test 3: Check for click interception ===');
    const clickInfo = await page.evaluate(() => {
      const canvas = document.querySelector('#game-canvas');
      const renderer = (window as any).renderer;
      let nodeCount = 0;
      if (renderer) {
        const scene = renderer.getScene();
        scene.traverse((child: any) => {
          if (child.userData?.type === 'intersection') {
            nodeCount++;
          }
        });
      }
      return {
        canvasFound: !!canvas,
        rendererFound: !!renderer,
        intersectionNodes: nodeCount,
        sceneChildren: renderer ? renderer.getScene().children.length : 0
      };
    });
    
    console.log('Click info:', JSON.stringify(clickInfo, null, 2));
    
    // Add click event listener to debug
    console.log('\n=== Test 4: Monitor actual click ===');
    await page.evaluate(() => {
      const canvas = document.querySelector('#game-canvas');
      if (canvas) {
        (window as any).lastClick = null;
        canvas.addEventListener('click', (e: any) => {
          (window as any).lastClick = { x: e.clientX, y: e.clientY, timestamp: Date.now() };
        });
      }
    });
    
    // Try clicking with our helper
    await game.placePiece(2, 0, 0);
    await page.waitForTimeout(500);
    
    const clickDebug = await page.evaluate(() => {
      return {
        lastClick: (window as any).lastClick,
        pieces: (window as any).game.getBoard().getAllPieces().length
      };
    });
    
    console.log('Click debug:', JSON.stringify(clickDebug, null, 2));
  });
});
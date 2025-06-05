import { test, expect } from '@playwright/test';
import { createGameHelpers } from './utils/game-interactions';

test.describe('Debug Visible Pieces', () => {
  test('debug getVisiblePieces', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    
    const game = createGameHelpers(page);
    
    // First close any dialogs
    await page.evaluate(() => {
      const closeButtons = document.querySelectorAll('.modal button');
      closeButtons.forEach(btn => {
        if (btn.textContent?.includes('Close') || btn.textContent === '×') {
          (btn as HTMLButtonElement).click();
        }
      });
    });
    await page.waitForTimeout(500);
    
    console.log('=== Placing a piece ===');
    await game.placePiece(1, 0, 0);
    await page.waitForTimeout(1000);
    
    // Check game state
    const gameState = await page.evaluate(() => {
      const g = (window as any).game;
      const board = g.getBoard();
      return {
        pieces: board.getAllPieces().map((p: any) => ({
          pos: p.coords,
          color: p.player.color
        }))
      };
    });
    console.log('Game pieces:', gameState);
    
    // Check visible pieces via helper
    const visiblePieces = await game.getVisiblePieces();
    console.log('Visible pieces from helper:', visiblePieces);
    
    // Check scene directly
    const sceneInfo = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const scene = renderer.getScene();
      const pieces: any[] = [];
      const allObjects: any[] = [];
      
      scene.traverse((child: any) => {
        if (child.userData?.type) {
          allObjects.push({
            type: child.userData.type,
            visible: child.visible,
            position: child.userData.position,
            worldPos: { x: child.position.x, y: child.position.y, z: child.position.z }
          });
          
          if (child.userData.type === 'piece') {
            pieces.push({
              userData: child.userData,
              visible: child.visible,
              position: { x: child.position.x, y: child.position.y, z: child.position.z }
            });
          }
        }
      });
      
      return {
        totalObjects: allObjects.length,
        pieceObjects: pieces,
        sampleObjects: allObjects.slice(0, 5)
      };
    });
    
    console.log('Scene info:', JSON.stringify(sceneInfo, null, 2));
  });
});
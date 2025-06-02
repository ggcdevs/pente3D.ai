import { test, expect } from '@playwright/test';
import { GamePage } from '../pages/GamePage';
import { createGameHelpers } from '../utils/game-interactions';

test.describe('Issue #010: Piece Colors', () => {
  let gamePage: GamePage;

  test.beforeEach(async ({ page }) => {
    gamePage = new GamePage(page);
    await gamePage.goto();
    await gamePage.waitForThreeJSLoad();
  });

  test('pieces should appear in correct colors (black and white, not grey)', async ({ page }) => {
    // Wait for scene to be ready
    await page.waitForTimeout(2000);
    
    // Use simple click approach that we know works
    await page.click('#game-canvas');
    await page.waitForTimeout(500);
    
    // Click slightly off-center for second piece
    const canvas = await page.locator('#game-canvas');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
      await page.waitForTimeout(500);
    }
    
    // Take a screenshot for visual verification
    await expect(page).toHaveScreenshot('piece-colors.png', {
      clip: { x: 100, y: 100, width: 600, height: 600 },
      animations: 'disabled'
    });
    
    // Verify pieces are placed with correct colors
    const pieceInfo = await page.evaluate(() => {
      const game = (window as any).game;
      const board = game.getBoard();
      const pieces = board.getAllPieces();
      return {
        pieceCount: pieces.length,
        pieces: pieces.map((p: any) => ({
          color: p.player.color
        }))
      };
    });
    
    expect(pieceInfo.pieceCount).toBeGreaterThanOrEqual(1);
    if (pieceInfo.pieceCount >= 2) {
      expect(pieceInfo.pieces[0].color).toBe('black');
      expect(pieceInfo.pieces[1].color).toBe('white');
    }
    
    // Log material properties for debugging
    const materialInfo = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const scene = renderer.getScene();
      const materials: any[] = [];
      
      scene.traverse((child: any) => {
        if (child.isMesh && child.material && child.material.color) {
          materials.push({
            color: child.material.color.getHex(),
            specular: child.material.specular ? child.material.specular.getHex() : null,
            shininess: child.material.shininess,
            emissive: child.material.emissive ? child.material.emissive.getHex() : null,
            emissiveIntensity: child.material.emissiveIntensity
          });
        }
      });
      
      return materials;
    });
    
    console.log('Material info:', materialInfo);
    
    // Verify lighting is not too bright
    const lightingInfo = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const scene = renderer.getScene();
      let ambientIntensity = 0;
      let directionalIntensity = 0;
      
      scene.traverse((child: any) => {
        if (child.isAmbientLight) {
          ambientIntensity += child.intensity;
        } else if (child.isDirectionalLight) {
          directionalIntensity += child.intensity;
        }
      });
      
      return { ambientIntensity, directionalIntensity, total: ambientIntensity + directionalIntensity };
    });
    
    console.log('Lighting info:', lightingInfo);
    
    // Total lighting should not exceed 1.0 to prevent washing out colors
    expect(lightingInfo.total).toBeLessThanOrEqual(1.0);
  });
});
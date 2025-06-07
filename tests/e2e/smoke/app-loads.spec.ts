import { test, expect } from '@playwright/test';
import { setupTest } from '../../helpers/e2e';
import { Vector3Builder } from '../../helpers/builders';

test.describe('Pente3D Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    // We'll handle test isolation when helpers are properly set up
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should load without console errors', async ({ page }) => {
    await setupTest(page);
    
    // Track console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    
    await page.waitForTimeout(1000);
    expect(errors).toHaveLength(0);
  });

  test('should have WebGL support', async ({ page }) => {
    
    await setupTest(page);
    
    // Check WebGL support
    const hasWebGL = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      return !!gl;
    });
    expect(hasWebGL).toBe(true);
  });

  test('should render 3D board', async ({ page }) => {
    await setupTest(page);
    
    // Wait for scene to be ready
    await page.waitForSelector('canvas', { state: 'visible' });
    await page.waitForTimeout(2000);
    
    // Check board is visible
    const boardVisible = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      return renderer && renderer.getScene();
    });
    expect(boardVisible).toBeTruthy();
  });

  test('should capture game state', async ({ page }) => {
    await setupTest(page);
    
    // Get game state
    const gameState = await page.evaluate(() => {
      const game = (window as any).game;
      if (!game) return null;
      return {
        boardSize: game.getBoard().size,
        currentPlayer: game.getCurrentPlayer().getColor(),
        pieceCount: game.getBoard().getPieceCount(),
        isGameOver: game.isGameOver()
      };
    });
    
    expect(gameState).toBeTruthy();
    expect(gameState.boardSize).toBe(7);
    expect(gameState.currentPlayer).toBeDefined();
    expect(gameState.pieceCount).toBe(0);
    expect(gameState.isGameOver).toBe(false);
  });

  test('should handle window resize', async ({ page }) => {
    await setupTest(page);
    
    // Test different viewport sizes
    const viewports = [
      { width: 800, height: 600 },
      { width: 1024, height: 768 },
      { width: 1920, height: 1080 }
    ];
    
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(500);
      
      const boardVisible = await page.evaluate(() => {
        const renderer = (window as any).renderer;
        return renderer && renderer.getScene();
      });
      expect(boardVisible).toBeTruthy();
    }
  });

  test('should have proper page title and metadata', async ({ page }) => {
    await page.goto('/');
    
    // Check title
    await expect(page).toHaveTitle(/Pente3D/i);
    
    // Check viewport meta tag for responsive design
    const viewport = await page.$('meta[name="viewport"]');
    expect(viewport).not.toBeNull();
  });
});
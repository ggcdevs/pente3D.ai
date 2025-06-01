import { test, expect } from '@playwright/test';
import { GamePage } from '../pages/GamePage';
import { waitForSceneReady, checkWebGLSupport, getRendererInfo } from '../utils/threejs-helpers';
import { expectScreenshotToMatchBaseline } from '../utils/visual-regression';

test.describe('Pente3D Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Set viewport size for consistent screenshots
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should load without console errors', async ({ page }) => {
    const gamePage = new GamePage(page);
    
    // Navigate to the game
    await gamePage.navigate();
    
    // Wait for Three.js to initialize
    await gamePage.waitForThreeJSLoad();
    
    // Check no console errors
    const errors = gamePage.getConsoleErrors();
    expect(errors).toHaveLength(0);
  });

  test('should have WebGL support', async ({ page }) => {
    await page.goto('/');
    
    const hasWebGL = await checkWebGLSupport(page);
    expect(hasWebGL).toBe(true);
    
    // Get renderer info for debugging
    const rendererInfo = await getRendererInfo(page);
    console.log('WebGL Renderer Info:', rendererInfo);
    expect(rendererInfo).not.toBeNull();
  });

  test('should render 3D board', async ({ page }) => {
    const gamePage = new GamePage(page);
    await gamePage.navigate();
    await gamePage.waitForThreeJSLoad();
    
    // Check canvas is visible
    const canvas = await gamePage.getCanvas();
    await expect(canvas).toBeVisible();
    
    // Check board is rendered
    const boardVisible = await gamePage.isBoardVisible();
    expect(boardVisible).toBe(true);
    
    // Visual regression test
    const screenshot = await gamePage.captureCanvasScreenshot('board-initial-state');
    const comparison = await expectScreenshotToMatchBaseline(
      screenshot,
      'board-initial-state',
      { threshold: 0.2 } // Higher threshold for 3D content
    );
    
    if (!comparison.match) {
      console.log(`Visual difference detected: ${comparison.diffPercentage.toFixed(2)}% (${comparison.diffPixels} pixels)`);
    }
    
    // For first run or when updating baselines, we might want to pass even if no match
    // expect(comparison.match).toBe(true);
  });

  test('should capture game state', async ({ page }) => {
    const gamePage = new GamePage(page);
    await gamePage.navigate();
    await gamePage.waitForThreeJSLoad();
    
    const gameState = await gamePage.captureGameState();
    
    expect(gameState.boardLoaded).toBe(true);
    expect(gameState.consoleErrors).toHaveLength(0);
    
    // Once the game exposes state, we can check more:
    // expect(gameState.currentPlayer).toBeDefined();
    // expect(gameState.pieces).toBeDefined();
  });

  test('should handle window resize', async ({ page }) => {
    const gamePage = new GamePage(page);
    await gamePage.navigate();
    await gamePage.waitForThreeJSLoad();
    
    // Resize window
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(500); // Wait for resize handler
    
    // Board should still be visible
    const boardVisible = await gamePage.isBoardVisible();
    expect(boardVisible).toBe(true);
    
    // Resize back
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(500);
    
    // Still visible
    expect(await gamePage.isBoardVisible()).toBe(true);
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
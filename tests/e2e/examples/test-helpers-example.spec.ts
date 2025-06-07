/**
 * Example test demonstrating the new consolidated test helpers
 * This shows best practices for using the new test infrastructure
 */

import { test, expect, setupTest } from '@/tests/helpers/e2e';

test.describe('Example: Using New Test Helpers', () => {
  test.beforeEach(async ({ page, testEnv }) => {
    // Isolate test environment
    await testEnv.isolateTest();
    
    // Set up test with common options
    await setupTest(page, {
      waitForScene: true,
      isolateStorage: true,
      viewport: { width: 1280, height: 720 }
    });
    
    // Track console errors
    testEnv.expectNoConsoleErrors();
  });

  test('basic game interaction with new helpers', async ({ game, visual, testEnv }) => {
    // Skip test if WebGL not supported
    await testEnv.skipIfNoWebGL();
    
    // Place a piece using the improved helper
    await game.placePiece({ x: 0, y: 0, z: 0 });
    
    // Validate piece was placed
    await expect(game.hasPieceAt({ x: 0, y: 0, z: 0 })).resolves.toBe(true);
    await game.validatePieceAt({ x: 0, y: 0, z: 0 }, 'black');
    
    // Check game state
    const state = await game.getGameState();
    expect(state.currentPlayer).toBe('white');
    expect(state.pieces).toHaveLength(1);
    
    // Take a visual snapshot
    const screenshot = await visual.takeScreenshot({
      animations: 'disabled',
      maskRegions: [
        { x: 0, y: 0, width: 200, height: 50 } // Mask timestamp
      ]
    });
    
    const comparison = await visual.compareWithBaseline(
      screenshot,
      'first-piece-placed'
    );
    expect(comparison.match).toBe(true);
  });

  test('camera controls with visual verification', async ({ game, visual }) => {
    // Get initial camera state
    const initialCamera = await game.getCameraState();
    
    // Rotate board
    await game.rotateBoard(100, 50);
    
    // Verify rotation occurred
    const rotatedCamera = await game.getCameraState();
    expect(rotatedCamera.azimuth).not.toBe(initialCamera.azimuth);
    
    // Take screenshot after rotation
    await visual.waitForVisualStability({ timeout: 1000 });
    const rotatedScreenshot = await visual.takeScreenshot();
    
    // Zoom in
    await game.zoomBoard(200);
    const zoomedCamera = await game.getCameraState();
    expect(zoomedCamera.distance).toBeLessThan(rotatedCamera.distance);
    
    // Reset camera
    await game.resetCamera();
    
    // Verify camera reset
    const resetCamera = await game.getCameraState();
    expect(resetCamera.distance).toBeCloseTo(initialCamera.distance, 1);
  });

  test('UI interaction with modals', async ({ game, browser }) => {
    // Open menu
    await game.openMenu();
    await expect(game.isModalVisible('Menu')).resolves.toBe(true);
    
    // Click settings
    await game.clickButton('Settings');
    await expect(game.isModalVisible('Settings')).resolves.toBe(true);
    
    // Close modal
    await game.closeModal();
    await expect(game.isModalVisible()).resolves.toBe(false);
    
    // Check browser capabilities
    const capabilities = await browser.checkCapabilities();
    expect(capabilities.webgl).toBe(true);
  });

  test('network game flow', async ({ game, testEnv }) => {
    // Host a game
    const gameCode = await game.hostGame();
    expect(gameCode).toMatch(/^[A-Z0-9]{6}$/);
    
    // Check network status
    const status = await game.getNetworkStatus();
    expect(status).toBe('connected');
    
    // Verify host status
    await expect(game.isHost()).resolves.toBe(true);
    
    // Add cleanup to disconnect
    testEnv.addCleanup(async () => {
      // Disconnect from network game
      await game.clickButton('Disconnect');
    });
  });

  test('performance monitoring', async ({ page, browser, testEnv }) => {
    // Start performance trace
    await testEnv.startPerformanceTrace();
    
    // Monitor console for performance warnings
    const logs = browser.setupConsoleMonitoring({
      logWarnings: true,
      filter: msg => msg.includes('performance')
    });
    
    // Perform some actions
    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(500);
    
    // Get performance metrics
    const metrics = await browser.getPerformanceMetrics();
    expect(metrics.fps).toBeGreaterThan(30);
    expect(metrics.memory.usedJSHeapSize).toBeLessThan(100 * 1024 * 1024); // Less than 100MB
    
    // Stop trace
    await testEnv.stopPerformanceTrace('performance-test');
    
    // Check for performance warnings
    expect(logs.warnings).toHaveLength(0);
  });

  test('visual regression with responsive viewports', async ({ visual }) => {
    // Define viewports to test
    const viewports = [
      { width: 1920, height: 1080, label: 'desktop' },
      { width: 768, height: 1024, label: 'tablet' },
      { width: 375, height: 667, label: 'mobile' }
    ];
    
    // Take screenshots at different sizes
    const screenshots = await visual.takeResponsiveScreenshots(
      'responsive-layout',
      viewports,
      { animations: 'disabled' }
    );
    
    // Compare each screenshot
    for (const [name, screenshot] of screenshots) {
      const result = await visual.compareWithBaseline(screenshot, name);
      expect(result.match).toBe(true);
    }
  });

  test('advanced game state validation', async ({ game, testEnv }) => {
    // Use test utilities for unique data
    const testId = testEnv.testId;
    
    // Place multiple pieces
    const moves = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 2, y: 0, z: 0 }
    ];
    
    for (const move of moves) {
      await game.placePiece(move);
      await game.waitForPieceAt(move, 1000);
    }
    
    // Get all visible pieces
    const visiblePieces = await game.getVisiblePieces();
    expect(visiblePieces).toHaveLength(4);
    
    // Validate piece colors alternate
    expect(visiblePieces[0].color).toBe('black');
    expect(visiblePieces[1].color).toBe('white');
    expect(visiblePieces[2].color).toBe('black');
    expect(visiblePieces[3].color).toBe('white');
    
    // Test undo
    await game.undoMove();
    const afterUndo = await game.getVisiblePieces();
    expect(afterUndo).toHaveLength(3);
    
    // Test redo
    await game.redoMove();
    const afterRedo = await game.getVisiblePieces();
    expect(afterRedo).toHaveLength(4);
  });

  test('browser environment setup', async ({ page, browser }) => {
    // Set up permissions
    await browser.setupPermissions(['clipboard-read', 'clipboard-write']);
    
    // Emulate slow network
    await browser.setNetworkConditions({
      downloadThroughput: 1.5 * 1024 * 1024 / 8, // 1.5 Mbps
      uploadThroughput: 750 * 1024 / 8,          // 750 Kbps
      latency: 40                                // 40ms
    });
    
    // Reload page with slow network
    await page.reload();
    await browser.waitForNetworkIdle();
    
    // Verify page still loads
    await expect(page.locator('#game-canvas')).toBeVisible();
    
    // Reset network conditions
    await browser.setNetworkConditions({});
  });
});
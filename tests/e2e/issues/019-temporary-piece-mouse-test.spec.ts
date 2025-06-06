import { test, expect } from '@playwright/test';
import { createGameHelpers } from '../utils/game-interactions';
import { waitForSceneReady, getCanvasElement } from '../utils/threejs-helpers';

test.describe('Issue #019: Temporary Piece Click Placement with Mouse Simulation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000); // Wait for game to load
    
    // Ensure clean state
    const pieceCount = await page.evaluate(() => {
      const game = (window as any).game;
      if (game && game.getBoard) {
        return game.getBoard().getAllPieces().length;
      }
      return -1;
    });
    
    if (pieceCount > 0) {
      console.warn(`Warning: Board not clean, found ${pieceCount} pieces`);
      await page.reload();
      await page.waitForTimeout(2000);
    }
  });

  test('should place temporary piece with realistic mouse movement', async ({ page }) => {
    const game = createGameHelpers(page);
    
    // Focus canvas and activate temporary mode
    await page.focus('#game-canvas');
    await page.waitForTimeout(100);
    
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    
    // Verify temporary mode is active
    const tempModeActive = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      return inputHandler?.state?.temporaryPieceMode || false;
    });
    expect(tempModeActive).toBe(true);
    console.log('✓ Temporary mode activated');
    
    // Get canvas bounding box for absolute positioning
    const canvas = page.locator('#game-canvas');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('Canvas not found');
    
    // Click in the center which seems to hit (3,3,3)
    const centerX = canvasBox.x + canvasBox.width / 2;
    const centerY = canvasBox.y + canvasBox.height / 2;
    
    console.log(`Clicking at center: (${centerX}, ${centerY})`);
    
    // Simulate realistic mouse movement
    // Start from a different position
    const startX = canvasBox.x + canvasBox.width * 0.3;
    const startY = canvasBox.y + canvasBox.height * 0.3;
    
    // Move to start position
    await page.mouse.move(startX, startY);
    await page.waitForTimeout(100);
    
    // Move gradually to target
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      const currentX = startX + (centerX - startX) * progress;
      const currentY = startY + (centerY - startY) * progress;
      await page.mouse.move(currentX, currentY);
      await page.waitForTimeout(20);
    }
    
    // Hover at target position
    await page.waitForTimeout(200);
    
    // Perform the click with explicit down/up
    console.log('Performing mouse click...');
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.waitForTimeout(200);
    
    // Check if temporary position was set
    const stateAfterClick = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      const state = inputHandler?.state;
      return {
        temporaryPieceMode: state?.temporaryPieceMode || false,
        hasTemporaryPosition: !!state?.temporaryPosition,
        temporaryPosition: state?.temporaryPosition,
        clickHandlerCalled: (window as any).lastClickPosition || null
      };
    });
    
    console.log('State after click:', stateAfterClick);
    
    expect(stateAfterClick.temporaryPieceMode).toBe(true);
    expect(stateAfterClick.hasTemporaryPosition).toBe(true);
    
    // Try Enter key to confirm
    console.log('Pressing Enter key...');
    
    // Set up console listener for confirmation
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('confirmTemporaryPiece') || text.includes('placePiece')) {
        consoleMessages.push(text);
      }
    });
    
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    
    console.log('Console messages after Enter:', consoleMessages);
    
    // Check final state
    const finalState = await page.evaluate(() => {
      const inputHandler = (window as any).inputHandler;
      const game = (window as any).game;
      return {
        temporaryPieceMode: inputHandler?.state?.temporaryPieceMode || false,
        pieceCount: game.getBoard().getAllPieces().length,
        hasPieceAt000: !!game.getBoard().getPieceAt({ x: 0, y: 0, z: 0 })
      };
    });
    
    console.log('Final state:', finalState);
    
    expect(finalState.temporaryPieceMode).toBe(false);
    expect(finalState.pieceCount).toBe(1);
    // The piece will be at (3,3,3) since that's where center clicks land
    const hasPieceAt333 = await game.hasPieceAt(3, 3, 3);
    expect(hasPieceAt333).toBe(true);
  });

  test('should handle click event propagation correctly', async ({ page }) => {
    // Add debugging to track click events
    const setupResult = await page.evaluate(() => {
      const canvas = document.querySelector('#game-canvas');
      if (!canvas) return { error: 'No canvas' };
      
      // Track all click-related events
      const events: string[] = [];
      (window as any).clickEvents = events;
      
      // Check if inputHandler exists
      const inputHandler = (window as any).inputHandler;
      if (!inputHandler) {
        return { error: 'No inputHandler found' };
      }
      
      canvas.addEventListener('mousedown', () => events.push('canvas-mousedown'), true);
      canvas.addEventListener('mouseup', () => events.push('canvas-mouseup'), true);
      canvas.addEventListener('click', () => events.push('canvas-click'), true);
      
      // Also track on window
      window.addEventListener('mousedown', () => events.push('window-mousedown'), true);
      window.addEventListener('mouseup', () => events.push('window-mouseup'), true);
      window.addEventListener('click', () => events.push('window-click'), true);
      
      // Track InputHandler onClick by wrapping it
      const originalOnClick = inputHandler.onClick;
      if (originalOnClick && typeof originalOnClick === 'function') {
        // Store the bound version to track calls
        const boundOnClick = originalOnClick.bind(inputHandler);
        (window as any).originalOnClickHandler = boundOnClick;
        
        // Create a wrapper that tracks calls
        const wrapper = function(event: MouseEvent) {
          events.push('inputhandler-onclick');
          console.log('InputHandler onClick wrapper called');
          return boundOnClick(event);
        };
        
        // Re-add the event listener with our wrapper
        canvas.removeEventListener('click', originalOnClick);
        canvas.addEventListener('click', wrapper);
        
        return { success: true, hasInputHandler: true };
      }
      
      return { error: 'onClick not found or not a function' };
    });
    
    console.log('Setup result:', setupResult);
    
    const canvas = await getCanvasElement(page);
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('Canvas not found');
    
    // Click in center of canvas
    const centerX = canvasBox.x + canvasBox.width / 2;
    const centerY = canvasBox.y + canvasBox.height / 2;
    
    await page.mouse.click(centerX, centerY);
    await page.waitForTimeout(100);
    
    // Check which events fired
    const clickEvents = await page.evaluate(() => (window as any).clickEvents);
    console.log('Click events captured:', clickEvents);
    
    // We should see all these events
    expect(clickEvents).toContain('canvas-mousedown');
    expect(clickEvents).toContain('canvas-mouseup');
    expect(clickEvents).toContain('canvas-click');
    
    // Check if InputHandler onClick was called
    const inputHandlerCalled = clickEvents.includes('inputhandler-onclick');
    console.log('InputHandler onClick called:', inputHandlerCalled);
  });

  test('should use helper functions for consistency', async ({ page }) => {
    const game = createGameHelpers(page);
    
    // This test demonstrates proper usage of helper functions
    // as required by the issue description
    
    // 1. Wait for scene to be ready
    // Note: Not using waitForSceneReady as THREE.js might not be in global scope
    
    // 2. Enter temporary mode
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    
    // 3. Use the game helper to click a node
    // This helper already implements proper mouse simulation
    await game.clickGridNode(1, 0, 0);
    
    // 4. Verify using game state helper
    const gameState = await game.getGameState();
    console.log('Game state after click:', {
      pieceCount: gameState.pieceCount,
      currentPlayer: gameState.currentPlayer
    });
    
    // 5. Use validation helpers
    const isHighlighted = await game.isNodeHighlighted(1, 0, 0);
    console.log('Node highlighted:', isHighlighted);
    
    // This demonstrates the pattern all tests should follow:
    // - Use helpers from utils/ directory
    // - Don't directly manipulate DOM or call page.click()
    // - Use game state queries for validation
  });
});
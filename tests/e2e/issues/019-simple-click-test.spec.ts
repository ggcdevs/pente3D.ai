import { test, expect } from '@playwright/test';
import { createGameHelpers } from '../utils/game-interactions';

test.describe('Issue #019: Simple Click Test', () => {
  test('basic piece placement should work', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000); // Wait for game to load
    
    const game = createGameHelpers(page);
    
    // Try to place a piece normally (not in temporary mode)
    console.log('Attempting to place piece at (0, 0, 0)...');
    await game.clickGridNode(0, 0, 0);
    
    // Check if piece was placed
    const hasPiece = await game.hasPieceAt(0, 0, 0);
    console.log('Has piece at (0, 0, 0):', hasPiece);
    
    // Check where the piece actually went
    const gameState = await game.getGameState();
    console.log('Total pieces:', gameState.pieceCount);
    if (gameState.pieces.length > 0) {
      console.log('Piece placed at:', gameState.pieces[0].position);
    }
    
    // Also check the last click position
    const lastClick = await page.evaluate(() => (window as any).lastClickPosition);
    console.log('Last click position:', lastClick);
    
    expect(hasPiece).toBe(true);
  });

  test('direct canvas click should trigger onClick', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    
    // Set up console message listener
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('onClick') || text.includes('Raycast') || text.includes('Board position')) {
        consoleMessages.push(text);
      }
    });
    
    // Get canvas and click in center
    const canvas = page.locator('#game-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');
    
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    
    console.log('Clicking at center:', centerX, centerY);
    await page.mouse.click(centerX, centerY);
    await page.waitForTimeout(500);
    
    console.log('Console messages captured:', consoleMessages);
    
    // Check if onClick was called
    const onClickCalled = consoleMessages.some(msg => msg.includes('onClick called'));
    expect(onClickCalled).toBe(true);
  });

  test('temporary mode with direct implementation', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    
    // Activate temporary mode
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    
    // Try a different approach - use the exposed game object directly
    const result = await page.evaluate(() => {
      const game = (window as any).game;
      const inputHandler = (window as any).inputHandler;
      const renderer = (window as any).renderer;
      
      if (!game || !inputHandler || !renderer) {
        return { error: 'Missing required objects' };
      }
      
      // Check temporary mode state
      const tempMode = inputHandler.state?.temporaryPieceMode;
      
      // Manually trigger the click workflow
      // Find the first intersection node
      const scene = renderer.getScene();
      let targetNode = null;
      scene.traverse((child: any) => {
        if (!targetNode && child.userData?.type === 'intersection' && 
            child.userData?.position?.x === 0 &&
            child.userData?.position?.y === 0 &&
            child.userData?.position?.z === 0) {
          targetNode = child;
        }
      });
      
      if (!targetNode) {
        return { error: 'No intersection node found at (0,0,0)' };
      }
      
      // Simulate setting temporary position
      const position = { x: 0, y: 0, z: 0 };
      inputHandler.state.temporaryPosition = position;
      renderer.setTemporaryPiece(position, game.getCurrentPlayer());
      
      return {
        temporaryMode: tempMode,
        temporaryPositionSet: !!inputHandler.state.temporaryPosition,
        nodeFound: !!targetNode
      };
    });
    
    console.log('Manual temporary piece result:', result);
    expect(result.temporaryMode).toBe(true);
    expect(result.temporaryPositionSet).toBe(true);
    
    // Now try Enter key
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    
    // Check if piece was placed
    const finalState = await page.evaluate(() => {
      const game = (window as any).game;
      const inputHandler = (window as any).inputHandler;
      return {
        pieceCount: game.getBoard().getAllPieces().length,
        temporaryMode: inputHandler.state?.temporaryPieceMode,
        hasPieceAt000: !!game.getBoard().getPieceAt({ x: 0, y: 0, z: 0 })
      };
    });
    
    console.log('Final state after Enter:', finalState);
    expect(finalState.pieceCount).toBe(1);
    expect(finalState.temporaryMode).toBe(false);
    expect(finalState.hasPieceAt000).toBe(true);
  });
});
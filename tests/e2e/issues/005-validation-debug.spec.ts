import { test, expect } from '@playwright/test';

test.describe('Issue #005: Debug Validation', () => {
  test('check what validation is failing', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Override GameRules.isValidMove to add logging
    const validationResult = await page.evaluate(() => {
      const game = (window as any).game;
      const GameRules = (window as any).GameRules || game.constructor.GameRules;
      
      // Try to access GameRules through the game's prototype chain
      let rulesClass: any = null;
      
      // Create a test position
      const testPosition = { x: 3, y: 3, z: 3 };
      
      // Try calling placePiece and catch any errors
      const originalConsoleLog = console.log;
      const logs: string[] = [];
      console.log = (...args: any[]) => {
        logs.push(args.join(' '));
        originalConsoleLog(...args);
      };
      
      try {
        // Check current game state
        const currentState = game.getCurrentState();
        const board = currentState.getBoard();
        const currentPlayer = currentState.getCurrentPlayer();
        
        logs.push(`Current player: ${currentPlayer.getColor()}`);
        logs.push(`Board size: ${board.getSize()}`);
        logs.push(`Position in bounds: ${board.isInBounds(testPosition)}`);
        logs.push(`Position empty: ${board.getPieceAt(testPosition) === null}`);
        
        // Try the actual placement
        const result = game.placePiece(testPosition);
        logs.push(`placePiece result: ${result}`);
        
        console.log = originalConsoleLog;
        return { success: result, logs };
      } catch (error: any) {
        console.log = originalConsoleLog;
        return { success: false, error: error.message, logs };
      }
    });
    
    console.log('Validation result:', validationResult);
    
    // Now let's check the Vector3 class issue
    const vector3Check = await page.evaluate(() => {
      // Check if Vector3 class is properly available
      const Vector3Class = (window as any).Vector3;
      const testVec = { x: 3, y: 3, z: 3 };
      
      return {
        hasVector3Class: !!Vector3Class,
        isVector3Instance: Vector3Class ? testVec instanceof Vector3Class : false,
        testVecType: Object.prototype.toString.call(testVec),
        testVecConstructor: testVec.constructor?.name
      };
    });
    
    console.log('Vector3 check:', vector3Check);
    
    expect(validationResult.success).toBe(true);
  });
});
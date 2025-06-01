import { test, expect } from '@playwright/test';

test.describe('Issue #005: Click Flow', () => {
  test('trace complete click flow', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', msg => {
      logs.push(`[${msg.type()}] ${msg.text()}`);
    });

    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Click directly on canvas center
    await page.click('#game-canvas');
    await page.waitForTimeout(1000);
    
    // Get game state
    const gameState = await page.evaluate(() => {
      const game = (window as any).game;
      const board = game.getBoard();
      
      let pieceCount = 0;
      const pieces: any[] = [];
      
      for (let x = 0; x < 7; x++) {
        for (let y = 0; y < 7; y++) {
          for (let z = 0; z < 7; z++) {
            const piece = board.getPieceAt({ x, y, z });
            if (piece) {
              pieceCount++;
              pieces.push({ x, y, z, color: piece.getColor() });
            }
          }
        }
      }
      
      return {
        pieceCount,
        pieces,
        currentPlayer: game.getCurrentPlayer()?.getColor(),
        historyLength: game.getHistoryLength()
      };
    });
    
    console.log('Console logs:');
    logs.forEach(log => console.log(log));
    console.log('\nGame state:', gameState);
    
    // Filter for relevant logs
    const relevantLogs = logs.filter(log => 
      log.includes('Click detected') ||
      log.includes('placePiece') ||
      log.includes('Invalid') ||
      log.includes('piecePlaced')
    );
    
    console.log('\nRelevant logs:');
    relevantLogs.forEach(log => console.log(log));
    
    expect(gameState.pieceCount).toBeGreaterThan(0);
  });
});
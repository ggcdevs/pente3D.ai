import { test, expect } from '@playwright/test';

test.describe('Issue #005: Debug updatePieces', () => {
  test('trace updatePieces execution', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Instrument the renderer to capture updatePieces execution
    await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const game = (window as any).game;
      
      // Store debug info
      (window as any).updatePiecesDebug = [];
      
      // Wrap updatePieces to capture what happens
      const originalUpdatePieces = renderer.updatePieces.bind(renderer);
      renderer.updatePieces = function() {
        const debug: any = {
          timestamp: Date.now(),
          boardReference: this.board,
          boardPieces: []
        };
        
        try {
          // Check if board exists
          if (!this.board) {
            debug.error = 'No board reference in renderer';
            (window as any).updatePiecesDebug.push(debug);
            return originalUpdatePieces();
          }
          
          // Get pieces from board
          const boardSize = this.board.getSize();
          debug.boardSize = boardSize;
          
          // Check each position
          for (let x = 0; x < boardSize; x++) {
            for (let y = 0; y < boardSize; y++) {
              for (let z = 0; z < boardSize; z++) {
                const pos = { x: x - Math.floor(boardSize/2), y: y - Math.floor(boardSize/2), z: z - Math.floor(boardSize/2) };
                const piece = this.board.getPieceAt(pos);
                if (piece) {
                  debug.boardPieces.push({
                    position: pos,
                    piece: {
                      coords: piece.coords,
                      player: piece.player.color,
                      isTemporary: piece.isTemporary
                    }
                  });
                }
              }
            }
          }
          
          // Check piecesGroup
          debug.piecesGroupBefore = {
            exists: !!this.piecesGroup,
            childCount: this.piecesGroup ? this.piecesGroup.children.length : 0
          };
          
          // Call original
          const result = originalUpdatePieces();
          
          // Check after
          debug.piecesGroupAfter = {
            exists: !!this.piecesGroup,
            childCount: this.piecesGroup ? this.piecesGroup.children.length : 0,
            children: this.piecesGroup ? this.piecesGroup.children.map((c: any) => ({
              type: c.type,
              geometry: c.geometry?.type,
              position: c.position,
              visible: c.visible
            })) : []
          };
          
          (window as any).updatePiecesDebug.push(debug);
          console.log('updatePieces debug:', debug);
          return result;
        } catch (error) {
          debug.error = error.toString();
          (window as any).updatePiecesDebug.push(debug);
          throw error;
        }
      };
      
      // Also check createPieceMesh
      if (renderer.createPieceMesh) {
        const originalCreatePieceMesh = renderer.createPieceMesh.bind(renderer);
        renderer.createPieceMesh = function(piece: any) {
          console.log('createPieceMesh called with:', {
            coords: piece.coords,
            player: piece.player.color,
            isTemporary: piece.isTemporary
          });
          const mesh = originalCreatePieceMesh(piece);
          console.log('createPieceMesh returned:', {
            type: mesh?.type,
            geometry: mesh?.geometry?.type,
            material: mesh?.material?.type
          });
          return mesh;
        };
      }
    });
    
    // Place a piece through game API first
    const manualPlacement = await page.evaluate(() => {
      const game = (window as any).game;
      const pos = { x: 0, y: 0, z: 0 };
      const result = game.placePiece(pos);
      return {
        success: result,
        boardPieces: game.getBoard().getAllPieces().length
      };
    });
    
    console.log('Manual placement:', manualPlacement);
    await page.waitForTimeout(500);
    
    // Get debug info
    const debugInfo = await page.evaluate(() => {
      return (window as any).updatePiecesDebug;
    });
    
    console.log('UpdatePieces debug info:', JSON.stringify(debugInfo, null, 2));
    
    // Now try clicking
    await page.click('#game-canvas');
    await page.waitForTimeout(500);
    
    // Get final debug info
    const finalDebug = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const game = (window as any).game;
      
      // Direct check of renderer internals
      const piecesGroup = renderer.piecesGroup || (renderer as any)._piecesGroup;
      const board = renderer.board || (renderer as any)._board;
      
      return {
        debugCalls: (window as any).updatePiecesDebug,
        rendererState: {
          hasBoard: !!board,
          hasPiecesGroup: !!piecesGroup,
          piecesGroupType: piecesGroup?.type,
          piecesGroupChildren: piecesGroup?.children.length,
          boardPieceCount: board ? board.getAllPieces().length : 'no board'
        },
        gameState: {
          pieces: game.getBoard().getAllPieces().length,
          moves: game.getHistoryLength() - 1
        }
      };
    });
    
    console.log('Final state:', JSON.stringify(finalDebug, null, 2));
    
    // Verify the debug info shows pieces
    expect(finalDebug.gameState.pieces).toBeGreaterThan(0);
    expect(finalDebug.debugCalls.length).toBeGreaterThan(0);
    
    // Check if pieces were found by updatePieces
    const lastCall = finalDebug.debugCalls[finalDebug.debugCalls.length - 1];
    expect(lastCall.boardPieces.length).toBeGreaterThan(0);
  });
});
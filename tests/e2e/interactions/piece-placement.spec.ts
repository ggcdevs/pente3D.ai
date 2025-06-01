import { test, expect } from '@playwright/test';
import { GamePage } from '../pages/GamePage';

test.describe('Piece Placement', () => {
  let gamePage: GamePage;

  test.beforeEach(async ({ page }) => {
    gamePage = new GamePage(page);
    await gamePage.goto();
    await gamePage.waitForThreeJSLoad();
    
    // Expose game and renderer to window for testing
    await page.evaluate(() => {
      // These should already be exposed by main.ts, but let's ensure they're accessible
      (window as any).testHelpers = {
        getIntersectionNodes: () => {
          const scene = (window as any).renderer?.getScene();
          if (!scene) return [];
          
          const nodes: any[] = [];
          scene.traverse((obj: any) => {
            if (obj.userData && obj.userData.type === 'intersection') {
              nodes.push({
                position: obj.position,
                userData: obj.userData
              });
            }
          });
          return nodes;
        },
        getRaycasterInfo: () => {
          const inputHandler = (window as any).inputHandler;
          if (!inputHandler) return null;
          
          // We'll check state after click
          return inputHandler.getState();
        }
      };
    });
  });

  test('should detect intersection nodes', async ({ page }) => {
    const nodes = await page.evaluate(() => {
      return (window as any).testHelpers.getIntersectionNodes();
    });

    console.log(`Found ${nodes.length} intersection nodes`);
    expect(nodes.length).toBeGreaterThan(0);
    
    // For a 7x7x7 board, should have 343 nodes
    expect(nodes.length).toBe(343);
  });

  test('should place piece on click', async ({ page }) => {
    // Get initial piece count
    const initialPieces = await page.evaluate(() => {
      const game = (window as any).game;
      if (!game) return 0;
      
      const board = game.getBoard();
      let count = 0;
      for (let x = 0; x < 7; x++) {
        for (let y = 0; y < 7; y++) {
          for (let z = 0; z < 7; z++) {
            if (board.getPieceAt({ x, y, z })) count++;
          }
        }
      }
      return count;
    });

    console.log('Initial pieces:', initialPieces);

    // Listen for console logs to debug
    page.on('console', msg => {
      if (msg.text().includes('Click detected') || msg.text().includes('Invalid move')) {
        console.log('Browser console:', msg.text());
      }
    });

    // Get the first node position in screen coordinates
    const nodeScreenPos = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const camera = renderer.getCamera();
      const nodes = (window as any).testHelpers.getIntersectionNodes();
      
      if (nodes.length === 0) return null;
      
      // Find a node near the center of the board
      const centerNode = nodes.find((n: any) => 
        n.userData.position.x === 3 && 
        n.userData.position.y === 3 && 
        n.userData.position.z === 3
      ) || nodes[Math.floor(nodes.length / 2)];
      
      // Project 3D position to screen coordinates
      const vector = centerNode.position.clone();
      vector.project(camera);
      
      const canvas = document.querySelector('canvas')!;
      const x = (vector.x + 1) / 2 * canvas.width;
      const y = -(vector.y - 1) / 2 * canvas.height;
      
      return { x: Math.round(x), y: Math.round(y), node: centerNode.userData.position };
    });

    expect(nodeScreenPos).toBeTruthy();
    console.log('Clicking at screen position:', nodeScreenPos);

    // Click on the node
    await page.mouse.click(nodeScreenPos!.x, nodeScreenPos!.y);

    // Wait for piece placement
    await page.waitForTimeout(100);

    // Check if piece was placed
    const newPieces = await page.evaluate(() => {
      const game = (window as any).game;
      if (!game) return 0;
      
      const board = game.getBoard();
      let count = 0;
      for (let x = 0; x < 7; x++) {
        for (let y = 0; y < 7; y++) {
          for (let z = 0; z < 7; z++) {
            if (board.getPieceAt({ x, y, z })) count++;
          }
        }
      }
      return count;
    });

    console.log('New pieces:', newPieces);
    expect(newPieces).toBe(initialPieces + 1);
  });

  test('should not place piece when dragging', async ({ page }) => {
    // Get initial piece count
    const initialPieces = await page.evaluate(() => {
      const game = (window as any).game;
      const board = game.getBoard();
      let count = 0;
      for (let x = 0; x < 7; x++) {
        for (let y = 0; y < 7; y++) {
          for (let z = 0; z < 7; z++) {
            if (board.getPieceAt({ x, y, z })) count++;
          }
        }
      }
      return count;
    });

    // Perform a drag (rotation)
    const canvas = page.locator('canvas');
    await canvas.hover({ position: { x: 300, y: 300 } });
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(400, 300, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(100);

    // Check piece count hasn't changed
    const newPieces = await page.evaluate(() => {
      const game = (window as any).game;
      const board = game.getBoard();
      let count = 0;
      for (let x = 0; x < 7; x++) {
        for (let y = 0; y < 7; y++) {
          for (let z = 0; z < 7; z++) {
            if (board.getPieceAt({ x, y, z })) count++;
          }
        }
      }
      return count;
    });

    expect(newPieces).toBe(initialPieces);
  });

  test('should alternate between black and white pieces', async ({ page }) => {
    // Place first piece (should be black)
    await page.mouse.click(300, 300);
    await page.waitForTimeout(100);

    const firstPlayer = await page.evaluate(() => {
      const game = (window as any).game;
      // Get the last move's player
      const history = game.getHistory();
      if (history.length === 0) return null;
      const lastMove = history[history.length - 1];
      return lastMove.getPlayer().getColor();
    });

    expect(firstPlayer).toBe('black');

    // Place second piece (should be white)
    await page.mouse.click(350, 350);
    await page.waitForTimeout(100);

    const secondPlayer = await page.evaluate(() => {
      const game = (window as any).game;
      const history = game.getHistory();
      if (history.length < 2) return null;
      const lastMove = history[history.length - 1];
      return lastMove.getPlayer().getColor();
    });

    expect(secondPlayer).toBe('white');
  });

  test('should show invalid move in console for occupied position', async ({ page }) => {
    const messages: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.text().includes('Invalid move')) {
        messages.push(msg.text());
      }
    });

    // Place a piece
    await page.mouse.click(300, 300);
    await page.waitForTimeout(100);

    // Try to place another piece at the same position
    await page.mouse.click(300, 300);
    await page.waitForTimeout(100);

    // Should have logged an invalid move error
    const hasInvalidMoveError = messages.some(msg => 
      msg.includes('Invalid move') || msg.includes('occupied')
    );
    expect(hasInvalidMoveError).toBe(true);
  });
});
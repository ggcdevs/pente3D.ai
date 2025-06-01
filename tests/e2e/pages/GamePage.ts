import { Page, ElementHandle } from '@playwright/test';

export interface GameState {
  boardLoaded: boolean;
  currentPlayer?: string;
  pieces?: any[];
  consoleErrors: string[];
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export class GamePage {
  private consoleErrors: string[] = [];

  constructor(private page: Page) {
    // Set up console error monitoring
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        this.consoleErrors.push(msg.text());
      }
    });
  }

  async navigate() {
    await this.page.goto('/');
  }

  async waitForThreeJSLoad(timeout = 10000): Promise<void> {
    // Wait for canvas to be available and have WebGL context
    await this.page.waitForFunction(
      () => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return false;
        
        // Check if canvas has dimensions
        if (canvas.width === 0 || canvas.height === 0) return false;
        
        // Check if WebGL context exists
        const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
        return !!gl;
      },
      { timeout }
    );

    // Give a bit more time for initial render
    await this.page.waitForTimeout(500);
  }

  async captureGameState(): Promise<GameState> {
    const boardLoaded = await this.isBoardVisible();
    
    const gameState = await this.page.evaluate(() => {
      // Try to access game state from window or other global
      // This will need to be adjusted based on actual implementation
      return {
        currentPlayer: null,
        pieces: []
      };
    });

    return {
      boardLoaded,
      ...gameState,
      consoleErrors: this.getConsoleErrors()
    };
  }

  async clickBoardPosition(x: number, y: number, z: number): Promise<void> {
    // Convert 3D position to screen coordinates
    const screenCoords = await this.convert3DToScreenCoords({ x, y, z });
    
    // Click on the canvas at the calculated position
    const canvas = await this.getCanvas();
    await canvas.click({
      position: screenCoords
    });
  }

  async getCanvas(): Promise<ElementHandle> {
    const canvas = await this.page.waitForSelector('canvas');
    if (!canvas) {
      throw new Error('Canvas element not found');
    }
    return canvas;
  }

  async isBoardVisible(): Promise<boolean> {
    try {
      const canvas = await this.getCanvas();
      const isVisible = await canvas.isVisible();
      
      // Also check if canvas has content
      const hasContent = await this.page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (!canvas || !(canvas instanceof HTMLCanvasElement)) return false;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return true; // WebGL canvas, assume it has content
        
        // For 2D context, check if it's not empty
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return imageData.data.some(channel => channel !== 0);
      });

      return isVisible && hasContent;
    } catch {
      return false;
    }
  }

  async captureScreenshot(name: string): Promise<Buffer> {
    return await this.page.screenshot({
      path: `tests/e2e/fixtures/screenshots/${name}.png`,
      fullPage: false
    });
  }

  async captureCanvasScreenshot(name: string): Promise<Buffer> {
    const canvas = await this.getCanvas();
    return await canvas.screenshot({
      path: `tests/e2e/fixtures/screenshots/${name}-canvas.png`
    });
  }

  getConsoleErrors(): string[] {
    return [...this.consoleErrors];
  }

  clearConsoleErrors(): void {
    this.consoleErrors = [];
  }

  private async convert3DToScreenCoords(position: Vector3): Promise<Point2D> {
    // This would need to use Three.js camera projection
    // For now, return center of canvas as placeholder
    const canvas = await this.getCanvas();
    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error('Could not get canvas bounding box');
    }

    // Placeholder - would need actual 3D to 2D projection
    return {
      x: box.width / 2,
      y: box.height / 2
    };
  }
}
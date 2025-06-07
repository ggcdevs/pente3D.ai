/**
 * Test environment setup and teardown utilities
 * Provides consistent test setup across all E2E tests
 */

import { test as base, Page, BrowserContext } from '@playwright/test';
import { createGamePage, GamePageHelpers } from './game-page';
import { createVisualTester, VisualTester } from './visual-testing';
import { createBrowserHelpers, BrowserHelpers } from './browser-helpers';

export interface TestFixtures {
  testEnv: TestEnvironment;
  game: GamePageHelpers;
  visual: VisualTester;
  browser: BrowserHelpers;
}

export interface TestEnvironment {
  // Test data cleanup
  cleanupHandlers: Array<() => Promise<void>>;
  addCleanup(handler: () => Promise<void>): void;
  
  // Test isolation
  isolateTest(): Promise<void>;
  
  // Common test data
  testId: string;
  timestamp: number;
  
  // Test state
  skipIfNoWebGL: () => Promise<void>;
  skipIfMobile: () => Promise<void>;
  skipIfSafari: () => Promise<void>;
  
  // Performance tracking
  startPerformanceTrace(): Promise<void>;
  stopPerformanceTrace(name: string): Promise<void>;
  
  // Error tracking
  expectNoConsoleErrors(): void;
  expectNoConsoleWarnings(): void;
}

/**
 * Extended test with fixtures
 */
export const test = base.extend<TestFixtures>({
  // Test environment fixture
  testEnv: async ({ page, context }, use) => {
    const cleanupHandlers: Array<() => Promise<void>> = [];
    const testId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const env: TestEnvironment = {
      cleanupHandlers,
      testId,
      timestamp: Date.now(),
      
      addCleanup(handler: () => Promise<void>) {
        cleanupHandlers.push(handler);
      },
      
      async isolateTest() {
        // Clear all storage
        await page.evaluate(() => {
          localStorage.clear();
          sessionStorage.clear();
        });
        
        // Clear IndexedDB
        await page.evaluate(() => {
          return new Promise<void>((resolve) => {
            const deleteReq = indexedDB.deleteDatabase('pente3d');
            deleteReq.onsuccess = () => resolve();
            deleteReq.onerror = () => resolve();
          });
        });
        
        // Reset any global state
        await page.evaluate(() => {
          // Reset any singletons or global state
          if ((window as any).game) {
            (window as any).game.reset();
          }
          if ((window as any).networkManager) {
            (window as any).networkManager.disconnect();
          }
        });
      },
      
      async skipIfNoWebGL() {
        const hasWebGL = await page.evaluate(() => {
          try {
            const canvas = document.createElement('canvas');
            return !!(
              window.WebGLRenderingContext &&
              (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
            );
          } catch (e) {
            return false;
          }
        });
        
        if (!hasWebGL) {
          test.skip(true, 'WebGL not supported');
        }
      },
      
      async skipIfMobile() {
        const isMobile = await page.evaluate(() => {
          return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
            navigator.userAgent
          );
        });
        
        if (isMobile) {
          test.skip(true, 'Test skipped on mobile');
        }
      },
      
      async skipIfSafari() {
        const isSafari = await page.evaluate(() => {
          return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        });
        
        if (isSafari) {
          test.skip(true, 'Test skipped on Safari');
        }
      },
      
      async startPerformanceTrace() {
        await context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: true
        });
      },
      
      async stopPerformanceTrace(name: string) {
        await context.tracing.stop({
          path: `test-results/traces/${testId}-${name}.zip`
        });
      },
      
      expectNoConsoleErrors() {
        const errors: string[] = [];
        page.on('console', msg => {
          if (msg.type() === 'error') {
            errors.push(msg.text());
          }
        });
        
        cleanupHandlers.push(async () => {
          if (errors.length > 0) {
            throw new Error(`Console errors detected:\n${errors.join('\n')}`);
          }
        });
      },
      
      expectNoConsoleWarnings() {
        const warnings: string[] = [];
        page.on('console', msg => {
          if (msg.type() === 'warning') {
            warnings.push(msg.text());
          }
        });
        
        cleanupHandlers.push(async () => {
          if (warnings.length > 0) {
            throw new Error(`Console warnings detected:\n${warnings.join('\n')}`);
          }
        });
      }
    };
    
    // Use the environment
    await use(env);
    
    // Run cleanup handlers
    for (const handler of cleanupHandlers.reverse()) {
      await handler();
    }
  },
  
  // Game helpers fixture
  game: async ({ page }, use) => {
    const game = createGamePage(page);
    await use(game);
  },
  
  // Visual testing fixture
  visual: async ({ page }, use) => {
    const visual = createVisualTester(page);
    await use(visual);
  },
  
  // Browser helpers fixture
  browser: async ({ page, context }, use) => {
    const browser = createBrowserHelpers(page, context);
    await use(browser);
  }
});

/**
 * Common test setup
 */
export async function setupTest(page: Page, options?: {
  waitForScene?: boolean;
  isolateStorage?: boolean;
  mockTime?: number;
  viewport?: { width: number; height: number };
}): Promise<void> {
  // Set viewport if specified
  if (options?.viewport) {
    await page.setViewportSize(options.viewport);
  }
  
  // Mock time if specified
  if (options?.mockTime) {
    await page.evaluate((time) => {
      const originalDate = Date;
      (window as any).Date = class extends originalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(time);
          } else {
            super(...args);
          }
        }
        static now() {
          return time;
        }
      };
    }, options.mockTime);
  }
  
  // Clear storage if requested
  if (options?.isolateStorage) {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  }
  
  // Navigate to the app
  await page.goto('/');
  
  // Wait for scene if requested
  if (options?.waitForScene !== false) {
    await page.waitForFunction(
      () => window.THREE !== undefined,
      { timeout: 10000 }
    );
    
    await page.waitForFunction(
      () => {
        const renderer = (window as any).renderer;
        const canvas = document.querySelector('canvas');
        return renderer && canvas && canvas.width > 0 && canvas.height > 0;
      },
      { timeout: 10000 }
    );
    
    // Wait for first render
    await page.waitForTimeout(100);
  }
}

/**
 * Common test utilities
 */
export const testUtils = {
  /**
   * Generate unique test data
   */
  generateTestId(): string {
    return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  },
  
  /**
   * Wait for condition with timeout
   */
  async waitForCondition(
    page: Page,
    condition: () => boolean | Promise<boolean>,
    options?: {
      timeout?: number;
      interval?: number;
      message?: string;
    }
  ): Promise<void> {
    const timeout = options?.timeout || 5000;
    const interval = options?.interval || 100;
    const message = options?.message || 'Condition not met';
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const result = await page.evaluate(condition);
      if (result) return;
      
      await page.waitForTimeout(interval);
    }
    
    throw new Error(`${message} (timeout: ${timeout}ms)`);
  },
  
  /**
   * Retry operation with backoff
   */
  async retry<T>(
    operation: () => Promise<T>,
    options?: {
      maxAttempts?: number;
      delay?: number;
      backoff?: number;
      onError?: (error: Error, attempt: number) => void;
    }
  ): Promise<T> {
    const maxAttempts = options?.maxAttempts || 3;
    const delay = options?.delay || 100;
    const backoff = options?.backoff || 2;
    
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (options?.onError) {
          options.onError(lastError, attempt);
        }
        
        if (attempt < maxAttempts) {
          await new Promise(resolve => 
            setTimeout(resolve, delay * Math.pow(backoff, attempt - 1))
          );
        }
      }
    }
    
    throw lastError!;
  },
  
  /**
   * Take screenshot with annotations
   */
  async annotatedScreenshot(
    page: Page,
    name: string,
    annotations?: Array<{
      type: 'rect' | 'circle' | 'arrow' | 'text';
      x: number;
      y: number;
      width?: number;
      height?: number;
      radius?: number;
      text?: string;
      color?: string;
    }>
  ): Promise<Buffer> {
    // Add annotation overlay
    if (annotations) {
      await page.evaluate((annotations) => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '999999';
        
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.width = '100%';
        svg.style.height = '100%';
        
        annotations.forEach(ann => {
          const color = ann.color || 'red';
          
          switch (ann.type) {
            case 'rect':
              const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
              rect.setAttribute('x', String(ann.x));
              rect.setAttribute('y', String(ann.y));
              rect.setAttribute('width', String(ann.width || 100));
              rect.setAttribute('height', String(ann.height || 100));
              rect.setAttribute('fill', 'none');
              rect.setAttribute('stroke', color);
              rect.setAttribute('stroke-width', '2');
              svg.appendChild(rect);
              break;
              
            case 'circle':
              const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
              circle.setAttribute('cx', String(ann.x));
              circle.setAttribute('cy', String(ann.y));
              circle.setAttribute('r', String(ann.radius || 20));
              circle.setAttribute('fill', 'none');
              circle.setAttribute('stroke', color);
              circle.setAttribute('stroke-width', '2');
              svg.appendChild(circle);
              break;
              
            case 'text':
              const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              text.setAttribute('x', String(ann.x));
              text.setAttribute('y', String(ann.y));
              text.setAttribute('fill', color);
              text.setAttribute('font-size', '16');
              text.setAttribute('font-weight', 'bold');
              text.textContent = ann.text || '';
              svg.appendChild(text);
              break;
          }
        });
        
        overlay.appendChild(svg);
        document.body.appendChild(overlay);
        
        // Store reference for cleanup
        (window as any).__testAnnotationOverlay = overlay;
      }, annotations);
    }
    
    // Take screenshot
    const screenshot = await page.screenshot();
    
    // Remove annotations
    if (annotations) {
      await page.evaluate(() => {
        const overlay = (window as any).__testAnnotationOverlay;
        if (overlay) {
          overlay.remove();
          delete (window as any).__testAnnotationOverlay;
        }
      });
    }
    
    return screenshot;
  }
};

// Re-export expect for convenience
export { expect } from '@playwright/test';
/**
 * Browser-specific utilities for E2E tests
 * Handles browser capabilities, permissions, and environment setup
 */

import { Page, BrowserContext } from '@playwright/test';

export interface BrowserCapabilities {
  webgl: boolean;
  webgl2: boolean;
  webgpu: boolean;
  offscreenCanvas: boolean;
  sharedArrayBuffer: boolean;
  webWorkers: boolean;
  serviceWorkers: boolean;
  webRTC: boolean;
  localStorage: boolean;
  sessionStorage: boolean;
  indexedDB: boolean;
  webAudio: boolean;
  pointerEvents: boolean;
  touchEvents: boolean;
}

export interface PerformanceMetrics {
  fps: number;
  memory: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
  renderTime: number;
  scriptTime: number;
  layoutTime: number;
  paintTime: number;
}

export interface NetworkConditions {
  offline?: boolean;
  downloadThroughput?: number; // bytes per second
  uploadThroughput?: number;   // bytes per second
  latency?: number;            // milliseconds
}

/**
 * Browser helper class for E2E tests
 */
export class BrowserHelpers {
  private page: Page;
  private context: BrowserContext;

  constructor(page: Page, context: BrowserContext) {
    this.page = page;
    this.context = context;
  }

  /**
   * Check browser capabilities
   */
  async checkCapabilities(): Promise<BrowserCapabilities> {
    return await this.page.evaluate(() => {
      const checkWebGL = (): boolean => {
        try {
          const canvas = document.createElement('canvas');
          return !!(
            window.WebGLRenderingContext &&
            (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
          );
        } catch (e) {
          return false;
        }
      };

      const checkWebGL2 = (): boolean => {
        try {
          const canvas = document.createElement('canvas');
          return !!(window.WebGL2RenderingContext && canvas.getContext('webgl2'));
        } catch (e) {
          return false;
        }
      };

      const checkWebGPU = (): boolean => {
        return 'gpu' in navigator;
      };

      const checkOffscreenCanvas = (): boolean => {
        return typeof OffscreenCanvas !== 'undefined';
      };

      const checkSharedArrayBuffer = (): boolean => {
        return typeof SharedArrayBuffer !== 'undefined';
      };

      const checkWebWorkers = (): boolean => {
        return typeof Worker !== 'undefined';
      };

      const checkServiceWorkers = (): boolean => {
        return 'serviceWorker' in navigator;
      };

      const checkWebRTC = (): boolean => {
        return !!(
          window.RTCPeerConnection ||
          (window as any).webkitRTCPeerConnection ||
          (window as any).mozRTCPeerConnection
        );
      };

      const checkLocalStorage = (): boolean => {
        try {
          const test = '__localStorage_test__';
          localStorage.setItem(test, test);
          localStorage.removeItem(test);
          return true;
        } catch (e) {
          return false;
        }
      };

      const checkSessionStorage = (): boolean => {
        try {
          const test = '__sessionStorage_test__';
          sessionStorage.setItem(test, test);
          sessionStorage.removeItem(test);
          return true;
        } catch (e) {
          return false;
        }
      };

      const checkIndexedDB = (): boolean => {
        return !!(window.indexedDB || (window as any).webkitIndexedDB);
      };

      const checkWebAudio = (): boolean => {
        return !!(window.AudioContext || (window as any).webkitAudioContext);
      };

      const checkPointerEvents = (): boolean => {
        return 'PointerEvent' in window;
      };

      const checkTouchEvents = (): boolean => {
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      };

      return {
        webgl: checkWebGL(),
        webgl2: checkWebGL2(),
        webgpu: checkWebGPU(),
        offscreenCanvas: checkOffscreenCanvas(),
        sharedArrayBuffer: checkSharedArrayBuffer(),
        webWorkers: checkWebWorkers(),
        serviceWorkers: checkServiceWorkers(),
        webRTC: checkWebRTC(),
        localStorage: checkLocalStorage(),
        sessionStorage: checkSessionStorage(),
        indexedDB: checkIndexedDB(),
        webAudio: checkWebAudio(),
        pointerEvents: checkPointerEvents(),
        touchEvents: checkTouchEvents()
      };
    });
  }

  /**
   * Set up browser permissions
   */
  async setupPermissions(permissions: string[]): Promise<void> {
    await this.context.grantPermissions(permissions);
  }

  /**
   * Emulate device
   */
  async emulateDevice(device: {
    viewport?: { width: number; height: number };
    userAgent?: string;
    deviceScaleFactor?: number;
    isMobile?: boolean;
    hasTouch?: boolean;
  }): Promise<void> {
    if (device.viewport) {
      await this.page.setViewportSize(device.viewport);
    }

    if (device.userAgent) {
      await this.page.evaluate((ua) => {
        Object.defineProperty(navigator, 'userAgent', {
          value: ua,
          writable: false
        });
      }, device.userAgent);
    }

    // Note: deviceScaleFactor, isMobile, and hasTouch need to be set
    // when creating the context, not after page is created
  }

  /**
   * Simulate network conditions
   */
  async setNetworkConditions(conditions: NetworkConditions): Promise<void> {
    const client = await this.context.newCDPSession(this.page);
    
    if (conditions.offline) {
      await client.send('Network.emulateNetworkConditions', {
        offline: true,
        downloadThroughput: 0,
        uploadThroughput: 0,
        latency: 0
      });
    } else {
      await client.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: conditions.downloadThroughput || -1,
        uploadThroughput: conditions.uploadThroughput || -1,
        latency: conditions.latency || 0
      });
    }
  }

  /**
   * Clear browser data
   */
  async clearBrowserData(options?: {
    localStorage?: boolean;
    sessionStorage?: boolean;
    cookies?: boolean;
    cache?: boolean;
  }): Promise<void> {
    const opts = {
      localStorage: true,
      sessionStorage: true,
      cookies: true,
      cache: true,
      ...options
    };

    if (opts.localStorage || opts.sessionStorage) {
      await this.page.evaluate((opts) => {
        if (opts.localStorage) {
          localStorage.clear();
        }
        if (opts.sessionStorage) {
          sessionStorage.clear();
        }
      }, opts);
    }

    if (opts.cookies) {
      await this.context.clearCookies();
    }

    if (opts.cache) {
      // This clears service worker cache
      await this.page.evaluate(() => {
        if ('caches' in window) {
          return caches.keys().then(names => {
            return Promise.all(names.map(name => caches.delete(name)));
          });
        }
      });
    }
  }

  /**
   * Get performance metrics
   */
  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    return await this.page.evaluate(() => {
      const getFPS = (): number => {
        // Simple FPS calculation based on requestAnimationFrame
        let fps = 60; // Default
        let lastTime = performance.now();
        let frameCount = 0;
        
        const measure = (): void => {
          const currentTime = performance.now();
          frameCount++;
          
          if (currentTime >= lastTime + 1000) {
            fps = Math.round(frameCount * 1000 / (currentTime - lastTime));
            frameCount = 0;
            lastTime = currentTime;
          }
          
          if (frameCount < 60) {
            requestAnimationFrame(measure);
          }
        };
        
        measure();
        return fps;
      };

      const getMemory = () => {
        const memory = (performance as any).memory;
        if (!memory) {
          return {
            usedJSHeapSize: 0,
            totalJSHeapSize: 0,
            jsHeapSizeLimit: 0
          };
        }
        
        return {
          usedJSHeapSize: memory.usedJSHeapSize,
          totalJSHeapSize: memory.totalJSHeapSize,
          jsHeapSizeLimit: memory.jsHeapSizeLimit
        };
      };

      const getTiming = () => {
        const entries = performance.getEntriesByType('measure');
        let renderTime = 0;
        let scriptTime = 0;
        let layoutTime = 0;
        let paintTime = 0;

        entries.forEach(entry => {
          if (entry.name.includes('render')) renderTime += entry.duration;
          if (entry.name.includes('script')) scriptTime += entry.duration;
          if (entry.name.includes('layout')) layoutTime += entry.duration;
          if (entry.name.includes('paint')) paintTime += entry.duration;
        });

        return { renderTime, scriptTime, layoutTime, paintTime };
      };

      const timing = getTiming();
      
      return {
        fps: getFPS(),
        memory: getMemory(),
        ...timing
      };
    });
  }

  /**
   * Monitor console messages
   */
  setupConsoleMonitoring(options?: {
    logErrors?: boolean;
    logWarnings?: boolean;
    logInfo?: boolean;
    filter?: (message: string) => boolean;
  }): {
    errors: string[];
    warnings: string[];
    info: string[];
  } {
    const logs = {
      errors: [] as string[],
      warnings: [] as string[],
      info: [] as string[]
    };

    const opts = {
      logErrors: true,
      logWarnings: true,
      logInfo: false,
      ...options
    };

    this.page.on('console', msg => {
      const text = msg.text();
      const type = msg.type();

      if (opts.filter && !opts.filter(text)) {
        return;
      }

      if (type === 'error' && opts.logErrors) {
        logs.errors.push(text);
      } else if (type === 'warning' && opts.logWarnings) {
        logs.warnings.push(text);
      } else if (opts.logInfo && ['log', 'info'].includes(type)) {
        logs.info.push(text);
      }
    });

    return logs;
  }

  /**
   * Set up request interception
   */
  async setupRequestInterception(options: {
    blockResources?: string[]; // Resource types to block
    blockUrls?: string[];      // URL patterns to block
    mockResponses?: Map<string, { status: number; body: string }>;
  }): Promise<void> {
    await this.page.route('**/*', (route, request) => {
      const url = request.url();
      const resourceType = request.resourceType();

      // Block by resource type
      if (options.blockResources?.includes(resourceType)) {
        return route.abort();
      }

      // Block by URL pattern
      if (options.blockUrls?.some(pattern => url.includes(pattern))) {
        return route.abort();
      }

      // Mock responses
      if (options.mockResponses) {
        for (const [pattern, response] of options.mockResponses) {
          if (url.includes(pattern)) {
            return route.fulfill({
              status: response.status,
              body: response.body,
              contentType: 'application/json'
            });
          }
        }
      }

      // Continue normally
      route.continue();
    });
  }

  /**
   * Wait for network idle
   */
  async waitForNetworkIdle(options?: {
    timeout?: number;
    maxInflightRequests?: number;
  }): Promise<void> {
    await this.page.waitForLoadState('networkidle', {
      timeout: options?.timeout || 30000
    });
  }

  /**
   * Get browser info
   */
  async getBrowserInfo(): Promise<{
    name: string;
    version: string;
    userAgent: string;
    platform: string;
  }> {
    return await this.page.evaluate(() => {
      const ua = navigator.userAgent;
      let name = 'Unknown';
      let version = 'Unknown';

      if (ua.includes('Firefox')) {
        name = 'Firefox';
        version = ua.match(/Firefox\/(\d+\.\d+)/)?.[1] || 'Unknown';
      } else if (ua.includes('Chrome')) {
        name = 'Chrome';
        version = ua.match(/Chrome\/(\d+\.\d+)/)?.[1] || 'Unknown';
      } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
        name = 'Safari';
        version = ua.match(/Version\/(\d+\.\d+)/)?.[1] || 'Unknown';
      } else if (ua.includes('Edge')) {
        name = 'Edge';
        version = ua.match(/Edge\/(\d+\.\d+)/)?.[1] || 'Unknown';
      }

      return {
        name,
        version,
        userAgent: ua,
        platform: navigator.platform
      };
    });
  }

  /**
   * Check for accessibility issues
   */
  async checkAccessibility(options?: {
    includedImpacts?: string[];
    excludeSelectors?: string[];
  }): Promise<any[]> {
    // This would integrate with axe-core or similar
    // For now, return a placeholder
    return [];
  }

  /**
   * Take performance trace
   */
  async startTrace(options?: {
    screenshots?: boolean;
    categories?: string[];
  }): Promise<void> {
    await this.context.tracing.start({
      screenshots: options?.screenshots ?? true,
      snapshots: true,
      sources: true,
      categories: options?.categories || ['devtools.timeline', 'disabled-by-default-devtools.timeline.frame']
    });
  }

  async stopTrace(path: string): Promise<void> {
    await this.context.tracing.stop({ path });
  }
}

/**
 * Create browser helpers instance
 */
export function createBrowserHelpers(page: Page, context: BrowserContext): BrowserHelpers {
  return new BrowserHelpers(page, context);
}
/**
 * Enhanced visual testing utilities for E2E tests
 * Improves upon the existing visual-regression.ts with better error handling and features
 */

import { Page } from '@playwright/test';
import { promises as fs } from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

// Dynamic import for ESM module
let pixelmatch: any;

export interface VisualTestOptions {
  threshold?: number;              // Pixel difference threshold (0-1)
  includeAA?: boolean;            // Include anti-aliasing in comparison
  diffMask?: boolean;             // Generate diff mask image
  maskColor?: [number, number, number]; // RGB color for diff mask
  failureThreshold?: number;      // Percentage of diff to consider test failed
  updateBaseline?: boolean;       // Force update baseline
  maskRegions?: MaskRegion[];     // Regions to mask before comparison
}

export interface MaskRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: [number, number, number]; // Optional mask color
}

export interface ComparisonResult {
  match: boolean;
  diffPixels: number;
  diffPercentage: number;
  diffImage?: Buffer;
  baselinePath?: string;
  actualPath?: string;
  diffPath?: string;
}

export interface ScreenshotOptions {
  fullPage?: boolean;
  clip?: { x: number; y: number; width: number; height: number };
  animations?: 'disabled' | 'allow';
  maskRegions?: MaskRegion[];
}

const DEFAULT_OPTIONS: VisualTestOptions = {
  threshold: 0.1,
  includeAA: true,
  diffMask: true,
  maskColor: [255, 0, 0],
  failureThreshold: 0.1, // 0.1% difference
  updateBaseline: false,
  maskRegions: []
};

/**
 * Visual testing helper class
 */
export class VisualTester {
  private page: Page;
  private baselineDir: string;
  private diffDir: string;
  private actualDir: string;

  constructor(page: Page, options?: {
    baselineDir?: string;
    diffDir?: string;
    actualDir?: string;
  }) {
    this.page = page;
    this.baselineDir = options?.baselineDir || 
      path.join(process.cwd(), 'tests/e2e/fixtures/baseline-screenshots');
    this.diffDir = options?.diffDir || 
      path.join(process.cwd(), 'tests/e2e/fixtures/diff-screenshots');
    this.actualDir = options?.actualDir || 
      path.join(process.cwd(), 'tests/e2e/fixtures/actual-screenshots');
  }

  /**
   * Take a screenshot with optional masking
   */
  async takeScreenshot(options?: ScreenshotOptions): Promise<Buffer> {
    // Disable animations if requested
    if (options?.animations === 'disabled') {
      await this.page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            transition-delay: 0s !important;
          }
        `
      });
    }

    // Take screenshot
    let screenshot = await this.page.screenshot({
      fullPage: options?.fullPage,
      clip: options?.clip
    });

    // Apply masks if needed
    if (options?.maskRegions && options.maskRegions.length > 0) {
      screenshot = await this.maskRegions(screenshot, options.maskRegions);
    }

    return screenshot;
  }

  /**
   * Take a screenshot of a specific element
   */
  async takeElementScreenshot(
    selector: string, 
    options?: ScreenshotOptions
  ): Promise<Buffer> {
    const element = await this.page.waitForSelector(selector, { 
      state: 'visible',
      timeout: 5000 
    });
    
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    // Disable animations if requested
    if (options?.animations === 'disabled') {
      await this.page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            transition-delay: 0s !important;
          }
        `
      });
    }

    let screenshot = await element.screenshot();

    // Apply masks if needed
    if (options?.maskRegions && options.maskRegions.length > 0) {
      screenshot = await this.maskRegions(screenshot, options.maskRegions);
    }

    return screenshot;
  }

  /**
   * Compare screenshot with baseline
   */
  async compareWithBaseline(
    screenshot: Buffer,
    name: string,
    options: VisualTestOptions = {}
  ): Promise<ComparisonResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    
    // Ensure directories exist
    await fs.mkdir(this.baselineDir, { recursive: true });
    await fs.mkdir(this.diffDir, { recursive: true });
    await fs.mkdir(this.actualDir, { recursive: true });

    const baselinePath = path.join(this.baselineDir, `${name}.png`);
    const actualPath = path.join(this.actualDir, `${name}.png`);
    const diffPath = path.join(this.diffDir, `${name}-diff.png`);

    // Save actual screenshot
    await fs.writeFile(actualPath, screenshot);

    // Check if we should update baseline
    if (opts.updateBaseline || process.env.UPDATE_BASELINES === 'true') {
      await fs.writeFile(baselinePath, screenshot);
      return {
        match: true,
        diffPixels: 0,
        diffPercentage: 0,
        baselinePath,
        actualPath
      };
    }

    // Load baseline
    let baseline: Buffer;
    try {
      baseline = await fs.readFile(baselinePath);
    } catch (error) {
      // No baseline exists, create it
      await fs.writeFile(baselinePath, screenshot);
      console.log(`Created baseline: ${name}`);
      return {
        match: true,
        diffPixels: 0,
        diffPercentage: 0,
        baselinePath,
        actualPath
      };
    }

    // Apply masks to both images if needed
    if (opts.maskRegions && opts.maskRegions.length > 0) {
      screenshot = await this.maskRegions(screenshot, opts.maskRegions);
      baseline = await this.maskRegions(baseline, opts.maskRegions);
    }

    // Compare images
    const result = await this.compareImages(screenshot, baseline, opts);
    
    // Save diff image if comparison failed
    if (!result.match && result.diffImage) {
      await fs.writeFile(diffPath, result.diffImage);
      result.diffPath = diffPath;
    }

    result.baselinePath = baselinePath;
    result.actualPath = actualPath;

    return result;
  }

  /**
   * Compare two images
   */
  private async compareImages(
    actual: Buffer,
    expected: Buffer,
    options: VisualTestOptions
  ): Promise<ComparisonResult> {
    // Load pixelmatch dynamically if not loaded
    if (!pixelmatch) {
      const module = await import('pixelmatch');
      pixelmatch = module.default;
    }

    // Parse PNG images
    const actualPng = PNG.sync.read(actual);
    const expectedPng = PNG.sync.read(expected);

    // Check dimensions match
    if (actualPng.width !== expectedPng.width || actualPng.height !== expectedPng.height) {
      return {
        match: false,
        diffPixels: actualPng.width * actualPng.height,
        diffPercentage: 100
      };
    }

    const { width, height } = actualPng;
    let diffPng: PNG | undefined;
    let output: Buffer | undefined;

    if (options.diffMask) {
      diffPng = new PNG({ width, height });
      output = Buffer.from(diffPng.data);
    }

    // Compare pixels
    const diffPixels = pixelmatch(
      actualPng.data,
      expectedPng.data,
      output,
      width,
      height,
      {
        threshold: options.threshold,
        includeAA: options.includeAA,
        diffColor: options.maskColor,
        diffColorAlt: [0, 255, 0], // Green for anti-aliased pixels
        alpha: 0.1
      }
    );

    const totalPixels = width * height;
    const diffPercentage = (diffPixels / totalPixels) * 100;

    const result: ComparisonResult = {
      match: diffPercentage < (options.failureThreshold || 0.1),
      diffPixels,
      diffPercentage
    };

    if (options.diffMask && diffPng) {
      result.diffImage = PNG.sync.write(diffPng);
    }

    return result;
  }

  /**
   * Mask regions in an image
   */
  private async maskRegions(
    screenshot: Buffer,
    regions: MaskRegion[]
  ): Promise<Buffer> {
    const png = PNG.sync.read(screenshot);

    for (const region of regions) {
      const color = region.color || [128, 128, 128];
      
      // Validate region bounds
      const startX = Math.max(0, region.x);
      const startY = Math.max(0, region.y);
      const endX = Math.min(png.width, region.x + region.width);
      const endY = Math.min(png.height, region.y + region.height);

      // Fill region with mask color
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (png.width * y + x) << 2;
          png.data[idx] = color[0];     // R
          png.data[idx + 1] = color[1]; // G
          png.data[idx + 2] = color[2]; // B
          png.data[idx + 3] = 255;      // A
        }
      }
    }

    return PNG.sync.write(png);
  }

  /**
   * Wait for page to be visually stable
   */
  async waitForVisualStability(options?: {
    timeout?: number;
    checkInterval?: number;
    threshold?: number;
  }): Promise<void> {
    const timeout = options?.timeout || 5000;
    const checkInterval = options?.checkInterval || 500;
    const threshold = options?.threshold || 0.01; // 0.01% change

    const startTime = Date.now();
    let previousScreenshot = await this.page.screenshot();
    
    while (Date.now() - startTime < timeout) {
      await this.page.waitForTimeout(checkInterval);
      
      const currentScreenshot = await this.page.screenshot();
      const comparison = await this.compareImages(
        currentScreenshot, 
        previousScreenshot,
        { threshold: 0, failureThreshold: threshold }
      );

      if (comparison.match) {
        // Page is stable
        return;
      }

      previousScreenshot = currentScreenshot;
    }

    throw new Error(`Page did not stabilize within ${timeout}ms`);
  }

  /**
   * Take screenshots at different viewport sizes
   */
  async takeResponsiveScreenshots(
    name: string,
    viewports: Array<{ width: number; height: number; label: string }>,
    options?: ScreenshotOptions
  ): Promise<Map<string, Buffer>> {
    const screenshots = new Map<string, Buffer>();
    const originalViewport = this.page.viewportSize();

    for (const viewport of viewports) {
      await this.page.setViewportSize({
        width: viewport.width,
        height: viewport.height
      });

      // Wait for any responsive changes to settle
      await this.page.waitForTimeout(500);
      
      const screenshot = await this.takeScreenshot(options);
      screenshots.set(`${name}-${viewport.label}`, screenshot);
    }

    // Restore original viewport
    if (originalViewport) {
      await this.page.setViewportSize(originalViewport);
    }

    return screenshots;
  }

  /**
   * Compare screenshots across different browsers/devices
   */
  async crossBrowserCompare(
    name: string,
    screenshots: Map<string, Buffer>,
    options?: VisualTestOptions
  ): Promise<Map<string, ComparisonResult>> {
    const results = new Map<string, ComparisonResult>();

    for (const [browserName, screenshot] of screenshots) {
      const result = await this.compareWithBaseline(
        screenshot,
        `${name}-${browserName}`,
        options
      );
      results.set(browserName, result);
    }

    return results;
  }

  /**
   * Clean up old diff/actual screenshots
   */
  async cleanup(options?: {
    diffDir?: boolean;
    actualDir?: boolean;
    olderThan?: number; // milliseconds
  }): Promise<void> {
    const olderThan = options?.olderThan || 7 * 24 * 60 * 60 * 1000; // 7 days

    if (options?.diffDir !== false) {
      await this.cleanupDirectory(this.diffDir, olderThan);
    }

    if (options?.actualDir !== false) {
      await this.cleanupDirectory(this.actualDir, olderThan);
    }
  }

  private async cleanupDirectory(dir: string, olderThan: number): Promise<void> {
    try {
      const files = await fs.readdir(dir);
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = await fs.stat(filePath);

        if (now - stats.mtime.getTime() > olderThan) {
          await fs.unlink(filePath);
        }
      }
    } catch (error) {
      // Directory might not exist
    }
  }
}

/**
 * Create a visual tester instance
 */
export function createVisualTester(page: Page, options?: {
  baselineDir?: string;
  diffDir?: string;
  actualDir?: string;
}): VisualTester {
  return new VisualTester(page, options);
}
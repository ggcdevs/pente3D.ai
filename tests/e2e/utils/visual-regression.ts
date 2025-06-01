import { promises as fs } from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

// Dynamic import for ESM module
let pixelmatch: any;

export interface ComparisonResult {
  match: boolean;
  diffPixels: number;
  diffPercentage: number;
  diffImage?: Buffer;
}

export interface VisualRegressionOptions {
  threshold?: number;           // Pixel difference threshold (0-1)
  includeAA?: boolean;         // Include anti-aliasing
  diffMask?: boolean;          // Generate diff mask image
  maskColor?: [number, number, number]; // RGB color for diff mask
}

const DEFAULT_OPTIONS: VisualRegressionOptions = {
  threshold: 0.1,
  includeAA: true,
  diffMask: true,
  maskColor: [255, 0, 0]
};

/**
 * Compare two screenshots for visual regression
 */
export async function compareScreenshots(
  actual: Buffer,
  expected: Buffer,
  options: VisualRegressionOptions = {}
): Promise<ComparisonResult> {
  // Load pixelmatch dynamically if not loaded
  if (!pixelmatch) {
    const module = await import('pixelmatch');
    pixelmatch = module.default;
  }
  
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
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
  
  if (opts.diffMask) {
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
      threshold: opts.threshold,
      includeAA: opts.includeAA,
      diffColor: opts.maskColor
    }
  );
  
  const totalPixels = width * height;
  const diffPercentage = (diffPixels / totalPixels) * 100;
  
  const result: ComparisonResult = {
    match: diffPercentage < 0.1, // Less than 0.1% difference
    diffPixels,
    diffPercentage
  };
  
  if (opts.diffMask && diffPng) {
    result.diffImage = PNG.sync.write(diffPng);
  }
  
  return result;
}

/**
 * Save a baseline screenshot
 */
export async function saveBaselineScreenshot(
  name: string,
  screenshot: Buffer
): Promise<void> {
  const baselineDir = path.join(process.cwd(), 'tests/e2e/fixtures/baseline-screenshots');
  await fs.mkdir(baselineDir, { recursive: true });
  
  const filePath = path.join(baselineDir, `${name}.png`);
  await fs.writeFile(filePath, screenshot);
}

/**
 * Load a baseline screenshot
 */
export async function loadBaselineScreenshot(name: string): Promise<Buffer | null> {
  const filePath = path.join(
    process.cwd(),
    'tests/e2e/fixtures/baseline-screenshots',
    `${name}.png`
  );
  
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    return null;
  }
}

/**
 * Mask dynamic content in screenshots (timestamps, random values, etc.)
 */
export async function maskDynamicContent(
  screenshot: Buffer,
  masks: Array<{ x: number; y: number; width: number; height: number }>
): Promise<Buffer> {
  const png = PNG.sync.read(screenshot);
  
  // Fill masked areas with solid color
  for (const mask of masks) {
    for (let y = mask.y; y < mask.y + mask.height; y++) {
      for (let x = mask.x; x < mask.x + mask.width; x++) {
        const idx = (png.width * y + x) << 2;
        png.data[idx] = 128;     // R
        png.data[idx + 1] = 128; // G
        png.data[idx + 2] = 128; // B
        png.data[idx + 3] = 255; // A
      }
    }
  }
  
  return PNG.sync.write(png);
}

/**
 * Compare screenshot with baseline, creating baseline if it doesn't exist
 */
export async function expectScreenshotToMatchBaseline(
  screenshot: Buffer,
  name: string,
  options: VisualRegressionOptions = {}
): Promise<ComparisonResult> {
  const baseline = await loadBaselineScreenshot(name);
  
  if (!baseline) {
    // No baseline exists, save current as baseline
    await saveBaselineScreenshot(name, screenshot);
    console.log(`Created baseline screenshot: ${name}`);
    return {
      match: true,
      diffPixels: 0,
      diffPercentage: 0
    };
  }
  
  // Compare with baseline
  const result = await compareScreenshots(screenshot, baseline, options);
  
  if (!result.match && result.diffImage) {
    // Save diff image for debugging
    const diffPath = path.join(
      process.cwd(),
      'tests/e2e/fixtures/diff-screenshots',
      `${name}-diff.png`
    );
    await fs.mkdir(path.dirname(diffPath), { recursive: true });
    await fs.writeFile(diffPath, result.diffImage);
    
    // Save actual screenshot for comparison
    const actualPath = path.join(
      process.cwd(),
      'tests/e2e/fixtures/diff-screenshots',
      `${name}-actual.png`
    );
    await fs.writeFile(actualPath, screenshot);
  }
  
  return result;
}
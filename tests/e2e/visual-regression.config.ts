/**
 * Visual regression test configuration
 */

import { PlaywrightTestConfig } from '@playwright/test';

export const visualRegressionConfig: Partial<PlaywrightTestConfig> = {
  use: {
    // Consistent viewport for visual tests
    viewport: { width: 1280, height: 720 },
    
    // Disable animations
    launchOptions: {
      args: ['--force-color-profile=srgb'],
    },
    
    // Screenshot options
    screenshot: {
      mode: 'only-on-failure',
      fullPage: false,
    },
    
    // Video recording for debugging
    video: process.env.CI ? 'off' : 'retain-on-failure',
    
    // Consistent fonts
    contextOptions: {
      // Force consistent font rendering
      forcedColors: 'none',
    },
  },

  // Projects for different browsers
  projects: [
    {
      name: 'chromium-visual',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--font-render-hinting=none',
            '--disable-font-subpixel-positioning',
            '--force-color-profile=srgb',
          ],
        },
      },
    },
    {
      name: 'firefox-visual',
      use: {
        ...devices['Desktop Firefox'],
      },
    },
    {
      name: 'webkit-visual',
      use: {
        ...devices['Desktop Safari'],
      },
    },
  ],
};

// Visual test thresholds
export const visualThresholds = {
  // Pixel difference threshold (0-1)
  threshold: 0.2,
  
  // Include anti-aliasing in comparison
  includeAA: true,
  
  // Percentage of different pixels to fail test
  maxDiffPixelRatio: 0.01, // 1%
  
  // Update baselines with UPDATE_BASELINES=true
  updateBaseline: process.env.UPDATE_BASELINES === 'true',
};

// Directories for visual tests
export const visualDirectories = {
  baseline: 'tests/e2e/fixtures/baseline-screenshots',
  actual: 'tests/e2e/fixtures/actual-screenshots',
  diff: 'tests/e2e/fixtures/diff-screenshots',
};

// Visual test helpers
export const visualTestHelpers = {
  /**
   * Get OS-specific baseline path
   */
  getBaselinePath(name: string, platform: string = process.platform): string {
    return `${visualDirectories.baseline}/${platform}/${name}.png`;
  },

  /**
   * Check if running in CI
   */
  isCI(): boolean {
    return process.env.CI === 'true';
  },

  /**
   * Get browser-specific settings
   */
  getBrowserSettings(browserName: string): Record<string, any> {
    const settings: Record<string, any> = {
      chromium: {
        args: [
          '--font-render-hinting=none',
          '--disable-font-subpixel-positioning',
          '--force-color-profile=srgb',
          '--disable-lcd-text',
        ],
      },
      firefox: {
        prefs: {
          'layout.css.devPixelsPerPx': '1.0',
          'gfx.font_rendering.cleartype_params.rendering_mode': 4,
        },
      },
      webkit: {
        // WebKit specific settings
      },
    };

    return settings[browserName] || {};
  },
};

// Import required for devices
import { devices } from '@playwright/test';
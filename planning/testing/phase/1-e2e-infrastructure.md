# Phase 1: E2E Infrastructure Setup

## Overview
This phase establishes the foundation for end-to-end testing of the Pente3D.ai game using Playwright. We'll set up the testing framework, create utilities for 3D game testing, and establish patterns for future test development.

## Goals
- Install and configure Playwright with TypeScript support
- Create test utilities for WebGL/Three.js interaction
- Set up visual regression testing for 3D scenes
- Establish CI/CD integration patterns
- Create base test helpers and fixtures

## Implementation Steps

### 1.1 Install Playwright and Dependencies
```bash
npm install --save-dev @playwright/test
npm install --save-dev @types/node
npx playwright install  # Install browsers
```

### 1.2 Create Playwright Configuration
Create `playwright.config.ts` with:
- Multiple browser testing (Chromium, Firefox, WebKit)
- Screenshot and video on failure
- Parallel test execution
- Custom timeout settings for 3D content
- Test report generation

### 1.3 Create Base Test Utilities

#### GamePage Object Model
```typescript
// tests/e2e/pages/GamePage.ts
export class GamePage {
  constructor(private page: Page) {}
  
  async waitForThreeJSLoad(): Promise<void>
  async captureGameState(): Promise<GameState>
  async clickBoardPosition(x: number, y: number, z: number): Promise<void>
  async getConsoleErrors(): Promise<string[]>
}
```

#### Three.js Test Helpers
```typescript
// tests/e2e/utils/threejs-helpers.ts
export async function waitForSceneReady(page: Page): Promise<void>
export async function getCanvasElement(page: Page): Promise<ElementHandle>
export async function convert3DToScreenCoords(position: Vector3): Promise<Point2D>
export async function captureCanvas(page: Page): Promise<Buffer>
```

#### Visual Regression Utilities
```typescript
// tests/e2e/utils/visual-regression.ts
export async function compareScreenshots(actual: Buffer, expected: Buffer): Promise<boolean>
export async function saveBaselineScreenshot(name: string, screenshot: Buffer): Promise<void>
export async function maskDynamicContent(screenshot: Buffer): Promise<Buffer>
```

### 1.4 Create Test Structure
```
tests/
  e2e/
    fixtures/
      baseline-screenshots/   # Visual regression baselines
      test-data/             # Test game states, configurations
    pages/
      GamePage.ts           # Page object for game
      MenuPage.ts           # Page object for menus
    utils/
      threejs-helpers.ts    # Three.js specific utilities
      visual-regression.ts  # Screenshot comparison
      network-helpers.ts    # PeerJS mocking/interception
    smoke/
      app-loads.spec.ts     # Basic loading tests
    config/
      test.config.ts        # Shared test configuration
```

### 1.5 Implement First Smoke Test
```typescript
// tests/e2e/smoke/app-loads.spec.ts
import { test, expect } from '@playwright/test';
import { GamePage } from '../pages/GamePage';

test.describe('Pente3D Smoke Tests', () => {
  test('should load without console errors', async ({ page }) => {
    const gamePage = new GamePage(page);
    
    // Monitor console
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    
    // Load the game
    await page.goto('http://localhost:3000');
    
    // Wait for Three.js to initialize
    await gamePage.waitForThreeJSLoad();
    
    // Check no console errors
    expect(consoleErrors).toHaveLength(0);
  });
  
  test('should render 3D board', async ({ page }) => {
    const gamePage = new GamePage(page);
    await page.goto('http://localhost:3000');
    await gamePage.waitForThreeJSLoad();
    
    // Capture screenshot for visual check
    const screenshot = await page.screenshot();
    
    // Basic check - canvas should be visible and have content
    const canvas = await page.locator('canvas');
    await expect(canvas).toBeVisible();
    
    // Visual regression test (if baseline exists)
    // await expectScreenshotToMatchBaseline(screenshot, 'board-initial-state');
  });
});
```

### 1.6 Add npm Scripts
Update `package.json`:
```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:debug": "playwright test --debug",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:report": "playwright show-report"
  }
}
```

### 1.7 Create GitHub Actions Workflow
```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run build
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

## Testing Approach

### WebGL/Three.js Specific Considerations
1. **Rendering Delays**: Three.js scenes may take time to fully render
2. **Animation Frames**: Need to account for requestAnimationFrame cycles
3. **GPU Variations**: Visual tests may vary slightly across GPUs
4. **Canvas Interaction**: Mouse events need coordinate transformation

### Best Practices
1. Use Page Object Model for maintainability
2. Implement visual regression with tolerance for GPU differences
3. Mock network calls for deterministic tests
4. Use test fixtures for game state setup
5. Parallelize tests but isolate those requiring specific states

## Success Criteria
- [ ] Playwright installed and configured
- [ ] Base test utilities created
- [ ] First smoke test passing
- [ ] Visual regression comparison working
- [ ] CI/CD pipeline integrated
- [ ] Test reports generated

## Next Phase
Once infrastructure is complete, proceed to Phase 2: Smoke & UI Tests
import { test, expect } from '@playwright/test';
import { GamePage } from '../pages/GamePage';

test.describe('Board Controls', () => {
  let gamePage: GamePage;

  test.beforeEach(async ({ page }) => {
    gamePage = new GamePage(page);
    await gamePage.goto();
    await gamePage.waitForThreeJSLoad();
  });

  test('should rotate board with left-click drag', async ({ page }) => {
    // Get initial camera position
    const initialCameraPos = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas || !(window as any).game) return null;
      
      // Access camera through renderer
      const renderer = (window as any).renderer;
      if (!renderer) return null;
      
      const camera = renderer.getCamera();
      return {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z
      };
    });

    expect(initialCameraPos).toBeTruthy();
    console.log('Initial camera position:', initialCameraPos);

    // Perform left-click drag to rotate
    const canvas = page.locator('canvas');
    await canvas.hover({ position: { x: 200, y: 200 } });
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(400, 200, { steps: 10 });
    await page.mouse.up();

    // Wait for animation
    await page.waitForTimeout(100);

    // Check camera position changed
    const newCameraPos = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      if (!renderer) return null;
      
      const camera = renderer.getCamera();
      return {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z
      };
    });

    console.log('New camera position:', newCameraPos);
    
    // Camera should have rotated (position changed)
    expect(newCameraPos).toBeTruthy();
    expect(
      Math.abs(newCameraPos!.x - initialCameraPos!.x) > 0.1 ||
      Math.abs(newCameraPos!.y - initialCameraPos!.y) > 0.1 ||
      Math.abs(newCameraPos!.z - initialCameraPos!.z) > 0.1
    ).toBe(true);
  });

  test('should pan board with right-click drag', async ({ page }) => {
    // Get initial controls target
    const initialTarget = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      if (!renderer) return null;
      
      const controls = renderer.getControls();
      return {
        x: controls.target.x,
        y: controls.target.y,
        z: controls.target.z
      };
    });

    expect(initialTarget).toBeTruthy();
    console.log('Initial target:', initialTarget);

    // Perform right-click drag to pan
    const canvas = page.locator('canvas');
    await canvas.hover({ position: { x: 300, y: 300 } });
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(400, 400, { steps: 10 });
    await page.mouse.up();

    // Wait for animation
    await page.waitForTimeout(100);

    // Check controls target changed (pan moves the target)
    const newTarget = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      if (!renderer) return null;
      
      const controls = renderer.getControls();
      return {
        x: controls.target.x,
        y: controls.target.y,
        z: controls.target.z
      };
    });

    console.log('New target:', newTarget);
    
    expect(newTarget).toBeTruthy();
    expect(
      Math.abs(newTarget!.x - initialTarget!.x) > 0.1 ||
      Math.abs(newTarget!.y - initialTarget!.y) > 0.1 ||
      Math.abs(newTarget!.z - initialTarget!.z) > 0.1
    ).toBe(true);
  });

  test('should zoom with mouse wheel', async ({ page }) => {
    // Get initial camera distance
    const initialDistance = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      if (!renderer) return null;
      
      const camera = renderer.getCamera();
      // Calculate distance from origin
      return Math.sqrt(
        camera.position.x ** 2 + 
        camera.position.y ** 2 + 
        camera.position.z ** 2
      );
    });

    expect(initialDistance).toBeTruthy();
    console.log('Initial distance:', initialDistance);

    // Zoom in with wheel
    const canvas = page.locator('canvas');
    await canvas.hover();
    await page.mouse.wheel(0, -100); // Negative = zoom in

    // Wait for animation
    await page.waitForTimeout(100);

    // Check camera moved closer
    const newDistance = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      if (!renderer) return null;
      
      const camera = renderer.getCamera();
      return Math.sqrt(
        camera.position.x ** 2 + 
        camera.position.y ** 2 + 
        camera.position.z ** 2
      );
    });

    console.log('New distance after zoom in:', newDistance);
    
    expect(newDistance).toBeTruthy();
    expect(newDistance!).toBeLessThan(initialDistance!);

    // Zoom out
    await page.mouse.wheel(0, 200); // Positive = zoom out
    await page.waitForTimeout(100);

    const finalDistance = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      if (!renderer) return null;
      
      const camera = renderer.getCamera();
      return Math.sqrt(
        camera.position.x ** 2 + 
        camera.position.y ** 2 + 
        camera.position.z ** 2
      );
    });

    console.log('Final distance after zoom out:', finalDistance);
    expect(finalDistance!).toBeGreaterThan(newDistance!);
  });

  test('should not show focus outline on click', async ({ page }) => {
    const canvas = page.locator('canvas');
    
    // Click on canvas
    await canvas.click();
    
    // Check for focus outline
    const outline = await canvas.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        outline: styles.outline,
        outlineWidth: styles.outlineWidth,
        outlineColor: styles.outlineColor,
        outlineStyle: styles.outlineStyle
      };
    });

    console.log('Canvas outline styles:', outline);
    
    // Should have no outline (or 'none')
    expect(outline.outline === 'none' || outline.outlineWidth === '0px').toBe(true);
  });

  test('canvas should fill viewport', async ({ page }) => {
    const viewport = page.viewportSize();
    expect(viewport).toBeTruthy();

    const canvasSize = await page.locator('canvas').evaluate((el) => ({
      width: el.offsetWidth,
      height: el.offsetHeight,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight
    }));

    console.log('Viewport:', viewport);
    console.log('Canvas size:', canvasSize);

    // Canvas should match viewport size
    expect(canvasSize.width).toBe(viewport!.width);
    expect(canvasSize.height).toBe(viewport!.height);
  });
});
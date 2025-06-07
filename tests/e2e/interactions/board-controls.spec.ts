import { test, expect } from '@playwright/test';
import { setupTest } from '../../helpers/e2e';

test.describe('Board Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should rotate board with left-click drag', async ({ page }) => {
    await setupTest(page);
    
    // Get initial camera position
    const initialCameraPos = await page.evaluate(() => {
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
    
    // Camera should have rotated (position changed)
    expect(newCameraPos).toBeTruthy();
    expect(
      Math.abs(newCameraPos!.x - initialCameraPos!.x) > 0.1 ||
      Math.abs(newCameraPos!.y - initialCameraPos!.y) > 0.1 ||
      Math.abs(newCameraPos!.z - initialCameraPos!.z) > 0.1
    ).toBe(true);
  });

  test('should pan board with right-click drag', async ({ page }) => {
    await setupTest(page);
    
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
    
    expect(newTarget).toBeTruthy();
    expect(
      Math.abs(newTarget!.x - initialTarget!.x) > 0.1 ||
      Math.abs(newTarget!.y - initialTarget!.y) > 0.1 ||
      Math.abs(newTarget!.z - initialTarget!.z) > 0.1
    ).toBe(true);
  });

  test('should zoom with mouse wheel', async ({ page }) => {
    await setupTest(page);
    
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

    expect(finalDistance!).toBeGreaterThan(newDistance!);
  });

  test('should not show focus outline on click', async ({ page }) => {
    await setupTest(page);
    
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
    
    // Should have no outline (or 'none')
    expect(outline.outline === 'none' || outline.outlineWidth === '0px').toBe(true);
  });

  test('canvas should fill viewport', async ({ page }) => {
    await setupTest(page);
    
    const viewport = page.viewportSize();
    expect(viewport).toBeTruthy();

    const canvasSize = await page.locator('canvas').evaluate((el) => ({
      width: el.offsetWidth,
      height: el.offsetHeight,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight
    }));

    // Canvas should match viewport size
    expect(canvasSize.width).toBe(viewport!.width);
    expect(canvasSize.height).toBe(viewport!.height);
  });

  test('should maintain smooth rotation during drag', async ({ page }) => {
    await setupTest(page);
    
    const canvas = page.locator('canvas');
    const positions: any[] = [];
    
    // Track camera positions during rotation
    await page.exposeFunction('trackCameraPosition', () => {
      const renderer = (window as any).renderer;
      if (!renderer) return;
      
      const camera = renderer.getCamera();
      positions.push({
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        time: Date.now()
      });
    });
    
    // Start tracking
    await page.evaluate(() => {
      let animationId: number;
      const track = () => {
        (window as any).trackCameraPosition();
        animationId = requestAnimationFrame(track);
      };
      track();
      
      // Stop after 1 second
      setTimeout(() => cancelAnimationFrame(animationId), 1000);
    });
    
    // Perform smooth rotation
    await canvas.hover({ position: { x: 640, y: 360 } });
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(740, 360, { steps: 20 });
    await page.mouse.up();
    
    await page.waitForTimeout(1100);
    
    // Verify smooth movement (no large jumps between frames)
    expect(positions.length).toBeGreaterThan(10);
    
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const curr = positions[i];
      const distance = Math.sqrt(
        (curr.x - prev.x) ** 2 +
        (curr.y - prev.y) ** 2 +
        (curr.z - prev.z) ** 2
      );
      
      // Movement between frames should be smooth (no large jumps)
      expect(distance).toBeLessThan(1.0);
    }
  });
});
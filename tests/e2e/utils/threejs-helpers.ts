import { Page, ElementHandle } from '@playwright/test';

export interface Point2D {
  x: number;
  y: number;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Wait for Three.js scene to be ready
 */
export async function waitForSceneReady(page: Page, timeout = 10000): Promise<void> {
  // Wait for Three.js to be loaded
  await page.waitForFunction(
    () => window.THREE !== undefined,
    { timeout }
  );

  // Wait for renderer to exist
  await page.waitForFunction(
    () => {
      // Check if there's a canvas element
      const canvas = document.querySelector('canvas');
      if (!canvas) return false;
      
      // Check if canvas has proper dimensions
      return canvas.width > 0 && canvas.height > 0;
    },
    { timeout }
  );

  // Give time for first render frame
  await page.waitForTimeout(100);
}

/**
 * Get the canvas element used for Three.js rendering
 */
export async function getCanvasElement(page: Page): Promise<ElementHandle> {
  const canvas = await page.waitForSelector('canvas', { timeout: 5000 });
  if (!canvas) {
    throw new Error('Canvas element not found');
  }
  return canvas;
}

/**
 * Convert 3D world coordinates to 2D screen coordinates
 * This is a placeholder - actual implementation would need access to camera/scene
 */
export async function convert3DToScreenCoords(
  page: Page,
  position: Vector3
): Promise<Point2D> {
  return await page.evaluate((pos) => {
    // This would need to access the Three.js camera and scene
    // For now, return a placeholder
    const canvas = document.querySelector('canvas');
    if (!canvas) return { x: 0, y: 0 };
    
    // Placeholder: return center of canvas
    return {
      x: canvas.width / 2,
      y: canvas.height / 2
    };
  }, position);
}

/**
 * Capture the canvas as a buffer
 */
export async function captureCanvas(page: Page): Promise<Buffer> {
  const canvas = await getCanvasElement(page);
  return await canvas.screenshot();
}

/**
 * Check if WebGL is supported and working
 */
export async function checkWebGLSupport(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      return !!gl;
    } catch (e) {
      return false;
    }
  });
}

/**
 * Get Three.js renderer info
 */
export async function getRendererInfo(page: Page): Promise<any> {
  return await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    
    try {
      const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
      if (!gl) return null;
      
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        vendor: gl.getParameter(debugInfo ? debugInfo.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
        renderer: gl.getParameter(debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
        webglVersion: gl.getParameter(gl.VERSION)
      };
    } catch (e) {
      return null;
    }
  });
}

/**
 * Wait for animations to complete
 */
export async function waitForAnimations(page: Page, duration = 1000): Promise<void> {
  await page.waitForTimeout(duration);
}

/**
 * Simulate mouse interaction on 3D canvas
 */
export async function interact3D(
  page: Page,
  action: 'click' | 'drag' | 'rotate',
  startPos: Point2D,
  endPos?: Point2D
): Promise<void> {
  const canvas = await getCanvasElement(page);
  
  switch (action) {
    case 'click':
      await canvas.click({ position: startPos });
      break;
      
    case 'drag':
      if (!endPos) throw new Error('End position required for drag');
      await canvas.hover({ position: startPos });
      await page.mouse.down();
      await canvas.hover({ position: endPos });
      await page.mouse.up();
      break;
      
    case 'rotate':
      if (!endPos) throw new Error('End position required for rotate');
      await canvas.hover({ position: startPos });
      await page.mouse.down({ button: 'right' });
      await canvas.hover({ position: endPos });
      await page.mouse.up({ button: 'right' });
      break;
  }
}
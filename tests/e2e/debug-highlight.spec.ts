import { test, expect } from '@playwright/test';
import { createGameHelpers } from './utils/game-interactions';

test.describe('Debug Highlight', () => {
  test('debug isNodeHighlighted', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    
    const game = createGameHelpers(page);
    
    console.log('=== Testing isNodeHighlighted ===');
    
    try {
      const result = await game.isNodeHighlighted(1, 0, 0);
      console.log('isNodeHighlighted result:', result, 'type:', typeof result);
    } catch (error) {
      console.error('isNodeHighlighted error:', error);
    }
    
    // Check raw evaluation
    const rawResult = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const scene = renderer.getScene();
      
      // Find the node at (1,0,0)
      let targetNode: any = null;
      scene.traverse((child: any) => {
        if (child.userData?.type === 'intersection' && 
            child.userData?.position?.x === 1 &&
            child.userData?.position?.y === 0 &&
            child.userData?.position?.z === 0) {
          targetNode = child;
        }
      });
      
      if (!targetNode) return { found: false };
      
      // Check if node has highlight material or scale
      const isHighlighted = 
        targetNode.scale.x > 1.01 || // Scaled up
        (targetNode.material && targetNode.material.emissive && 
         targetNode.material.emissive.r > 0); // Has emissive color
         
      return {
        found: true,
        isHighlighted,
        scale: { x: targetNode.scale.x, y: targetNode.scale.y, z: targetNode.scale.z },
        hasEmissive: targetNode.material && targetNode.material.emissive ? true : false
      };
    });
    
    console.log('Raw result:', rawResult);
  });
});
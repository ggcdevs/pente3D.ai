import { test, expect } from '@playwright/test';

test.describe('Debug Node Finding', () => {
  test('check if nodes are found correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    
    console.log('=== Checking Node Finding ===');
    
    const nodeInfo = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const scene = renderer.getScene();
      
      // Positions to check
      const checkPositions = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: -1, y: 0, z: 0 },
        { x: 3, y: 3, z: 3 }
      ];
      
      const results = checkPositions.map(pos => {
        let foundNode = null;
        scene.traverse((child: any) => {
          if (child.userData?.type === 'intersection' && 
              child.userData?.position?.x === pos.x &&
              child.userData?.position?.y === pos.y &&
              child.userData?.position?.z === pos.z) {
            foundNode = {
              worldPosition: {
                x: child.position.x,
                y: child.position.y,
                z: child.position.z
              },
              userData: child.userData
            };
          }
        });
        
        return {
          position: pos,
          found: !!foundNode,
          nodeInfo: foundNode
        };
      });
      
      // Also get all intersection nodes
      const allNodes: any[] = [];
      scene.traverse((child: any) => {
        if (child.userData?.type === 'intersection') {
          allNodes.push({
            userData: child.userData.position,
            worldPos: {
              x: child.position.x,
              y: child.position.y,
              z: child.position.z
            }
          });
        }
      });
      
      return {
        checkedPositions: results,
        totalIntersectionNodes: allNodes.length,
        sampleNodes: allNodes.slice(0, 10)
      };
    });
    
    console.log('Node info:', JSON.stringify(nodeInfo, null, 2));
    
    // Test clicking on found vs not found nodes
    console.log('\n=== Testing Click Projection ===');
    
    const clickTest = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const camera = renderer.getCamera();
      const canvas = document.querySelector('canvas')!;
      
      // Test projection for (0,0,0)
      const testPos = { x: 0, y: 0, z: 0 };
      
      // Find the node
      let targetNode: any = null;
      renderer.getScene().traverse((child: any) => {
        if (child.userData?.type === 'intersection' && 
            child.userData?.position?.x === testPos.x &&
            child.userData?.position?.y === testPos.y &&
            child.userData?.position?.z === testPos.z) {
          targetNode = child;
        }
      });
      
      // Project using manual calculation
      const viewMatrix = camera.matrixWorldInverse.elements;
      const projMatrix = camera.projectionMatrix.elements;
      
      const vx = testPos.x * viewMatrix[0] + testPos.y * viewMatrix[4] + testPos.z * viewMatrix[8] + viewMatrix[12];
      const vy = testPos.x * viewMatrix[1] + testPos.y * viewMatrix[5] + testPos.z * viewMatrix[9] + viewMatrix[13];
      const vz = testPos.x * viewMatrix[2] + testPos.y * viewMatrix[6] + testPos.z * viewMatrix[10] + viewMatrix[14];
      const vw = testPos.x * viewMatrix[3] + testPos.y * viewMatrix[7] + testPos.z * viewMatrix[11] + viewMatrix[15];
      
      const cx = vx * projMatrix[0] + vy * projMatrix[4] + vz * projMatrix[8] + vw * projMatrix[12];
      const cy = vx * projMatrix[1] + vy * projMatrix[5] + vz * projMatrix[9] + vw * projMatrix[13];
      const cw = vx * projMatrix[3] + vy * projMatrix[7] + vz * projMatrix[11] + vw * projMatrix[15];
      
      const ndcX = cx / cw;
      const ndcY = cy / cw;
      
      const screenX = (ndcX + 1) * canvas.width / 2;
      const screenY = (1 - ndcY) * canvas.height / 2;
      
      return {
        nodeFound: !!targetNode,
        nodeWorldPos: targetNode ? {
          x: targetNode.position.x,
          y: targetNode.position.y,
          z: targetNode.position.z
        } : null,
        projectedScreen: { x: screenX, y: screenY },
        canvasSize: { width: canvas.width, height: canvas.height },
        canvasCenter: { x: canvas.width / 2, y: canvas.height / 2 }
      };
    });
    
    console.log('Click test:', JSON.stringify(clickTest, null, 2));
  });
});
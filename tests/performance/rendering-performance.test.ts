import { Renderer } from '@/rendering/Renderer';
import { Board } from '@/core/Board';
import { Vector3 } from '@/core/Vector3';
import { PerformanceMonitor } from '@/utils/PerformanceMonitor';
import { QualityManager } from '@/rendering/QualityManager';

describe('Rendering Performance', () => {
  let renderer: Renderer;
  let board: Board;
  let performanceMonitor: PerformanceMonitor;
  let qualityManager: QualityManager;
  
  beforeEach(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    document.body.appendChild(canvas);
    
    renderer = new Renderer(canvas);
    performanceMonitor = new PerformanceMonitor();
    qualityManager = new QualityManager(performanceMonitor);
    
    renderer.setPerformanceMonitor(performanceMonitor);
    renderer.setQualityManager(qualityManager);
    
    board = Board.create(11); // Large board
    renderer.initializeBoard(board);
  });
  
  afterEach(() => {
    renderer.dispose();
    document.body.innerHTML = '';
  });
  
  test('should maintain 60fps with empty board', async () => {
    performanceMonitor.startMonitoring();
    
    const frames = 120; // 2 seconds at 60fps
    
    for (let i = 0; i < frames; i++) {
      performanceMonitor.beginFrame();
      renderer.render();
      await new Promise(resolve => setTimeout(resolve, 16.67));
      performanceMonitor.endFrame();
    }
    
    const metrics = performanceMonitor.getMetrics();
    expect(metrics.averageFps).toBeGreaterThan(55);
  });
  
  test('should handle many pieces efficiently', async () => {
    // Place 200 pieces
    for (let i = 0; i < 200; i++) {
      const x = i % 11;
      const y = Math.floor(i / 11) % 11;
      const z = Math.floor(i / 121);
      
      board = board.placePiece(
        new Vector3(x, y, z),
        i % 2 === 0 ? 'black' : 'white'
      );
    }
    
    renderer.updateBoard(board);
    performanceMonitor.startMonitoring();
    
    // Render 60 frames
    for (let i = 0; i < 60; i++) {
      performanceMonitor.beginFrame();
      renderer.render();
      await new Promise(resolve => setTimeout(resolve, 16.67));
      performanceMonitor.endFrame();
    }
    
    const metrics = performanceMonitor.getMetrics();
    expect(metrics.averageFps).toBeGreaterThan(30);
    expect(metrics.drawCalls).toBeLessThan(500);
  });
  
  test('should optimize with frustum culling', () => {
    // Place pieces across entire board
    for (let x = 0; x < 11; x++) {
      for (let y = 0; y < 11; y++) {
        board = board.placePiece(new Vector3(x, y, 0), 'black');
      }
    }
    
    renderer.updateBoard(board);
    
    // Move camera to look at corner
    const camera = (renderer as any).camera;
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.fov = 30; // Narrow field of view
    camera.updateProjectionMatrix();
    
    performanceMonitor.startMonitoring();
    performanceMonitor.beginFrame();
    renderer.render();
    performanceMonitor.endFrame();
    
    const stats = (renderer as any).renderStats;
    expect(stats.culledObjects).toBeGreaterThan(50);
    expect(stats.visibleObjects).toBeLessThan(stats.culledObjects);
  });
  
  test('should scale quality based on performance', async () => {
    qualityManager.setAutoAdjust(true);
    qualityManager.setQualityPreset('ultra');
    
    // Fill board to stress renderer
    for (let i = 0; i < 500; i++) {
      const pos = new Vector3(
        i % 11,
        Math.floor(i / 11) % 11,
        Math.floor(i / 121)
      );
      if (board.isValidPosition(pos)) {
        board = board.placePiece(pos, 'black');
      }
    }
    
    renderer.updateBoard(board);
    
    const qualityChanges: string[] = [];
    qualityManager.on('quality-changed', ({ preset }) => {
      qualityChanges.push(preset);
    });
    
    performanceMonitor.startMonitoring();
    
    // Simulate low performance
    for (let i = 0; i < 100; i++) {
      performanceMonitor.beginFrame();
      renderer.render();
      await new Promise(resolve => setTimeout(resolve, 50)); // 20fps
      performanceMonitor.endFrame();
      
      if (i % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 1100));
      }
    }
    
    expect(qualityChanges.length).toBeGreaterThan(0);
    expect(qualityManager.getCurrentPreset()).not.toBe('ultra');
  });
});
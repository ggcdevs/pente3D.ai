import { Game } from '@/core/Game';
import { Renderer } from '@/rendering/Renderer';
import { PerformanceMonitor } from '@/utils/PerformanceMonitor';
import { QualityManager } from '@/rendering/QualityManager';
import { Vector3 } from '@/core/Vector3';

describe('Performance System Integration', () => {
  let game: Game;
  let renderer: Renderer;
  let performanceMonitor: PerformanceMonitor;
  let qualityManager: QualityManager;
  let canvas: HTMLCanvasElement;
  
  beforeEach(() => {
    canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    
    game = new Game({ boardSize: 9 });
    renderer = new Renderer(canvas);
    performanceMonitor = new PerformanceMonitor();
    qualityManager = new QualityManager(performanceMonitor);
    
    renderer.setPerformanceMonitor(performanceMonitor);
    renderer.setQualityManager(qualityManager);
    renderer.initializeBoard(game.getState().board);
  });
  
  afterEach(() => {
    renderer.dispose();
    document.body.innerHTML = '';
  });
  
  test('should maintain 60fps with normal gameplay', async () => {
    performanceMonitor.startMonitoring();
    
    // Simulate normal game
    const moves = [
      new Vector3(4, 4, 4),
      new Vector3(4, 4, 3),
      new Vector3(3, 4, 4),
      new Vector3(5, 4, 4),
      new Vector3(4, 3, 4),
      new Vector3(4, 5, 4)
    ];
    
    for (const move of moves) {
      game = game.placePiece(move);
      renderer.updateBoard(game.getState().board);
      
      // Simulate frame
      performanceMonitor.beginFrame();
      renderer.render();
      await new Promise(resolve => setTimeout(resolve, 16));
      performanceMonitor.endFrame();
    }
    
    const metrics = performanceMonitor.getMetrics();
    expect(metrics.averageFps).toBeGreaterThan(55);
  });
  
  test('should auto-adjust quality under load', async () => {
    performanceMonitor.startMonitoring();
    qualityManager.setAutoAdjust(true);
    
    const qualityChangeSpy = jest.fn();
    qualityManager.on('quality-changed', qualityChangeSpy);
    
    // Simulate heavy load
    for (let i = 0; i < 100; i++) {
      const pos = new Vector3(i % 9, Math.floor(i / 9) % 9, Math.floor(i / 81));
      if (game.getState().board.isValidPosition(pos)) {
        game = game.placePiece(pos);
      }
    }
    
    renderer.updateBoard(game.getState().board);
    
    // Simulate low FPS
    for (let i = 0; i < 65; i++) {
      performanceMonitor.beginFrame();
      renderer.render();
      await new Promise(resolve => setTimeout(resolve, 50)); // 20fps
      performanceMonitor.endFrame();
    }
    
    // Wait for quality adjustment
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    expect(qualityChangeSpy).toHaveBeenCalled();
    expect(qualityManager.getCurrentPreset()).not.toBe('high');
  });
  
  test('should handle memory pressure', () => {
    const warningSpy = jest.fn();
    performanceMonitor.on('performance-warning', warningSpy);
    
    // Mock high memory usage
    (global.performance as any).memory = {
      usedJSHeapSize: 600 * 1024 * 1024,
      jsHeapSizeLimit: 1024 * 1024 * 1024
    };
    
    performanceMonitor.startMonitoring();
    performanceMonitor.beginFrame();
    renderer.render();
    performanceMonitor.endFrame();
    
    expect(warningSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'high-memory'
      })
    );
  });
  
  test('should optimize draw calls with many pieces', () => {
    // Fill board with pieces
    for (let x = 0; x < 9; x++) {
      for (let y = 0; y < 9; y++) {
        for (let z = 0; z < 9; z++) {
          const pos = new Vector3(x, y, z);
          if (game.getState().board.isValidPosition(pos)) {
            game = game.placePiece(pos);
          }
        }
      }
    }
    
    renderer.updateBoard(game.getState().board);
    
    performanceMonitor.startMonitoring();
    performanceMonitor.beginFrame();
    renderer.render();
    performanceMonitor.endFrame();
    
    const metrics = performanceMonitor.getMetrics();
    expect(metrics.drawCalls).toBeLessThan(1000);
  });
});
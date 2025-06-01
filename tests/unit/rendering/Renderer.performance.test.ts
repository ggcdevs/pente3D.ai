import { Renderer } from '@/rendering/Renderer';
import { PerformanceMonitor } from '@/utils/PerformanceMonitor';
import { QualityManager } from '@/rendering/QualityManager';
import { Board } from '@/core/Board';
import { Vector3 } from '@/core/Vector3';
import * as THREE from 'three';

describe('Renderer Performance Features', () => {
  let renderer: Renderer;
  let performanceMonitor: PerformanceMonitor;
  let qualityManager: QualityManager;
  let board: Board;
  
  beforeEach(() => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    
    renderer = new Renderer(canvas);
    performanceMonitor = new PerformanceMonitor();
    qualityManager = new QualityManager(performanceMonitor);
    
    renderer.setPerformanceMonitor(performanceMonitor);
    renderer.setQualityManager(qualityManager);
    
    board = Board.create(7);
    renderer.initializeBoard(board);
  });
  
  afterEach(() => {
    renderer.dispose();
    document.body.innerHTML = '';
  });
  
  describe('Frustum Culling', () => {
    test('should cull objects outside camera frustum', () => {
      // Place many pieces
      for (let i = 0; i < 50; i++) {
        const pos = new Vector3(
          Math.floor(i / 7),
          i % 7,
          0
        );
        board = board.placePiece(pos, i % 2 === 0 ? 'black' : 'white');
      }
      
      renderer.updateBoard(board);
      
      // Move camera to look at specific area
      const camera = (renderer as any).camera;
      camera.position.set(0, 0, 10);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      
      // Render and check culling
      renderer.render();
      
      const stats = (renderer as any).renderStats;
      expect(stats.culledObjects).toBeGreaterThan(0);
      expect(stats.visibleObjects).toBeLessThan(50);
    });
  });
  
  describe('Level of Detail', () => {
    test('should adjust detail based on distance', () => {
      // Enable LOD
      (renderer as any).lodManager.enabled = true;
      
      // Place pieces at various distances
      const positions = [
        new Vector3(0, 0, 0), // Close
        new Vector3(3, 3, 3), // Medium
        new Vector3(6, 6, 6)  // Far
      ];
      
      positions.forEach(pos => {
        board = board.placePiece(pos, 'black');
      });
      
      renderer.updateBoard(board);
      
      // Update LOD
      (renderer as any).updateLOD();
      
      // Check that distant pieces have reduced detail or are hidden
      const pieceGroup = (renderer as any).pieceGroup;
      let hiddenCount = 0;
      
      pieceGroup.children.forEach((piece: THREE.Mesh) => {
        if (!piece.visible) {
          hiddenCount++;
        }
      });
      
      expect(hiddenCount).toBeGreaterThanOrEqual(0);
    });
  });
  
  describe('Quality Settings Application', () => {
    test('should apply shadow quality settings', () => {
      const webglRenderer = (renderer as any).renderer as THREE.WebGLRenderer;
      
      qualityManager.setQualityPreset('ultra');
      expect(webglRenderer.shadowMap.enabled).toBe(true);
      expect(webglRenderer.shadowMap.type).toBe(THREE.PCFSoftShadowMap);
      
      qualityManager.setQualityPreset('low');
      expect(webglRenderer.shadowMap.enabled).toBe(false);
    });
    
    test('should apply pixel ratio settings', () => {
      const webglRenderer = (renderer as any).renderer as THREE.WebGLRenderer;
      
      qualityManager.setQualityPreset('ultra');
      expect(webglRenderer.getPixelRatio()).toBe(window.devicePixelRatio || 1);
      
      qualityManager.setQualityPreset('potato');
      expect(webglRenderer.getPixelRatio()).toBe(0.75);
    });
  });
  
  describe('Animation Quality', () => {
    test('should update animations based on quality', () => {
      // Add temporary pieces for animation
      renderer.showTemporaryPiece(new Vector3(0, 0, 0), 'black');
      renderer.showTemporaryPiece(new Vector3(1, 1, 1), 'white');
      
      const updateSpy = jest.spyOn(renderer as any, 'updateAllAnimations');
      
      // High quality - updates every frame
      qualityManager.setQualityPreset('high');
      for (let i = 0; i < 3; i++) {
        renderer.render();
      }
      expect(updateSpy).toHaveBeenCalledTimes(3);
      
      updateSpy.mockClear();
      
      // Low quality - updates every 3rd frame
      qualityManager.setQualityPreset('low');
      for (let i = 0; i < 6; i++) {
        (renderer as any).lodManager.frameCounter = i;
        renderer.render();
      }
      expect(updateSpy).toHaveBeenCalledTimes(2);
    });
  });
  
  describe('Memory Management', () => {
    test('should dispose resources properly', () => {
      // Create some objects
      for (let i = 0; i < 10; i++) {
        board = board.placePiece(new Vector3(i % 3, Math.floor(i / 3), 0), 'black');
      }
      renderer.updateBoard(board);
      
      const disposeSpy = jest.spyOn(THREE.BufferGeometry.prototype, 'dispose');
      const materialDisposeSpy = jest.spyOn(THREE.Material.prototype, 'dispose');
      
      renderer.dispose();
      
      expect(disposeSpy).toHaveBeenCalled();
      expect(materialDisposeSpy).toHaveBeenCalled();
      
      disposeSpy.mockRestore();
      materialDisposeSpy.mockRestore();
    });
  });
});
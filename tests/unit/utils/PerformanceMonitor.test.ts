import { PerformanceMonitor, PerformanceMetrics, PerformanceThresholds } from '@/utils/PerformanceMonitor';
import * as THREE from 'three';

describe('PerformanceMonitor', () => {
  let monitor: PerformanceMonitor;
  let mockRenderer: THREE.WebGLRenderer;
  
  beforeEach(() => {
    jest.useFakeTimers();
    // Mock performance.memory
    (global.performance as any).memory = {
      usedJSHeapSize: 100 * 1024 * 1024,
      jsHeapSizeLimit: 1024 * 1024 * 1024
    };
    
    // Mock THREE.WebGLRenderer
    mockRenderer = {
      info: {
        render: {
          calls: 50,
          triangles: 10000
        },
        memory: {
          textures: 10,
          geometries: 20
        },
        programs: [1, 2, 3, 4, 5]
      }
    } as any;
    
    monitor = new PerformanceMonitor();
  });
  
  afterEach(() => {
    monitor.stopMonitoring();
    jest.useRealTimers();
  });
  
  describe('Constructor', () => {
    test('should initialize with default thresholds', () => {
      expect(monitor).toBeDefined();
      const metrics = monitor.getMetrics();
      expect(metrics.fps).toBe(0);
      expect(metrics.averageFps).toBe(0);
    });
    
    test('should accept custom thresholds', () => {
      const customMonitor = new PerformanceMonitor({
        targetFps: 120,
        minAcceptableFps: 60,
        maxMemoryUsage: 1024 * 1024 * 1024
      });
      expect(customMonitor).toBeDefined();
    });
  });
  
  describe('Monitoring Control', () => {
    test('should start monitoring', () => {
      const startSpy = jest.fn();
      monitor.on('monitoring-started', startSpy);
      
      monitor.startMonitoring();
      expect(startSpy).toHaveBeenCalled();
    });
    
    test('should stop monitoring', () => {
      const stopSpy = jest.fn();
      monitor.on('monitoring-stopped', stopSpy);
      
      monitor.startMonitoring();
      monitor.stopMonitoring();
      expect(stopSpy).toHaveBeenCalled();
    });
    
    test('should not start monitoring if already started', () => {
      const startSpy = jest.fn();
      monitor.on('monitoring-started', startSpy);
      
      monitor.startMonitoring();
      monitor.startMonitoring();
      expect(startSpy).toHaveBeenCalledTimes(1);
    });
  });
  
  describe('Frame Tracking', () => {
    test('should track frame metrics', () => {
      monitor.startMonitoring();
      monitor.setRenderer(mockRenderer);
      
      // Simulate frame
      monitor.beginFrame();
      jest.advanceTimersByTime(16.67); // ~60fps
      monitor.endFrame();
      
      const metrics = monitor.getMetrics();
      expect(metrics.fps).toBeCloseTo(60, 0);
      expect(metrics.frameTime).toBeCloseTo(16.67, 0);
    });
    
    test('should calculate average FPS over multiple frames', () => {
      monitor.startMonitoring();
      
      // Simulate 10 frames
      for (let i = 0; i < 10; i++) {
        monitor.beginFrame();
        jest.advanceTimersByTime(16.67);
        monitor.endFrame();
      }
      
      const metrics = monitor.getMetrics();
      expect(metrics.averageFps).toBeCloseTo(60, 0);
    });
    
    test('should track min and max FPS', () => {
      monitor.startMonitoring();
      
      // Simulate variable frame times
      const frameTimes = [16.67, 33.33, 8.33, 16.67]; // 60fps, 30fps, 120fps, 60fps
      
      frameTimes.forEach(time => {
        monitor.beginFrame();
        jest.advanceTimersByTime(time);
        monitor.endFrame();
      });
      
      const metrics = monitor.getMetrics();
      expect(metrics.minFps).toBeCloseTo(30, 0);
      expect(metrics.maxFps).toBeCloseTo(120, 0);
    });
  });
  
  describe('Memory Tracking', () => {
    test('should track memory usage', () => {
      monitor.startMonitoring();
      monitor.beginFrame();
      monitor.endFrame();
      
      const metrics = monitor.getMetrics();
      expect(metrics.memoryUsed).toBe(100 * 1024 * 1024);
      expect(metrics.memoryLimit).toBe(1024 * 1024 * 1024);
    });
    
    test('should handle missing performance.memory', () => {
      delete (global.performance as any).memory;
      
      monitor.startMonitoring();
      monitor.beginFrame();
      monitor.endFrame();
      
      const metrics = monitor.getMetrics();
      expect(metrics.memoryUsed).toBe(0);
      expect(metrics.memoryLimit).toBe(0);
    });
  });
  
  describe('Renderer Metrics', () => {
    test('should track renderer statistics', () => {
      monitor.setRenderer(mockRenderer);
      monitor.startMonitoring();
      monitor.beginFrame();
      monitor.endFrame();
      
      const metrics = monitor.getMetrics();
      expect(metrics.drawCalls).toBe(50);
      expect(metrics.triangles).toBe(10000);
      expect(metrics.textures).toBe(10);
      expect(metrics.geometries).toBe(20);
      expect(metrics.programs).toBe(5);
    });
    
    test('should handle missing renderer', () => {
      monitor.startMonitoring();
      monitor.beginFrame();
      monitor.endFrame();
      
      const metrics = monitor.getMetrics();
      expect(metrics.drawCalls).toBe(0);
      expect(metrics.triangles).toBe(0);
    });
  });
  
  describe('Performance Warnings', () => {
    test('should emit warning for low FPS', () => {
      const warningSpy = jest.fn();
      monitor.on('performance-warning', warningSpy);
      
      monitor.startMonitoring();
      
      // Simulate low FPS
      for (let i = 0; i < 65; i++) {
        monitor.beginFrame();
        jest.advanceTimersByTime(50); // 20fps
        monitor.endFrame();
      }
      
      expect(warningSpy).toHaveBeenCalledWith({
        type: 'low-fps',
        value: expect.any(Number),
        threshold: 30
      });
    });
    
    test('should emit warning for high memory usage', () => {
      const warningSpy = jest.fn();
      monitor.on('performance-warning', warningSpy);
      
      // Set high memory usage
      (global.performance as any).memory.usedJSHeapSize = 600 * 1024 * 1024;
      
      monitor.startMonitoring();
      monitor.beginFrame();
      monitor.endFrame();
      
      expect(warningSpy).toHaveBeenCalledWith({
        type: 'high-memory',
        value: 600 * 1024 * 1024,
        threshold: 500 * 1024 * 1024
      });
    });
    
    test('should emit warning for high draw calls', () => {
      const warningSpy = jest.fn();
      monitor.on('performance-warning', warningSpy);
      
      mockRenderer.info.render.calls = 1500;
      monitor.setRenderer(mockRenderer);
      monitor.startMonitoring();
      monitor.beginFrame();
      monitor.endFrame();
      
      expect(warningSpy).toHaveBeenCalledWith({
        type: 'high-draw-calls',
        value: 1500,
        threshold: 1000
      });
    });
  });
  
  describe('Reporting', () => {
    test('should generate performance report', () => {
      monitor.setRenderer(mockRenderer);
      monitor.startMonitoring();
      
      // Simulate some frames
      for (let i = 0; i < 5; i++) {
        monitor.beginFrame();
        jest.advanceTimersByTime(16.67);
        monitor.endFrame();
      }
      
      const report = monitor.generateReport();
      expect(report).toContain('Performance Report');
      expect(report).toContain('FPS:');
      expect(report).toContain('Memory:');
      expect(report).toContain('Draw Calls:');
    });
  });
  
  describe('Reset', () => {
    test('should reset all metrics', () => {
      monitor.startMonitoring();
      
      // Generate some data
      for (let i = 0; i < 5; i++) {
        monitor.beginFrame();
        jest.advanceTimersByTime(16.67);
        monitor.endFrame();
      }
      
      monitor.reset();
      
      const metrics = monitor.getMetrics();
      expect(metrics.fps).toBe(0);
      expect(metrics.averageFps).toBe(0);
      expect(metrics.minFps).toBe(Infinity);
      expect(metrics.maxFps).toBe(-Infinity);
    });
  });
});
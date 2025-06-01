import { EventEmitter } from './EventEmitter';
import * as THREE from 'three';

export interface PerformanceMetrics {
  fps: number;
  averageFps: number;
  minFps: number;
  maxFps: number;
  frameTime: number;
  memoryUsed: number;
  memoryLimit: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  programs: number;
  geometries: number;
  renderTime: number;
  updateTime: number;
}

export interface PerformanceThresholds {
  targetFps: number;
  minAcceptableFps: number;
  maxMemoryUsage: number;
  maxDrawCalls: number;
}

export class PerformanceMonitor extends EventEmitter {
  private metrics: PerformanceMetrics;
  private thresholds: PerformanceThresholds;
  private frameHistory: number[] = [];
  private lastFrameTime: number = 0;
  private frameCount: number = 0;
  private startTime: number = 0;
  private isMonitoring: boolean = false;
  private renderer: THREE.WebGLRenderer | null = null;
  
  constructor(thresholds?: Partial<PerformanceThresholds>) {
    super();
    
    this.thresholds = {
      targetFps: 60,
      minAcceptableFps: 30,
      maxMemoryUsage: 500 * 1024 * 1024, // 500MB
      maxDrawCalls: 1000,
      ...thresholds
    };
    
    this.metrics = this.initializeMetrics();
  }
  
  private initializeMetrics(): PerformanceMetrics {
    return {
      fps: 0,
      averageFps: 0,
      minFps: Infinity,
      maxFps: -Infinity,
      frameTime: 0,
      memoryUsed: 0,
      memoryLimit: 0,
      drawCalls: 0,
      triangles: 0,
      textures: 0,
      programs: 0,
      geometries: 0,
      renderTime: 0,
      updateTime: 0
    };
  }
  
  public setRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
  }
  
  public startMonitoring(): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.startTime = performance.now();
    this.lastFrameTime = this.startTime;
    this.frameHistory = [];
    this.frameCount = 0;
    
    this.emit('monitoring-started');
  }
  
  public stopMonitoring(): void {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    this.emit('monitoring-stopped');
  }
  
  public beginFrame(): void {
    if (!this.isMonitoring) return;
    
    this.frameCount++;
  }
  
  public endFrame(): void {
    if (!this.isMonitoring) return;
    
    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastFrameTime;
    this.lastFrameTime = currentTime;
    
    // Update FPS metrics
    const instantFps = 1000 / deltaTime;
    this.frameHistory.push(instantFps);
    
    // Keep only last 60 frames for average calculation
    if (this.frameHistory.length > 60) {
      this.frameHistory.shift();
    }
    
    this.metrics.fps = instantFps;
    this.metrics.frameTime = deltaTime;
    this.metrics.averageFps = this.frameHistory.reduce((a, b) => a + b, 0) / this.frameHistory.length;
    this.metrics.minFps = Math.min(this.metrics.minFps, instantFps);
    this.metrics.maxFps = Math.max(this.metrics.maxFps, instantFps);
    
    // Update memory metrics
    if ((performance as any).memory) {
      this.metrics.memoryUsed = (performance as any).memory.usedJSHeapSize;
      this.metrics.memoryLimit = (performance as any).memory.jsHeapSizeLimit;
    }
    
    // Update renderer metrics
    if (this.renderer) {
      const info = this.renderer.info;
      this.metrics.drawCalls = info.render.calls;
      this.metrics.triangles = info.render.triangles;
      this.metrics.textures = info.memory.textures;
      this.metrics.programs = info.programs ? info.programs.length : 0;
      this.metrics.geometries = info.memory.geometries;
    }
    
    // Check performance thresholds
    this.checkThresholds();
    
    // Emit metrics update
    this.emit('metrics-updated', this.metrics);
  }
  
  private checkThresholds(): void {
    // Check FPS threshold
    if (this.metrics.averageFps < this.thresholds.minAcceptableFps) {
      this.emit('performance-warning', {
        type: 'low-fps',
        value: this.metrics.averageFps,
        threshold: this.thresholds.minAcceptableFps
      });
    }
    
    // Check memory threshold
    if (this.metrics.memoryUsed > this.thresholds.maxMemoryUsage) {
      this.emit('performance-warning', {
        type: 'high-memory',
        value: this.metrics.memoryUsed,
        threshold: this.thresholds.maxMemoryUsage
      });
    }
    
    // Check draw calls threshold
    if (this.metrics.drawCalls > this.thresholds.maxDrawCalls) {
      this.emit('performance-warning', {
        type: 'high-draw-calls',
        value: this.metrics.drawCalls,
        threshold: this.thresholds.maxDrawCalls
      });
    }
  }
  
  public getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }
  
  public getAverageMetrics(): PerformanceMetrics {
    return {
      ...this.metrics,
      fps: this.metrics.averageFps
    };
  }
  
  public reset(): void {
    this.metrics = this.initializeMetrics();
    this.frameHistory = [];
    this.frameCount = 0;
  }
  
  public generateReport(): string {
    const runtime = (performance.now() - this.startTime) / 1000;
    
    return `Performance Report (${runtime.toFixed(1)}s runtime):
    FPS: ${this.metrics.fps.toFixed(1)} (avg: ${this.metrics.averageFps.toFixed(1)}, min: ${this.metrics.minFps.toFixed(1)}, max: ${this.metrics.maxFps.toFixed(1)})
    Frame Time: ${this.metrics.frameTime.toFixed(2)}ms
    Memory: ${(this.metrics.memoryUsed / 1024 / 1024).toFixed(1)}MB / ${(this.metrics.memoryLimit / 1024 / 1024).toFixed(1)}MB
    Draw Calls: ${this.metrics.drawCalls}
    Triangles: ${this.metrics.triangles}
    Textures: ${this.metrics.textures}
    Programs: ${this.metrics.programs}
    Geometries: ${this.metrics.geometries}`;
  }
}
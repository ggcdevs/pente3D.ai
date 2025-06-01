# Chunk 6.1: Performance Optimization - Development Guide

## Overview
This chunk focuses on optimizing the Pente3D.ai application for maximum performance across all devices. We'll implement rendering optimizations, memory management, scalability improvements, and adaptive quality settings to ensure smooth 60fps gameplay even on lower-end devices.

## Key Components

### 1. PerformanceMonitor Class (`src/utils/PerformanceMonitor.ts`)
A comprehensive performance monitoring system for tracking FPS, memory usage, and performance metrics.

```typescript
import { EventEmitter } from './EventEmitter';

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
```

### 2. ObjectPool Class (`src/utils/ObjectPool.ts`)
Generic object pooling system for efficient memory management.

```typescript
export interface Poolable {
  reset(): void;
}

export class ObjectPool<T extends Poolable> {
  private pool: T[] = [];
  private activeObjects: Set<T> = new Set();
  private factory: () => T;
  private maxSize: number;
  private preAllocateSize: number;
  
  constructor(
    factory: () => T,
    options: {
      maxSize?: number;
      preAllocateSize?: number;
    } = {}
  ) {
    this.factory = factory;
    this.maxSize = options.maxSize || 1000;
    this.preAllocateSize = options.preAllocateSize || 0;
    
    // Pre-allocate objects
    for (let i = 0; i < this.preAllocateSize; i++) {
      this.pool.push(this.factory());
    }
  }
  
  public acquire(): T {
    let obj: T;
    
    if (this.pool.length > 0) {
      obj = this.pool.pop()!;
    } else {
      obj = this.factory();
    }
    
    this.activeObjects.add(obj);
    return obj;
  }
  
  public release(obj: T): void {
    if (!this.activeObjects.has(obj)) {
      console.warn('Attempting to release object not from this pool');
      return;
    }
    
    this.activeObjects.delete(obj);
    obj.reset();
    
    if (this.pool.length < this.maxSize) {
      this.pool.push(obj);
    }
  }
  
  public releaseAll(): void {
    this.activeObjects.forEach(obj => {
      obj.reset();
      if (this.pool.length < this.maxSize) {
        this.pool.push(obj);
      }
    });
    this.activeObjects.clear();
  }
  
  public clear(): void {
    this.pool = [];
    this.activeObjects.clear();
  }
  
  public getPoolSize(): number {
    return this.pool.length;
  }
  
  public getActiveCount(): number {
    return this.activeObjects.size;
  }
  
  public getTotalCount(): number {
    return this.pool.length + this.activeObjects.size;
  }
}
```

### 3. QualityManager Class (`src/rendering/QualityManager.ts`)
Adaptive quality settings based on performance metrics.

```typescript
import { EventEmitter } from '../utils';
import { PerformanceMonitor, PerformanceMetrics } from '../utils/PerformanceMonitor';

export interface QualitySettings {
  shadowQuality: 'none' | 'low' | 'medium' | 'high';
  antialias: boolean;
  pixelRatio: number;
  particleCount: number;
  animationQuality: 'low' | 'medium' | 'high';
  postProcessing: boolean;
  reflections: boolean;
  bloomEffect: boolean;
  depthOfField: boolean;
}

export interface QualityPreset {
  name: string;
  settings: QualitySettings;
  minFps: number;
}

export class QualityManager extends EventEmitter {
  private currentSettings: QualitySettings;
  private performanceMonitor: PerformanceMonitor;
  private autoAdjust: boolean = true;
  private adjustmentCooldown: number = 5000; // 5 seconds
  private lastAdjustmentTime: number = 0;
  private qualityHistory: { time: number; quality: string }[] = [];
  
  private readonly presets: QualityPreset[] = [
    {
      name: 'ultra',
      settings: {
        shadowQuality: 'high',
        antialias: true,
        pixelRatio: window.devicePixelRatio || 1,
        particleCount: 1000,
        animationQuality: 'high',
        postProcessing: true,
        reflections: true,
        bloomEffect: true,
        depthOfField: true
      },
      minFps: 55
    },
    {
      name: 'high',
      settings: {
        shadowQuality: 'medium',
        antialias: true,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        particleCount: 500,
        animationQuality: 'high',
        postProcessing: true,
        reflections: false,
        bloomEffect: true,
        depthOfField: false
      },
      minFps: 45
    },
    {
      name: 'medium',
      settings: {
        shadowQuality: 'low',
        antialias: true,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
        particleCount: 250,
        animationQuality: 'medium',
        postProcessing: false,
        reflections: false,
        bloomEffect: false,
        depthOfField: false
      },
      minFps: 35
    },
    {
      name: 'low',
      settings: {
        shadowQuality: 'none',
        antialias: false,
        pixelRatio: 1,
        particleCount: 100,
        animationQuality: 'low',
        postProcessing: false,
        reflections: false,
        bloomEffect: false,
        depthOfField: false
      },
      minFps: 25
    },
    {
      name: 'potato',
      settings: {
        shadowQuality: 'none',
        antialias: false,
        pixelRatio: 0.75,
        particleCount: 0,
        animationQuality: 'low',
        postProcessing: false,
        reflections: false,
        bloomEffect: false,
        depthOfField: false
      },
      minFps: 20
    }
  ];
  
  private currentPresetIndex: number = 1; // Start with 'high'
  
  constructor(performanceMonitor: PerformanceMonitor) {
    super();
    
    this.performanceMonitor = performanceMonitor;
    this.currentSettings = { ...this.presets[this.currentPresetIndex].settings };
    
    // Listen for performance warnings
    this.performanceMonitor.on('performance-warning', this.handlePerformanceWarning.bind(this));
    
    // Periodic quality check
    setInterval(() => {
      if (this.autoAdjust) {
        this.checkAndAdjustQuality();
      }
    }, 1000);
  }
  
  private handlePerformanceWarning(warning: any): void {
    if (!this.autoAdjust) return;
    
    if (warning.type === 'low-fps') {
      this.decreaseQuality('Low FPS detected');
    } else if (warning.type === 'high-memory') {
      this.decreaseQuality('High memory usage detected');
    }
  }
  
  private checkAndAdjustQuality(): void {
    const now = performance.now();
    if (now - this.lastAdjustmentTime < this.adjustmentCooldown) {
      return;
    }
    
    const metrics = this.performanceMonitor.getMetrics();
    const currentPreset = this.presets[this.currentPresetIndex];
    
    // Check if we should decrease quality
    if (metrics.averageFps < currentPreset.minFps - 5) {
      this.decreaseQuality(`FPS below threshold (${metrics.averageFps.toFixed(1)} < ${currentPreset.minFps})`);
    }
    // Check if we can increase quality
    else if (
      this.currentPresetIndex > 0 &&
      metrics.averageFps > this.presets[this.currentPresetIndex - 1].minFps + 10
    ) {
      this.increaseQuality(`FPS allows higher quality (${metrics.averageFps.toFixed(1)})`);
    }
  }
  
  private decreaseQuality(reason: string): void {
    if (this.currentPresetIndex >= this.presets.length - 1) {
      return; // Already at lowest quality
    }
    
    this.currentPresetIndex++;
    this.applyPreset(this.currentPresetIndex, reason);
  }
  
  private increaseQuality(reason: string): void {
    if (this.currentPresetIndex <= 0) {
      return; // Already at highest quality
    }
    
    this.currentPresetIndex--;
    this.applyPreset(this.currentPresetIndex, reason);
  }
  
  private applyPreset(index: number, reason: string): void {
    const preset = this.presets[index];
    this.currentSettings = { ...preset.settings };
    this.lastAdjustmentTime = performance.now();
    
    this.qualityHistory.push({
      time: this.lastAdjustmentTime,
      quality: preset.name
    });
    
    // Keep only last 10 quality changes
    if (this.qualityHistory.length > 10) {
      this.qualityHistory.shift();
    }
    
    this.emit('quality-changed', {
      preset: preset.name,
      settings: this.currentSettings,
      reason
    });
  }
  
  public setAutoAdjust(enabled: boolean): void {
    this.autoAdjust = enabled;
    this.emit('auto-adjust-changed', enabled);
  }
  
  public setQualityPreset(presetName: string): void {
    const index = this.presets.findIndex(p => p.name === presetName);
    if (index !== -1) {
      this.currentPresetIndex = index;
      this.applyPreset(index, 'Manual preset change');
    }
  }
  
  public getSettings(): QualitySettings {
    return { ...this.currentSettings };
  }
  
  public getCurrentPreset(): string {
    return this.presets[this.currentPresetIndex].name;
  }
  
  public getQualityHistory(): { time: number; quality: string }[] {
    return [...this.qualityHistory];
  }
  
  public isAutoAdjustEnabled(): boolean {
    return this.autoAdjust;
  }
}
```

### 4. Enhanced Renderer Class Updates
Add performance optimizations to the existing Renderer class.

```typescript
// Add to src/rendering/Renderer.ts

private performanceMonitor?: PerformanceMonitor;
private qualityManager?: QualityManager;
private objectPools: Map<string, ObjectPool<any>> = new Map();
private frustumCuller: THREE.Frustum = new THREE.Frustum();
private cameraMatrix: THREE.Matrix4 = new THREE.Matrix4();
private renderStats = {
  visibleObjects: 0,
  culledObjects: 0,
  batchedDrawCalls: 0
};

// Level of Detail (LOD) management
private lodManager = {
  enabled: true,
  distances: [50, 150, 300],
  updateFrequency: 10, // Update LOD every N frames
  frameCounter: 0
};

// Batch rendering for pieces
private pieceBatches: Map<string, THREE.InstancedMesh> = new Map();
private maxInstancesPerBatch = 1000;

public setPerformanceMonitor(monitor: PerformanceMonitor): void {
  this.performanceMonitor = monitor;
  monitor.setRenderer(this.renderer);
}

public setQualityManager(manager: QualityManager): void {
  this.qualityManager = manager;
  
  // Apply quality settings
  manager.on('quality-changed', ({ settings }: any) => {
    this.applyQualitySettings(settings);
  });
}

private applyQualitySettings(settings: QualitySettings): void {
  // Update renderer settings
  this.renderer.setPixelRatio(settings.pixelRatio);
  this.renderer.antialias = settings.antialias;
  
  // Update shadow settings
  this.renderer.shadowMap.enabled = settings.shadowQuality !== 'none';
  if (settings.shadowQuality !== 'none') {
    switch (settings.shadowQuality) {
      case 'low':
        this.renderer.shadowMap.type = THREE.BasicShadowMap;
        break;
      case 'medium':
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        break;
      case 'high':
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        break;
    }
  }
  
  // Recreate renderer if needed (for antialias changes)
  if (this.renderer.antialias !== settings.antialias) {
    this.recreateRenderer(settings);
  }
}

private recreateRenderer(settings: QualitySettings): void {
  const oldRenderer = this.renderer;
  const canvas = oldRenderer.domElement;
  
  // Create new renderer
  this.renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: settings.antialias,
    powerPreference: 'high-performance'
  });
  
  // Copy settings
  this.renderer.setSize(canvas.width, canvas.height);
  this.renderer.setPixelRatio(settings.pixelRatio);
  
  // Dispose old renderer
  oldRenderer.dispose();
  
  // Update performance monitor
  if (this.performanceMonitor) {
    this.performanceMonitor.setRenderer(this.renderer);
  }
}

// Optimized render method with frustum culling
public render(): void {
  if (!this.scene || !this.camera) return;
  
  if (this.performanceMonitor) {
    this.performanceMonitor.beginFrame();
  }
  
  const renderStart = performance.now();
  
  // Update frustum for culling
  this.lodManager.frameCounter++;
  if (this.lodManager.frameCounter % 2 === 0) { // Update frustum every other frame
    this.cameraMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    this.frustumCuller.setFromProjectionMatrix(this.cameraMatrix);
  }
  
  // Perform frustum culling
  this.performFrustumCulling();
  
  // Update LOD if needed
  if (this.lodManager.enabled && 
      this.lodManager.frameCounter % this.lodManager.updateFrequency === 0) {
    this.updateLOD();
  }
  
  // Update animations efficiently
  if (this.qualityManager) {
    const quality = this.qualityManager.getSettings().animationQuality;
    this.updateAnimations(quality);
  }
  
  // Render scene
  this.renderer.render(this.scene, this.camera);
  
  const renderEnd = performance.now();
  
  if (this.performanceMonitor) {
    this.performanceMonitor.endFrame();
  }
}

private performFrustumCulling(): void {
  this.renderStats.visibleObjects = 0;
  this.renderStats.culledObjects = 0;
  
  this.scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      if (object.geometry.boundingSphere === null) {
        object.geometry.computeBoundingSphere();
      }
      
      // Check if object is in frustum
      const inFrustum = this.frustumCuller.intersectsObject(object);
      object.visible = inFrustum;
      
      if (inFrustum) {
        this.renderStats.visibleObjects++;
      } else {
        this.renderStats.culledObjects++;
      }
    }
  });
}

private updateLOD(): void {
  const cameraPosition = this.camera.position;
  
  this.pieceGroup.children.forEach((piece) => {
    if (piece instanceof THREE.Mesh) {
      const distance = piece.position.distanceTo(cameraPosition);
      
      // Adjust geometry detail based on distance
      if (distance > this.lodManager.distances[2]) {
        // Very far - use simplest geometry
        piece.visible = false; // Or use very low poly version
      } else if (distance > this.lodManager.distances[1]) {
        // Far - use low detail
        if (piece.geometry.attributes.position.count > 100) {
          // Switch to simpler geometry
        }
      } else if (distance > this.lodManager.distances[0]) {
        // Medium distance - use medium detail
      } else {
        // Close - use full detail
      }
    }
  });
}

// Batch rendering for pieces
private initializeBatchRendering(): void {
  // Create instanced meshes for black and white pieces
  const pieceGeometry = new THREE.SphereGeometry(0.3, 16, 16);
  
  const blackMaterial = new THREE.MeshPhongMaterial({
    color: 0x000000,
    emissive: 0x111111
  });
  
  const whiteMaterial = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    emissive: 0xaaaaaa
  });
  
  const blackBatch = new THREE.InstancedMesh(
    pieceGeometry,
    blackMaterial,
    this.maxInstancesPerBatch
  );
  
  const whiteBatch = new THREE.InstancedMesh(
    pieceGeometry,
    whiteMaterial,
    this.maxInstancesPerBatch
  );
  
  this.pieceBatches.set('black', blackBatch);
  this.pieceBatches.set('white', whiteBatch);
  
  this.scene.add(blackBatch);
  this.scene.add(whiteBatch);
}

// Memory management
public dispose(): void {
  // Dispose all geometries
  this.scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      object.geometry.dispose();
      
      if (object instanceof THREE.Mesh && object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(m => m.dispose());
        } else {
          object.material.dispose();
        }
      }
    }
  });
  
  // Clear object pools
  this.objectPools.forEach(pool => pool.clear());
  this.objectPools.clear();
  
  // Dispose renderer
  this.renderer.dispose();
  
  // Clear references
  this.scene.clear();
  this.pieceGroup.clear();
  this.boardGroup.clear();
  this.highlightGroup.clear();
}

// Efficient animation updates based on quality
private updateAnimations(quality: 'low' | 'medium' | 'high'): void {
  const deltaTime = this.clock.getDelta();
  
  // Update rotation animations based on quality
  if (quality === 'high') {
    // Update all animations every frame
    this.updateAllAnimations(deltaTime);
  } else if (quality === 'medium') {
    // Update animations every other frame
    if (this.lodManager.frameCounter % 2 === 0) {
      this.updateAllAnimations(deltaTime);
    }
  } else {
    // Update animations every 3rd frame
    if (this.lodManager.frameCounter % 3 === 0) {
      this.updateAllAnimations(deltaTime);
    }
  }
}

private updateAllAnimations(deltaTime: number): void {
  // Update pulsing animations
  if (this.temporaryPieces.size > 0) {
    const time = this.clock.getElapsedTime();
    const pulseScale = 1 + Math.sin(time * 3) * 0.1;
    
    this.temporaryPieces.forEach((piece) => {
      piece.scale.setScalar(pulseScale);
    });
  }
  
  // Update rotating animations efficiently
  this.highlightGroup.children.forEach((highlight) => {
    if (highlight.userData.rotating) {
      highlight.rotation.y += deltaTime;
    }
  });
}
```

### 5. PerformanceStats UI Component (`src/ui/PerformanceStats.ts`)
Optional performance statistics overlay for development and debugging.

```typescript
import { PerformanceMonitor, PerformanceMetrics } from '../utils/PerformanceMonitor';

export class PerformanceStats {
  private container: HTMLDivElement;
  private monitor: PerformanceMonitor;
  private isVisible: boolean = false;
  private updateInterval: number = 100; // Update every 100ms
  private lastUpdateTime: number = 0;
  
  constructor(monitor: PerformanceMonitor) {
    this.monitor = monitor;
    this.container = this.createContainer();
    
    // Listen for metrics updates
    this.monitor.on('metrics-updated', this.updateDisplay.bind(this));
    
    // Toggle with F3 key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F3') {
        this.toggle();
      }
    });
  }
  
  private createContainer(): HTMLDivElement {
    const container = document.createElement('div');
    container.className = 'performance-stats';
    container.innerHTML = `
      <div class="stats-header">Performance Monitor</div>
      <div class="stats-content">
        <div class="stat-row">
          <span class="stat-label">FPS:</span>
          <span class="stat-value" id="stat-fps">0</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Frame Time:</span>
          <span class="stat-value" id="stat-frametime">0ms</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Memory:</span>
          <span class="stat-value" id="stat-memory">0MB</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Draw Calls:</span>
          <span class="stat-value" id="stat-drawcalls">0</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Triangles:</span>
          <span class="stat-value" id="stat-triangles">0</span>
        </div>
      </div>
    `;
    
    document.body.appendChild(container);
    this.hide();
    
    return container;
  }
  
  private updateDisplay(metrics: PerformanceMetrics): void {
    if (!this.isVisible) return;
    
    const now = performance.now();
    if (now - this.lastUpdateTime < this.updateInterval) {
      return;
    }
    this.lastUpdateTime = now;
    
    // Update FPS with color coding
    const fpsElement = this.container.querySelector('#stat-fps') as HTMLElement;
    fpsElement.textContent = metrics.fps.toFixed(1);
    fpsElement.className = 'stat-value';
    if (metrics.fps < 30) {
      fpsElement.classList.add('warning');
    } else if (metrics.fps < 50) {
      fpsElement.classList.add('caution');
    } else {
      fpsElement.classList.add('good');
    }
    
    // Update other stats
    (this.container.querySelector('#stat-frametime') as HTMLElement).textContent = 
      `${metrics.frameTime.toFixed(1)}ms`;
    
    (this.container.querySelector('#stat-memory') as HTMLElement).textContent = 
      `${(metrics.memoryUsed / 1024 / 1024).toFixed(1)}MB`;
    
    (this.container.querySelector('#stat-drawcalls') as HTMLElement).textContent = 
      metrics.drawCalls.toString();
    
    (this.container.querySelector('#stat-triangles') as HTMLElement).textContent = 
      metrics.triangles.toString();
  }
  
  public show(): void {
    this.container.style.display = 'block';
    this.isVisible = true;
    this.monitor.startMonitoring();
  }
  
  public hide(): void {
    this.container.style.display = 'none';
    this.isVisible = false;
  }
  
  public toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }
  
  public destroy(): void {
    this.container.remove();
  }
}
```

### 6. Integration in main.ts
Update main.ts to integrate the performance optimization system.

```typescript
// Add imports
import { PerformanceMonitor } from './utils/PerformanceMonitor';
import { QualityManager } from './rendering/QualityManager';
import { PerformanceStats } from './ui/PerformanceStats';

// Initialize performance systems
const performanceMonitor = new PerformanceMonitor({
  targetFps: 60,
  minAcceptableFps: 30,
  maxMemoryUsage: 500 * 1024 * 1024, // 500MB
  maxDrawCalls: 1000
});

const qualityManager = new QualityManager(performanceMonitor);

// Set up renderer with performance optimization
renderer.setPerformanceMonitor(performanceMonitor);
renderer.setQualityManager(qualityManager);

// Optional: Add performance stats overlay (development mode)
if (import.meta.env.DEV) {
  const performanceStats = new PerformanceStats(performanceMonitor);
}

// Listen for quality changes and update settings
qualityManager.on('quality-changed', ({ preset, reason }) => {
  console.log(`Quality changed to ${preset}: ${reason}`);
  
  // Save quality preference
  settings.set('performanceQuality', preset);
});

// Load saved quality preference
const savedQuality = settings.get('performanceQuality');
if (savedQuality) {
  qualityManager.setQualityPreset(savedQuality);
}

// Add performance monitoring to render loop
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);
  
  const currentTime = performance.now();
  const deltaTime = currentTime - lastTime;
  lastTime = currentTime;
  
  // Update controls and render
  if (controls) {
    controls.update();
  }
  
  renderer.render();
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  performanceMonitor.stopMonitoring();
  renderer.dispose();
});
```

### 7. CSS for Performance Stats
Add styles for the performance stats overlay.

```css
/* Add to src/style.css */

.performance-stats {
  position: fixed;
  top: 10px;
  right: 10px;
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 10px;
  font-family: monospace;
  font-size: 12px;
  border-radius: 4px;
  min-width: 200px;
  z-index: 10000;
}

.stats-header {
  font-weight: bold;
  margin-bottom: 5px;
  border-bottom: 1px solid #444;
  padding-bottom: 5px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  margin: 3px 0;
}

.stat-label {
  color: #888;
}

.stat-value {
  font-weight: bold;
}

.stat-value.good {
  color: #4CAF50;
}

.stat-value.caution {
  color: #FFC107;
}

.stat-value.warning {
  color: #F44336;
}
```

## Implementation Order

1. **PerformanceMonitor** - Core performance tracking
2. **ObjectPool** - Memory management utility
3. **QualityManager** - Adaptive quality system
4. **Renderer enhancements** - Optimization features
5. **PerformanceStats** - Debug overlay
6. **Integration** - Wire everything together

## Key Performance Features

### 1. Frustum Culling
- Only render objects visible to camera
- Significant performance boost for large boards

### 2. Level of Detail (LOD)
- Reduce geometry complexity for distant objects
- Maintain visual quality while improving performance

### 3. Batch Rendering
- Instance rendering for multiple pieces
- Reduces draw calls dramatically

### 4. Adaptive Quality
- Automatic quality adjustment based on FPS
- Maintains smooth gameplay on all devices

### 5. Object Pooling
- Reuse objects instead of creating new ones
- Reduces garbage collection pressure

### 6. Efficient Animations
- Update animations based on quality settings
- Skip frames on lower-end devices

## Performance Targets

- **60 FPS**: Maintained on modern devices
- **30 FPS**: Minimum acceptable framerate
- **Memory**: Under 500MB usage
- **Load Time**: Under 2 seconds
- **Draw Calls**: Under 1000 per frame
- **Mobile**: Playable on mobile devices

## Browser Compatibility

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- Mobile Safari 14+
- Chrome Android 90+

## Export Structure

Update barrel exports:

```typescript
// src/utils/index.ts
export { PerformanceMonitor } from './PerformanceMonitor';
export { ObjectPool } from './ObjectPool';
export type { PerformanceMetrics, PerformanceThresholds, Poolable } from './PerformanceMonitor';

// src/rendering/index.ts
export { QualityManager } from './QualityManager';
export type { QualitySettings, QualityPreset } from './QualityManager';

// src/ui/index.ts
export { PerformanceStats } from './PerformanceStats';
```
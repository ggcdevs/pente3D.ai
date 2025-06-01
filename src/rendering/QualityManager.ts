import { EventEmitter } from '../utils';
import { PerformanceMonitor } from '../utils/PerformanceMonitor';

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
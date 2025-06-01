import { QualityManager, QualitySettings } from '@/rendering/QualityManager';
import { PerformanceMonitor } from '@/utils/PerformanceMonitor';

describe('QualityManager', () => {
  let qualityManager: QualityManager;
  let performanceMonitor: PerformanceMonitor;
  
  beforeEach(() => {
    performanceMonitor = new PerformanceMonitor();
    qualityManager = new QualityManager(performanceMonitor);
    
    // Mock window.devicePixelRatio
    Object.defineProperty(window, 'devicePixelRatio', {
      value: 2,
      writable: true
    });
  });
  
  describe('Constructor', () => {
    test('should initialize with high preset by default', () => {
      expect(qualityManager.getCurrentPreset()).toBe('high');
    });
    
    test('should initialize with correct settings', () => {
      const settings = qualityManager.getSettings();
      expect(settings.shadowQuality).toBe('medium');
      expect(settings.antialias).toBe(true);
      expect(settings.pixelRatio).toBe(2);
    });
  });
  
  describe('Manual Quality Control', () => {
    test('should change quality preset manually', () => {
      const changeSpy = jest.fn();
      qualityManager.on('quality-changed', changeSpy);
      
      qualityManager.setQualityPreset('low');
      
      expect(qualityManager.getCurrentPreset()).toBe('low');
      expect(changeSpy).toHaveBeenCalledWith({
        preset: 'low',
        settings: expect.objectContaining({
          shadowQuality: 'none',
          antialias: false,
          pixelRatio: 1
        }),
        reason: 'Manual preset change'
      });
    });
    
    test('should ignore invalid preset names', () => {
      const currentPreset = qualityManager.getCurrentPreset();
      qualityManager.setQualityPreset('invalid');
      expect(qualityManager.getCurrentPreset()).toBe(currentPreset);
    });
  });
  
  describe('Auto Adjust', () => {
    test('should be enabled by default', () => {
      expect(qualityManager.isAutoAdjustEnabled()).toBe(true);
    });
    
    test('should toggle auto adjust', () => {
      const changeSpy = jest.fn();
      qualityManager.on('auto-adjust-changed', changeSpy);
      
      qualityManager.setAutoAdjust(false);
      expect(qualityManager.isAutoAdjustEnabled()).toBe(false);
      expect(changeSpy).toHaveBeenCalledWith(false);
    });
  });
  
  describe('Performance-based Adjustments', () => {
    test('should decrease quality on low FPS warning', () => {
      const changeSpy = jest.fn();
      qualityManager.on('quality-changed', changeSpy);
      
      performanceMonitor.emit('performance-warning', {
        type: 'low-fps',
        value: 25,
        threshold: 30
      });
      
      expect(changeSpy).toHaveBeenCalledWith({
        preset: 'medium',
        settings: expect.any(Object),
        reason: 'Low FPS detected'
      });
    });
    
    test('should decrease quality on high memory warning', () => {
      const changeSpy = jest.fn();
      qualityManager.on('quality-changed', changeSpy);
      
      performanceMonitor.emit('performance-warning', {
        type: 'high-memory',
        value: 600 * 1024 * 1024,
        threshold: 500 * 1024 * 1024
      });
      
      expect(changeSpy).toHaveBeenCalledWith({
        preset: 'medium',
        settings: expect.any(Object),
        reason: 'High memory usage detected'
      });
    });
    
    test('should not adjust when auto-adjust is disabled', () => {
      qualityManager.setAutoAdjust(false);
      
      const changeSpy = jest.fn();
      qualityManager.on('quality-changed', changeSpy);
      
      performanceMonitor.emit('performance-warning', {
        type: 'low-fps',
        value: 25,
        threshold: 30
      });
      
      expect(changeSpy).not.toHaveBeenCalled();
    });
    
    test('should not decrease below potato quality', () => {
      // Set to lowest quality
      qualityManager.setQualityPreset('potato');
      
      const changeSpy = jest.fn();
      qualityManager.on('quality-changed', changeSpy);
      
      performanceMonitor.emit('performance-warning', {
        type: 'low-fps',
        value: 15,
        threshold: 30
      });
      
      expect(changeSpy).not.toHaveBeenCalled();
    });
  });
  
  describe('Quality History', () => {
    test('should track quality changes', () => {
      qualityManager.setQualityPreset('low');
      qualityManager.setQualityPreset('medium');
      qualityManager.setQualityPreset('high');
      
      const history = qualityManager.getQualityHistory();
      expect(history).toHaveLength(3);
      expect(history[0].quality).toBe('low');
      expect(history[1].quality).toBe('medium');
      expect(history[2].quality).toBe('high');
    });
    
    test('should limit history to 10 entries', () => {
      for (let i = 0; i < 15; i++) {
        qualityManager.setQualityPreset(i % 2 === 0 ? 'low' : 'high');
      }
      
      const history = qualityManager.getQualityHistory();
      expect(history).toHaveLength(10);
    });
  });
  
  describe('Quality Settings', () => {
    test('should return correct settings for each preset', () => {
      const presets = ['ultra', 'high', 'medium', 'low', 'potato'];
      
      presets.forEach(preset => {
        qualityManager.setQualityPreset(preset);
        const settings = qualityManager.getSettings();
        
        switch (preset) {
          case 'ultra':
            expect(settings.shadowQuality).toBe('high');
            expect(settings.postProcessing).toBe(true);
            expect(settings.reflections).toBe(true);
            break;
          case 'potato':
            expect(settings.shadowQuality).toBe('none');
            expect(settings.pixelRatio).toBe(0.75);
            expect(settings.particleCount).toBe(0);
            break;
        }
      });
    });
  });
});
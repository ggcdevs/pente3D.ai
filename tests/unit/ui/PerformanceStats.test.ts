import { PerformanceStats } from '@/ui/PerformanceStats';
import { PerformanceMonitor } from '@/utils/PerformanceMonitor';

describe('PerformanceStats', () => {
  let stats: PerformanceStats;
  let monitor: PerformanceMonitor;
  
  beforeEach(() => {
    monitor = new PerformanceMonitor();
    stats = new PerformanceStats(monitor);
  });
  
  afterEach(() => {
    stats.destroy();
  });
  
  test('should create stats container', () => {
    const container = document.querySelector('.performance-stats');
    expect(container).toBeTruthy();
    expect(container).toHaveClass('performance-stats');
  });
  
  test('should be hidden by default', () => {
    const container = document.querySelector('.performance-stats') as HTMLElement;
    expect(container.style.display).toBe('none');
  });
  
  test('should show stats', () => {
    stats.show();
    const container = document.querySelector('.performance-stats') as HTMLElement;
    expect(container.style.display).toBe('block');
  });
  
  test('should hide stats', () => {
    stats.show();
    stats.hide();
    const container = document.querySelector('.performance-stats') as HTMLElement;
    expect(container.style.display).toBe('none');
  });
  
  test('should toggle visibility', () => {
    const container = document.querySelector('.performance-stats') as HTMLElement;
    
    stats.toggle();
    expect(container.style.display).toBe('block');
    
    stats.toggle();
    expect(container.style.display).toBe('none');
  });
  
  test('should update display with metrics', () => {
    stats.show();
    
    monitor.emit('metrics-updated', {
      fps: 59.5,
      frameTime: 16.8,
      memoryUsed: 150 * 1024 * 1024,
      drawCalls: 250,
      triangles: 50000
    });
    
    const fpsElement = document.querySelector('#stat-fps');
    const frameTimeElement = document.querySelector('#stat-frametime');
    const memoryElement = document.querySelector('#stat-memory');
    const drawCallsElement = document.querySelector('#stat-drawcalls');
    const trianglesElement = document.querySelector('#stat-triangles');
    
    expect(fpsElement?.textContent).toBe('59.5');
    expect(frameTimeElement?.textContent).toBe('16.8ms');
    expect(memoryElement?.textContent).toBe('150.0MB');
    expect(drawCallsElement?.textContent).toBe('250');
    expect(trianglesElement?.textContent).toBe('50000');
  });
  
  test('should color-code FPS values', () => {
    stats.show();
    
    const fpsElement = document.querySelector('#stat-fps') as HTMLElement;
    
    // Good FPS
    monitor.emit('metrics-updated', { fps: 60 });
    expect(fpsElement).toHaveClass('good');
    
    // Caution FPS
    monitor.emit('metrics-updated', { fps: 40 });
    expect(fpsElement).toHaveClass('caution');
    
    // Warning FPS
    monitor.emit('metrics-updated', { fps: 25 });
    expect(fpsElement).toHaveClass('warning');
  });
  
  test('should toggle with F3 key', () => {
    const container = document.querySelector('.performance-stats') as HTMLElement;
    
    const event = new KeyboardEvent('keydown', { key: 'F3' });
    document.dispatchEvent(event);
    
    expect(container.style.display).toBe('block');
    
    document.dispatchEvent(event);
    expect(container.style.display).toBe('none');
  });
  
  test('should throttle updates', () => {
    stats.show();
    
    const fpsElement = document.querySelector('#stat-fps') as HTMLElement;
    
    // Send multiple rapid updates
    for (let i = 0; i < 10; i++) {
      monitor.emit('metrics-updated', { fps: i * 10 });
    }
    
    // Should only update based on throttle interval
    expect(parseInt(fpsElement.textContent || '0')).toBeLessThan(90);
  });
});
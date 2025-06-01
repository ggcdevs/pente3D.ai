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
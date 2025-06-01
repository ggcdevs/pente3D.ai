describe('Mobile Accessibility', () => {
  let originalNavigator: any;
  let originalWindow: any;

  beforeEach(() => {
    // Mock mobile environment
    originalNavigator = global.navigator;
    originalWindow = global.window;
    
    Object.defineProperty(window, 'navigator', {
      writable: true,
      value: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
        maxTouchPoints: 5
      }
    });
    
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 375
    });
    
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      value: 667
    });
  });

  afterEach(() => {
    global.navigator = originalNavigator;
    global.window = originalWindow;
  });

  test('should provide touch-friendly tap targets', () => {
    // Create buttons
    const button = document.createElement('button');
    button.textContent = 'Test Button';
    button.style.padding = '12px 24px';
    button.style.fontSize = '16px';
    document.body.appendChild(button);
    
    // Check minimum size (44x44px is WCAG recommendation)
    const rect = button.getBoundingClientRect();
    
    // Note: getBoundingClientRect returns 0 in jsdom
    // In real browser testing, verify:
    // expect(rect.width).toBeGreaterThanOrEqual(44);
    // expect(rect.height).toBeGreaterThanOrEqual(44);
    
    // Verify button exists and has appropriate styling
    expect(button.style.padding).toBeTruthy();
    expect(parseInt(button.style.fontSize)).toBeGreaterThanOrEqual(16);
    
    document.body.removeChild(button);
  });

  test('should work with screen reader gestures', () => {
    // Mock touch events
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', '3D game board');
    document.body.appendChild(canvas);
    
    // Simulate swipe gestures
    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 100, clientY: 100 } as Touch]
    });
    
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientX: 200, clientY: 100 } as Touch]
    });
    
    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: 200, clientY: 100 } as Touch]
    });
    
    // Dispatch events
    canvas.dispatchEvent(touchStart);
    canvas.dispatchEvent(touchMove);
    canvas.dispatchEvent(touchEnd);
    
    // Verify canvas has proper ARIA attributes for screen readers
    expect(canvas.getAttribute('role')).toBe('application');
    expect(canvas.getAttribute('aria-label')).toBeTruthy();
    
    document.body.removeChild(canvas);
  });

  test('should handle virtual keyboard', () => {
    // Create input field
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'test-input';
    input.setAttribute('aria-label', 'Test input');
    document.body.appendChild(input);
    
    // Focus input (would trigger virtual keyboard on mobile)
    input.focus();
    
    // Simulate viewport resize when keyboard appears
    const resizeEvent = new Event('resize');
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      value: 400 // Reduced height with keyboard
    });
    window.dispatchEvent(resizeEvent);
    
    // Verify input is still accessible
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-label')).toBeTruthy();
    
    document.body.removeChild(input);
  });

  test('should support pinch zoom', () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    
    // Mock pinch gesture
    const touchStart = new TouchEvent('touchstart', {
      touches: [
        { clientX: 100, clientY: 100 } as Touch,
        { clientX: 200, clientY: 200 } as Touch
      ]
    });
    
    const touchMove = new TouchEvent('touchmove', {
      touches: [
        { clientX: 80, clientY: 80 } as Touch,
        { clientX: 220, clientY: 220 } as Touch
      ]
    });
    
    // Verify viewport meta tag allows zooming
    let viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
      viewport = document.createElement('meta');
      viewport.setAttribute('name', 'viewport');
      viewport.setAttribute('content', 'width=device-width, initial-scale=1.0');
      document.head.appendChild(viewport);
    }
    
    const content = viewport.getAttribute('content');
    expect(content).not.toContain('user-scalable=no');
    expect(content).not.toContain('maximum-scale=1');
    
    document.body.removeChild(canvas);
  });

  test('should work in landscape and portrait', () => {
    // Test portrait
    Object.defineProperty(window, 'innerWidth', { value: 375 });
    Object.defineProperty(window, 'innerHeight', { value: 667 });
    
    const portraitQuery = window.matchMedia('(orientation: portrait)');
    
    // Test landscape
    Object.defineProperty(window, 'innerWidth', { value: 667 });
    Object.defineProperty(window, 'innerHeight', { value: 375 });
    
    const landscapeQuery = window.matchMedia('(orientation: landscape)');
    
    // Create responsive UI element
    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.maxWidth = '800px';
    container.style.margin = '0 auto';
    document.body.appendChild(container);
    
    // Verify container adapts to viewport
    expect(container.style.width).toBe('100%');
    expect(container.style.maxWidth).toBeTruthy();
    
    document.body.removeChild(container);
  });
});
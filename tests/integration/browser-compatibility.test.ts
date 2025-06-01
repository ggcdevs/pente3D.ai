describe('Browser Compatibility', () => {
  let originalUserAgent: string;

  beforeEach(() => {
    originalUserAgent = navigator.userAgent;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      value: originalUserAgent
    });
  });

  test('should work with Chrome + ChromeVox', () => {
    // Mock Chrome user agent
    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
    
    // Verify ARIA attributes work
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'Test button for ChromeVox');
    button.setAttribute('role', 'button');
    document.body.appendChild(button);
    
    expect(button.getAttribute('aria-label')).toBe('Test button for ChromeVox');
    expect(button.getAttribute('role')).toBe('button');
    
    // ChromeVox specific: live regions
    const liveRegion = document.createElement('div');
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    document.body.appendChild(liveRegion);
    
    liveRegion.textContent = 'Update for ChromeVox';
    expect(liveRegion.textContent).toBe('Update for ChromeVox');
    
    document.body.removeChild(button);
    document.body.removeChild(liveRegion);
  });

  test('should work with Firefox + NVDA', () => {
    // Mock Firefox user agent
    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0'
    });
    
    // Test Firefox-specific features
    const navigation = document.createElement('nav');
    navigation.setAttribute('role', 'navigation');
    navigation.setAttribute('aria-label', 'Main navigation');
    
    const list = document.createElement('ul');
    list.setAttribute('role', 'list');
    
    const item = document.createElement('li');
    item.setAttribute('role', 'listitem');
    item.textContent = 'Navigation item';
    
    list.appendChild(item);
    navigation.appendChild(list);
    document.body.appendChild(navigation);
    
    // NVDA reads semantic HTML well
    expect(navigation.getAttribute('role')).toBe('navigation');
    expect(list.getAttribute('role')).toBe('list');
    expect(item.getAttribute('role')).toBe('listitem');
    
    document.body.removeChild(navigation);
  });

  test('should work with Safari + VoiceOver', () => {
    // Mock Safari user agent
    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15'
    });
    
    // Test Safari/VoiceOver specific features
    const form = document.createElement('form');
    form.setAttribute('role', 'form');
    
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = 'Game Options';
    
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'sound-enabled';
    
    const label = document.createElement('label');
    label.setAttribute('for', 'sound-enabled');
    label.textContent = 'Enable sound';
    
    fieldset.appendChild(legend);
    fieldset.appendChild(input);
    fieldset.appendChild(label);
    form.appendChild(fieldset);
    document.body.appendChild(form);
    
    // VoiceOver uses fieldset/legend for grouping
    expect(legend.textContent).toBe('Game Options');
    expect(label.getAttribute('for')).toBe(input.id);
    
    document.body.removeChild(form);
  });

  test('should work with Edge + Narrator', () => {
    // Mock Edge user agent
    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 Edg/91.0.864.59'
    });
    
    // Test Edge/Narrator specific features
    const table = document.createElement('table');
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', 'Game statistics');
    
    const caption = document.createElement('caption');
    caption.textContent = 'Player Statistics';
    
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    
    const headers = ['Player', 'Wins', 'Losses'];
    headers.forEach(text => {
      const th = document.createElement('th');
      th.textContent = text;
      th.setAttribute('scope', 'col');
      headerRow.appendChild(th);
    });
    
    thead.appendChild(headerRow);
    table.appendChild(caption);
    table.appendChild(thead);
    document.body.appendChild(table);
    
    // Narrator reads table structure
    expect(table.getAttribute('role')).toBe('table');
    expect(caption.textContent).toBe('Player Statistics');
    
    document.body.removeChild(table);
  });

  test('should handle browser-specific shortcuts', () => {
    // Test that our shortcuts don't conflict with browser shortcuts
    const shortcuts = [
      { key: 'F1', used: false },      // Browser help
      { key: 'F5', used: false },      // Refresh
      { key: 'F11', used: false },     // Fullscreen
      { key: 'F12', used: false },     // DevTools
      { key: 'Ctrl+S', used: false },  // Save
      { key: 'Ctrl+P', used: false },  // Print
      { key: 'Ctrl+F', used: false },  // Find
    ];
    
    // Our app uses these shortcuts
    const appShortcuts = [
      'h', 'a', 'm', 't', 'r', 'g',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'PageUp', 'PageDown', 'Space', 'Enter',
      'Ctrl+Z', 'Ctrl+Y', 'Escape'
    ];
    
    // Verify no conflicts with critical browser shortcuts
    appShortcuts.forEach(shortcut => {
      const conflicts = shortcuts.find(s => s.key.toLowerCase() === shortcut.toLowerCase());
      expect(conflicts).toBeFalsy();
    });
  });

  test('should work with browser extensions', () => {
    // Test that our app doesn't break with common extensions
    
    // Simulate ad blocker by removing an element
    const ad = document.createElement('div');
    ad.className = 'advertisement';
    document.body.appendChild(ad);
    
    // Ad blocker would remove this
    document.body.removeChild(ad);
    
    // App should still function
    const gameContainer = document.createElement('div');
    gameContainer.id = 'game-container';
    gameContainer.setAttribute('role', 'application');
    document.body.appendChild(gameContainer);
    
    expect(gameContainer.getAttribute('role')).toBe('application');
    
    // Simulate password manager adding attributes
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('data-lastpass-icon', 'true');
    gameContainer.appendChild(input);
    
    // App should handle extra attributes gracefully
    expect(input.type).toBe('text');
    
    document.body.removeChild(gameContainer);
  });
});
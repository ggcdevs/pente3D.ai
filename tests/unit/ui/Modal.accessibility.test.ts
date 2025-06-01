import { Modal } from '@/ui/Modal';

// Create a concrete implementation for testing
class TestModal extends Modal {
  protected render(): void {
    const content = document.createElement('div');
    content.innerHTML = `
      <p>Test modal content</p>
      <button id="test-button">Test Button</button>
      <input type="text" id="test-input" placeholder="Test Input">
      <a href="#" id="test-link">Test Link</a>
    `;
    this.setContent(content);
  }
  
  public getContainer() {
    return this.container;
  }
}

describe('Modal - ARIA Attributes', () => {
  let modal: TestModal;

  beforeEach(() => {
    modal = new TestModal({ title: 'Test Modal' });
  });

  afterEach(() => {
    modal.destroy();
    document.body.innerHTML = '';
  });

  test('should have role="dialog"', () => {
    modal.open();
    const container = modal.getContainer();
    expect(container.getAttribute('role')).toBe('dialog');
  });

  test('should have aria-modal="true"', () => {
    modal.open();
    const container = modal.getContainer();
    expect(container.getAttribute('aria-modal')).toBe('true');
  });

  test('should have aria-labelledby pointing to title', () => {
    modal.open();
    const container = modal.getContainer();
    const labelledBy = container.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    
    const titleElement = document.getElementById(labelledBy!);
    expect(titleElement?.textContent).toBe('Test Modal');
  });

  test('should have aria-describedby for content', () => {
    modal.open();
    const container = modal.getContainer();
    const describedBy = container.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    
    const contentElement = document.getElementById(describedBy!);
    expect(contentElement).toBeTruthy();
  });

  test('should announce modal opening', () => {
    const element = (modal as any).element;
    expect(element.getAttribute('aria-live')).toBe('assertive');
    expect(element.getAttribute('aria-atomic')).toBe('true');
  });

  test('should maintain proper heading hierarchy', () => {
    modal.open();
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    
    // Modal title should be h2
    const modalTitle = Array.from(headings).find(h => h.textContent === 'Test Modal');
    expect(modalTitle?.tagName).toBe('H2');
  });
});

describe('Modal - Focus Management', () => {
  let modal: TestModal;

  beforeEach(() => {
    modal = new TestModal({ 
      title: 'Test Modal',
      focusFirst: true 
    });
  });

  afterEach(() => {
    modal.destroy();
  });

  test('should focus first focusable element on open', () => {
    modal.open();
    
    // Wait for focus to be set
    setTimeout(() => {
      const focusedElement = document.activeElement;
      expect(focusedElement?.id).toBe('test-button');
    }, 100);
  });

  test('should trap focus within modal', () => {
    modal.open();
    
    const tabEvent = new KeyboardEvent('keydown', { 
      key: 'Tab',
      bubbles: true
    });
    
    // Focus should cycle within modal
    const button = document.getElementById('test-button');
    const input = document.getElementById('test-input');
    const link = document.getElementById('test-link');
    
    button?.focus();
    button?.dispatchEvent(tabEvent);
    
    // Should move to next focusable element
    expect(['test-input', 'test-link', 'modal-close']).toContain(document.activeElement?.id);
  });

  test('should handle Tab cycling', () => {
    modal.open();
    (modal as any).updateFocusableElements();
    
    const focusableElements = (modal as any).focusableElements;
    expect(focusableElements.length).toBeGreaterThan(0);
    
    // Test forward cycling
    (modal as any).currentFocusIndex = focusableElements.length - 1;
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab' });
    (modal as any).handleTab(tabEvent);
    
    expect((modal as any).currentFocusIndex).toBe(0);
  });

  test('should handle Shift+Tab reverse cycling', () => {
    modal.open();
    (modal as any).updateFocusableElements();
    
    // Test reverse cycling
    (modal as any).currentFocusIndex = 0;
    const shiftTabEvent = new KeyboardEvent('keydown', { 
      key: 'Tab',
      shiftKey: true 
    });
    (modal as any).handleTab(shiftTabEvent);
    
    expect((modal as any).currentFocusIndex).toBe((modal as any).focusableElements.length - 1);
  });

  test('should restore focus on close', () => {
    const button = document.createElement('button');
    button.id = 'external-button';
    document.body.appendChild(button);
    button.focus();
    
    modal.open();
    expect(document.activeElement).not.toBe(button);
    
    modal.close();
    setTimeout(() => {
      expect(document.activeElement).toBe(button);
    }, 300);
  });

  test('should handle no focusable elements', () => {
    const emptyModal = new class extends Modal {
      protected render(): void {
        this.setContent('<div>No focusable content</div>');
      }
    }();
    
    emptyModal.open();
    (emptyModal as any).updateFocusableElements();
    
    expect((emptyModal as any).focusableElements.length).toBe(1); // Close button only
    
    emptyModal.destroy();
  });

  test('should skip disabled elements', () => {
    modal.open();
    
    // Add disabled button
    const disabledButton = document.createElement('button');
    disabledButton.disabled = true;
    disabledButton.id = 'disabled-button';
    modal['content'].appendChild(disabledButton);
    
    (modal as any).updateFocusableElements();
    const focusableElements = (modal as any).focusableElements;
    
    const hasDisabled = focusableElements.some((el: HTMLElement) => el.id === 'disabled-button');
    expect(hasDisabled).toBe(false);
  });

  test('should handle dynamic content changes', () => {
    modal.open();
    const initialCount = (modal as any).focusableElements.length;
    
    // Add new button
    const newButton = document.createElement('button');
    newButton.id = 'new-button';
    newButton.textContent = 'New Button';
    modal['content'].appendChild(newButton);
    
    // Update focusable elements
    modal.setContent(modal['content']);
    
    const newCount = (modal as any).focusableElements.length;
    expect(newCount).toBe(initialCount + 1);
  });
});
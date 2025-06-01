import { Modal, ModalOptions } from '../../../src/ui/Modal';

// Test implementation of Modal since it's abstract
class TestModal extends Modal {
  public renderCalled = false;
  public contentToRender = 'Test Content';

  protected render(): void {
    this.renderCalled = true;
    this.setContent(this.contentToRender);
  }

  // Expose protected methods for testing
  public testSetContent(content: string | HTMLElement): void {
    this.setContent(content);
  }

  public testSetFooter(content: string | HTMLElement): void {
    this.setFooter(content);
  }

  public testUpdateFocusableElements(): void {
    this.updateFocusableElements();
  }

  public getFocusableElements(): HTMLElement[] {
    return this.focusableElements;
  }

  public getCurrentFocusIndex(): number {
    return this.currentFocusIndex;
  }
}

describe('Modal', () => {
  let modal: TestModal;
  let originalQuerySelector: typeof document.querySelector;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    modal = new TestModal();
  });

  afterEach(() => {
    modal.destroy();
    // Clean up any remaining modals
    document.querySelectorAll('.modal').forEach(el => el.remove());
  });

  describe('constructor', () => {
    it('should create modal with default options', () => {
      const modal = new TestModal();
      expect(modal).toBeDefined();
      expect((modal as any).options.closeOnBackdrop).toBe(true);
      expect((modal as any).options.closeOnEscape).toBe(true);
      expect((modal as any).options.focusFirst).toBe(true);
      expect((modal as any).options.showCloseButton).toBe(true);
      expect((modal as any).options.animationDuration).toBe(200);
    });

    it('should create modal with custom options', () => {
      const options: ModalOptions = {
        title: 'Custom Title',
        className: 'custom-modal',
        closeOnBackdrop: false,
        closeOnEscape: false,
        focusFirst: false,
        showCloseButton: false,
        animationDuration: 500
      };
      const modal = new TestModal(options);
      expect((modal as any).options.title).toBe('Custom Title');
      expect((modal as any).options.className).toBe('custom-modal');
      expect((modal as any).options.closeOnBackdrop).toBe(false);
      expect((modal as any).options.closeOnEscape).toBe(false);
      expect((modal as any).options.focusFirst).toBe(false);
      expect((modal as any).options.showCloseButton).toBe(false);
      expect((modal as any).options.animationDuration).toBe(500);
    });
  });

  describe('DOM structure', () => {
    it('should create proper DOM structure', () => {
      const modal = new TestModal({ title: 'Test Modal' });
      const element = (modal as any).element as HTMLDivElement;
      
      expect(element.className).toContain('modal');
      expect(element.style.display).toBe('none');
      expect(element.style.position).toBe('fixed');
      
      const backdrop = element.querySelector('.modal-backdrop');
      expect(backdrop).toBeDefined();
      
      const container = element.querySelector('.modal-container');
      expect(container).toBeDefined();
      
      const header = element.querySelector('.modal-header');
      expect(header).toBeDefined();
      
      const title = element.querySelector('.modal-title');
      expect(title?.textContent).toBe('Test Modal');
      
      const closeButton = element.querySelector('.modal-close');
      expect(closeButton).toBeDefined();
    });

    it('should not show close button when disabled', () => {
      const modal = new TestModal({ showCloseButton: false });
      const element = (modal as any).element as HTMLDivElement;
      const closeButton = element.querySelector('.modal-close');
      expect(closeButton).toBeNull();
    });

    it('should not show title when not provided', () => {
      const modal = new TestModal();
      const element = (modal as any).element as HTMLDivElement;
      const title = element.querySelector('.modal-title');
      expect(title).toBeNull();
    });
  });

  describe('open', () => {
    it('should open modal and call render', () => {
      modal.open();
      expect(modal.renderCalled).toBe(true);
      expect((modal as any).isOpen).toBe(true);
      expect(document.body.contains((modal as any).element)).toBe(true);
    });

    it('should not open if already open', () => {
      modal.open();
      modal.renderCalled = false;
      modal.open();
      expect(modal.renderCalled).toBe(false);
    });

    it('should save previous focus', () => {
      const button = document.createElement('button');
      document.body.appendChild(button);
      button.focus();
      
      modal.open();
      expect((modal as any).previousFocus).toBe(button);
    });

    it('should emit open event', (done) => {
      modal.on('open', () => {
        done();
      });
      modal.open();
    });

    it('should add keyboard event listeners', () => {
      const addEventListenerSpy = jest.spyOn(document, 'addEventListener');
      modal.open();
      expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });
  });

  describe('close', () => {
    beforeEach(() => {
      modal.open();
    });

    it('should close modal', (done) => {
      modal.close();
      expect((modal as any).isOpen).toBe(false);
      
      setTimeout(() => {
        expect(document.body.contains((modal as any).element)).toBe(false);
        done();
      }, 250);
    });

    it('should not close if already closed', () => {
      modal.close();
      const removeEventListenerSpy = jest.spyOn(document, 'removeEventListener');
      modal.close();
      expect(removeEventListenerSpy).not.toHaveBeenCalled();
    });

    it('should restore previous focus', (done) => {
      const button = document.createElement('button');
      document.body.appendChild(button);
      button.focus();
      
      modal.open();
      modal.close();
      
      setTimeout(() => {
        expect(document.activeElement).toBe(button);
        done();
      }, 250);
    });

    it('should emit close event', (done) => {
      modal.on('close', () => {
        done();
      });
      modal.close();
    });

    it('should remove keyboard event listeners', () => {
      const removeEventListenerSpy = jest.spyOn(document, 'removeEventListener');
      modal.close();
      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });
  });

  describe('toggle', () => {
    it('should open when closed', () => {
      expect((modal as any).isOpen).toBe(false);
      modal.toggle();
      expect((modal as any).isOpen).toBe(true);
    });

    it('should close when open', () => {
      modal.open();
      expect((modal as any).isOpen).toBe(true);
      modal.toggle();
      expect((modal as any).isOpen).toBe(false);
    });
  });

  describe('setTitle', () => {
    it('should update existing title', () => {
      const modal = new TestModal({ title: 'Original Title' });
      modal.setTitle('New Title');
      
      const title = (modal as any).element.querySelector('.modal-title');
      expect(title?.textContent).toBe('New Title');
    });

    it('should create title if none exists', () => {
      modal.setTitle('New Title');
      
      const title = (modal as any).element.querySelector('.modal-title');
      expect(title?.textContent).toBe('New Title');
    });
  });

  describe('content management', () => {
    it('should set string content', () => {
      modal.testSetContent('<p>Test Content</p>');
      const content = (modal as any).content as HTMLDivElement;
      expect(content.innerHTML).toBe('<p>Test Content</p>');
    });

    it('should set element content', () => {
      const div = document.createElement('div');
      div.textContent = 'Test Element';
      modal.testSetContent(div);
      
      const content = (modal as any).content as HTMLDivElement;
      expect(content.firstChild).toBe(div);
    });

    it('should set footer content', () => {
      modal.testSetFooter('<button>OK</button>');
      const footer = (modal as any).footer as HTMLDivElement;
      expect(footer.innerHTML).toBe('<button>OK</button>');
      expect(footer.style.display).toBe('block');
    });

    it('should hide footer when empty', () => {
      modal.testSetFooter('');
      const footer = (modal as any).footer as HTMLDivElement;
      expect(footer.style.display).toBe('none');
    });
  });

  describe('backdrop interaction', () => {
    it('should close on backdrop click when enabled', () => {
      modal.open();
      const backdrop = (modal as any).backdrop as HTMLDivElement;
      backdrop.click();
      expect((modal as any).isOpen).toBe(false);
    });

    it('should not close on backdrop click when disabled', () => {
      const modal = new TestModal({ closeOnBackdrop: false });
      modal.open();
      const backdrop = (modal as any).backdrop as HTMLDivElement;
      backdrop.click();
      expect((modal as any).isOpen).toBe(true);
    });

    it('should not close on container click', () => {
      modal.open();
      const container = (modal as any).container as HTMLDivElement;
      container.click();
      expect((modal as any).isOpen).toBe(true);
    });
  });

  describe('keyboard interaction', () => {
    it('should close on Escape when enabled', () => {
      modal.open();
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);
      expect((modal as any).isOpen).toBe(false);
    });

    it('should not close on Escape when disabled', () => {
      const modal = new TestModal({ closeOnEscape: false });
      modal.open();
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);
      expect((modal as any).isOpen).toBe(true);
    });

    it('should handle Tab navigation', () => {
      modal.open();
      
      // Add focusable elements
      const button1 = document.createElement('button');
      const button2 = document.createElement('button');
      (modal as any).content.appendChild(button1);
      (modal as any).content.appendChild(button2);
      modal.testUpdateFocusableElements();
      
      expect(modal.getFocusableElements().length).toBeGreaterThan(0);
      
      // Simulate Tab press
      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab' });
      document.dispatchEvent(tabEvent);
      
      expect(modal.getCurrentFocusIndex()).toBe(1);
    });

    it('should handle Shift+Tab navigation', () => {
      modal.open();
      
      // Add focusable elements
      const button1 = document.createElement('button');
      const button2 = document.createElement('button');
      (modal as any).content.appendChild(button1);
      (modal as any).content.appendChild(button2);
      modal.testUpdateFocusableElements();
      
      // Simulate Shift+Tab press
      const shiftTabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true });
      document.dispatchEvent(shiftTabEvent);
      
      expect(modal.getCurrentFocusIndex()).toBe(modal.getFocusableElements().length - 1);
    });
  });

  describe('accessibility', () => {
    it('should have proper ARIA attributes', () => {
      const modal = new TestModal({ title: 'Accessible Modal' });
      const element = (modal as any).element as HTMLDivElement;
      
      expect(element.getAttribute('role')).toBe('dialog');
      expect(element.getAttribute('aria-modal')).toBe('true');
      expect(element.getAttribute('aria-labelledby')).toBe('modal-title');
    });

    it('should update focusable elements when content changes', () => {
      modal.open();
      expect(modal.getFocusableElements().length).toBeGreaterThan(0);
      
      const button = document.createElement('button');
      (modal as any).content.appendChild(button);
      modal.testUpdateFocusableElements();
      
      const newCount = modal.getFocusableElements().length;
      expect(newCount).toBeGreaterThan(1);
    });

    it('should not include disabled elements in focusable list', () => {
      modal.open();
      
      const enabledButton = document.createElement('button');
      const disabledButton = document.createElement('button');
      disabledButton.disabled = true;
      
      (modal as any).content.appendChild(enabledButton);
      (modal as any).content.appendChild(disabledButton);
      modal.testUpdateFocusableElements();
      
      const focusableElements = modal.getFocusableElements();
      expect(focusableElements).toContain(enabledButton);
      expect(focusableElements).not.toContain(disabledButton);
    });
  });

  describe('animations', () => {
    it('should apply animation styles', () => {
      const modal = new TestModal({ animationDuration: 300 });
      const backdrop = (modal as any).backdrop as HTMLDivElement;
      const container = (modal as any).container as HTMLDivElement;
      
      expect(backdrop.style.transition).toContain('300ms');
      expect(container.style.transition).toContain('300ms');
    });
  });

  describe('destroy', () => {
    it('should close modal and remove listeners', () => {
      modal.open();
      const removeAllListenersSpy = jest.spyOn(modal, 'removeAllListeners');
      
      modal.destroy();
      
      expect((modal as any).isOpen).toBe(false);
      expect(removeAllListenersSpy).toHaveBeenCalled();
    });
  });
});
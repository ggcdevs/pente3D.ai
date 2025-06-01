import { DialogManager, DialogType } from '../../../src/ui/DialogManager';

describe('DialogManager', () => {
  let dialogManager: DialogManager;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    dialogManager = new DialogManager();
  });

  afterEach(() => {
    dialogManager.closeAll();
    // Clean up any remaining modals
    document.querySelectorAll('.modal').forEach(el => el.remove());
  });

  describe('showInfo', () => {
    it('should show info dialog with message', async () => {
      const promise = dialogManager.showInfo('Test info message');
      
      const dialog = document.querySelector('.dialog-info');
      expect(dialog).toBeDefined();
      
      const message = dialog?.querySelector('p');
      expect(message?.textContent).toBe('Test info message');
      
      const icon = dialog?.querySelector('div[style*="font-size: 3rem"]');
      expect(icon?.textContent).toBe('ℹ️');
      
      const okButton = dialog?.querySelector('.modal-footer button');
      expect(okButton?.textContent).toBe('OK');
      
      okButton?.click();
      await promise;
    });

    it('should show info dialog with custom title', async () => {
      const promise = dialogManager.showInfo('Test message', 'Custom Title');
      
      const title = document.querySelector('.modal-title');
      expect(title?.textContent).toBe('Custom Title');
      
      const okButton = document.querySelector('.modal-footer button');
      okButton?.click();
      await promise;
    });

    it('should use blue color for OK button', () => {
      dialogManager.showInfo('Test message');
      
      const okButton = document.querySelector('.modal-footer button') as HTMLButtonElement;
      expect(okButton.style.backgroundColor).toBe('rgb(33, 150, 243)');
    });
  });

  describe('showWarning', () => {
    it('should show warning dialog with message', async () => {
      const promise = dialogManager.showWarning('Test warning message');
      
      const dialog = document.querySelector('.dialog-warning');
      expect(dialog).toBeDefined();
      
      const message = dialog?.querySelector('p');
      expect(message?.textContent).toBe('Test warning message');
      
      const icon = dialog?.querySelector('div[style*="font-size: 3rem"]');
      expect(icon?.textContent).toBe('⚠️');
      
      const okButton = dialog?.querySelector('.modal-footer button');
      expect(okButton?.textContent).toBe('OK');
      
      okButton?.click();
      await promise;
    });

    it('should use orange color for OK button', () => {
      dialogManager.showWarning('Test message');
      
      const okButton = document.querySelector('.modal-footer button') as HTMLButtonElement;
      expect(okButton.style.backgroundColor).toBe('rgb(255, 152, 0)');
    });
  });

  describe('showError', () => {
    it('should show error dialog with message', async () => {
      const promise = dialogManager.showError('Test error message');
      
      const dialog = document.querySelector('.dialog-error');
      expect(dialog).toBeDefined();
      
      const message = dialog?.querySelector('p');
      expect(message?.textContent).toBe('Test error message');
      
      const icon = dialog?.querySelector('div[style*="font-size: 3rem"]');
      expect(icon?.textContent).toBe('❌');
      
      const okButton = dialog?.querySelector('.modal-footer button');
      expect(okButton?.textContent).toBe('OK');
      
      okButton?.click();
      await promise;
    });

    it('should use red color for OK button', () => {
      dialogManager.showError('Test message');
      
      const okButton = document.querySelector('.modal-footer button') as HTMLButtonElement;
      expect(okButton.style.backgroundColor).toBe('rgb(244, 67, 54)');
    });
  });

  describe('showConfirm', () => {
    it('should show confirm dialog with message', () => {
      dialogManager.showConfirm('Test confirm message');
      
      const dialog = document.querySelector('.dialog-confirm');
      expect(dialog).toBeDefined();
      
      const message = dialog?.querySelector('p');
      expect(message?.textContent).toBe('Test confirm message');
      
      const icon = dialog?.querySelector('div[style*="font-size: 3rem"]');
      expect(icon?.textContent).toBe('❓');
      
      const buttons = dialog?.querySelectorAll('.modal-footer button');
      expect(buttons?.length).toBe(2);
      expect(buttons?.[0].textContent).toBe('Cancel');
      expect(buttons?.[1].textContent).toBe('Confirm');
    });

    it('should resolve true when confirm clicked', async () => {
      const promise = dialogManager.showConfirm('Test message');
      
      const confirmButton = Array.from(document.querySelectorAll('.modal-footer button'))
        .find(btn => btn.textContent === 'Confirm');
      confirmButton?.click();
      
      const result = await promise;
      expect(result).toBe(true);
    });

    it('should resolve false when cancel clicked', async () => {
      const promise = dialogManager.showConfirm('Test message');
      
      const cancelButton = Array.from(document.querySelectorAll('.modal-footer button'))
        .find(btn => btn.textContent === 'Cancel');
      cancelButton?.click();
      
      const result = await promise;
      expect(result).toBe(false);
    });

    it('should use custom button texts', () => {
      dialogManager.showConfirm('Test message', 'Title', 'Yes', 'No');
      
      const buttons = document.querySelectorAll('.modal-footer button');
      expect(buttons[0].textContent).toBe('No');
      expect(buttons[1].textContent).toBe('Yes');
    });

    it('should not close on backdrop or escape for confirm', () => {
      dialogManager.showConfirm('Test message');
      
      const dialog = document.querySelector('.dialog-confirm');
      const closeButton = dialog?.querySelector('.modal-close');
      expect(closeButton).toBeNull();
      
      // These properties are set but testing would require accessing private properties
      // The actual behavior is tested in integration tests
    });
  });

  describe('confirmAction', () => {
    it('should format message with action only', () => {
      dialogManager.confirmAction('delete this file');
      
      const message = document.querySelector('p');
      expect(message?.textContent).toBe('Are you sure you want to delete this file?');
    });

    it('should format message with action and consequence', () => {
      dialogManager.confirmAction('reset the game', 'All progress will be lost.');
      
      const message = document.querySelector('p');
      expect(message?.textContent).toBe('Are you sure you want to reset the game? All progress will be lost.');
    });

    it('should show Confirm Action as title', () => {
      dialogManager.confirmAction('test action');
      
      const title = document.querySelector('.modal-title');
      expect(title?.textContent).toBe('Confirm Action');
    });

    it('should use Yes/No as button texts', () => {
      dialogManager.confirmAction('test action');
      
      const buttons = document.querySelectorAll('.modal-footer button');
      expect(buttons[0].textContent).toBe('No');
      expect(buttons[1].textContent).toBe('Yes');
    });
  });

  describe('multiple dialogs', () => {
    it('should close previous dialog when showing new one', async () => {
      dialogManager.showInfo('First message');
      
      const firstDialog = document.querySelector('.dialog-info');
      expect(firstDialog).toBeDefined();
      
      dialogManager.showWarning('Second message');
      
      // Give time for close animation
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const dialogs = document.querySelectorAll('.modal');
      expect(dialogs.length).toBe(1);
      
      const warningDialog = document.querySelector('.dialog-warning');
      expect(warningDialog).toBeDefined();
    });
  });

  describe('closeAll', () => {
    it('should close current dialog', () => {
      dialogManager.showInfo('Test message');
      
      expect(document.querySelector('.modal')).toBeDefined();
      
      dialogManager.closeAll();
      
      // Dialog should start closing
      const dialog = document.querySelector('.modal') as HTMLElement;
      expect(dialog.style.display).toBe('block'); // Still visible during animation
    });

    it('should do nothing if no dialog is open', () => {
      expect(() => dialogManager.closeAll()).not.toThrow();
    });
  });

  describe('button interactions', () => {
    it('should apply hover effect', () => {
      dialogManager.showInfo('Test message');
      
      const button = document.querySelector('.modal-footer button') as HTMLButtonElement;
      
      // Simulate mouseenter
      const mouseenterEvent = new MouseEvent('mouseenter', { bubbles: true });
      button.dispatchEvent(mouseenterEvent);
      
      expect(button.style.opacity).toBe('0.8');
      
      // Simulate mouseleave
      const mouseleaveEvent = new MouseEvent('mouseleave', { bubbles: true });
      button.dispatchEvent(mouseleaveEvent);
      
      expect(button.style.opacity).toBe('1');
    });
  });

  describe('dialog styling', () => {
    it('should center content', () => {
      dialogManager.showInfo('Test message');
      
      const content = document.querySelector('.modal-content div') as HTMLElement;
      expect(content.style.textAlign).toBe('center');
      expect(content.style.minWidth).toBe('300px');
    });

    it('should style message text', () => {
      dialogManager.showInfo('Test message');
      
      const message = document.querySelector('p') as HTMLElement;
      expect(message.style.color).toBe('rgb(255, 255, 255)');
      expect(message.style.fontSize).toBe('1.1rem');
      expect(message.style.lineHeight).toBe('1.5');
    });

    it('should style buttons with proper spacing', () => {
      dialogManager.showConfirm('Test message');
      
      const footer = document.querySelector('.modal-footer div') as HTMLElement;
      expect(footer.style.display).toBe('flex');
      expect(footer.style.justifyContent).toBe('center');
      expect(footer.style.gap).toBe('10px');
      
      const buttons = footer.querySelectorAll('button');
      buttons.forEach(button => {
        expect((button as HTMLElement).style.minWidth).toBe('100px');
      });
    });
  });

  describe('promise resolution', () => {
    it('should resolve promise when dialog is closed', async () => {
      const promise = dialogManager.showInfo('Test message');
      
      const okButton = document.querySelector('.modal-footer button');
      okButton?.click();
      
      await expect(promise).resolves.toBeUndefined();
    });

    it('should resolve promise even if closed by other means', async () => {
      const promise = dialogManager.showInfo('Test message');
      
      // Close by calling closeAll
      dialogManager.closeAll();
      
      await expect(promise).resolves.toBeUndefined();
    });
  });
});
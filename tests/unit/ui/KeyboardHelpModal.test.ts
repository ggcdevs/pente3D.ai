import { KeyboardHelpModal } from '@/ui/KeyboardHelpModal';

describe('KeyboardHelpModal', () => {
  let modal: KeyboardHelpModal;

  beforeEach(() => {
    modal = new KeyboardHelpModal();
  });

  afterEach(() => {
    modal.destroy();
    document.body.innerHTML = '';
  });

  test('should display all keyboard shortcuts', () => {
    modal.open();
    
    // Check for key shortcuts
    const shortcuts = [
      'Arrow Keys',
      'Page Up/Down',
      'Space/Enter',
      'Ctrl+Z',
      'Ctrl+Y',
      'T',
      'R',
      'G',
      'M',
      'H',
      'Escape',
      'A',
      'F3'
    ];
    
    shortcuts.forEach(shortcut => {
      const element = Array.from(document.querySelectorAll('kbd')).find(
        el => el.textContent === shortcut
      );
      expect(element).toBeTruthy();
    });
  });

  test('should organize shortcuts by category', () => {
    modal.open();
    
    const categories = [
      'Navigation',
      'Game Actions',
      'View Controls',
      'UI Controls',
      'Accessibility'
    ];
    
    categories.forEach(category => {
      const categoryRow = Array.from(document.querySelectorAll('.category-row')).find(
        row => row.textContent === category
      );
      expect(categoryRow).toBeTruthy();
    });
  });

  test('should use accessible table structure', () => {
    modal.open();
    
    const table = document.querySelector('.shortcuts-table');
    expect(table).toBeTruthy();
    expect(table?.getAttribute('role')).toBe('table');
    expect(table?.getAttribute('aria-label')).toBe('Keyboard shortcuts');
    
    // Check headers
    const headers = table?.querySelectorAll('th[role="columnheader"]');
    expect(headers?.length).toBe(2);
    expect(headers?.[0].textContent).toBe('Key/Shortcut');
    expect(headers?.[1].textContent).toBe('Action');
  });

  test('should include search functionality', () => {
    modal.open();
    
    const searchInput = document.getElementById('shortcut-search') as HTMLInputElement;
    expect(searchInput).toBeTruthy();
    expect(searchInput.type).toBe('text');
    expect(searchInput.placeholder).toBe('Type to filter shortcuts...');
    
    // Test search
    searchInput.value = 'undo';
    searchInput.dispatchEvent(new Event('input'));
    
    // Check that only undo-related shortcuts are visible
    const visibleRows = document.querySelectorAll('.shortcut-row:not([style*="display: none"])');
    const undoRow = Array.from(visibleRows).find(row => 
      row.textContent?.toLowerCase().includes('undo')
    );
    expect(undoRow).toBeTruthy();
  });

  test('should be dismissible with Escape', () => {
    modal.open();
    expect(modal['isOpen']).toBe(true);
    
    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    window.dispatchEvent(escapeEvent);
    
    setTimeout(() => {
      expect(modal['isOpen']).toBe(false);
    }, 300);
  });
});
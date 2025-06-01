import { Modal } from './Modal';

interface KeyboardShortcut {
  key: string;
  action: string;
  category?: string;
}

export class KeyboardHelpModal extends Modal {
  private shortcuts: KeyboardShortcut[] = [
    // Board Navigation
    { key: 'Arrow Keys', action: 'Navigate board horizontally (X-Y plane)', category: 'Navigation' },
    { key: 'Page Up/Down', action: 'Navigate board vertically (Z axis)', category: 'Navigation' },
    { key: 'Shift + Arrows', action: 'Fast navigation', category: 'Navigation' },
    { key: 'Tab', action: 'Navigate UI elements', category: 'Navigation' },
    
    // Game Actions
    { key: 'Space/Enter', action: 'Place piece at current position', category: 'Game Actions' },
    { key: 'T', action: 'Toggle temporary piece mode', category: 'Game Actions' },
    { key: 'Ctrl+Z', action: 'Undo last move', category: 'Game Actions' },
    { key: 'Ctrl+Y', action: 'Redo move', category: 'Game Actions' },
    { key: 'Ctrl+Shift+Z', action: 'Redo move (alternative)', category: 'Game Actions' },
    
    // View Controls
    { key: 'R', action: 'Reset camera view', category: 'View Controls' },
    { key: 'G', action: 'Toggle grid visibility', category: 'View Controls' },
    { key: 'Mouse Drag', action: 'Rotate camera', category: 'View Controls' },
    { key: 'Mouse Wheel', action: 'Zoom in/out', category: 'View Controls' },
    
    // UI Controls
    { key: 'M', action: 'Open menu', category: 'UI Controls' },
    { key: 'H', action: 'Show this help', category: 'UI Controls' },
    { key: 'Escape', action: 'Close dialog/Cancel action', category: 'UI Controls' },
    
    // Accessibility
    { key: 'A', action: 'Announce current game state', category: 'Accessibility' },
    { key: 'F3', action: 'Toggle performance stats (dev mode)', category: 'Accessibility' },
  ];
  
  constructor() {
    super({
      title: 'Keyboard Shortcuts',
      className: 'keyboard-help-modal',
      closeOnBackdrop: true,
      closeOnEscape: true
    });
    
    this.render();
  }
  
  protected render(): void {
    
    const container = document.createElement('div');
    container.className = 'keyboard-shortcuts-container';
    container.style.maxWidth = '600px';
    
    // Create search input
    const searchContainer = this.createSearchInput();
    container.appendChild(searchContainer);
    
    // Create shortcuts table
    const table = this.createShortcutsTable(this.shortcuts);
    container.appendChild(table);
    
    this.setContent(container);
    
    // Add footer with close button
    const footer = document.createElement('div');
    footer.style.textAlign = 'center';
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.className = 'modal-button primary';
    closeButton.style.padding = '10px 20px';
    closeButton.style.fontSize = '1rem';
    closeButton.style.backgroundColor = '#4a90e2';
    closeButton.style.color = '#fff';
    closeButton.style.border = 'none';
    closeButton.style.borderRadius = '4px';
    closeButton.style.cursor = 'pointer';
    closeButton.onclick = () => this.close();
    
    footer.appendChild(closeButton);
    this.setFooter(footer);
  }
  
  private createSearchInput(): HTMLElement {
    const container = document.createElement('div');
    container.style.marginBottom = '20px';
    
    const label = document.createElement('label');
    label.textContent = 'Search shortcuts:';
    label.setAttribute('for', 'shortcut-search');
    label.style.display = 'block';
    label.style.marginBottom = '5px';
    label.style.fontWeight = 'bold';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'shortcut-search';
    input.placeholder = 'Type to filter shortcuts...';
    input.style.width = '100%';
    input.style.padding = '8px';
    input.style.fontSize = '1rem';
    input.style.border = '1px solid #444';
    input.style.borderRadius = '4px';
    input.style.backgroundColor = '#333';
    input.style.color = '#fff';
    
    input.addEventListener('input', (e) => {
      const searchTerm = (e.target as HTMLInputElement).value.toLowerCase();
      this.filterShortcuts(searchTerm);
    });
    
    container.appendChild(label);
    container.appendChild(input);
    
    return container;
  }
  
  private createShortcutsTable(shortcuts: KeyboardShortcut[]): HTMLElement {
    const table = document.createElement('table');
    table.className = 'shortcuts-table';
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', 'Keyboard shortcuts');
    
    // Create table header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.setAttribute('role', 'row');
    
    const keyHeader = document.createElement('th');
    keyHeader.textContent = 'Key/Shortcut';
    keyHeader.style.textAlign = 'left';
    keyHeader.style.padding = '10px';
    keyHeader.style.borderBottom = '2px solid #444';
    keyHeader.style.fontWeight = 'bold';
    keyHeader.setAttribute('role', 'columnheader');
    keyHeader.setAttribute('scope', 'col');
    
    const actionHeader = document.createElement('th');
    actionHeader.textContent = 'Action';
    actionHeader.style.textAlign = 'left';
    actionHeader.style.padding = '10px';
    actionHeader.style.borderBottom = '2px solid #444';
    actionHeader.style.fontWeight = 'bold';
    actionHeader.setAttribute('role', 'columnheader');
    actionHeader.setAttribute('scope', 'col');
    
    headerRow.appendChild(keyHeader);
    headerRow.appendChild(actionHeader);
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Create table body
    const tbody = document.createElement('tbody');
    tbody.setAttribute('role', 'rowgroup');
    
    let currentCategory = '';
    shortcuts.forEach(shortcut => {
      // Add category row if new category
      if (shortcut.category && shortcut.category !== currentCategory) {
        currentCategory = shortcut.category;
        const categoryRow = document.createElement('tr');
        categoryRow.className = 'category-row';
        categoryRow.setAttribute('role', 'row');
        
        const categoryCell = document.createElement('td');
        categoryCell.colSpan = 2;
        categoryCell.textContent = currentCategory;
        categoryCell.style.padding = '15px 10px 5px';
        categoryCell.style.fontWeight = 'bold';
        categoryCell.style.fontSize = '1.1rem';
        categoryCell.style.color = '#4a90e2';
        categoryCell.setAttribute('role', 'cell');
        
        categoryRow.appendChild(categoryCell);
        tbody.appendChild(categoryRow);
      }
      
      // Add shortcut row
      const row = document.createElement('tr');
      row.className = 'shortcut-row';
      row.setAttribute('role', 'row');
      row.dataset.searchText = `${shortcut.key} ${shortcut.action}`.toLowerCase();
      
      const keyCell = document.createElement('td');
      keyCell.style.padding = '8px 10px';
      keyCell.style.borderBottom = '1px solid #333';
      keyCell.setAttribute('role', 'cell');
      
      const keyBadge = document.createElement('kbd');
      keyBadge.textContent = shortcut.key;
      keyBadge.style.padding = '3px 6px';
      keyBadge.style.backgroundColor = '#444';
      keyBadge.style.border = '1px solid #666';
      keyBadge.style.borderRadius = '3px';
      keyBadge.style.fontFamily = 'monospace';
      keyBadge.style.fontSize = '0.9rem';
      keyCell.appendChild(keyBadge);
      
      const actionCell = document.createElement('td');
      actionCell.textContent = shortcut.action;
      actionCell.style.padding = '8px 10px';
      actionCell.style.borderBottom = '1px solid #333';
      actionCell.style.color = '#ccc';
      actionCell.setAttribute('role', 'cell');
      
      row.appendChild(keyCell);
      row.appendChild(actionCell);
      tbody.appendChild(row);
    });
    
    table.appendChild(tbody);
    
    return table;
  }
  
  
  private filterShortcuts(searchTerm: string): void {
    const rows = this.content.querySelectorAll('.shortcut-row');
    const categoryRows = this.content.querySelectorAll('.category-row');
    
    if (!searchTerm) {
      // Show all rows
      rows.forEach(row => {
        (row as HTMLElement).style.display = '';
      });
      categoryRows.forEach(row => {
        (row as HTMLElement).style.display = '';
      });
      return;
    }
    
    // Hide all category rows during search
    categoryRows.forEach(row => {
      (row as HTMLElement).style.display = 'none';
    });
    
    // Filter shortcut rows
    rows.forEach(row => {
      const searchText = (row as HTMLElement).dataset.searchText || '';
      if (searchText.includes(searchTerm)) {
        (row as HTMLElement).style.display = '';
      } else {
        (row as HTMLElement).style.display = 'none';
      }
    });
  }
}
# Chunk 6.2: Accessibility & Keyboard Navigation - Development Guide

## Overview
This chunk implements comprehensive accessibility features to ensure the game is fully playable for users with disabilities, including complete keyboard navigation, screen reader support, and visual accessibility options.

## Components to Implement

### 1. AccessibilityManager Class
Location: `src/utils/AccessibilityManager.ts`

```typescript
import { EventEmitter } from './EventEmitter';
import { Game } from '../core/Game';
import { Vector3 } from '../core/Vector3';

export interface AccessibilityOptions {
  announceGameEvents: boolean;
  highContrastMode: boolean;
  reducedMotion: boolean;
  keyboardHelp: boolean;
}

export class AccessibilityManager extends EventEmitter {
  private game: Game;
  private options: AccessibilityOptions;
  private announcementQueue: string[];
  private currentFocus: Vector3 | null;
  private boardSize: number;
  
  constructor(game: Game);
  
  // Core methods
  announceGameEvent(event: string, details?: any): void;
  setHighContrastMode(enabled: boolean): void;
  setReducedMotion(enabled: boolean): void;
  toggleKeyboardHelp(): void;
  
  // Keyboard navigation
  moveFocus(direction: 'up' | 'down' | 'left' | 'right' | 'forward' | 'backward'): void;
  getCurrentFocusPosition(): Vector3 | null;
  selectCurrentPosition(): void;
  
  // Screen reader support
  announceCurrentPosition(): void;
  announceBoardState(): void;
  announceGameStatus(): void;
  announceAvailableMoves(): void;
  
  // Utility methods
  private createAnnouncement(message: string): void;
  private processAnnouncementQueue(): void;
  private positionToText(position: Vector3): string;
  dispose(): void;
}
```

Key features:
- Event-based game announcements
- Keyboard focus management for 3D board navigation
- Screen reader announcements with queuing
- High contrast and reduced motion support
- Keyboard help overlay system

### 2. Enhanced InputHandler for Keyboard Navigation
Extend `src/ui/InputHandler.ts`:

```typescript
// Additional keyboard controls
private setupAccessibilityKeyboardControls(): void {
  // Arrow keys for 2D navigation (X-Y plane)
  // Page Up/Down for Z-axis navigation
  // Space/Enter to place piece
  // Tab to cycle through UI elements
  // Escape to cancel/close
  // H for help overlay
  // A to announce current state
  // Shift+arrows for fast navigation
}

// Focus management
private handleFocusChange(position: Vector3): void;
private renderFocusIndicator(position: Vector3): void;
private updateFocusVisuals(): void;
```

### 3. ARIA Labels and Semantic HTML
Update `index.html` and dynamically created elements:

```html
<!-- Main game area -->
<main role="main" aria-label="3D Pente Game Board">
  <div id="game-container" role="application" aria-label="Game Board">
    <canvas id="game-canvas" 
            role="img" 
            aria-label="3D game visualization"
            tabindex="0">
    </canvas>
    
    <!-- Live region for announcements -->
    <div id="game-announcements" 
         class="sr-only" 
         role="status" 
         aria-live="polite" 
         aria-atomic="true">
    </div>
    
    <!-- Current position indicator -->
    <div id="position-indicator" 
         class="sr-only" 
         role="status" 
         aria-live="assertive">
    </div>
  </div>
  
  <!-- Skip links -->
  <nav class="skip-links">
    <a href="#game-canvas" class="skip-link">Skip to game board</a>
    <a href="#game-controls" class="skip-link">Skip to controls</a>
    <a href="#game-status" class="skip-link">Skip to game status</a>
  </nav>
</main>
```

### 4. Enhanced UI Components with Accessibility

#### Update Modal.ts for accessibility:
```typescript
protected setupAccessibility(): void {
  // Set role and aria attributes
  this.modalElement.setAttribute('role', 'dialog');
  this.modalElement.setAttribute('aria-modal', 'true');
  this.modalElement.setAttribute('aria-labelledby', `${this.modalElement.id}-title`);
  
  // Focus management
  this.trapFocus();
  this.restoreFocusOnClose();
  
  // Escape key handling
  this.handleEscapeKey();
}
```

#### Update all buttons and controls:
```typescript
private createAccessibleButton(text: string, action: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = text;
  button.setAttribute('aria-label', `${text} - ${action}`);
  button.setAttribute('role', 'button');
  
  // Add keyboard event handlers
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      button.click();
    }
  });
  
  return button;
}
```

### 5. High Contrast Mode Styles
Create `src/styles/high-contrast.css`:

```css
/* High contrast mode styles */
body.high-contrast {
  background: #000;
  color: #fff;
}

.high-contrast .modal {
  background: #000;
  border: 2px solid #fff;
  color: #fff;
}

.high-contrast button {
  background: #000;
  color: #fff;
  border: 2px solid #fff;
}

.high-contrast button:hover,
.high-contrast button:focus {
  background: #fff;
  color: #000;
}

.high-contrast .network-status {
  background: #000;
  border: 2px solid #fff;
}

/* Focus indicators */
.high-contrast *:focus {
  outline: 3px solid #ff0;
  outline-offset: 2px;
}

/* Disable animations in reduced motion */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 6. Keyboard Help Overlay
Create `src/ui/KeyboardHelpModal.ts`:

```typescript
export class KeyboardHelpModal extends Modal {
  constructor() {
    super('keyboard-help-modal');
  }
  
  protected getTitle(): string {
    return 'Keyboard Shortcuts';
  }
  
  protected setupContent(): void {
    const shortcuts = [
      { key: 'Arrow Keys', action: 'Navigate board (X-Y plane)' },
      { key: 'Page Up/Down', action: 'Navigate board (Z axis)' },
      { key: 'Space/Enter', action: 'Place piece at current position' },
      { key: 'T', action: 'Toggle temporary piece mode' },
      { key: 'Ctrl+Z', action: 'Undo last move' },
      { key: 'Ctrl+Y', action: 'Redo move' },
      { key: 'R', action: 'Reset camera view' },
      { key: 'G', action: 'Toggle grid visibility' },
      { key: 'H', action: 'Show this help' },
      { key: 'A', action: 'Announce current game state' },
      { key: 'M', action: 'Open menu' },
      { key: 'Escape', action: 'Close dialog/cancel action' },
      { key: 'Tab', action: 'Navigate UI elements' },
      { key: 'Shift+Arrows', action: 'Fast navigation' }
    ];
    
    // Create accessible table
    const table = this.createShortcutsTable(shortcuts);
    this.contentElement.appendChild(table);
  }
  
  private createShortcutsTable(shortcuts: Array<{key: string, action: string}>): HTMLElement {
    // Implementation with proper ARIA labels
  }
}
```

### 7. Screen Reader Announcements
Enhance game events with announcements:

```typescript
// In Game class
private announceMove(move: Move): void {
  const position = this.accessibilityManager.positionToText(move.position);
  const player = move.playerId === 'player1' ? 'Black' : 'White';
  const captures = move.captures.length;
  
  let announcement = `${player} placed piece at ${position}`;
  if (captures > 0) {
    announcement += `, capturing ${captures} piece${captures > 1 ? 's' : ''}`;
  }
  
  this.accessibilityManager.announceGameEvent('move', announcement);
}

private announceWin(winner: Player, result: WinResult): void {
  const player = winner.id === 'player1' ? 'Black' : 'White';
  const reason = result.winType === 'line' ? 'five in a row' : 'captures';
  
  this.accessibilityManager.announceGameEvent('win', 
    `Game over! ${player} wins by ${reason}!`
  );
}
```

### 8. Update Main.ts for Accessibility
Add accessibility initialization:

```typescript
// In main.ts
const accessibilityManager = new AccessibilityManager(game);

// Listen for accessibility preferences
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
  accessibilityManager.setReducedMotion(e.matches);
  renderer.setReducedMotion(e.matches);
});

window.matchMedia('(prefers-contrast: high)').addEventListener('change', (e) => {
  accessibilityManager.setHighContrastMode(e.matches);
  document.body.classList.toggle('high-contrast', e.matches);
});

// Keyboard help
document.addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') {
    const helpModal = new KeyboardHelpModal();
    helpModal.show();
  }
});
```

## Implementation Order

1. **AccessibilityManager class** - Core accessibility coordination
2. **Update InputHandler** - Add comprehensive keyboard navigation
3. **Update HTML structure** - Add ARIA labels and semantic elements
4. **Update Modal system** - Enhance all modals with accessibility
5. **Create high contrast styles** - Visual accessibility support
6. **KeyboardHelpModal** - Help overlay for keyboard shortcuts
7. **Screen reader announcements** - Game event narration
8. **Update main.ts** - Wire everything together

## Key Accessibility Requirements

1. **WCAG 2.1 AA Compliance**:
   - Color contrast ratios of at least 4.5:1
   - All functionality available via keyboard
   - Clear focus indicators
   - Proper heading structure

2. **Keyboard Navigation**:
   - All interactive elements reachable via Tab
   - Arrow keys for spatial navigation
   - Escape to cancel/close
   - Enter/Space to activate

3. **Screen Reader Support**:
   - Meaningful alt text and ARIA labels
   - Live regions for dynamic updates
   - Proper semantic structure
   - Announcement queuing

4. **Visual Accessibility**:
   - High contrast mode support
   - Respect prefers-reduced-motion
   - Clear focus indicators
   - No reliance on color alone

5. **Focus Management**:
   - Logical tab order
   - Focus trapping in modals
   - Focus restoration after modal close
   - Visual focus indicators

## Integration Points

- **Game class**: Add announcement hooks for all game events
- **Renderer class**: Support for high contrast and reduced motion
- **InputHandler**: Extended keyboard controls and focus management
- **All UI components**: ARIA labels and keyboard support
- **Settings**: Accessibility preferences persistence

## Performance Considerations

- Announcement queuing to prevent overwhelming screen readers
- Efficient focus indicator rendering
- Minimal performance impact when features are disabled
- Lazy loading of help content

## Browser Compatibility

- Test with major screen readers: NVDA, JAWS, VoiceOver
- Ensure keyboard navigation works in all browsers
- Verify high contrast mode in Windows
- Test reduced motion preferences
# Accessibility and UX Improvements

## 1. Keyboard Navigation Enhancements

### 1.1 Complete Keyboard Support
**Problem**: Incomplete keyboard navigation for 3D space
**Solution**: Comprehensive keyboard navigation system

```typescript
// Enhanced keyboard navigation
class KeyboardNavigationEnhanced {
  private cursor: Vector3 = new Vector3(0, 0, 0);
  private layer: 'x' | 'y' | 'z' = 'x'; // Current navigation plane
  
  // Navigation commands
  private commands = {
    // Plane navigation
    'ArrowUp': () => this.moveCursor(0, 1, 0),
    'ArrowDown': () => this.moveCursor(0, -1, 0),
    'ArrowLeft': () => this.moveCursor(-1, 0, 0),
    'ArrowRight': () => this.moveCursor(1, 0, 0),
    
    // Depth navigation
    'PageUp': () => this.moveCursor(0, 0, 1),
    'PageDown': () => this.moveCursor(0, 0, -1),
    
    // Layer switching
    '1': () => this.setLayer('x'),
    '2': () => this.setLayer('y'),
    '3': () => this.setLayer('z'),
    
    // Quick jumps
    'Home': () => this.jumpToCorner('min'),
    'End': () => this.jumpToCorner('max'),
    'c': () => this.jumpToCenter(),
    
    // View controls
    'v': () => this.cycleViewAngle(),
    'f': () => this.focusOnCursor(),
  };
  
  // Visual feedback for current position
  private updateCursorVisual(): void {
    // Highlight current node
    this.highlightNode(this.cursor);
    
    // Show coordinate overlay
    this.showCoordinateHUD(this.cursor);
    
    // Announce position to screen reader
    this.announcePosition(this.cursor);
  }
  
  // Smart navigation helpers
  private findNextPiece(direction: 'forward' | 'backward'): Vector3 | null {
    const pieces = this.board.getAllPieces();
    // Navigate between existing pieces
    return this.findClosestInDirection(this.cursor, pieces, direction);
  }
  
  private findNextEmptySpace(): Vector3 | null {
    // Find nearest empty valid position
    const empty = this.board.getEmptyPositions();
    return this.findClosest(this.cursor, empty);
  }
}
```

### 1.2 Keyboard Shortcut System
```typescript
interface KeyboardShortcut {
  key: string;
  modifiers?: ('ctrl' | 'alt' | 'shift' | 'meta')[];
  description: string;
  category: string;
  action: () => void;
  enabled?: () => boolean;
}

class ShortcutManager {
  private shortcuts: Map<string, KeyboardShortcut> = new Map();
  
  register(shortcut: KeyboardShortcut): void {
    const key = this.getShortcutKey(shortcut);
    this.shortcuts.set(key, shortcut);
  }
  
  // Generate help documentation
  getHelpText(): Record<string, KeyboardShortcut[]> {
    const grouped: Record<string, KeyboardShortcut[]> = {};
    
    for (const shortcut of this.shortcuts.values()) {
      if (!grouped[shortcut.category]) {
        grouped[shortcut.category] = [];
      }
      grouped[shortcut.category].push(shortcut);
    }
    
    return grouped;
  }
  
  // Context-aware shortcuts
  handleKeyPress(event: KeyboardEvent): boolean {
    const key = this.getEventKey(event);
    const shortcut = this.shortcuts.get(key);
    
    if (shortcut && (!shortcut.enabled || shortcut.enabled())) {
      event.preventDefault();
      shortcut.action();
      this.announceAction(shortcut.description);
      return true;
    }
    
    return false;
  }
}

// Register game shortcuts
shortcutManager.register({
  key: 'z',
  modifiers: ['ctrl'],
  description: 'Undo last move',
  category: 'Game Actions',
  action: () => game.undo(),
  enabled: () => game.canUndo()
});
```

## 2. Screen Reader Support

### 2.1 ARIA Live Regions
```typescript
class AriaAnnouncer {
  private liveRegion: HTMLElement;
  private queue: string[] = [];
  
  constructor() {
    this.liveRegion = this.createLiveRegion();
  }
  
  private createLiveRegion(): HTMLElement {
    const region = document.createElement('div');
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    region.className = 'sr-only'; // Visually hidden
    document.body.appendChild(region);
    return region;
  }
  
  announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
    this.liveRegion.setAttribute('aria-live', priority);
    
    // Clear and set new message
    this.liveRegion.textContent = '';
    
    // Use setTimeout to ensure screen readers catch the change
    setTimeout(() => {
      this.liveRegion.textContent = message;
    }, 100);
  }
  
  // Announce game state changes
  announcePiecePlaced(position: Vector3, player: Player): void {
    const message = `${player.name} placed ${player.color} piece at position ${this.formatPosition(position)}`;
    this.announce(message);
  }
  
  announceGameStatus(status: GameStatus): void {
    const messages = {
      'in-progress': 'Game in progress',
      'check': 'Check! One more piece to win',
      'game-over': 'Game over',
      'draw': 'Game ended in a draw'
    };
    
    this.announce(messages[status], 'assertive');
  }
  
  private formatPosition(pos: Vector3): string {
    // Convert to user-friendly format (A1, B2, etc.)
    const x = String.fromCharCode(65 + pos.x); // A, B, C...
    const y = pos.y + 1; // 1, 2, 3...
    const z = pos.z + 1; // Layer 1, 2, 3...
    return `${x}${y}, layer ${z}`;
  }
}
```

### 2.2 Semantic HTML Structure
```typescript
class AccessibleGameBoard {
  createAccessibleStructure(): HTMLElement {
    const container = document.createElement('section');
    container.setAttribute('role', 'application');
    container.setAttribute('aria-label', 'Pente 3D Game Board');
    
    // Board state summary
    const summary = document.createElement('div');
    summary.setAttribute('role', 'status');
    summary.setAttribute('aria-label', 'Game Status');
    summary.innerHTML = `
      <h2 class="sr-only">Game Status</h2>
      <p id="current-player">Current player: <span></span></p>
      <p id="move-count">Move: <span></span></p>
      <p id="game-phase">Phase: <span></span></p>
    `;
    
    // Board representation
    const board = document.createElement('div');
    board.setAttribute('role', 'grid');
    board.setAttribute('aria-label', '3D Game Board');
    board.setAttribute('aria-describedby', 'board-instructions');
    
    // Instructions
    const instructions = document.createElement('div');
    instructions.id = 'board-instructions';
    instructions.className = 'sr-only';
    instructions.textContent = 'Use arrow keys to navigate, Space to place piece. Press H for help.';
    
    container.appendChild(summary);
    container.appendChild(board);
    container.appendChild(instructions);
    
    return container;
  }
  
  // Alternative text representation
  createTextBoard(): string {
    const lines: string[] = [];
    lines.push('Pente 3D Board State:');
    lines.push('');
    
    for (let z = 0; z < this.size; z++) {
      lines.push(`Layer ${z + 1}:`);
      for (let y = this.size - 1; y >= 0; y--) {
        let row = '';
        for (let x = 0; x < this.size; x++) {
          const piece = this.board.getPieceAt(x, y, z);
          row += piece ? (piece.player.color === 'black' ? 'B' : 'W') : '.';
          row += ' ';
        }
        lines.push(row);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }
}
```

## 3. Visual Accessibility

### 3.1 High Contrast Mode
```typescript
class HighContrastTheme {
  private colors = {
    // High contrast color scheme
    black: '#000000',
    white: '#FFFFFF',
    blackPiece: '#000000',
    whitePiece: '#FFFF00', // Yellow for better contrast
    grid: '#00FFFF', // Cyan
    highlight: '#FF00FF', // Magenta
    background: '#000080', // Navy
    text: '#FFFFFF',
    
    // Patterns for colorblind users
    blackPattern: 'diagonal-lines',
    whitePattern: 'dots'
  };
  
  applyToRenderer(renderer: Renderer): void {
    // Update materials
    renderer.updateMaterials({
      blackPiece: this.createPieceMaterial('black'),
      whitePiece: this.createPieceMaterial('white'),
      grid: this.createGridMaterial(),
      highlight: this.createHighlightMaterial()
    });
    
    // Add patterns for better distinction
    this.addPiecePatterns(renderer);
    
    // Increase contrast for UI elements
    this.updateUIContrast();
  }
  
  private createPieceMaterial(color: 'black' | 'white'): THREE.Material {
    const material = new THREE.MeshPhongMaterial({
      color: this.colors[color + 'Piece'],
      emissive: this.colors[color + 'Piece'],
      emissiveIntensity: 0.3,
      shininess: 100
    });
    
    // Add texture pattern
    const pattern = this.loadPattern(this.colors[color + 'Pattern']);
    material.map = pattern;
    
    return material;
  }
}
```

### 3.2 Color Blind Modes
```typescript
enum ColorBlindMode {
  Normal = 'normal',
  Protanopia = 'protanopia',
  Deuteranopia = 'deuteranopia',
  Tritanopia = 'tritanopia',
  Monochromacy = 'monochromacy'
}

class ColorBlindFilter {
  private filters: Record<ColorBlindMode, number[][]> = {
    [ColorBlindMode.Normal]: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ],
    [ColorBlindMode.Protanopia]: [
      [0.567, 0.433, 0],
      [0.558, 0.442, 0],
      [0, 0.242, 0.758]
    ],
    [ColorBlindMode.Deuteranopia]: [
      [0.625, 0.375, 0],
      [0.7, 0.3, 0],
      [0, 0.3, 0.7]
    ],
    [ColorBlindMode.Tritanopia]: [
      [0.95, 0.05, 0],
      [0, 0.433, 0.567],
      [0, 0.475, 0.525]
    ],
    [ColorBlindMode.Monochromacy]: [
      [0.299, 0.587, 0.114],
      [0.299, 0.587, 0.114],
      [0.299, 0.587, 0.114]
    ]
  };
  
  applyFilter(renderer: THREE.WebGLRenderer, mode: ColorBlindMode): void {
    if (mode === ColorBlindMode.Normal) {
      renderer.outputEncoding = THREE.sRGBEncoding;
      return;
    }
    
    // Apply color transformation matrix
    const filter = this.filters[mode];
    const shader = this.createColorBlindShader(filter);
    
    // Post-processing pass
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new ShaderPass(shader));
  }
}
```

## 4. Visual Feedback

### 4.1 Animation Feedback
```typescript
class AccessibleAnimations {
  private reducedMotion: boolean = false;
  
  constructor() {
    // Respect user preference
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  
  animatePiecePlacement(piece: Mesh, position: Vector3): void {
    if (this.reducedMotion) {
      // Instant placement
      piece.position.copy(position);
      this.flashHighlight(piece);
    } else {
      // Smooth animation
      gsap.to(piece.position, {
        x: position.x,
        y: position.y,
        z: position.z,
        duration: 0.5,
        ease: 'power2.inOut',
        onComplete: () => this.pulseEffect(piece)
      });
    }
  }
  
  private flashHighlight(object: Mesh): void {
    const original = object.material.emissive.getHex();
    object.material.emissive.setHex(0xFFFFFF);
    
    setTimeout(() => {
      object.material.emissive.setHex(original);
    }, 200);
  }
  
  showValidMoves(positions: Vector3[]): void {
    positions.forEach(pos => {
      if (this.reducedMotion) {
        // Static indicators
        this.addValidMoveMarker(pos);
      } else {
        // Animated indicators
        this.addAnimatedMarker(pos);
      }
    });
  }
}
```

### 4.2 Visual Cues System
```typescript
class VisualCues {
  private cues: Map<string, THREE.Object3D> = new Map();
  
  // Different cue types for different information
  showLastMove(position: Vector3): void {
    const cue = this.createCue({
      type: 'last-move',
      shape: 'ring',
      color: 0x00FF00,
      animate: 'pulse',
      duration: 2000
    });
    
    cue.position.copy(position);
    this.addCue('last-move', cue);
  }
  
  showThreatLine(line: Line): void {
    const cue = this.createLineCue({
      type: 'threat',
      color: 0xFF0000,
      width: 0.1,
      opacity: 0.6,
      pattern: 'dashed'
    });
    
    this.addCue(`threat-${line.id}`, cue);
  }
  
  showHint(position: Vector3, strength: 'weak' | 'medium' | 'strong'): void {
    const colors = {
      weak: 0xFFFF00,
      medium: 0xFFA500,
      strong: 0xFF0000
    };
    
    const cue = this.createCue({
      type: 'hint',
      shape: 'arrow',
      color: colors[strength],
      size: strength === 'strong' ? 1.5 : 1.0
    });
    
    cue.position.copy(position);
    this.addCue(`hint-${position.toKey()}`, cue);
  }
  
  private createCue(config: CueConfig): THREE.Object3D {
    // Create appropriate visual cue based on config
    const geometry = this.getCueGeometry(config.shape);
    const material = this.getCueMaterial(config);
    const mesh = new THREE.Mesh(geometry, material);
    
    if (config.animate) {
      this.animateCue(mesh, config.animate);
    }
    
    return mesh;
  }
}
```

## 5. Error Handling and Feedback

### 5.1 User-Friendly Error Messages
```typescript
class UserErrorHandler {
  private errorMessages: Record<string, (context: any) => string> = {
    POSITION_OCCUPIED: (ctx) => 
      `That position is already occupied by a ${ctx.existingPiece.color} piece`,
    
    OUT_OF_BOUNDS: (ctx) => 
      `Position ${ctx.position} is outside the board`,
    
    NOT_YOUR_TURN: (ctx) => 
      `It's ${ctx.currentPlayer}'s turn to play`,
    
    GAME_OVER: () => 
      'The game has ended. Start a new game to continue playing',
    
    NETWORK_ERROR: (ctx) => 
      `Connection error: ${ctx.message}. Please check your internet connection`,
    
    INVALID_MOVE: (ctx) => 
      'That move is not allowed. ' + this.getInvalidMoveHint(ctx)
  };
  
  handleError(error: GameError): void {
    const message = this.getErrorMessage(error);
    
    // Visual feedback
    this.showErrorToast(message);
    
    // Audio feedback
    this.playErrorSound();
    
    // Screen reader announcement
    this.announcer.announce(message, 'assertive');
    
    // Log for debugging
    console.error('Game error:', error);
  }
  
  private showErrorToast(message: string): void {
    const toast = new Toast({
      message,
      type: 'error',
      duration: 3000,
      position: 'top-center',
      dismissible: true
    });
    
    toast.show();
  }
}
```

### 5.2 Contextual Help
```typescript
class ContextualHelp {
  private helpDatabase: Map<string, HelpContent> = new Map();
  
  showHelp(context: string): void {
    const help = this.getHelpForContext(context);
    
    const modal = new HelpModal({
      title: help.title,
      content: help.content,
      relatedTopics: help.related,
      videoUrl: help.video
    });
    
    modal.show();
  }
  
  // Inline help tooltips
  addTooltip(element: HTMLElement, helpKey: string): void {
    const tooltip = new Tooltip({
      target: element,
      content: this.getQuickHelp(helpKey),
      position: 'auto',
      trigger: 'hover focus',
      delay: 500
    });
    
    // Keyboard accessible
    element.setAttribute('aria-describedby', tooltip.id);
  }
  
  // Progressive disclosure
  createHelpLevels(): HelpLevel[] {
    return [
      {
        level: 'beginner',
        topics: ['basic-moves', 'winning', 'controls'],
        showHints: true
      },
      {
        level: 'intermediate',
        topics: ['strategy', 'captures', 'defense'],
        showHints: false
      },
      {
        level: 'advanced',
        topics: ['openings', 'tactics', 'endgame'],
        showHints: false
      }
    ];
  }
}
```

## 6. Mobile Accessibility

### 6.1 Touch Controls
```typescript
class TouchAccessibility {
  private touchManager: TouchManager;
  
  setupAccessibleTouch(): void {
    // Larger touch targets
    this.setMinimumTouchSize(44); // WCAG recommendation
    
    // Touch gestures
    this.touchManager.registerGesture({
      name: 'double-tap',
      action: 'place-piece',
      vibrate: true
    });
    
    this.touchManager.registerGesture({
      name: 'long-press',
      action: 'show-context-menu',
      vibrate: true
    });
    
    // Gesture hints
    this.showGestureHints();
  }
  
  // Haptic feedback
  provideHapticFeedback(type: 'success' | 'error' | 'selection'): void {
    if (!('vibrate' in navigator)) return;
    
    const patterns = {
      success: [50, 50, 50],
      error: [200],
      selection: [25]
    };
    
    navigator.vibrate(patterns[type]);
  }
}
```

### 6.2 Responsive UI
```typescript
class ResponsiveAccessibility {
  adjustForViewport(): void {
    const viewport = this.getViewportSize();
    
    if (viewport.width < 768) {
      // Mobile adjustments
      this.enableSingleColumnLayout();
      this.enlargeTouchTargets();
      this.simplifyInterface();
    }
    
    if (viewport.height < 600) {
      // Landscape adjustments
      this.compactVerticalSpace();
      this.moveControlsToSide();
    }
  }
  
  // Dynamic font sizing
  adjustFontSize(): void {
    const baseFontSize = this.calculateOptimalFontSize();
    document.documentElement.style.setProperty('--base-font-size', `${baseFontSize}px`);
  }
}
```

## 7. Cognitive Accessibility

### 7.1 Simplified Mode
```typescript
class SimplifiedMode {
  private complexity: 'simple' | 'normal' | 'advanced' = 'normal';
  
  enableSimplifiedMode(): void {
    this.complexity = 'simple';
    
    // Reduce visual complexity
    this.hideNonEssentialUI();
    
    // Clearer instructions
    this.useSimpleLanguage();
    
    // Reduce choices
    this.limitOptions();
    
    // Add more guidance
    this.enableGuidedMode();
  }
  
  private hideNonEssentialUI(): void {
    // Hide advanced features
    document.querySelectorAll('[data-complexity="advanced"]')
      .forEach(el => el.classList.add('hidden'));
    
    // Simplify menus
    this.menuManager.setMode('simple');
  }
  
  private enableGuidedMode(): void {
    // Step-by-step instructions
    this.guide = new GuidedTour({
      steps: [
        'Click on an empty space to place your piece',
        'Try to get 5 in a row',
        'Block your opponent from getting 5 in a row'
      ],
      showProgress: true,
      allowSkip: true
    });
  }
}
```

### 7.2 Clear Status Indicators
```typescript
class StatusIndicators {
  createClearIndicators(): void {
    // Visual and text indicators
    const indicators = {
      turn: {
        visual: 'animated-border',
        text: 'Your turn',
        audio: 'chime'
      },
      waiting: {
        visual: 'pulsing-icon',
        text: "Opponent's turn",
        audio: null
      },
      thinking: {
        visual: 'spinner',
        text: 'AI thinking...',
        audio: null
      },
      danger: {
        visual: 'red-flash',
        text: 'Opponent can win next turn!',
        audio: 'warning'
      }
    };
    
    this.updateIndicator(this.gameState.status);
  }
}
```

## 8. Performance for Accessibility

### 8.1 Reduced Motion Performance
```typescript
class ReducedMotionOptimizer {
  optimizeForReducedMotion(): void {
    // Disable non-essential animations
    gsap.globalTimeline.timeScale(0);
    
    // Use CSS transitions instead of JS
    document.body.classList.add('reduced-motion');
    
    // Immediate state changes
    this.renderer.setAnimationDuration(0);
    
    // But keep essential feedback
    this.enableInstantFeedback();
  }
}
```

## 9. Testing Accessibility

### 9.1 Automated Tests
```typescript
describe('Accessibility', () => {
  test('keyboard navigation works correctly', async () => {
    const { game, keyboard } = await setupTest();
    
    // Test all navigation keys
    await keyboard.press('ArrowRight');
    expect(game.getCursorPosition()).toEqual({ x: 1, y: 0, z: 0 });
    
    await keyboard.press('Space');
    expect(game.hasPieceAt(1, 0, 0)).toBe(true);
  });
  
  test('screen reader announcements', async () => {
    const { game, announcer } = await setupTest();
    const spy = jest.spyOn(announcer, 'announce');
    
    await game.placePiece(0, 0, 0);
    
    expect(spy).toHaveBeenCalledWith(
      'Black placed piece at A1, layer 1',
      'polite'
    );
  });
  
  test('WCAG compliance', async () => {
    const results = await runAxeTests(page);
    expect(results.violations).toHaveLength(0);
  });
});
```

## 10. Accessibility Checklist

### WCAG 2.1 AA Compliance
- [ ] All interactive elements keyboard accessible
- [ ] Focus indicators visible and clear
- [ ] Color not sole indicator of information
- [ ] Contrast ratios meet standards (4.5:1 normal, 3:1 large text)
- [ ] Text resizable to 200% without loss of functionality
- [ ] No keyboard traps
- [ ] Skip links provided
- [ ] Page has proper heading structure
- [ ] All images have alt text
- [ ] Form labels associated with controls
- [ ] Error messages clear and specific
- [ ] Time limits adjustable
- [ ] No flashing content
- [ ] Content readable by screen readers
- [ ] Touch targets at least 44x44 pixels
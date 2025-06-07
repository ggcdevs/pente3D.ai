import {
  Raycaster,
  Vector2,
  Camera,
  Scene,
  Intersection,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Vector3 } from '@/core/Vector3';
import { Game } from '@/core/Game';
import { Renderer } from '@/rendering/Renderer';
import { AccessibilityManager } from '@/utils/AccessibilityManager';
import { logger } from '@/utils';

export interface InputHandlerOptions {
  canvas: HTMLCanvasElement;
  camera: Camera;
  scene: Scene;
  controls: OrbitControls;
  game: Game;
  renderer: Renderer;
  accessibilityManager?: AccessibilityManager;
}

export interface InteractionState {
  hoveredPosition: Vector3 | null;
  selectedPosition: Vector3 | null;
  temporaryPieceMode: boolean;
  temporaryPosition: Vector3 | null;
  mouseDown: boolean;
  mouseButton: number;
  lastClickTime: number;
  doubleClickThreshold: number;
  keyboardFocus: Vector3 | null;
  fastNavigation: boolean;
  keyboardMode: boolean;
}

export class InputHandler {
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: Camera;
  private readonly scene: Scene;
  private readonly controls: OrbitControls;
  private readonly game: Game;
  private readonly renderer: Renderer;
  private readonly raycaster: Raycaster;
  private readonly mouse: Vector2;
  private readonly state: InteractionState;
  private readonly listeners: Map<string, Set<(data: any) => void>>;
  private readonly keyboardShortcuts: Map<string, () => void>;
  private animationFrameId: number | null = null;
  private accessibilityManager?: AccessibilityManager;
  private focusIndicator: Mesh | null = null;

  constructor(options: InputHandlerOptions) {
    this.canvas = options.canvas;
    this.camera = options.camera;
    this.scene = options.scene;
    this.controls = options.controls;
    this.game = options.game;
    this.renderer = options.renderer;
    this.accessibilityManager = options.accessibilityManager;

    this.raycaster = new Raycaster();
    this.mouse = new Vector2();

    this.state = {
      hoveredPosition: null,
      selectedPosition: null,
      temporaryPieceMode: false,
      temporaryPosition: null,
      mouseDown: false,
      mouseButton: -1,
      lastClickTime: 0,
      doubleClickThreshold: 300,
      keyboardFocus: null,
      fastNavigation: false,
      keyboardMode: false,
    };

    this.listeners = new Map();
    this.keyboardShortcuts = new Map();

    this.setupEventListeners();
    this.setupKeyboardShortcuts();
    this.setupAccessibilityKeyboardControls();
    this.createFocusIndicator();

    // Set canvas as focusable
    this.canvas.setAttribute('tabindex', '0');
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-label', '3D Pente game board. Use arrow keys to navigate.');
  }

  private setupEventListeners(): void {
    this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
    this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.canvas.addEventListener('click', this.onClick.bind(this));
    this.canvas.addEventListener('dblclick', this.onDoubleClick.bind(this));
    this.canvas.addEventListener('contextmenu', this.onContextMenu.bind(this));
    this.canvas.addEventListener('wheel', this.onWheel.bind(this));

    window.addEventListener('keydown', this.onKeyDown.bind(this));
    window.addEventListener('keyup', this.onKeyUp.bind(this));
    window.addEventListener('resize', this.onResize.bind(this));
  }

  private setupKeyboardShortcuts(): void {
    // Undo/Redo
    this.keyboardShortcuts.set('ctrl+z', () => this.game.undo());
    this.keyboardShortcuts.set('ctrl+y', () => this.game.redo());
    this.keyboardShortcuts.set('ctrl+shift+z', () => this.game.redo());

    // Temporary piece mode
    this.keyboardShortcuts.set('t', () => this.toggleTemporaryPieceMode());
    this.keyboardShortcuts.set('enter', () => this.confirmTemporaryPiece());

    // Cancel operations
    this.keyboardShortcuts.set('escape', () => this.cancelCurrentOperation());

    // Reset view
    this.keyboardShortcuts.set('r', () => this.resetView());

    // Toggle grid
    this.keyboardShortcuts.set('g', () => this.emit('toggleGrid'));

    // Accessibility shortcuts
    this.keyboardShortcuts.set('h', () => this.emit('showHelp'));
    this.keyboardShortcuts.set('a', () => this.announceGameState());
    this.keyboardShortcuts.set('m', () => this.emit('openMenu'));
  }

  private updateMouse(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private performRaycast(): Intersection[] {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    return this.raycaster.intersectObjects(this.scene.children, true);
  }

  private findBoardIntersection(intersections: Intersection[]): Vector3 | null {
    // Look for intersection points (spheres) in the scene
    for (const intersection of intersections) {
      const object = intersection.object;
      if (object && object.userData && object.userData.type === 'intersection') {
        const position = object.userData.position;
        // Check if it's a Vector3-like object (has x, y, z properties)
        if (
          position &&
          typeof position.x === 'number' &&
          typeof position.y === 'number' &&
          typeof position.z === 'number'
        ) {
          return position as Vector3;
        }
      }
    }
    return null;
  }

  private onMouseMove(event: MouseEvent): void {
    this.updateMouse(event);

    const intersections = this.performRaycast();
    const boardPosition = this.findBoardIntersection(intersections);

    if (boardPosition !== this.state.hoveredPosition) {
      const previousPosition = this.state.hoveredPosition;
      this.state.hoveredPosition = boardPosition;

      // Update highlighting
      if (previousPosition) {
        this.renderer.unhighlightPosition(previousPosition);
      }
      if (boardPosition) {
        this.renderer.highlightPosition(boardPosition);
      }

      this.emit('hover', { position: boardPosition, previousPosition });
    }

    // In temporary mode, show a preview piece on hover only if no temporary piece has been placed
    if (this.state.temporaryPieceMode && boardPosition && !this.state.temporaryPosition) {
      // Show hover preview only when no temporary piece is placed yet
      this.renderer.setTemporaryPiece(boardPosition, this.game.getCurrentPlayer());
    } else if (this.state.temporaryPieceMode && this.state.temporaryPosition && boardPosition) {
      // If temporary piece is already placed, don't update it with hover
      // Keep the placed temporary piece visible at its original position
      this.renderer.setTemporaryPiece(this.state.temporaryPosition, this.game.getCurrentPlayer());
    }
  }

  private onMouseDown(event: MouseEvent): void {
    this.state.mouseDown = true;
    this.state.mouseButton = event.button;

    // Track if we're dragging
    this.updateMouse(event);
    const startX = event.clientX;
    const startY = event.clientY;

    // Store start position to detect drag vs click
    (this as any).mouseDownPosition = { x: startX, y: startY };
  }

  private onMouseUp(event: MouseEvent): void {
    const wasDragging =
      this.state.mouseDown &&
      (this as any).mouseDownPosition &&
      (Math.abs(event.clientX - (this as any).mouseDownPosition.x) > 5 ||
        Math.abs(event.clientY - (this as any).mouseDownPosition.y) > 5);

    this.state.mouseDown = false;
    this.state.mouseButton = -1;
    (this as any).mouseDownPosition = null;

    // Mark if this was a drag
    (this as any).wasRecentDrag = wasDragging;

    // Clear drag flag after a short delay
    if (wasDragging) {
      setTimeout(() => {
        (this as any).wasRecentDrag = false;
      }, 100);
    }
  }

  private onClick(event: MouseEvent): void {
    // Only process left clicks
    if (event.button !== 0) return;

    // Skip if this was triggered by a drag
    const wasDragging = (this as any).wasRecentDrag;
    if (wasDragging) {
      (this as any).wasRecentDrag = false;
      return;
    }

    this.updateMouse(event);
    const intersections = this.performRaycast();
    const boardPosition = this.findBoardIntersection(intersections);

    if (boardPosition) {
      this.state.selectedPosition = boardPosition;

      // Try to place a piece at this position
      if (!this.state.temporaryPieceMode) {
        try {
          const result = this.game.placePiece(boardPosition);
          if (result) {
            this.emit('piecePlaced', { position: boardPosition });
          }
        } catch (error) {
          this.emit('invalidMove', { position: boardPosition, error });
          logger.error('Invalid move', error as Error, { position: boardPosition });
        }
      } else {
        // In temporary mode, just show the piece visually
        this.state.temporaryPosition = boardPosition;
        this.renderer.setTemporaryPiece(boardPosition, this.game.getCurrentPlayer());
        this.emit('temporaryPiecePlaced', { position: boardPosition });
      }
    }
  }

  private onDoubleClick(_event: MouseEvent): void {
    // Double click to confirm temporary piece placement
    if (this.state.temporaryPieceMode && this.state.temporaryPosition) {
      try {
        this.game.placePiece(this.state.temporaryPosition);
        this.renderer.clearTemporaryPiece();
        this.state.temporaryPosition = null;
        this.state.temporaryPieceMode = false;
        this.emit('temporaryPieceConfirmed', { position: this.state.temporaryPosition });
      } catch (error) {
        this.emit('invalidMove', { position: this.state.temporaryPosition, error });
      }
    }
  }

  private onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    // Right click handling is done in mousedown/mouseup for orbit controls
  }

  private onWheel(event: WheelEvent): void {
    // Wheel events are handled by OrbitControls for zoom
    // We can emit an event if needed for UI updates
    this.emit('zoom', { delta: event.deltaY });
  }

  private onKeyDown(event: KeyboardEvent): void {
    // Check if focus is on canvas
    const canvasHasFocus = document.activeElement === this.canvas;

    // Handle keyboard navigation if canvas has focus
    if (canvasHasFocus && this.isNavigationKey(event.key)) {
      this.state.keyboardMode = true;
      this.handleKeyboardNavigation(event);
      return;
    }

    const key = this.getKeyString(event);
    const handler = this.keyboardShortcuts.get(key);

    if (handler) {
      event.preventDefault();
      handler();
      this.emit('shortcut', { key });
    }
  }

  private isNavigationKey(key: string): boolean {
    return [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'PageUp',
      'PageDown',
      ' ',
      'Enter',
    ].includes(key);
  }

  private onKeyUp(_event: KeyboardEvent): void {
    // Handle key up events if needed
  }

  private onResize(): void {
    // Update raycaster on resize
    this.emit('resize');
  }

  private getKeyString(event: KeyboardEvent): string {
    const parts: string[] = [];
    if (event.ctrlKey || event.metaKey) parts.push('ctrl');
    if (event.shiftKey) parts.push('shift');
    if (event.altKey) parts.push('alt');
    parts.push(event.key.toLowerCase());
    return parts.join('+');
  }

  private toggleTemporaryPieceMode(): void {
    this.state.temporaryPieceMode = !this.state.temporaryPieceMode;

    if (!this.state.temporaryPieceMode) {
      // Clear temporary pieces when exiting mode
      this.renderer.clearTemporaryPiece();
      this.state.temporaryPosition = null;
    }

    this.emit('temporaryModeChanged', { enabled: this.state.temporaryPieceMode });
  }

  private confirmTemporaryPiece(): void {
    if (this.state.temporaryPieceMode && this.state.temporaryPosition) {
      try {
        // Place the piece permanently using regular game logic
        const result = this.game.placePiece(this.state.temporaryPosition);
        if (result) {
          // Exit temporary mode
          this.state.temporaryPieceMode = false;
          this.state.temporaryPosition = null;
          this.renderer.clearTemporaryPiece();
          this.emit('temporaryPieceConfirmed');
        }
      } catch (error) {
        this.emit('invalidMove', { error });
        logger.error('Error confirming temporary piece', error as Error);
      }
    }
  }

  private cancelCurrentOperation(): void {
    if (this.state.temporaryPieceMode) {
      this.state.temporaryPieceMode = false;
      this.renderer.clearTemporaryPiece();
      this.state.temporaryPosition = null;
    }

    if (this.state.hoveredPosition) {
      this.renderer.unhighlightPosition(this.state.hoveredPosition);
      this.state.hoveredPosition = null;
    }

    this.emit('operationCancelled');
  }

  private resetView(): void {
    // Reset camera to default position
    this.controls.reset();
    this.emit('viewReset');
  }

  private setupAccessibilityKeyboardControls(): void {
    // Listen for accessibility manager focus changes
    if (this.accessibilityManager) {
      this.accessibilityManager.on('focusChanged', (event: any) => {
        this.handleFocusChange(event.position);
      });
    }
  }

  private createFocusIndicator(): void {
    // Create a ring to show keyboard focus
    const ringGeometry = new RingGeometry(0.15, 0.2, 32);
    const material = new MeshBasicMaterial({
      color: 0xffff00,
      opacity: 0.8,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.focusIndicator = new Mesh(ringGeometry, material);
    this.focusIndicator.visible = false;
    this.focusIndicator.renderOrder = 999; // Render on top
    this.scene.add(this.focusIndicator);
  }

  private handleFocusChange(position: Vector3 | null): void {
    this.state.keyboardFocus = position;
    this.updateFocusVisuals();

    if (position && this.state.keyboardMode) {
      // Move camera to show focused position
      this.renderer.focusCameraOnPosition(position);
    }
  }

  private updateFocusVisuals(): void {
    if (!this.focusIndicator) return;

    if (this.state.keyboardFocus && this.state.keyboardMode) {
      const pos = this.state.keyboardFocus;
      this.focusIndicator.position.set(pos.x, pos.y, pos.z);
      this.focusIndicator.visible = true;

      // Make it pulsate for better visibility
      const scale = 1 + Math.sin(Date.now() * 0.003) * 0.1;
      this.focusIndicator.scale.set(scale, scale, scale);
    } else {
      this.focusIndicator.visible = false;
    }
  }

  private announceGameState(): void {
    if (this.accessibilityManager) {
      this.accessibilityManager.announceBoardState();
    }
  }

  private handleKeyboardNavigation(event: KeyboardEvent): void {
    if (!this.accessibilityManager) return;

    const isShift = event.shiftKey;
    this.state.fastNavigation = isShift;

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        this.accessibilityManager.moveFocus('up');
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.accessibilityManager.moveFocus('down');
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.accessibilityManager.moveFocus('left');
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.accessibilityManager.moveFocus('right');
        break;
      case 'PageUp':
        event.preventDefault();
        this.accessibilityManager.moveFocus('forward');
        break;
      case 'PageDown':
        event.preventDefault();
        this.accessibilityManager.moveFocus('backward');
        break;
      case ' ':
      case 'Enter':
        event.preventDefault();
        // In temporary mode with a temporary position, Enter should confirm
        if (this.state.temporaryPieceMode && this.state.temporaryPosition) {
          this.confirmTemporaryPiece();
        } else {
          this.handleKeyboardSelect();
        }
        break;
    }
  }

  private handleKeyboardSelect(): void {
    if (!this.state.keyboardFocus || !this.accessibilityManager) return;

    const position = this.state.keyboardFocus;

    if (!this.state.temporaryPieceMode) {
      try {
        this.game.placePiece(position);
        this.emit('piecePlaced', { position, keyboard: true });
      } catch (error) {
        this.emit('invalidMove', { position, error, keyboard: true });
      }
    } else {
      this.state.temporaryPosition = position;
      this.renderer.setTemporaryPiece(position, this.game.getCurrentPlayer());
      this.emit('temporaryPiecePlaced', { position, keyboard: true });
    }

    this.accessibilityManager.selectCurrentPosition();
  }

  // Event system
  public on(event: string, listener: (data: any) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  public off(event: string, listener: (data: any) => void): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener);
    }
  }

  private emit(event: string, data?: any): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach((listener) => listener(data));
    }
  }

  // Public methods
  public getState(): Readonly<InteractionState> {
    return { ...this.state };
  }

  public setTemporaryPieceMode(enabled: boolean): void {
    this.state.temporaryPieceMode = enabled;
    if (!enabled) {
      this.renderer.clearTemporaryPiece();
      this.state.temporaryPosition = null;
    }
  }

  public setAccessibilityManager(manager: AccessibilityManager): void {
    this.accessibilityManager = manager;
    this.setupAccessibilityKeyboardControls();
  }

  // Start animation loop for focus indicator
  public startAnimationLoop(): void {
    const animate = () => {
      this.updateFocusVisuals();
      this.animationFrameId = requestAnimationFrame(animate);
    };
    animate();
  }

  public dispose(): void {
    // Remove event listeners
    this.canvas.removeEventListener('mousemove', this.onMouseMove.bind(this));
    this.canvas.removeEventListener('mousedown', this.onMouseDown.bind(this));
    this.canvas.removeEventListener('mouseup', this.onMouseUp.bind(this));
    this.canvas.removeEventListener('click', this.onClick.bind(this));
    this.canvas.removeEventListener('dblclick', this.onDoubleClick.bind(this));
    this.canvas.removeEventListener('contextmenu', this.onContextMenu.bind(this));
    this.canvas.removeEventListener('wheel', this.onWheel.bind(this));

    window.removeEventListener('keydown', this.onKeyDown.bind(this));
    window.removeEventListener('keyup', this.onKeyUp.bind(this));
    window.removeEventListener('resize', this.onResize.bind(this));

    // Clear all listeners
    this.listeners.clear();
    this.keyboardShortcuts.clear();

    // Cancel any pending operations
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // Remove focus indicator
    if (this.focusIndicator) {
      this.scene.remove(this.focusIndicator);
      if (this.focusIndicator.geometry) this.focusIndicator.geometry.dispose();
      if (this.focusIndicator.material instanceof MeshBasicMaterial) {
        this.focusIndicator.material.dispose();
      }
      this.focusIndicator = null;
    }
  }
}

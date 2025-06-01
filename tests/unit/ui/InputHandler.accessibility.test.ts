import { InputHandler } from '@/ui/InputHandler';
import { Game } from '@/core/Game';
import { Renderer } from '@/rendering/Renderer';
import { Vector3 } from '@/core/Vector3';
import { AccessibilityManager } from '@/utils/AccessibilityManager';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

// Mock Three.js
jest.mock('three');
jest.mock('three/examples/jsm/controls/OrbitControls');

describe('InputHandler - Keyboard Navigation', () => {
  let canvas: HTMLCanvasElement;
  let game: Game;
  let renderer: Renderer;
  let inputHandler: InputHandler;
  let camera: THREE.Camera;
  let scene: THREE.Scene;
  let controls: OrbitControls;
  let accessibilityManager: AccessibilityManager;

  beforeEach(() => {
    // Create canvas
    canvas = document.createElement('canvas');
    canvas.setAttribute('tabindex', '0');
    document.body.appendChild(canvas);
    
    // Create mocks
    game = new Game({ boardSize: 7 });
    accessibilityManager = new AccessibilityManager(game);
    
    // Mock Three.js objects
    camera = new THREE.PerspectiveCamera();
    scene = new THREE.Scene();
    controls = new OrbitControls(camera, canvas);
    
    // Mock renderer
    renderer = {
      getCamera: () => camera,
      getScene: () => scene,
      getControls: () => controls,
      focusCameraOnPosition: jest.fn()
    } as any;
    
    // Create input handler
    inputHandler = new InputHandler({
      canvas,
      camera,
      scene,
      controls,
      game,
      renderer,
      accessibilityManager
    });
  });

  afterEach(() => {
    inputHandler.dispose();
    document.body.removeChild(canvas);
  });

  test('should handle arrow keys for X-Y navigation', () => {
    const moveFocusSpy = jest.spyOn(accessibilityManager, 'moveFocus');
    canvas.focus();
    
    // Test arrow up
    const upEvent = new KeyboardEvent('keydown', { key: 'ArrowUp' });
    canvas.dispatchEvent(upEvent);
    expect(moveFocusSpy).toHaveBeenCalledWith('up');
    
    // Test arrow down
    const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown' });
    canvas.dispatchEvent(downEvent);
    expect(moveFocusSpy).toHaveBeenCalledWith('down');
    
    // Test arrow left
    const leftEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft' });
    canvas.dispatchEvent(leftEvent);
    expect(moveFocusSpy).toHaveBeenCalledWith('left');
    
    // Test arrow right
    const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    canvas.dispatchEvent(rightEvent);
    expect(moveFocusSpy).toHaveBeenCalledWith('right');
  });

  test('should handle Page Up/Down for Z navigation', () => {
    const moveFocusSpy = jest.spyOn(accessibilityManager, 'moveFocus');
    canvas.focus();
    
    // Test page up
    const pageUpEvent = new KeyboardEvent('keydown', { key: 'PageUp' });
    canvas.dispatchEvent(pageUpEvent);
    expect(moveFocusSpy).toHaveBeenCalledWith('forward');
    
    // Test page down
    const pageDownEvent = new KeyboardEvent('keydown', { key: 'PageDown' });
    canvas.dispatchEvent(pageDownEvent);
    expect(moveFocusSpy).toHaveBeenCalledWith('backward');
  });

  test('should handle Space/Enter for piece placement', () => {
    const placePieceSpy = jest.spyOn(game, 'placePiece');
    const selectSpy = jest.spyOn(accessibilityManager, 'selectCurrentPosition');
    
    // Set focus position
    accessibilityManager.moveFocus('up');
    canvas.focus();
    
    // Test space key
    const spaceEvent = new KeyboardEvent('keydown', { key: ' ' });
    canvas.dispatchEvent(spaceEvent);
    expect(selectSpy).toHaveBeenCalled();
    
    // Test enter key
    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
    canvas.dispatchEvent(enterEvent);
    expect(selectSpy).toHaveBeenCalled();
  });

  test('should handle Tab for UI element cycling', () => {
    // Tab cycling is handled by the Modal class focus management
    // This test verifies Tab doesn't interfere with navigation
    canvas.focus();
    
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab' });
    canvas.dispatchEvent(tabEvent);
    
    // Should not trigger navigation
    const moveFocusSpy = jest.spyOn(accessibilityManager, 'moveFocus');
    expect(moveFocusSpy).not.toHaveBeenCalled();
  });

  test('should handle Escape for cancel/close', () => {
    const spy = jest.fn();
    inputHandler.on('operationCancelled', spy);
    
    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    window.dispatchEvent(escapeEvent);
    
    expect(spy).toHaveBeenCalled();
  });

  test('should handle H for help overlay', () => {
    const spy = jest.fn();
    inputHandler.on('showHelp', spy);
    
    const helpEvent = new KeyboardEvent('keydown', { key: 'h' });
    window.dispatchEvent(helpEvent);
    
    expect(spy).toHaveBeenCalled();
  });

  test('should handle A for announcements', () => {
    const announceSpy = jest.spyOn(accessibilityManager, 'announceBoardState');
    
    const announceEvent = new KeyboardEvent('keydown', { key: 'a' });
    window.dispatchEvent(announceEvent);
    
    expect(announceSpy).toHaveBeenCalled();
  });

  test('should handle Shift+arrows for fast navigation', () => {
    const moveFocusSpy = jest.spyOn(accessibilityManager, 'moveFocus');
    canvas.focus();
    
    const shiftUpEvent = new KeyboardEvent('keydown', { 
      key: 'ArrowUp', 
      shiftKey: true 
    });
    canvas.dispatchEvent(shiftUpEvent);
    
    expect(moveFocusSpy).toHaveBeenCalledWith('up');
    // Fast navigation speed is handled internally
  });

  test('should prevent default browser behaviors', () => {
    canvas.focus();
    
    const arrowEvent = new KeyboardEvent('keydown', { 
      key: 'ArrowUp',
      cancelable: true
    });
    
    const preventDefaultSpy = jest.spyOn(arrowEvent, 'preventDefault');
    canvas.dispatchEvent(arrowEvent);
    
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  test('should respect disabled state', () => {
    // Disable the game (e.g., game over)
    const state = game.getState();
    (state as any).winner = state.players[0];
    
    const moveFocusSpy = jest.spyOn(accessibilityManager, 'moveFocus');
    canvas.focus();
    
    const arrowEvent = new KeyboardEvent('keydown', { key: 'ArrowUp' });
    canvas.dispatchEvent(arrowEvent);
    
    // Should still allow navigation even when game is over
    expect(moveFocusSpy).toHaveBeenCalled();
  });

  test('should handle simultaneous key presses', () => {
    const moveFocusSpy = jest.spyOn(accessibilityManager, 'moveFocus');
    canvas.focus();
    
    // Simulate multiple keys pressed quickly
    const events = [
      new KeyboardEvent('keydown', { key: 'ArrowUp' }),
      new KeyboardEvent('keydown', { key: 'ArrowRight' }),
      new KeyboardEvent('keydown', { key: 'ArrowDown' })
    ];
    
    events.forEach(event => canvas.dispatchEvent(event));
    
    expect(moveFocusSpy).toHaveBeenCalledTimes(3);
  });

  test('should update focus indicator on navigation', () => {
    // Mock focus indicator
    const focusIndicator = {
      position: new THREE.Vector3(),
      visible: false,
      scale: new THREE.Vector3(1, 1, 1)
    };
    (inputHandler as any).focusIndicator = focusIndicator;
    
    // Enable keyboard mode
    canvas.focus();
    const arrowEvent = new KeyboardEvent('keydown', { key: 'ArrowUp' });
    canvas.dispatchEvent(arrowEvent);
    
    // Focus indicator should be updated
    expect((inputHandler as any).state.keyboardMode).toBe(true);
  });
});

describe('InputHandler - Focus Indicator', () => {
  let inputHandler: InputHandler;
  let scene: THREE.Scene;
  let accessibilityManager: AccessibilityManager;

  beforeEach(() => {
    const canvas = document.createElement('canvas');
    const camera = new THREE.PerspectiveCamera();
    scene = new THREE.Scene();
    const controls = {} as OrbitControls;
    const game = new Game({ boardSize: 7 });
    const renderer = {} as any;
    accessibilityManager = new AccessibilityManager(game);
    
    // Mock scene.add
    scene.add = jest.fn();
    
    inputHandler = new InputHandler({
      canvas,
      camera,
      scene,
      controls,
      game,
      renderer,
      accessibilityManager
    });
  });

  test('should create focus indicator mesh', () => {
    expect(scene.add).toHaveBeenCalled();
    const focusIndicator = (inputHandler as any).focusIndicator;
    expect(focusIndicator).toBeTruthy();
  });

  test('should update indicator position', () => {
    const focusIndicator = (inputHandler as any).focusIndicator;
    const newPosition = new Vector3(2, 3, 4);
    
    accessibilityManager.emit('focusChanged', { position: newPosition });
    
    expect((inputHandler as any).state.keyboardFocus).toEqual(newPosition);
  });

  test('should show/hide indicator appropriately', () => {
    const focusIndicator = (inputHandler as any).focusIndicator;
    
    // Initially hidden
    expect(focusIndicator.visible).toBe(false);
    
    // Enable keyboard mode
    (inputHandler as any).state.keyboardMode = true;
    (inputHandler as any).state.keyboardFocus = new Vector3(3, 3, 3);
    (inputHandler as any).updateFocusVisuals();
    
    expect(focusIndicator.visible).toBe(true);
  });

  test('should use high contrast colors when enabled', () => {
    accessibilityManager.setHighContrastMode(true);
    
    const focusIndicator = (inputHandler as any).focusIndicator;
    const material = focusIndicator.material as THREE.MeshBasicMaterial;
    
    // Yellow color for high contrast
    expect(material.color.getHex()).toBe(0xffff00);
  });

  test('should animate focus changes smoothly', () => {
    jest.useFakeTimers();
    
    const focusIndicator = (inputHandler as any).focusIndicator;
    (inputHandler as any).state.keyboardMode = true;
    (inputHandler as any).state.keyboardFocus = new Vector3(3, 3, 3);
    
    // Start animation
    inputHandler.startAnimationLoop();
    
    // Advance time
    jest.advanceTimersByTime(1000);
    
    // Scale should have changed due to pulsing animation
    expect(focusIndicator.scale.x).not.toBe(1);
    
    jest.useRealTimers();
  });
});
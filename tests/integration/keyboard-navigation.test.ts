import { Game } from '@/core/Game';
import { Renderer } from '@/rendering/Renderer';
import { InputHandler } from '@/ui/InputHandler';
import { AccessibilityManager } from '@/utils/AccessibilityManager';
import { MenuModal, SettingsModal, KeyboardHelpModal } from '@/ui';
import { Vector3 } from '@/core/Vector3';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

// Mock Three.js
jest.mock('three');
jest.mock('three/examples/jsm/controls/OrbitControls');

describe('Keyboard Navigation Flow', () => {
  let game: Game;
  let renderer: Renderer;
  let inputHandler: InputHandler;
  let accessibilityManager: AccessibilityManager;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    
    // Create canvas
    canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    canvas.setAttribute('tabindex', '0');
    document.body.appendChild(canvas);
    
    // Create game and accessibility manager
    game = new Game({ boardSize: 7 });
    accessibilityManager = new AccessibilityManager(game);
    
    // Mock Three.js objects
    const camera = new THREE.PerspectiveCamera();
    const scene = new THREE.Scene();
    const controls = new OrbitControls(camera, canvas);
    
    // Mock renderer
    renderer = {
      getCamera: () => camera,
      getScene: () => scene,
      getControls: () => controls,
      focusCameraOnPosition: jest.fn(),
      updatePieces: jest.fn()
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
    accessibilityManager.dispose();
  });

  test('should navigate entire board with keyboard', () => {
    canvas.focus();
    
    const positions: Vector3[] = [];
    accessibilityManager.on('focusChanged', (event) => {
      positions.push(event.position!);
    });
    
    // Navigate in all directions
    const movements = [
      { key: 'ArrowUp', count: 3 },
      { key: 'ArrowRight', count: 3 },
      { key: 'ArrowDown', count: 3 },
      { key: 'ArrowLeft', count: 3 },
      { key: 'PageUp', count: 2 },
      { key: 'PageDown', count: 2 }
    ];
    
    movements.forEach(({ key, count }) => {
      for (let i = 0; i < count; i++) {
        const event = new KeyboardEvent('keydown', { key });
        canvas.dispatchEvent(event);
      }
    });
    
    expect(positions.length).toBeGreaterThan(0);
  });

  test('should place pieces with keyboard', () => {
    canvas.focus();
    
    // Move to a position
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    
    // Place piece with Space
    const placeSpy = jest.spyOn(game, 'placePiece');
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    
    expect(placeSpy).toHaveBeenCalled();
    
    // Move to another position
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    
    // Place piece with Enter
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    
    expect(placeSpy).toHaveBeenCalledTimes(2);
  });

  test('should open/close modals with keyboard', () => {
    // Open menu with M
    const menuSpy = jest.fn();
    inputHandler.on('openMenu', menuSpy);
    
    const menuEvent = new KeyboardEvent('keydown', { key: 'm' });
    window.dispatchEvent(menuEvent);
    
    expect(menuSpy).toHaveBeenCalled();
    
    // Open help with H
    const helpEvent = new KeyboardEvent('keydown', { key: 'h' });
    window.dispatchEvent(helpEvent);
    
    // Check help modal exists
    setTimeout(() => {
      const helpModal = document.querySelector('.keyboard-help-modal');
      expect(helpModal).toBeTruthy();
    }, 100);
  });

  test('should navigate menus with keyboard', () => {
    const menuModal = new MenuModal({
      game,
      onNewGame: jest.fn(),
      onLoadGame: jest.fn(),
      onSaveGame: jest.fn(),
      onExportGame: jest.fn(),
      onImportGame: jest.fn(),
      onSettings: jest.fn()
    });
    
    menuModal.open();
    
    // Tab through menu items
    const buttons = menuModal['content'].querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    
    // Simulate Tab navigation
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab' });
    buttons[0].focus();
    buttons[0].dispatchEvent(tabEvent);
    
    menuModal.destroy();
  });

  test('should handle game flow entirely via keyboard', () => {
    canvas.focus();
    
    // Play several moves
    const moves = [
      { nav: ['ArrowUp'], place: true },
      { nav: ['ArrowRight'], place: true },
      { nav: ['ArrowDown', 'ArrowDown'], place: true },
      { nav: ['ArrowLeft', 'ArrowLeft'], place: true }
    ];
    
    moves.forEach(({ nav, place }) => {
      nav.forEach(key => {
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key }));
      });
      
      if (place) {
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      }
    });
    
    // Check moves were made
    expect(game.getState().moveHistory.length).toBe(4);
    
    // Undo a move
    const undoEvent = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true });
    window.dispatchEvent(undoEvent);
    
    expect(game.getState().moveHistory.length).toBe(3);
  });

  test('should show clear focus indicators', () => {
    const focusIndicator = (inputHandler as any).focusIndicator;
    expect(focusIndicator).toBeTruthy();
    
    canvas.focus();
    
    // Enable keyboard mode
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    
    // Focus indicator should be visible in keyboard mode
    expect((inputHandler as any).state.keyboardMode).toBe(true);
  });

  test('should handle rapid key presses', () => {
    canvas.focus();
    
    const moveSpy = jest.spyOn(accessibilityManager, 'moveFocus');
    
    // Rapid key presses
    for (let i = 0; i < 20; i++) {
      const key = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'][i % 4];
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key }));
    }
    
    expect(moveSpy).toHaveBeenCalledTimes(20);
  });

  test('should work with sticky keys', () => {
    // Sticky keys simulation - keys pressed one at a time
    canvas.focus();
    
    // Ctrl down
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control' }));
    
    // Z down (for undo)
    const undoSpy = jest.spyOn(game, 'undo');
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    
    expect(undoSpy).toHaveBeenCalled();
  });

  test('should handle international keyboards', () => {
    canvas.focus();
    
    // Test with non-ASCII key codes
    const events = [
      new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp' }),
      new KeyboardEvent('keydown', { key: ' ', code: 'Space' }),
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' })
    ];
    
    events.forEach(event => {
      expect(() => canvas.dispatchEvent(event)).not.toThrow();
    });
  });

  test('should provide skip links', () => {
    // Check skip links exist
    const skipLinks = document.querySelectorAll('.skip-link');
    expect(skipLinks.length).toBeGreaterThan(0);
    
    // Verify they link to correct sections
    const gameCanvasLink = Array.from(skipLinks).find(
      link => (link as HTMLAnchorElement).href.includes('#game-canvas')
    );
    expect(gameCanvasLink).toBeTruthy();
  });

  test('should handle browser shortcuts gracefully', () => {
    // Test that browser shortcuts don't interfere
    const browserShortcuts = [
      { key: 'Tab', ctrlKey: true }, // Browser tab switching
      { key: 'w', ctrlKey: true },    // Close tab
      { key: 'n', ctrlKey: true }     // New window
    ];
    
    browserShortcuts.forEach(shortcut => {
      const event = new KeyboardEvent('keydown', shortcut);
      expect(() => window.dispatchEvent(event)).not.toThrow();
    });
  });

  test('should work without mouse events', () => {
    // Ensure game is fully playable without mouse
    canvas.focus();
    
    // Complete game flow
    const gameFlow = async () => {
      // Navigate and place pieces
      for (let i = 0; i < 5; i++) {
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        
        if (i < 4) {
          canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
          canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        }
      }
      
      // Check game state
      const state = game.getState();
      expect(state.moveHistory.length).toBeGreaterThan(0);
      
      // Open menu
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
      
      // Show help
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));
      
      // Announce state
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    };
    
    expect(gameFlow()).resolves.not.toThrow();
  });
});
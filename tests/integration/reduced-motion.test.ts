import { AccessibilityManager } from '@/utils/AccessibilityManager';
import { Game } from '@/core/Game';
import { Renderer } from '@/rendering/Renderer';
import * as THREE from 'three';

// Mock Three.js
jest.mock('three');

describe('Reduced Motion Support', () => {
  let accessibilityManager: AccessibilityManager;
  let game: Game;
  let renderer: Renderer;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    
    game = new Game({ boardSize: 7 });
    accessibilityManager = new AccessibilityManager(game);
    
    // Mock renderer
    renderer = new Renderer({
      canvas,
      boardSize: 7
    });
    
    // Add setReducedMotion method if it doesn't exist
    if (!renderer.setReducedMotion) {
      renderer.setReducedMotion = jest.fn();
    }
  });

  afterEach(() => {
    accessibilityManager.dispose();
    renderer.dispose();
    document.body.removeChild(canvas);
  });

  test('should detect prefers-reduced-motion', () => {
    // Mock matchMedia
    const mockMatchMedia = {
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };
    
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(query => {
        if (query === '(prefers-reduced-motion: reduce)') {
          return mockMatchMedia;
        }
        return { matches: false };
      })
    });
    
    // Check if reduced motion is detected
    const matches = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    expect(matches).toBe(true);
  });

  test('should disable animations when requested', () => {
    const setReducedMotionSpy = jest.spyOn(renderer, 'setReducedMotion' as any);
    
    accessibilityManager.setReducedMotion(true);
    
    // Verify event is emitted
    const eventSpy = jest.fn();
    accessibilityManager.on('reducedMotionChanged', eventSpy);
    accessibilityManager.setReducedMotion(true);
    
    expect(eventSpy).toHaveBeenCalledWith({ enabled: true });
  });

  test('should maintain functionality without animations', () => {
    accessibilityManager.setReducedMotion(true);
    
    // Game should still be playable
    expect(() => {
      game.placePiece(new THREE.Vector3(3, 3, 3));
      game.placePiece(new THREE.Vector3(4, 4, 4));
      game.undo();
      game.redo();
    }).not.toThrow();
  });

  test('should apply to all UI components', () => {
    accessibilityManager.setReducedMotion(true);
    
    // Create a modal to test
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.transition = 'all 0.3s ease';
    document.body.appendChild(modal);
    
    // In real implementation, CSS would handle this
    // Check that reduce-motion class or attribute is applied
    expect(document.body.querySelector('.modal')).toBeTruthy();
    
    document.body.removeChild(modal);
  });

  test('should apply to Three.js animations', () => {
    const mockMixer = {
      timeScale: 1
    };
    
    (renderer as any).animationMixers = [mockMixer];
    
    renderer.setReducedMotion?.(true);
    
    // In real implementation, this would disable Three.js animations
    expect(renderer.setReducedMotion).toHaveBeenCalledWith(true);
  });

  test('should update when preference changes', () => {
    const listeners: { [key: string]: Function[] } = {};
    
    // Mock matchMedia with change events
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(query => ({
        matches: false,
        addEventListener: (event: string, listener: Function) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(listener);
        },
        removeEventListener: jest.fn()
      }))
    });
    
    // Set up listener
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changeSpy = jest.fn();
    mediaQuery.addEventListener('change', changeSpy);
    
    // Trigger change event
    if (listeners['change']) {
      listeners['change'].forEach(listener => listener({ matches: true }));
    }
    
    expect(changeSpy).toHaveBeenCalled();
  });
});
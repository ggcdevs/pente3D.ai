import { Game } from '@/core/Game';
import { Renderer } from '@/rendering/Renderer';
import { InputHandler } from '@/ui/InputHandler';
import { Vector3 } from '@/core/Vector3';
import * as THREE from 'three';

// Mock Three.js
jest.mock('three');
jest.mock('three/examples/jsm/controls/OrbitControls');

describe('InputHandler Integration Tests', () => {
  let game: Game;
  let renderer: Renderer;
  let inputHandler: InputHandler;
  let canvas: HTMLCanvasElement;
  
  beforeEach(() => {
    // Create real game instance
    game = new Game({ boardSize: 7 });
    
    // Create canvas
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    canvas.getBoundingClientRect = jest.fn(() => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {}
    }));
    
    // Mock WebGL context
    const mockContext = {
      getParameter: jest.fn(),
      getExtension: jest.fn(),
      createTexture: jest.fn(),
      bindTexture: jest.fn(),
      texParameteri: jest.fn(),
      texImage2D: jest.fn(),
      clearColor: jest.fn(),
      clear: jest.fn(),
      enable: jest.fn(),
      disable: jest.fn(),
      depthFunc: jest.fn(),
      frontFace: jest.fn(),
      cullFace: jest.fn(),
      viewport: jest.fn(),
      drawArrays: jest.fn(),
      drawElements: jest.fn(),
    };
    
    canvas.getContext = jest.fn((type) => {
      if (type === 'webgl' || type === 'webgl2') {
        return mockContext;
      }
      return null;
    });
    
    // Create renderer
    renderer = new Renderer({
      canvas,
      boardSize: 7
    });
    
    // Set the board
    renderer.setBoard(game.getBoard());
    
    // Create input handler
    inputHandler = new InputHandler({
      canvas,
      camera: renderer.getCamera(),
      scene: renderer.getScene(),
      controls: renderer.getControls(),
      game,
      renderer
    });
  });
  
  afterEach(() => {
    inputHandler.dispose();
    renderer.dispose();
  });
  
  describe('Game flow integration', () => {
    it('should handle complete game flow with mouse and keyboard', () => {
      const moveListener = jest.fn();
      const gameOverListener = jest.fn();
      const piecePlacedListener = jest.fn();
      
      game.on('move', moveListener);
      game.on('gameOver', gameOverListener);
      inputHandler.on('piecePlaced', piecePlacedListener);
      
      // Mock raycaster intersection
      const mockRaycaster = (THREE.Raycaster as any).mock.instances[0];
      mockRaycaster.intersectObjects.mockReturnValue([{
        object: {
          userData: {
            type: 'intersection',
            position: Vector3.create(3, 3, 3)
          }
        }
      }]);
      
      // Click to place first piece
      const clickEvent = new MouseEvent('click', {
        clientX: 400,
        clientY: 300,
        button: 0
      });
      canvas.dispatchEvent(clickEvent);
      
      expect(piecePlacedListener).toHaveBeenCalledWith({
        position: Vector3.create(3, 3, 3)
      });
      expect(moveListener).toHaveBeenCalled();
      expect(game.getCurrentPlayer().id).toBe('white');
      
      // Test undo
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true
      }));
      
      expect(game.getHistory().length).toBe(0);
      expect(game.getCurrentPlayer().id).toBe('black');
      
      // Redo
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'y',
        ctrlKey: true
      }));
      
      expect(game.getHistory().length).toBe(1);
      expect(game.getCurrentPlayer().id).toBe('white');
    });
    
    it('should handle temporary piece mode workflow', () => {
      const temporaryModeListener = jest.fn();
      const temporaryPlacedListener = jest.fn();
      
      inputHandler.on('temporaryModeChanged', temporaryModeListener);
      inputHandler.on('temporaryPiecePlaced', temporaryPlacedListener);
      
      // Toggle temporary mode
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 't' }));
      
      expect(temporaryModeListener).toHaveBeenCalledWith({ enabled: true });
      expect(inputHandler.getState().temporaryPieceMode).toBe(true);
      
      // Mock raycaster intersection
      const mockRaycaster = (THREE.Raycaster as any).mock.instances[0];
      mockRaycaster.intersectObjects.mockReturnValue([{
        object: {
          userData: {
            type: 'intersection',
            position: Vector3.create(3, 3, 3)
          }
        }
      }]);
      
      // Click to place temporary piece
      canvas.dispatchEvent(new MouseEvent('click', {
        clientX: 400,
        clientY: 300,
        button: 0
      }));
      
      expect(temporaryPlacedListener).toHaveBeenCalledWith({
        position: Vector3.create(3, 3, 3)
      });
      
      // Game state should not change
      expect(game.getHistory().length).toBe(0);
      
      // Cancel with escape
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      
      expect(inputHandler.getState().temporaryPieceMode).toBe(false);
    });
    
    it('should handle hover highlighting during gameplay', () => {
      const mockRaycaster = (THREE.Raycaster as any).mock.instances[0];
      
      // Spy on renderer methods
      const highlightSpy = jest.spyOn(renderer, 'highlightPosition');
      const unhighlightSpy = jest.spyOn(renderer, 'unhighlightPosition');
      
      // First hover
      mockRaycaster.intersectObjects.mockReturnValue([{
        object: {
          userData: {
            type: 'intersection',
            position: Vector3.create(3, 3, 3)
          }
        }
      }]);
      
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 400,
        clientY: 300
      }));
      
      expect(highlightSpy).toHaveBeenCalledWith(Vector3.create(3, 3, 3));
      
      // Move to different position
      mockRaycaster.intersectObjects.mockReturnValue([{
        object: {
          userData: {
            type: 'intersection',
            position: Vector3.create(4, 4, 4)
          }
        }
      }]);
      
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 500,
        clientY: 400
      }));
      
      expect(unhighlightSpy).toHaveBeenCalledWith(Vector3.create(3, 3, 3));
      expect(highlightSpy).toHaveBeenCalledWith(Vector3.create(4, 4, 4));
      
      // Move to empty space
      mockRaycaster.intersectObjects.mockReturnValue([]);
      
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 600,
        clientY: 500
      }));
      
      expect(unhighlightSpy).toHaveBeenCalledWith(Vector3.create(4, 4, 4));
    });
    
    it('should handle mouse controls for camera manipulation', () => {
      const controls = renderer.getControls();
      
      // Left mouse down should disable controls
      canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      expect(controls.enabled).toBe(false);
      
      // Mouse up should re-enable controls
      canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      expect(controls.enabled).toBe(true);
      
      // Right mouse should not affect controls
      canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
      expect(controls.enabled).toBe(true);
      
      // Wheel events should be passed through
      const wheelListener = jest.fn();
      inputHandler.on('zoom', wheelListener);
      
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
      expect(wheelListener).toHaveBeenCalledWith({ delta: 100 });
    });
    
    it('should handle keyboard shortcuts during game', () => {
      const shortcutListener = jest.fn();
      inputHandler.on('shortcut', shortcutListener);
      
      // Test various shortcuts
      const shortcuts = [
        { key: 'z', ctrlKey: true, expected: 'ctrl+z' },
        { key: 'y', ctrlKey: true, expected: 'ctrl+y' },
        { key: 't', expected: 't' },
        { key: 'r', expected: 'r' },
        { key: 'g', expected: 'g' },
        { key: 'Escape', expected: 'escape' }
      ];
      
      shortcuts.forEach(({ key, ctrlKey, expected }) => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key,
          ctrlKey: ctrlKey || false
        }));
        
        expect(shortcutListener).toHaveBeenCalledWith({ key: expected });
      });
    });
    
    it('should handle invalid move attempts', () => {
      const invalidMoveListener = jest.fn();
      inputHandler.on('invalidMove', invalidMoveListener);
      
      // Place a piece
      const mockRaycaster = (THREE.Raycaster as any).mock.instances[0];
      mockRaycaster.intersectObjects.mockReturnValue([{
        object: {
          userData: {
            type: 'intersection',
            position: Vector3.create(3, 3, 3)
          }
        }
      }]);
      
      canvas.dispatchEvent(new MouseEvent('click', {
        clientX: 400,
        clientY: 300,
        button: 0
      }));
      
      // Try to place another piece at the same position
      canvas.dispatchEvent(new MouseEvent('click', {
        clientX: 400,
        clientY: 300,
        button: 0
      }));
      
      expect(invalidMoveListener).toHaveBeenCalledWith({
        position: Vector3.create(3, 3, 3),
        error: expect.any(Error)
      });
    });
  });
  
  describe('Performance and edge cases', () => {
    it('should handle rapid mouse movements', () => {
      const mockRaycaster = (THREE.Raycaster as any).mock.instances[0];
      const positions = [
        Vector3.create(0, 0, 0),
        Vector3.create(1, 1, 1),
        Vector3.create(2, 2, 2),
        Vector3.create(3, 3, 3),
        Vector3.create(4, 4, 4)
      ];
      
      // Simulate rapid mouse movements
      positions.forEach((position, index) => {
        mockRaycaster.intersectObjects.mockReturnValue([{
          object: {
            userData: {
              type: 'intersection',
              position
            }
          }
        }]);
        
        canvas.dispatchEvent(new MouseEvent('mousemove', {
          clientX: 100 + index * 100,
          clientY: 100 + index * 100
        }));
      });
      
      // Should highlight the last position
      expect(inputHandler.getState().hoveredPosition).toEqual(positions[4]);
    });
    
    it('should handle window resize', () => {
      const resizeListener = jest.fn();
      inputHandler.on('resize', resizeListener);
      
      window.dispatchEvent(new Event('resize'));
      
      expect(resizeListener).toHaveBeenCalled();
    });
    
    it('should prevent context menu on right click', () => {
      const contextMenuEvent = new MouseEvent('contextmenu', {
        clientX: 400,
        clientY: 300,
        button: 2
      });
      
      let defaultPrevented = false;
      contextMenuEvent.preventDefault = () => {
        defaultPrevented = true;
      };
      
      canvas.dispatchEvent(contextMenuEvent);
      
      expect(defaultPrevented).toBe(true);
    });
  });
});
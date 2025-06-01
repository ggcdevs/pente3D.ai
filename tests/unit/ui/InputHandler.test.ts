import { InputHandler, InputHandlerOptions } from '@/ui/InputHandler';
import { Game } from '@/core/Game';
import { Renderer } from '@/rendering/Renderer';
import { Vector3 } from '@/core/Vector3';
import { Player } from '@/core/Player';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

// Mock Three.js
jest.mock('three');
jest.mock('three/examples/jsm/controls/OrbitControls');

describe('InputHandler', () => {
  let inputHandler: InputHandler;
  let mockCanvas: HTMLCanvasElement;
  let mockCamera: THREE.Camera;
  let mockScene: THREE.Scene;
  let mockControls: OrbitControls;
  let mockGame: Game;
  let mockRenderer: Renderer;
  let mockRaycaster: jest.Mocked<THREE.Raycaster>;
  
  beforeEach(() => {
    // Create mock canvas
    mockCanvas = document.createElement('canvas');
    mockCanvas.getBoundingClientRect = jest.fn(() => ({
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
    
    // Mock Three.js objects
    mockCamera = new THREE.PerspectiveCamera();
    mockScene = new THREE.Scene();
    mockControls = new OrbitControls(mockCamera, mockCanvas);
    
    // Mock raycaster
    mockRaycaster = {
      setFromCamera: jest.fn(),
      intersectObjects: jest.fn(() => [])
    } as any;
    (THREE.Raycaster as jest.Mock).mockImplementation(() => mockRaycaster);
    
    // Mock Game
    mockGame = {
      placePiece: jest.fn(),
      getCurrentPlayer: jest.fn(() => ({ id: 'black', name: 'Black' })),
      undo: jest.fn(),
      redo: jest.fn()
    } as any;
    
    // Mock Renderer
    mockRenderer = {
      highlightPosition: jest.fn(),
      unhighlightPosition: jest.fn(),
      setTemporaryPiece: jest.fn(),
      clearTemporaryPiece: jest.fn(),
      updatePieces: jest.fn()
    } as any;
    
    const options: InputHandlerOptions = {
      canvas: mockCanvas,
      camera: mockCamera,
      scene: mockScene,
      controls: mockControls,
      game: mockGame,
      renderer: mockRenderer
    };
    
    inputHandler = new InputHandler(options);
  });
  
  afterEach(() => {
    inputHandler.dispose();
    jest.clearAllMocks();
  });
  
  describe('constructor', () => {
    it('should initialize with provided options', () => {
      expect(inputHandler).toBeDefined();
      expect(inputHandler.getState()).toMatchObject({
        hoveredPosition: null,
        selectedPosition: null,
        temporaryPieceMode: false,
        temporaryPosition: null,
        mouseDown: false,
        mouseButton: -1,
        doubleClickThreshold: 300
      });
    });
  });
  
  describe('mouse events', () => {
    describe('mousemove', () => {
      it('should update mouse position and perform raycast', () => {
        const mockMesh = new THREE.Mesh();
        mockMesh.userData = {
          type: 'intersection',
          position: Vector3.create(3, 3, 3)
        };
        const mockIntersection = {
          object: mockMesh
        };
        mockRaycaster.intersectObjects.mockReturnValue([mockIntersection] as any);
        
        const event = new MouseEvent('mousemove', {
          clientX: 400,
          clientY: 300
        });
        
        mockCanvas.dispatchEvent(event);
        
        expect(mockRaycaster.setFromCamera).toHaveBeenCalled();
        expect(mockRaycaster.intersectObjects).toHaveBeenCalledWith(mockScene.children, true);
        expect(mockRenderer.highlightPosition).toHaveBeenCalledWith(Vector3.create(3, 3, 3));
      });
      
      it('should update temporary piece position in temporary mode', () => {
        inputHandler.setTemporaryPieceMode(true);
        
        const mockMesh = new THREE.Mesh();
        mockMesh.userData = {
          type: 'intersection',
          position: Vector3.create(3, 3, 3)
        };
        const mockIntersection = {
          object: mockMesh
        };
        mockRaycaster.intersectObjects.mockReturnValue([mockIntersection] as any);
        
        const event = new MouseEvent('mousemove', {
          clientX: 400,
          clientY: 300
        });
        
        mockCanvas.dispatchEvent(event);
        
        expect(mockRenderer.setTemporaryPiece).toHaveBeenCalledWith(
          Vector3.create(3, 3, 3),
          expect.objectContaining({ id: 'black' })
        );
      });
      
      it('should unhighlight previous position when hovering new position', () => {
        const position1 = Vector3.create(3, 3, 3);
        const position2 = Vector3.create(4, 4, 4);
        
        // First hover
        const mockMesh1 = new THREE.Mesh();
        mockMesh1.userData = { type: 'intersection', position: position1 };
        mockRaycaster.intersectObjects.mockReturnValue([{
          object: mockMesh1
        }] as any);
        
        mockCanvas.dispatchEvent(new MouseEvent('mousemove', {
          clientX: 400,
          clientY: 300
        }));
        
        // Second hover
        const mockMesh2 = new THREE.Mesh();
        mockMesh2.userData = { type: 'intersection', position: position2 };
        mockRaycaster.intersectObjects.mockReturnValue([{
          object: mockMesh2
        }] as any);
        
        mockCanvas.dispatchEvent(new MouseEvent('mousemove', {
          clientX: 500,
          clientY: 400
        }));
        
        expect(mockRenderer.unhighlightPosition).toHaveBeenCalledWith(position1);
        expect(mockRenderer.highlightPosition).toHaveBeenCalledWith(position2);
      });
    });
    
    describe('click', () => {
      it('should place piece on left click', () => {
        const position = Vector3.create(3, 3, 3);
        const mockMesh = new THREE.Mesh();
        mockMesh.userData = { type: 'intersection', position };
        mockRaycaster.intersectObjects.mockReturnValue([{
          object: mockMesh
        }] as any);
        
        mockGame.placePiece.mockReturnValue(true);
        
        const listener = jest.fn();
        inputHandler.on('piecePlaced', listener);
        
        const event = new MouseEvent('click', {
          clientX: 400,
          clientY: 300,
          button: 0
        });
        
        mockCanvas.dispatchEvent(event);
        
        expect(mockGame.placePiece).toHaveBeenCalledWith(position);
        expect(listener).toHaveBeenCalledWith({ position });
      });
      
      it('should emit invalidMove event on failed placement', () => {
        const position = Vector3.create(3, 3, 3);
        const error = new Error('Position occupied');
        
        const mockMesh = new THREE.Mesh();
        mockMesh.userData = { type: 'intersection', position };
        mockRaycaster.intersectObjects.mockReturnValue([{
          object: mockMesh
        }] as any);
        
        mockGame.placePiece.mockImplementation(() => {
          throw error;
        });
        
        const listener = jest.fn();
        inputHandler.on('invalidMove', listener);
        
        const event = new MouseEvent('click', {
          clientX: 400,
          clientY: 300,
          button: 0
        });
        
        mockCanvas.dispatchEvent(event);
        
        expect(listener).toHaveBeenCalledWith({ position, error });
      });
      
      it('should not place piece on right click', () => {
        const event = new MouseEvent('click', {
          clientX: 400,
          clientY: 300,
          button: 2
        });
        
        mockCanvas.dispatchEvent(event);
        
        expect(mockGame.placePiece).not.toHaveBeenCalled();
      });
    });
    
    describe('mousedown/mouseup', () => {
      it('should disable controls on left mouse down', () => {
        const event = new MouseEvent('mousedown', { button: 0 });
        mockCanvas.dispatchEvent(event);
        
        expect(mockControls.enabled).toBe(false);
        expect(inputHandler.getState().mouseDown).toBe(true);
        expect(inputHandler.getState().mouseButton).toBe(0);
      });
      
      it('should re-enable controls on mouse up', () => {
        mockCanvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
        mockCanvas.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
        
        expect(mockControls.enabled).toBe(true);
        expect(inputHandler.getState().mouseDown).toBe(false);
        expect(inputHandler.getState().mouseButton).toBe(-1);
      });
    });
  });
  
  describe('keyboard events', () => {
    it('should handle undo shortcut (Ctrl+Z)', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true
      });
      
      window.dispatchEvent(event);
      
      expect(mockGame.undo).toHaveBeenCalled();
    });
    
    it('should handle redo shortcut (Ctrl+Y)', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'y',
        ctrlKey: true
      });
      
      window.dispatchEvent(event);
      
      expect(mockGame.redo).toHaveBeenCalled();
    });
    
    it('should handle redo shortcut (Ctrl+Shift+Z)', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        shiftKey: true
      });
      
      window.dispatchEvent(event);
      
      expect(mockGame.redo).toHaveBeenCalled();
    });
    
    it('should toggle temporary piece mode with T key', () => {
      const listener = jest.fn();
      inputHandler.on('temporaryModeChanged', listener);
      
      const event = new KeyboardEvent('keydown', { key: 't' });
      window.dispatchEvent(event);
      
      expect(inputHandler.getState().temporaryPieceMode).toBe(true);
      expect(listener).toHaveBeenCalledWith({ enabled: true });
      
      window.dispatchEvent(event);
      
      expect(inputHandler.getState().temporaryPieceMode).toBe(false);
      expect(listener).toHaveBeenCalledWith({ enabled: false });
    });
    
    it('should cancel operations with Escape key', () => {
      // Set up some state
      inputHandler.setTemporaryPieceMode(true);
      
      const listener = jest.fn();
      inputHandler.on('operationCancelled', listener);
      
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      window.dispatchEvent(event);
      
      expect(inputHandler.getState().temporaryPieceMode).toBe(false);
      expect(mockRenderer.clearTemporaryPiece).toHaveBeenCalled();
      expect(listener).toHaveBeenCalled();
    });
    
    it('should reset view with R key', () => {
      const listener = jest.fn();
      inputHandler.on('viewReset', listener);
      
      mockControls.reset = jest.fn();
      
      const event = new KeyboardEvent('keydown', { key: 'r' });
      window.dispatchEvent(event);
      
      expect(mockControls.reset).toHaveBeenCalled();
      expect(listener).toHaveBeenCalled();
    });
    
    it('should emit toggleGrid event with G key', () => {
      const listener = jest.fn();
      inputHandler.on('toggleGrid', listener);
      
      const event = new KeyboardEvent('keydown', { key: 'g' });
      window.dispatchEvent(event);
      
      expect(listener).toHaveBeenCalled();
    });
  });
  
  describe('temporary piece mode', () => {
    it('should show temporary piece on click in temporary mode', () => {
      inputHandler.setTemporaryPieceMode(true);
      
      const position = Vector3.create(3, 3, 3);
      const mockMesh = new THREE.Mesh();
      mockMesh.userData = { type: 'intersection', position };
      mockRaycaster.intersectObjects.mockReturnValue([{
        object: mockMesh
      }] as any);
      
      const listener = jest.fn();
      inputHandler.on('temporaryPiecePlaced', listener);
      
      const event = new MouseEvent('click', {
        clientX: 400,
        clientY: 300,
        button: 0
      });
      
      mockCanvas.dispatchEvent(event);
      
      expect(mockRenderer.setTemporaryPiece).toHaveBeenCalledWith(
        position,
        expect.objectContaining({ id: 'black' })
      );
      expect(listener).toHaveBeenCalledWith({ position });
      expect(mockGame.placePiece).not.toHaveBeenCalled();
    });
    
    it('should confirm temporary piece on double click', () => {
      inputHandler.setTemporaryPieceMode(true);
      
      // Set temporary position
      const position = Vector3.create(3, 3, 3);
      const mockMesh = new THREE.Mesh();
      mockMesh.userData = { type: 'intersection', position };
      mockRaycaster.intersectObjects.mockReturnValue([{
        object: mockMesh
      }] as any);
      
      // Click to place temporary piece (this sets temporaryPosition)
      mockCanvas.dispatchEvent(new MouseEvent('click', {
        clientX: 400,
        clientY: 300,
        button: 0
      }));
      
      // Verify temporaryPosition is set
      expect(inputHandler.getState().temporaryPosition).toEqual(position);
      
      // Double click to confirm
      mockGame.placePiece.mockReturnValue(true);
      
      const listener = jest.fn();
      inputHandler.on('temporaryPieceConfirmed', listener);
      
      mockCanvas.dispatchEvent(new MouseEvent('dblclick', {
        clientX: 400,
        clientY: 300,
        button: 0
      }));
      
      expect(mockGame.placePiece).toHaveBeenCalledWith(position);
      expect(mockRenderer.clearTemporaryPiece).toHaveBeenCalled();
      expect(inputHandler.getState().temporaryPieceMode).toBe(false);
    });
  });
  
  describe('event system', () => {
    it('should register and emit events', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      
      inputHandler.on('test', listener1);
      inputHandler.on('test', listener2);
      
      // Emit through resize event
      window.dispatchEvent(new Event('resize'));
      
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
      
      // Verify resize event is emitted
      const resizeListener = jest.fn();
      inputHandler.on('resize', resizeListener);
      window.dispatchEvent(new Event('resize'));
      expect(resizeListener).toHaveBeenCalled();
    });
    
    it('should remove event listeners', () => {
      const listener = jest.fn();
      
      inputHandler.on('test', listener);
      inputHandler.off('test', listener);
      
      // Try to trigger through a different event
      const resizeListener = jest.fn();
      inputHandler.on('resize', resizeListener);
      window.dispatchEvent(new Event('resize'));
      
      expect(listener).not.toHaveBeenCalled();
      expect(resizeListener).toHaveBeenCalled();
    });
  });
  
  describe('dispose', () => {
    it('should clean up all resources', () => {
      const removeEventListenerSpy = jest.spyOn(mockCanvas, 'removeEventListener');
      const windowRemoveEventListenerSpy = jest.spyOn(window, 'removeEventListener');
      
      inputHandler.dispose();
      
      expect(removeEventListenerSpy).toHaveBeenCalledTimes(7); // All mouse events
      expect(windowRemoveEventListenerSpy).toHaveBeenCalledTimes(3); // keydown, keyup, resize
    });
  });
});
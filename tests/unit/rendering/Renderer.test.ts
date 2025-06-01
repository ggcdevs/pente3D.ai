import { Renderer, RendererOptions } from '@/rendering/Renderer';
import { Board } from '@/core/Board';
import { Vector3 } from '@/core/Vector3';
import { Player } from '@/core/Player';
import { Piece } from '@/core/Piece';

// THREE is mocked via jest.config.js moduleNameMapper
const THREE = require('three');

describe('Renderer', () => {
  let canvas: HTMLCanvasElement;
  let renderer: Renderer;
  
  beforeEach(() => {
    canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 600, configurable: true });
  });
  
  afterEach(() => {
    if (renderer) {
      renderer.dispose();
    }
  });
  
  describe('constructor', () => {
    it('should create renderer with default options', () => {
      renderer = new Renderer({ canvas });
      
      expect(renderer).toBeDefined();
      expect(renderer.getScene()).toBeDefined();
      expect(renderer.getCamera()).toBeDefined();
      expect(renderer.getRenderer()).toBeDefined();
      expect(renderer.getControls()).toBeDefined();
    });
    
    it('should create renderer with custom options', () => {
      const options: RendererOptions = {
        canvas,
        boardSize: 9,
        cellSize: 2,
        pieceSize: 0.5,
        backgroundColor: 0xff0000,
        gridColor: 0x00ff00,
        blackPieceColor: 0x0000ff,
        whitePieceColor: 0xffff00,
        temporaryOpacity: 0.7,
        antialias: false
      };
      
      renderer = new Renderer(options);
      
      expect(renderer).toBeDefined();
      expect(THREE.WebGLRenderer).toHaveBeenCalledWith({
        canvas,
        antialias: false
      });
    });
    
    it('should set up scene background color', () => {
      renderer = new Renderer({ canvas, backgroundColor: 0x123456 });
      
      const scene = renderer.getScene();
      expect(scene.background).toBeDefined();
    });
    
    it('should position camera correctly', () => {
      renderer = new Renderer({ canvas, boardSize: 7, cellSize: 1 });
      
      const camera = renderer.getCamera();
      expect(camera.position.set).toHaveBeenCalledWith(14, 14, 14);
      expect(camera.lookAt).toHaveBeenCalledWith(0, 0, 0);
    });
    
    it('should configure renderer settings', () => {
      renderer = new Renderer({ canvas });
      
      const webglRenderer = renderer.getRenderer();
      expect(webglRenderer.setSize).toHaveBeenCalledWith(800, 600);
      expect(webglRenderer.setPixelRatio).toHaveBeenCalledWith(window.devicePixelRatio);
    });
    
    it('should configure orbit controls', () => {
      renderer = new Renderer({ canvas, boardSize: 7, cellSize: 1 });
      
      const controls = renderer.getControls();
      expect(controls.enableDamping).toBe(true);
      expect(controls.dampingFactor).toBe(0.05);
      expect(controls.screenSpacePanning).toBe(false);
      expect(controls.minDistance).toBe(7);
      expect(controls.maxDistance).toBe(28);
    });
    
    it('should add lights to scene', () => {
      renderer = new Renderer({ canvas });
      
      const scene = renderer.getScene();
      expect(scene.add).toHaveBeenCalled();
    });
  });
  
  describe('setBoard', () => {
    beforeEach(() => {
      renderer = new Renderer({ canvas });
    });
    
    it('should create board grid when board is set', () => {
      const board = Board.createEmpty(7);
      renderer.setBoard(board);
      
      // Verify grid creation
      expect(renderer['gridGroup'].add).toHaveBeenCalled();
    });
    
    it('should update pieces when board is set', () => {
      const board = Board.createEmpty(7);
      const player = Player.createLocal('black', 'Black Player');
      const position = Vector3.create(3, 3, 3);
      const boardWithPiece = board.placePiece(Piece.create(position, player));
      
      renderer.setBoard(boardWithPiece);
      
      // Verify piece creation
      expect(renderer['piecesGroup'].add).toHaveBeenCalled();
    });
    
    it('should handle empty board', () => {
      const board = Board.createEmpty(7);
      
      expect(() => renderer.setBoard(board)).not.toThrow();
    });
    
    it('should clear previous board when setting new one', () => {
      const board1 = Board.createEmpty(7);
      const board2 = Board.createEmpty(9);
      
      renderer.setBoard(board1);
      renderer.setBoard(board2);
      
      expect(renderer['gridGroup'].clear).toHaveBeenCalledTimes(2);
      expect(renderer['piecesGroup'].clear).toHaveBeenCalledTimes(2);
    });
  });
  
  describe('updatePieces', () => {
    beforeEach(() => {
      renderer = new Renderer({ canvas });
    });
    
    it('should clear and recreate all pieces', () => {
      const board = Board.createEmpty(7);
      const player1 = Player.createLocal('black', 'Black');
      const player2 = Player.createLocal('white', 'White');
      
      let currentBoard = board;
      currentBoard = currentBoard.placePiece(Piece.create(Vector3.create(3, 3, 3), player1));
      currentBoard = currentBoard.placePiece(Piece.create(Vector3.create(4, 4, 4), player2));
      
      renderer.setBoard(currentBoard);
      renderer.updatePieces();
      
      expect(renderer['piecesGroup'].clear).toHaveBeenCalled();
      expect(renderer['temporaryPiecesGroup'].clear).toHaveBeenCalled();
    });
    
    it('should separate permanent and temporary pieces', () => {
      const board = Board.createEmpty(7);
      const player = Player.createLocal('black', 'Black');
      
      let currentBoard = board;
      currentBoard = currentBoard.placePiece(Piece.create(Vector3.create(3, 3, 3), player, false));
      currentBoard = currentBoard.placePiece(Piece.create(Vector3.create(4, 4, 4), player, true));
      
      renderer.setBoard(currentBoard);
      
      expect(renderer['piecesGroup'].add).toHaveBeenCalled();
      expect(renderer['temporaryPiecesGroup'].add).toHaveBeenCalled();
    });
    
    it('should position pieces correctly in 3D space', () => {
      const board = Board.createEmpty(7);
      const player = Player.createLocal('black', 'Black');
      const position = Vector3.create(3, 4, 5);
      
      const currentBoard = board.placePiece(Piece.create(position, player));
      renderer.setBoard(currentBoard);
      
      const mockMesh = THREE.Mesh as jest.MockedClass<typeof THREE.Mesh>;
      const instances = mockMesh.mock.instances;
      expect(instances.length).toBeGreaterThan(0);
      
      // Check if position.set was called with correct coordinates
      const expectedX = 3 * 1 - 3; // (x * cellSize - halfSize)
      const expectedY = 4 * 1 - 3; // (y * cellSize - halfSize)
      const expectedZ = 5 * 1 - 3; // (z * cellSize - halfSize)
      
      const pieceMesh = instances.find(mesh => 
        mesh.position.set.mock.calls.some(call => 
          call[0] === expectedX && call[1] === expectedY && call[2] === expectedZ
        )
      );
      
      expect(pieceMesh).toBeDefined();
    });
    
    it('should handle board with no pieces', () => {
      const board = Board.createEmpty(7);
      
      expect(() => {
        renderer.setBoard(board);
        renderer.updatePieces();
      }).not.toThrow();
    });
  });
  
  describe('temporary pieces', () => {
    beforeEach(() => {
      renderer = new Renderer({ canvas });
      renderer.setBoard(Board.createEmpty(7));
    });
    
    it('should add temporary piece at position', () => {
      const position = Vector3.create(3, 3, 3);
      const player = Player.createLocal('black', 'Black');
      
      renderer.addTemporaryPiece(position, player);
      
      expect(renderer['temporaryPiecesGroup'].add).toHaveBeenCalled();
    });
    
    it('should remove temporary piece at position', () => {
      const position = Vector3.create(3, 3, 3);
      const player = Player.createLocal('black', 'Black');
      
      renderer.addTemporaryPiece(position, player);
      renderer.removeTemporaryPiece(position);
      
      expect(renderer['temporaryPiecesGroup'].traverse).toHaveBeenCalled();
    });
    
    it('should clear all temporary pieces', () => {
      const player = Player.createLocal('black', 'Black');
      
      renderer.addTemporaryPiece(Vector3.create(1, 1, 1), player);
      renderer.addTemporaryPiece(Vector3.create(2, 2, 2), player);
      renderer.addTemporaryPiece(Vector3.create(3, 3, 3), player);
      
      renderer.clearTemporaryPieces();
      
      expect(renderer['temporaryPiecesGroup'].clear).toHaveBeenCalled();
    });
    
    it('should store position data in mesh userData', () => {
      const position = Vector3.create(3, 3, 3);
      const player = Player.createLocal('black', 'Black');
      
      renderer.addTemporaryPiece(position, player);
      
      const mockMesh = THREE.Mesh as jest.MockedClass<typeof THREE.Mesh>;
      const instances = mockMesh.mock.instances;
      const tempPiece = instances[instances.length - 1];
      
      expect(tempPiece.userData).toEqual({ position });
    });
  });
  
  describe('highlighting', () => {
    beforeEach(() => {
      renderer = new Renderer({ canvas });
      jest.useFakeTimers();
    });
    
    afterEach(() => {
      jest.useRealTimers();
    });
    
    it('should highlight position with default color', () => {
      const position = Vector3.create(3, 3, 3);
      
      renderer.highlightPosition(position);
      
      expect(renderer.getScene().add).toHaveBeenCalled();
    });
    
    it('should highlight position with custom color', () => {
      const position = Vector3.create(3, 3, 3);
      const color = 0xff0000;
      
      renderer.highlightPosition(position, color);
      
      expect(renderer.getScene().add).toHaveBeenCalled();
    });
    
    it('should remove highlight after timeout', () => {
      const position = Vector3.create(3, 3, 3);
      
      renderer.highlightPosition(position);
      
      expect(renderer.getScene().remove).not.toHaveBeenCalled();
      
      jest.advanceTimersByTime(1000);
      
      expect(renderer.getScene().remove).toHaveBeenCalled();
    });
  });
  
  describe('render loop', () => {
    beforeEach(() => {
      renderer = new Renderer({ canvas });
    });
    
    it('should start render loop', () => {
      const rafSpy = jest.spyOn(window, 'requestAnimationFrame');
      
      renderer.startRenderLoop();
      
      expect(rafSpy).toHaveBeenCalled();
    });
    
    it('should not start multiple render loops', () => {
      const rafSpy = jest.spyOn(window, 'requestAnimationFrame');
      
      renderer.startRenderLoop();
      const callCount = rafSpy.mock.calls.length;
      
      renderer.startRenderLoop();
      
      expect(rafSpy).toHaveBeenCalledTimes(callCount);
    });
    
    it('should stop render loop', () => {
      const cafSpy = jest.spyOn(window, 'cancelAnimationFrame');
      
      renderer.startRenderLoop();
      renderer.stopRenderLoop();
      
      expect(cafSpy).toHaveBeenCalled();
    });
    
    it('should update controls in render loop', () => {
      renderer.startRenderLoop();
      
      // Simulate animation frame
      const controls = renderer.getControls();
      expect(controls.update).toHaveBeenCalled();
    });
  });
  
  describe('resize handling', () => {
    beforeEach(() => {
      renderer = new Renderer({ canvas });
    });
    
    it('should handle window resize', () => {
      Object.defineProperty(canvas, 'clientWidth', { value: 1024 });
      Object.defineProperty(canvas, 'clientHeight', { value: 768 });
      
      window.dispatchEvent(new Event('resize'));
      
      const camera = renderer.getCamera() as any;
      expect(camera.aspect).toBe(1024 / 768);
      expect(camera.updateProjectionMatrix).toHaveBeenCalled();
      
      const webglRenderer = renderer.getRenderer();
      expect(webglRenderer.setSize).toHaveBeenCalledWith(1024, 768);
    });
    
    it('should render after resize', () => {
      const renderSpy = jest.spyOn(renderer, 'render');
      
      window.dispatchEvent(new Event('resize'));
      
      expect(renderSpy).toHaveBeenCalled();
    });
  });
  
  describe('disposal', () => {
    beforeEach(() => {
      renderer = new Renderer({ canvas });
    });
    
    it('should stop render loop on dispose', () => {
      const stopSpy = jest.spyOn(renderer, 'stopRenderLoop');
      
      renderer.dispose();
      
      expect(stopSpy).toHaveBeenCalled();
    });
    
    it('should dispose Three.js resources', () => {
      const board = Board.createEmpty(7);
      const player = Player.createLocal('black', 'Black');
      const boardWithPiece = board.placePiece(Piece.create(Vector3.create(3, 3, 3), player));
      
      renderer.setBoard(boardWithPiece);
      renderer.dispose();
      
      const webglRenderer = renderer.getRenderer();
      expect(webglRenderer.dispose).toHaveBeenCalled();
      
      const controls = renderer.getControls();
      expect(controls.dispose).toHaveBeenCalled();
    });
    
    it('should remove event listeners', () => {
      const removeSpy = jest.spyOn(window, 'removeEventListener');
      
      renderer.dispose();
      
      expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    });
  });
  
  describe('render method', () => {
    beforeEach(() => {
      renderer = new Renderer({ canvas });
    });
    
    it('should render scene', () => {
      const webglRenderer = renderer.getRenderer();
      const scene = renderer.getScene();
      const camera = renderer.getCamera();
      
      renderer.render();
      
      expect(webglRenderer.render).toHaveBeenCalledWith(scene, camera);
    });
    
    it('should render when controls change', () => {
      const renderSpy = jest.spyOn(renderer, 'render');
      const controls = renderer.getControls();
      
      // Simulate control change event
      const changeCallback = controls.addEventListener.mock.calls.find(
        call => call[0] === 'change'
      )?.[1];
      
      if (changeCallback) {
        changeCallback();
      }
      
      expect(renderSpy).toHaveBeenCalled();
    });
  });
});
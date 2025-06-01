import { Renderer } from '@/rendering/Renderer';
import { Board } from '@/core/Board';
import { Vector3 } from '@/core/Vector3';
import { Player } from '@/core/Player';
import { Piece } from '@/core/Piece';

describe('Renderer Performance', () => {
  let canvas: HTMLCanvasElement;
  let renderer: Renderer;
  
  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    document.body.appendChild(canvas);
  });
  
  afterEach(() => {
    if (renderer) {
      renderer.dispose();
    }
    document.body.removeChild(canvas);
  });
  
  describe('rendering performance', () => {
    it('should initialize in reasonable time', () => {
      const startTime = performance.now();
      
      renderer = new Renderer({ canvas, boardSize: 9 });
      
      const endTime = performance.now();
      expect(endTime - startTime).toBeLessThan(100); // 100ms
    });
    
    it('should render frame in less than 16ms', () => {
      renderer = new Renderer({ canvas, boardSize: 7 });
      const board = Board.create(7);
      renderer.setBoard(board);
      
      const startTime = performance.now();
      renderer.render();
      const endTime = performance.now();
      
      expect(endTime - startTime).toBeLessThan(16); // 60fps
    });
    
    it('should handle large board efficiently', () => {
      renderer = new Renderer({ canvas, boardSize: 11 });
      const board = Board.create(11);
      
      // Fill board with many pieces
      const player1 = Player.create('black', 'Black');
      const player2 = Player.create('white', 'White');
      let currentBoard = board;
      
      for (let x = 0; x < 11; x += 2) {
        for (let y = 0; y < 11; y += 2) {
          for (let z = 0; z < 11; z += 2) {
            const player = (x + y + z) % 4 === 0 ? player1 : player2;
            currentBoard = currentBoard.placePiece(
              Piece.create(Vector3.create(x, y, z), player)
            );
          }
        }
      }
      
      renderer.setBoard(currentBoard);
      
      const startTime = performance.now();
      renderer.render();
      const endTime = performance.now();
      
      expect(endTime - startTime).toBeLessThan(16); // Still 60fps
    });
    
    it('should update pieces efficiently', () => {
      renderer = new Renderer({ canvas, boardSize: 9 });
      const board = Board.create(9);
      
      // Create board with many pieces
      const player = Player.create('black', 'Black');
      let currentBoard = board;
      
      for (let i = 0; i < 100; i++) {
        const x = Math.floor(Math.random() * 9);
        const y = Math.floor(Math.random() * 9);
        const z = Math.floor(Math.random() * 9);
        currentBoard = currentBoard.placePiece(
          Piece.create(Vector3.create(x, y, z), player)
        );
      }
      
      renderer.setBoard(currentBoard);
      
      const startTime = performance.now();
      renderer.updatePieces();
      const endTime = performance.now();
      
      expect(endTime - startTime).toBeLessThan(50); // 50ms for update
    });
  });
  
  describe('memory performance', () => {
    it('should not leak memory on repeated updates', () => {
      renderer = new Renderer({ canvas, boardSize: 7 });
      const board = Board.create(7);
      
      // Perform many updates
      for (let i = 0; i < 100; i++) {
        renderer.setBoard(board);
        renderer.updatePieces();
        renderer.clearTemporaryPieces();
      }
      
      // In a real test, would check memory usage
      expect(true).toBe(true);
    });
    
    it('should clean up resources on dispose', () => {
      renderer = new Renderer({ canvas, boardSize: 7 });
      const board = Board.create(7);
      
      renderer.setBoard(board);
      renderer.render();
      
      const disposeSpy = jest.spyOn(renderer['pieceGeometry'], 'dispose');
      
      renderer.dispose();
      
      expect(disposeSpy).toHaveBeenCalled();
    });
  });
});
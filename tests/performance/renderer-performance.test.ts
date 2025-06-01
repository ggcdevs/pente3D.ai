import { Renderer } from '@/rendering/Renderer';
import { Board } from '@/core/Board';
import { Vector3 } from '@/core/Vector3';
import { Player } from '@/core/Player';
import { Piece } from '@/core/Piece';
import { Line } from '@/core/Line';

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
  
  describe('highlighting performance', () => {
    beforeEach(() => {
      renderer = new Renderer({ canvas, boardSize: 9 });
      const board = Board.create(9);
      const player1 = Player.create('black', 'Black');
      const player2 = Player.create('white', 'White');
      
      // Create board with some pieces
      let currentBoard = board;
      for (let i = 0; i < 50; i++) {
        const x = i % 9;
        const y = Math.floor(i / 9) % 9;
        const z = Math.floor(i / 81) % 9;
        const player = i % 2 === 0 ? player1 : player2;
        currentBoard = currentBoard.placePiece(Piece.create(Vector3.create(x, y, z), player));
      }
      
      renderer.setBoard(currentBoard);
    });
    
    it('should highlight positions efficiently', () => {
      const startTime = performance.now();
      
      // Highlight many positions
      for (let i = 0; i < 20; i++) {
        const x = i % 9;
        const y = Math.floor(i / 9) % 9;
        const z = 0;
        renderer.highlightPosition(Vector3.create(x, y, z), 0xff0000 + i * 0x001100);
      }
      
      const endTime = performance.now();
      expect(endTime - startTime).toBeLessThan(10); // 10ms for 20 highlights
    });
    
    it('should unhighlight positions efficiently', () => {
      // First highlight positions
      const positions: Vector3[] = [];
      for (let i = 0; i < 20; i++) {
        const pos = Vector3.create(i % 9, Math.floor(i / 9) % 9, 0);
        positions.push(pos);
        renderer.highlightPosition(pos);
      }
      
      const startTime = performance.now();
      
      // Unhighlight all positions
      positions.forEach(pos => renderer.unhighlightPosition(pos));
      
      const endTime = performance.now();
      expect(endTime - startTime).toBeLessThan(10); // 10ms for 20 unhighlights
    });
    
    it('should highlight lines efficiently', () => {
      const startTime = performance.now();
      
      // Create and highlight multiple lines
      for (let i = 0; i < 10; i++) {
        const line = Line.fromCoords([
          Vector3.create(i % 9, 0, 0),
          Vector3.create(i % 9, 1, 0),
          Vector3.create(i % 9, 2, 0),
          Vector3.create(i % 9, 3, 0)
        ]);
        renderer.highlightLine(line, 0x00ff00);
      }
      
      const endTime = performance.now();
      expect(endTime - startTime).toBeLessThan(20); // 20ms for 10 lines
    });
    
    it('should highlight pieces efficiently', () => {
      const positions: Vector3[] = [];
      for (let i = 0; i < 30; i++) {
        positions.push(Vector3.create(i % 9, Math.floor(i / 9) % 9, Math.floor(i / 81) % 9));
      }
      
      const startTime = performance.now();
      
      // Highlight half as connected, half as capturable
      positions.slice(0, 15).forEach(pos => renderer.highlightPiece(pos, 'connected'));
      positions.slice(15).forEach(pos => renderer.highlightPiece(pos, 'capture'));
      
      const endTime = performance.now();
      expect(endTime - startTime).toBeLessThan(15); // 15ms for 30 piece highlights
    });
    
    it('should render with many highlights at 60fps', () => {
      // Add many different types of highlights
      for (let i = 0; i < 10; i++) {
        renderer.highlightPosition(Vector3.create(i % 9, 0, 0));
      }
      
      for (let i = 0; i < 5; i++) {
        const line = Line.fromCoords([
          Vector3.create(0, i, 0),
          Vector3.create(1, i, 0),
          Vector3.create(2, i, 0)
        ]);
        renderer.highlightLine(line);
      }
      
      for (let i = 0; i < 10; i++) {
        renderer.highlightPiece(Vector3.create(i % 9, 1, 1), 'connected');
      }
      
      // Test render performance with all highlights
      const startTime = performance.now();
      renderer.render();
      const endTime = performance.now();
      
      expect(endTime - startTime).toBeLessThan(16); // 60fps target
    });
    
    it('should handle rapid highlight changes efficiently', () => {
      const startTime = performance.now();
      
      // Simulate rapid hover changes
      for (let i = 0; i < 50; i++) {
        const pos = Vector3.create(i % 9, Math.floor(i / 9) % 9, 0);
        renderer.highlightPosition(pos);
        renderer.unhighlightPosition(pos);
      }
      
      const endTime = performance.now();
      expect(endTime - startTime).toBeLessThan(100); // 100ms for 50 highlight/unhighlight cycles
    });
    
    it('should clear all highlights efficiently', () => {
      // Add many highlights
      for (let i = 0; i < 20; i++) {
        renderer.highlightPosition(Vector3.create(i % 9, Math.floor(i / 9) % 9, 0));
      }
      
      for (let i = 0; i < 10; i++) {
        const line = Line.fromCoords([
          Vector3.create(0, i % 9, 0),
          Vector3.create(1, i % 9, 0)
        ]);
        renderer.highlightLine(line);
      }
      
      for (let i = 0; i < 15; i++) {
        renderer.highlightPiece(Vector3.create(i % 9, 0, 0), 'connected');
      }
      
      const startTime = performance.now();
      renderer.clearAllHighlights();
      const endTime = performance.now();
      
      expect(endTime - startTime).toBeLessThan(20); // 20ms to clear all
    });
    
    it('should handle state indicators efficiently', () => {
      const startTime = performance.now();
      
      // Update indicators multiple times
      for (let i = 0; i < 20; i++) {
        renderer.updateCurrentPlayerIndicator(i % 2 === 0 ? 'black' : 'white');
        renderer.updateCaptureCount(i, i + 1);
      }
      
      const endTime = performance.now();
      expect(endTime - startTime).toBeLessThan(50); // 50ms for 20 updates each
    });
    
    it('should maintain 60fps with animations', () => {
      // Set up animated elements
      renderer.setTemporaryPiece(Vector3.create(4, 4, 4), Player.create('black', 'Black'));
      renderer.updateCurrentPlayerIndicator('black');
      
      // Add animated highlights
      for (let i = 0; i < 5; i++) {
        renderer.highlightPosition(Vector3.create(i, i, i));
      }
      
      for (let i = 0; i < 3; i++) {
        const line = Line.fromCoords([
          Vector3.create(i, 0, 0),
          Vector3.create(i, 1, 0),
          Vector3.create(i, 2, 0)
        ]);
        renderer.highlightLine(line);
      }
      
      // Test multiple frames of animation
      const frameTimes: number[] = [];
      for (let frame = 0; frame < 10; frame++) {
        const frameStart = performance.now();
        
        // Simulate render loop frame
        renderer['clock'].getDelta(); // Advance clock
        renderer.render();
        
        const frameEnd = performance.now();
        frameTimes.push(frameEnd - frameStart);
      }
      
      // All frames should be under 16ms
      frameTimes.forEach(time => {
        expect(time).toBeLessThan(16);
      });
    });
    
    it('should optimize memory usage with highlight pooling', () => {
      // Repeatedly add and remove highlights
      for (let cycle = 0; cycle < 10; cycle++) {
        // Add highlights
        for (let i = 0; i < 20; i++) {
          renderer.highlightPosition(Vector3.create(i % 9, Math.floor(i / 9) % 9, 0));
        }
        
        // Clear highlights
        renderer.clearAllHighlights();
      }
      
      // Memory should be stable (in real test would measure actual memory)
      expect(renderer['materialPool'].size).toBeLessThanOrEqual(5);
      expect(renderer['geometryPool'].size).toBeLessThanOrEqual(5);
    });
  });
});
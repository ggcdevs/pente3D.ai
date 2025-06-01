import { Renderer } from '@/rendering/Renderer';
import { Board } from '@/core/Board';
import { Vector3 } from '@/core/Vector3';
import { Player } from '@/core/Player';
import { Piece } from '@/core/Piece';
import { Game } from '@/core/Game';

describe('Renderer Integration', () => {
  let canvas: HTMLCanvasElement;
  let renderer: Renderer;
  
  beforeEach(() => {
    // Create a real canvas element
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    document.body.appendChild(canvas);
    
    // Mock WebGL context
    const mockContext = {
      getParameter: jest.fn().mockReturnValue(1024),
      getExtension: jest.fn(),
      createTexture: jest.fn(),
      bindTexture: jest.fn(),
      texParameteri: jest.fn(),
      texImage2D: jest.fn(),
      createShader: jest.fn(),
      shaderSource: jest.fn(),
      compileShader: jest.fn(),
      getShaderParameter: jest.fn().mockReturnValue(true),
      createProgram: jest.fn(),
      attachShader: jest.fn(),
      linkProgram: jest.fn(),
      getProgramParameter: jest.fn().mockReturnValue(true),
      useProgram: jest.fn(),
      createBuffer: jest.fn(),
      bindBuffer: jest.fn(),
      bufferData: jest.fn(),
      enableVertexAttribArray: jest.fn(),
      vertexAttribPointer: jest.fn(),
      uniformMatrix4fv: jest.fn(),
      createFramebuffer: jest.fn(),
      bindFramebuffer: jest.fn(),
      framebufferTexture2D: jest.fn(),
      checkFramebufferStatus: jest.fn().mockReturnValue(36053), // FRAMEBUFFER_COMPLETE
      createRenderbuffer: jest.fn(),
      bindRenderbuffer: jest.fn(),
      renderbufferStorage: jest.fn(),
      framebufferRenderbuffer: jest.fn(),
      viewport: jest.fn(),
      clear: jest.fn(),
      clearColor: jest.fn(),
      enable: jest.fn(),
      disable: jest.fn(),
      depthFunc: jest.fn(),
      blendFunc: jest.fn(),
      cullFace: jest.fn(),
      frontFace: jest.fn(),
      drawArrays: jest.fn(),
      drawElements: jest.fn(),
      getUniformLocation: jest.fn(),
      getAttribLocation: jest.fn().mockReturnValue(0),
      uniform1f: jest.fn(),
      uniform1i: jest.fn(),
      uniform2f: jest.fn(),
      uniform3f: jest.fn(),
      uniform4f: jest.fn(),
      deleteShader: jest.fn(),
      deleteProgram: jest.fn(),
      deleteBuffer: jest.fn(),
      deleteTexture: jest.fn(),
      deleteFramebuffer: jest.fn(),
      deleteRenderbuffer: jest.fn(),
      canvas: canvas
    };
    
    jest.spyOn(canvas, 'getContext').mockReturnValue(mockContext as any);
  });
  
  afterEach(() => {
    if (renderer) {
      renderer.dispose();
    }
    document.body.removeChild(canvas);
  });
  
  describe('game integration', () => {
    it('should render game board correctly', () => {
      const game = new Game({ boardSize: 7 });
      
      expect(() => {
        renderer = new Renderer({ canvas, boardSize: 7 });
        renderer.setBoard(game.getBoard());
      }).not.toThrow();
    });
    
    it('should update when game state changes', () => {
      const game = new Game({ boardSize: 7 });
      renderer = new Renderer({ canvas, boardSize: 7 });
      
      // Initial board
      renderer.setBoard(game.getBoard());
      
      // Make a move
      game.placePiece(new Vector3(3, 3, 3));
      renderer.setBoard(game.getBoard());
      
      // Verify no errors
      expect(() => renderer.render()).not.toThrow();
    });
    
    it('should handle complete game workflow', () => {
      const game = new Game({ boardSize: 7 });
      renderer = new Renderer({ canvas, boardSize: 7 });
      
      // Play several moves
      const moves = [
        Vector3.create(3, 3, 3),
        Vector3.create(4, 3, 3),
        Vector3.create(3, 4, 3),
        Vector3.create(4, 4, 3),
        Vector3.create(3, 3, 4),
        Vector3.create(4, 3, 4)
      ];
      
      moves.forEach(move => {
        game.placePiece(move);
        renderer.setBoard(game.getBoard());
        expect(() => renderer.render()).not.toThrow();
      });
    });
  });
  
  describe('performance', () => {
    it('should maintain reasonable memory usage', () => {
      renderer = new Renderer({ canvas, boardSize: 9 });
      const board = Board.create(9);
      
      // Add many pieces
      const player1 = Player.create('black', 'Black');
      const player2 = Player.create('white', 'White');
      let currentBoard = board;
      
      for (let i = 0; i < 50; i++) {
        const x = i % 9;
        const y = Math.floor(i / 9) % 9;
        const z = Math.floor(i / 81) % 9;
        const player = i % 2 === 0 ? player1 : player2;
        currentBoard = currentBoard.placePiece(Piece.create(Vector3.create(x, y, z), player));
      }
      
      renderer.setBoard(currentBoard);
      
      // Update multiple times
      for (let i = 0; i < 10; i++) {
        renderer.updatePieces();
      }
      
      // Should not throw or leak memory
      expect(() => renderer.render()).not.toThrow();
    });
    
    it('should handle rapid updates', () => {
      renderer = new Renderer({ canvas, boardSize: 7 });
      const game = new Game({ boardSize: 7 });
      
      // Rapid sequence of operations
      for (let i = 0; i < 20; i++) {
        if (i % 3 === 0) {
          renderer.setBoard(game.getBoard());
        } else if (i % 3 === 1) {
          renderer.updatePieces();
        } else {
          renderer.render();
        }
      }
      
      expect(() => renderer.render()).not.toThrow();
    });
  });
  
  describe('edge cases', () => {
    it('should handle minimum board size', () => {
      renderer = new Renderer({ canvas, boardSize: 3 });
      const board = Board.create(3);
      
      expect(() => {
        renderer.setBoard(board);
        renderer.render();
      }).not.toThrow();
    });
    
    it('should handle maximum board size', () => {
      renderer = new Renderer({ canvas, boardSize: 11 });
      const board = Board.create(11);
      
      expect(() => {
        renderer.setBoard(board);
        renderer.render();
      }).not.toThrow();
    });
    
    it('should handle empty board updates', () => {
      renderer = new Renderer({ canvas, boardSize: 7 });
      const board = Board.create(7);
      
      renderer.setBoard(board);
      
      // Multiple updates on empty board
      for (let i = 0; i < 5; i++) {
        renderer.updatePieces();
      }
      
      expect(() => renderer.render()).not.toThrow();
    });
    
    it('should handle disposal and recreation', () => {
      renderer = new Renderer({ canvas, boardSize: 7 });
      const board = Board.create(7);
      
      renderer.setBoard(board);
      renderer.render();
      renderer.dispose();
      
      // Create new renderer with same canvas
      expect(() => {
        renderer = new Renderer({ canvas, boardSize: 7 });
        renderer.setBoard(board);
        renderer.render();
      }).not.toThrow();
    });
  });
  
  describe('temporary pieces workflow', () => {
    it('should manage temporary pieces lifecycle', () => {
      renderer = new Renderer({ canvas, boardSize: 7 });
      renderer.setBoard(Board.create(7));
      
      const player = Player.create('black', 'Black');
      const positions = [
        Vector3.create(1, 1, 1),
        Vector3.create(2, 2, 2),
        Vector3.create(3, 3, 3)
      ];
      
      // Add temporary pieces
      positions.forEach(pos => {
        renderer.addTemporaryPiece(pos, player);
      });
      
      // Remove specific piece
      renderer.removeTemporaryPiece(positions[1]);
      
      // Clear remaining
      renderer.clearTemporaryPieces();
      
      expect(() => renderer.render()).not.toThrow();
    });
    
    it('should handle mixed permanent and temporary pieces', () => {
      const board = Board.create(7);
      const player1 = Player.create('black', 'Black');
      const player2 = Player.create('white', 'White');
      
      // Add permanent pieces
      let currentBoard = board;
      currentBoard = currentBoard.placePiece(Piece.create(Vector3.create(3, 3, 3), player1));
      currentBoard = currentBoard.placePiece(Piece.create(Vector3.create(4, 4, 4), player2));
      
      renderer = new Renderer({ canvas, boardSize: 7 });
      renderer.setBoard(currentBoard);
      
      // Add temporary pieces
      renderer.addTemporaryPiece(Vector3.create(5, 5, 5), player1);
      renderer.addTemporaryPiece(Vector3.create(2, 2, 2), player2);
      
      expect(() => renderer.render()).not.toThrow();
    });
  });
  
  describe('visual features', () => {
    it('should apply highlight effects', () => {
      renderer = new Renderer({ canvas, boardSize: 7 });
      renderer.setBoard(Board.create(7));
      
      // Apply multiple highlights
      renderer.highlightPosition(Vector3.create(3, 3, 3));
      renderer.highlightPosition(Vector3.create(4, 4, 4), 0xff0000);
      renderer.highlightPosition(Vector3.create(5, 5, 5), 0x00ff00);
      
      expect(() => renderer.render()).not.toThrow();
    });
    
    it('should handle render loop lifecycle', () => {
      renderer = new Renderer({ canvas, boardSize: 7 });
      
      // Start and stop multiple times
      renderer.startRenderLoop();
      renderer.stopRenderLoop();
      renderer.startRenderLoop();
      renderer.stopRenderLoop();
      
      expect(() => renderer.render()).not.toThrow();
    });
  });
});
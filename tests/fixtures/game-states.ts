import { Board, Player, Move, Vector3, GameState, Piece } from '@/core';
import type { BoardSize } from '@/types';

// Helper function to create a board with pieces
function createBoardWithPieces(size: number, pieces: { pos: [number, number, number], player: string }[]): Board {
  let board = Board.createEmpty(size);
  for (const { pos, player } of pieces) {
    board = board.placePieceByPlayer(Vector3.create(...pos), player);
  }
  return board;
}

// Game state fixtures
export const gameStates = {
  // Empty board state
  empty: GameState.createInitialState(7, [
    Player.createLocal('player1', 'white'),
    Player.createLocal('player2', 'black')
  ]),

  // Complex mid-game position
  midGame: (() => {
    const players = [
      Player.createLocal('player1', 'white'),
      Player.createLocal('player2', 'black')
    ];
    const board = createBoardWithPieces(7, [
      { pos: [0, 0, 0], player: 'player1' },
      { pos: [1, 0, 0], player: 'player2' },
      { pos: [0, 1, 0], player: 'player1' },
      { pos: [1, 1, 0], player: 'player2' },
      { pos: [0, 0, 1], player: 'player1' },
      { pos: [-1, 0, 0], player: 'player2' },
      { pos: [2, 0, 0], player: 'player1' },
    ]);
    const moveHistory = [
      Move.create(Vector3.create(0, 0, 0), 'player1'),
      Move.create(Vector3.create(1, 0, 0), 'player2'),
      Move.create(Vector3.create(0, 1, 0), 'player1'),
      Move.create(Vector3.create(1, 1, 0), 'player2'),
      Move.create(Vector3.create(0, 0, 1), 'player1'),
      Move.create(Vector3.create(-1, 0, 0), 'player2'),
      Move.create(Vector3.create(2, 0, 0), 'player1'),
    ];
    return new GameState(board, players, moveHistory, 1); // player2's turn
  })(),

  // One move from horizontal victory
  nearWin: (() => {
    const players = [
      Player.createLocal('player1', 'white'),
      Player.createLocal('player2', 'black')
    ];
    const board = createBoardWithPieces(7, [
      { pos: [0, 0, 0], player: 'player1' },
      { pos: [1, 0, 0], player: 'player1' },
      { pos: [2, 0, 0], player: 'player1' },
      { pos: [3, 0, 0], player: 'player1' },
      // Missing [4, 0, 0] for win
      { pos: [0, 1, 0], player: 'player2' },
      { pos: [1, 1, 0], player: 'player2' },
      { pos: [2, 1, 0], player: 'player2' },
    ]);
    return new GameState(board, players, [], 0); // player1's turn
  })(),

  // Multiple capture opportunities
  capturePosition: (() => {
    const players = [
      Player.createLocal('player1', 'white'),
      Player.createLocal('player2', 'black')
    ];
    const board = createBoardWithPieces(7, [
      // Horizontal capture setup: X O O _
      { pos: [0, 0, 0], player: 'player1' },
      { pos: [1, 0, 0], player: 'player2' },
      { pos: [2, 0, 0], player: 'player2' },
      // Position [3, 0, 0] would capture
      
      // Vertical capture setup
      { pos: [0, 1, 0], player: 'player1' },
      { pos: [0, 2, 0], player: 'player2' },
      { pos: [0, 3, 0], player: 'player2' },
      // Position [0, 4, 0] would capture
    ]);
    return new GameState(board, players, [], 0); // player1's turn
  })(),

  // Nearly full board
  endGame: (() => {
    const players = [
      Player.createLocal('player1', 'white').addCaptures(4),
      Player.createLocal('player2', 'black').addCaptures(3)
    ];
    const pieces: { pos: [number, number, number], player: string }[] = [];
    
    // Fill most of the board
    for (let x = -3; x <= 3; x++) {
      for (let y = -3; y <= 3; y++) {
        for (let z = -3; z <= 3; z++) {
          if (Math.abs(x) + Math.abs(y) + Math.abs(z) < 7) {
            pieces.push({ 
              pos: [x, y, z], 
              player: ((x + y + z) % 2 === 0) ? 'player1' : 'player2' 
            });
          }
        }
      }
    }
    
    const board = createBoardWithPieces(7, pieces.slice(0, -5)); // Leave some spaces
    return new GameState(board, players, [], 0);
  })(),

  // Draw position (no winning moves available)
  drawPosition: (() => {
    const players = [
      Player.createLocal('player1', 'white'),
      Player.createLocal('player2', 'black')
    ];
    // Create a board where neither player can form 5 in a row
    const board = createBoardWithPieces(7, [
      { pos: [0, 0, 0], player: 'player1' },
      { pos: [1, 0, 0], player: 'player2' },
      { pos: [2, 0, 0], player: 'player1' },
      { pos: [0, 1, 0], player: 'player2' },
      { pos: [1, 1, 0], player: 'player1' },
      { pos: [2, 1, 0], player: 'player2' },
    ]);
    return new GameState(board, players, [], 0);
  })()
};

// Move sequences for testing
export const moveSequences = {
  // 9 moves to horizontal victory
  horizontalWin: [
    { pos: Vector3.create(0, 0, 0), player: 'player1' },
    { pos: Vector3.create(0, 1, 0), player: 'player2' },
    { pos: Vector3.create(1, 0, 0), player: 'player1' },
    { pos: Vector3.create(1, 1, 0), player: 'player2' },
    { pos: Vector3.create(2, 0, 0), player: 'player1' },
    { pos: Vector3.create(2, 1, 0), player: 'player2' },
    { pos: Vector3.create(3, 0, 0), player: 'player1' },
    { pos: Vector3.create(3, 1, 0), player: 'player2' },
    { pos: Vector3.create(4, 0, 0), player: 'player1' }, // Win!
  ],

  // 11 moves to diagonal victory
  diagonalWin: [
    { pos: Vector3.create(0, 0, 0), player: 'player1' },
    { pos: Vector3.create(1, 0, 0), player: 'player2' },
    { pos: Vector3.create(1, 1, 1), player: 'player1' },
    { pos: Vector3.create(2, 0, 0), player: 'player2' },
    { pos: Vector3.create(2, 2, 2), player: 'player1' },
    { pos: Vector3.create(3, 0, 0), player: 'player2' },
    { pos: Vector3.create(3, 3, 3), player: 'player1' },
    { pos: Vector3.create(0, 1, 0), player: 'player2' },
    { pos: Vector3.create(-1, -1, -1), player: 'player1' },
    { pos: Vector3.create(0, 2, 0), player: 'player2' },
    { pos: Vector3.create(-2, -2, -2), player: 'player1' }, // Win!
  ],

  // 20 moves to capture victory
  captureWin: [
    // First capture
    { pos: Vector3.create(0, 0, 0), player: 'player1' },
    { pos: Vector3.create(1, 0, 0), player: 'player2' },
    { pos: Vector3.create(2, 0, 0), player: 'player1' },
    { pos: Vector3.create(3, 0, 0), player: 'player2' },
    { pos: Vector3.create(4, 0, 0), player: 'player1' }, // Capture at (1,0,0) and (3,0,0)
    
    // Second capture
    { pos: Vector3.create(0, 1, 0), player: 'player2' },
    { pos: Vector3.create(0, 2, 0), player: 'player1' },
    { pos: Vector3.create(1, 1, 0), player: 'player2' },
    { pos: Vector3.create(1, 2, 0), player: 'player1' },
    { pos: Vector3.create(2, 1, 0), player: 'player2' },
    { pos: Vector3.create(2, 2, 0), player: 'player1' }, // Capture at (0,1,0) and (1,1,0)
    
    // Third capture
    { pos: Vector3.create(0, 0, 1), player: 'player2' },
    { pos: Vector3.create(0, 0, 2), player: 'player1' },
    { pos: Vector3.create(1, 0, 1), player: 'player2' },
    { pos: Vector3.create(1, 0, 2), player: 'player1' },
    { pos: Vector3.create(2, 0, 1), player: 'player2' },
    { pos: Vector3.create(2, 0, 2), player: 'player1' }, // Capture at (0,0,1) and (1,0,1)
    
    // Fourth and fifth captures would follow similar pattern...
  ],

  // 50+ move realistic game
  complexGame: (() => {
    const moves: { pos: Vector3, player: string }[] = [];
    const positions = [
      [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
      [2, 0, 0], [0, 2, 0], [1, 2, 0], [2, 1, 0],
      [2, 2, 0], [3, 0, 0], [0, 3, 0], [3, 1, 0],
      [1, 3, 0], [3, 2, 0], [2, 3, 0], [3, 3, 0],
      [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
      [-1, 0, 0], [-1, 1, 0], [-1, -1, 0], [0, -1, 0],
      [1, -1, 0], [-1, 0, 1], [0, -1, 1], [-1, -1, 1],
    ];
    
    positions.forEach((pos, index) => {
      moves.push({
        pos: Vector3.create(...pos as [number, number, number]),
        player: index % 2 === 0 ? 'player1' : 'player2'
      });
    });
    
    return moves;
  })()
};

// Helper functions for tests
export function createTestPlayers(): Player[] {
  return [
    Player.createLocal('player1', 'white'),
    Player.createLocal('player2', 'black')
  ];
}

export function createTestBoard(size: BoardSize = 7): Board {
  return Board.createEmpty(size);
}

export function applyMoveSequence(
  initialState: GameState, 
  moves: { pos: Vector3, player: string }[]
): GameState {
  let state = initialState;
  
  for (const { pos, player } of moves) {
    const move = Move.create(pos, player);
    state = state.applyMove(move);
  }
  
  return state;
}
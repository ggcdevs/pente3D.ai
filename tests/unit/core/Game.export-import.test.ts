import { Game, ExportedGame, ExportedGameCollection } from '@/core/Game';
import { Vector3 } from '@/core/Vector3';

describe('Game Export/Import', () => {
  let game: Game;

  beforeEach(() => {
    game = new Game({ boardSize: 9, blackFirst: true });
  });

  describe('exportGame', () => {
    it('should export empty game with metadata', () => {
      const exported = game.exportGame('Test Game', 'A test game export');
      const data = JSON.parse(exported) as ExportedGame;

      expect(data.version).toBe('1.0.0');
      expect(data.metadata.gameName).toBe('Test Game');
      expect(data.metadata.description).toBe('A test game export');
      expect(data.metadata.boardSize).toBe(9);
      expect(data.metadata.blackFirst).toBe(true);
      expect(data.metadata.moveCount).toBe(0);
      expect(data.metadata.winner).toBeNull();
      expect(data.metadata.captureCount.black).toBe(0);
      expect(data.metadata.captureCount.white).toBe(0);
    });

    it('should export game with moves', () => {
      const result1 = game.placePiece(new Vector3(4, 4, 4));
      expect(result1).toBe(true);
      const result2 = game.placePiece(new Vector3(4, 5, 4));
      expect(result2).toBe(true);
      
      const exported = game.exportGame();
      const data = JSON.parse(exported) as ExportedGame;

      expect(data.metadata.moveCount).toBe(2);
      expect(data.gameData.history).toHaveLength(3); // initial + 2 moves
      expect(data.gameData.currentStateIndex).toBe(2);
    });

    it('should include win information when game is won', () => {
      // Create a winning scenario
      const positions = [
        new Vector3(0, 0, 0), // black
        new Vector3(1, 0, 0), // white
        new Vector3(0, 1, 0), // black
        new Vector3(1, 1, 0), // white
        new Vector3(0, 2, 0), // black
        new Vector3(1, 2, 0), // white
        new Vector3(0, 3, 0), // black
        new Vector3(1, 3, 0), // white
        new Vector3(0, 4, 0), // black - wins
      ];

      positions.forEach(pos => game.placePiece(pos));

      const exported = game.exportGame();
      const data = JSON.parse(exported) as ExportedGame;

      expect(data.metadata.winner).toBe('black');
      expect(data.metadata.winType).toBe('five-in-a-row');
    });

    it('should include capture counts', () => {
      // Create a capture scenario
      game.placePiece(new Vector3(0, 0, 0)); // black
      game.placePiece(new Vector3(1, 0, 0)); // white
      game.placePiece(new Vector3(3, 0, 0)); // black
      game.placePiece(new Vector3(2, 0, 0)); // white - should capture black at (1,0,0)

      const exported = game.exportGame();
      const data = JSON.parse(exported) as ExportedGame;

      expect(data.metadata.captureCount.white).toBeGreaterThan(0);
    });

    it('should create valid JSON format', () => {
      const exported = game.exportGame();
      expect(() => JSON.parse(exported)).not.toThrow();
      
      const data = JSON.parse(exported) as ExportedGame;
      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('metadata');
      expect(data).toHaveProperty('gameData');
    });
  });

  describe('importGame', () => {
    it('should import exported game', () => {
      game.placePiece(new Vector3(4, 4, 4));
      game.placePiece(new Vector3(4, 5, 4));
      
      const exported = game.exportGame('Import Test');
      const imported = Game.importGame(exported);

      expect(imported.getMoveCount()).toBe(2);
      expect(imported.getOptions().boardSize).toBe(9);
      expect(imported.getOptions().blackFirst).toBe(true);
      expect(imported.getCurrentStateIndex()).toBe(2);
    });

    it('should handle old format for backward compatibility', () => {
      const oldFormat = {
        boardSize: 7,
        blackFirst: false,
        history: [game.getCurrentState().toJSON()],
        currentStateIndex: 0
      };

      const imported = Game.importGame(JSON.stringify(oldFormat));
      expect(imported.getOptions().boardSize).toBe(7);
      expect(imported.getOptions().blackFirst).toBe(false);
    });

    it('should throw error for invalid JSON', () => {
      expect(() => Game.importGame('invalid json')).toThrow('Failed to import game');
    });

    it('should throw error for unsupported version', () => {
      const futureVersion: ExportedGame = {
        version: '2.0.0',
        metadata: {
          exportedAt: new Date().toISOString(),
          boardSize: 9,
          blackFirst: true,
          moveCount: 0,
          winner: null,
          captureCount: { black: 0, white: 0 }
        },
        gameData: {
          options: { boardSize: 9, blackFirst: true },
          history: [],
          currentStateIndex: 0
        }
      };

      expect(() => Game.importGame(JSON.stringify(futureVersion)))
        .toThrow('Unsupported game version: 2.0.0');
    });

    it('should throw error for missing required fields', () => {
      const invalidData = {
        version: '1.0.0',
        metadata: {},
        gameData: {}
      };

      expect(() => Game.importGame(JSON.stringify(invalidData)))
        .toThrow('Invalid game data: missing required fields');
    });

    it('should throw error for invalid state index', () => {
      const invalidData: ExportedGame = {
        version: '1.0.0',
        metadata: {
          exportedAt: new Date().toISOString(),
          boardSize: 9,
          blackFirst: true,
          moveCount: 0,
          winner: null,
          captureCount: { black: 0, white: 0 }
        },
        gameData: {
          options: { boardSize: 9, blackFirst: true },
          history: [game.getCurrentState().toJSON()],
          currentStateIndex: 5 // Invalid - only 1 state
        }
      };

      expect(() => Game.importGame(JSON.stringify(invalidData)))
        .toThrow('Invalid current state index');
    });

    it('should restore game with undo/redo history', () => {
      game.placePiece(new Vector3(4, 4, 4));
      game.placePiece(new Vector3(4, 5, 4));
      game.placePiece(new Vector3(5, 4, 4));
      game.undo();
      
      const exported = game.exportGame();
      const imported = Game.importGame(exported);

      expect(imported.getCurrentStateIndex()).toBe(2);
      expect(imported.canRedo()).toBe(true);
      expect(imported.getMoveCount()).toBe(2);
    });

    it('should preserve compression options', () => {
      game.setCompressionOptions({
        maxHistorySize: 500,
        compressionThreshold: 250
      });

      const exported = game.exportGame();
      const imported = Game.importGame(exported);
      const importedData = JSON.parse(imported.exportGame()) as ExportedGame;

      expect(importedData.gameData.compressionOptions?.maxHistorySize).toBe(500);
      expect(importedData.gameData.compressionOptions?.compressionThreshold).toBe(250);
    });
  });

  describe('exportGames', () => {
    it('should export multiple games', () => {
      const game1 = new Game({ boardSize: 7 });
      game1.placePiece(new Vector3(3, 3, 3));
      
      const game2 = new Game({ boardSize: 9 });
      game2.placePiece(new Vector3(4, 4, 4));
      game2.placePiece(new Vector3(4, 5, 4));

      const exported = Game.exportGames([
        { game: game1, name: 'Game 1', description: 'First game' },
        { game: game2, name: 'Game 2', description: 'Second game' }
      ]);

      const collection = JSON.parse(exported) as ExportedGameCollection;
      expect(collection.version).toBe('1.0.0');
      expect(collection.games).toHaveLength(2);
      expect(collection.games[0].metadata.gameName).toBe('Game 1');
      expect(collection.games[0].metadata.moveCount).toBe(1);
      expect(collection.games[1].metadata.gameName).toBe('Game 2');
      expect(collection.games[1].metadata.moveCount).toBe(2);
    });

    it('should export empty collection', () => {
      const exported = Game.exportGames([]);
      const collection = JSON.parse(exported) as ExportedGameCollection;
      
      expect(collection.games).toHaveLength(0);
    });
  });

  describe('importGames', () => {
    it('should import game collection', () => {
      const game1 = new Game({ boardSize: 7 });
      game1.placePiece(new Vector3(3, 3, 3));
      
      const game2 = new Game({ boardSize: 9 });
      game2.placePiece(new Vector3(4, 4, 4));

      const exported = Game.exportGames([
        { game: game1, name: 'Game 1' },
        { game: game2, name: 'Game 2' }
      ]);

      const imported = Game.importGames(exported);
      
      expect(imported).toHaveLength(2);
      expect(imported[0].game.getOptions().boardSize).toBe(7);
      expect(imported[0].game.getMoveCount()).toBe(1);
      expect(imported[0].metadata.gameName).toBe('Game 1');
      
      expect(imported[1].game.getOptions().boardSize).toBe(9);
      expect(imported[1].game.getMoveCount()).toBe(1);
      expect(imported[1].metadata.gameName).toBe('Game 2');
    });

    it('should import single game as collection', () => {
      game.placePiece(new Vector3(4, 4, 4));
      const exported = game.exportGame('Single Game');
      
      const imported = Game.importGames(exported);
      
      expect(imported).toHaveLength(1);
      expect(imported[0].game.getMoveCount()).toBe(1);
      expect(imported[0].metadata.gameName).toBe('Single Game');
    });

    it('should handle old format single game', () => {
      const oldFormat = {
        boardSize: 7,
        blackFirst: false,
        history: [game.getCurrentState().toJSON()],
        currentStateIndex: 0
      };

      const imported = Game.importGames(JSON.stringify(oldFormat));
      
      expect(imported).toHaveLength(1);
      expect(imported[0].game.getOptions().boardSize).toBe(7);
      expect(imported[0].metadata.boardSize).toBe(7);
    });

    it('should throw error for invalid collection version', () => {
      const futureCollection = {
        version: '2.0.0',
        exportedAt: new Date().toISOString(),
        games: []
      };

      expect(() => Game.importGames(JSON.stringify(futureCollection)))
        .toThrow('Unsupported collection version: 2.0.0');
    });

    it('should throw error if any game in collection fails', () => {
      const invalidCollection = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        games: [
          {
            version: '1.0.0',
            metadata: {},
            gameData: {} // Invalid - missing required fields
          }
        ]
      };

      expect(() => Game.importGames(JSON.stringify(invalidCollection)))
        .toThrow('Failed to import game 1:');
    });

    it('should throw error for invalid JSON', () => {
      expect(() => Game.importGames('invalid json'))
        .toThrow('Failed to import games:');
    });
  });

  describe('round-trip consistency', () => {
    it('should maintain game state through export/import cycle', () => {
      // Make some moves
      const moves = [
        new Vector3(4, 4, 4),
        new Vector3(4, 5, 4),
        new Vector3(5, 4, 4),
        new Vector3(5, 5, 4),
        new Vector3(6, 4, 4)
      ];

      moves.forEach(move => game.placePiece(move));
      game.undo();
      game.undo();

      const originalState = game.getCurrentState();
      const originalMoveCount = game.getMoveCount();
      const originalIndex = game.getCurrentStateIndex();
      const originalCanRedo = game.canRedo();

      // Export and import
      const exported = game.exportGame('Round Trip Test');
      const imported = Game.importGame(exported);

      // Verify state is preserved
      expect(imported.getMoveCount()).toBe(originalMoveCount);
      expect(imported.getCurrentStateIndex()).toBe(originalIndex);
      expect(imported.canRedo()).toBe(originalCanRedo);
      expect(imported.getCurrentState().getHash()).toBe(originalState.getHash());
    });

    it('should maintain collection through export/import cycle', () => {
      const games = Array.from({ length: 3 }, (_, i) => {
        const g = new Game({ boardSize: 7 + i * 2 });
        for (let j = 0; j <= i; j++) {
          g.placePiece(new Vector3(j, j, j));
        }
        return { game: g, name: `Game ${i + 1}` };
      });

      const exported = Game.exportGames(games);
      const imported = Game.importGames(exported);

      expect(imported).toHaveLength(3);
      imported.forEach((item, i) => {
        expect(item.game.getOptions().boardSize).toBe(7 + i * 2);
        expect(item.game.getMoveCount()).toBe(i + 1);
        expect(item.metadata.gameName).toBe(`Game ${i + 1}`);
      });
    });
  });
});
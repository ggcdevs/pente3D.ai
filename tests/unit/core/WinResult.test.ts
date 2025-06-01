import { WinResult, Player, Line, Vector3 } from '@/core';

describe('WinResult', () => {
  // Test Group K: WinResult Construction
  describe('construction', () => {
    it('should create no-win result', () => {
      const result = new WinResult();
      
      expect(result.winner).toBeNull();
      expect(result.winningLine).toBeNull();
      expect(result.winType).toBeNull();
    });

    it('should create five-in-a-row win', () => {
      const player = Player.createLocal('winner', 'black');
      const line = Line.fromCoords([
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(2, 0, 0),
        new Vector3(3, 0, 0),
        new Vector3(4, 0, 0)
      ]);
      
      const result = new WinResult(player, line, 'five-in-a-row');
      
      expect(result.winner).toEqual(player);
      expect(result.winningLine).toEqual(line);
      expect(result.winType).toBe('five-in-a-row');
    });

    it('should create capture win', () => {
      const player = Player.createLocal('winner', 'white');
      
      const result = new WinResult(player, null, 'captures');
      
      expect(result.winner).toEqual(player);
      expect(result.winningLine).toBeNull();
      expect(result.winType).toBe('captures');
    });

    it('should throw error for winner without type', () => {
      const player = Player.createLocal('winner', 'black');
      
      expect(() => new WinResult(player, null, null))
        .toThrow('Win result must specify win type');
    });

    it('should throw error for five-in-a-row without line', () => {
      const player = Player.createLocal('winner', 'black');
      
      expect(() => new WinResult(player, null, 'five-in-a-row'))
        .toThrow('Five-in-a-row win must include winning line');
    });

    it('should use factory methods correctly', () => {
      const player = Player.createLocal('winner', 'black');
      const line = Line.fromCoords([
        new Vector3(0, 0, 0),
        new Vector3(1, 1, 1),
        new Vector3(2, 2, 2),
        new Vector3(3, 3, 3),
        new Vector3(4, 4, 4)
      ]);
      
      // No win factory
      const noWin = WinResult.noWin();
      expect(noWin.isWin()).toBe(false);
      
      // Five in a row factory
      const fiveWin = WinResult.fiveInARow(player, line);
      expect(fiveWin.isWin()).toBe(true);
      expect(fiveWin.isFiveInARow()).toBe(true);
      expect(fiveWin.winner).toEqual(player);
      expect(fiveWin.winningLine).toEqual(line);
      
      // Captures factory
      const captureWin = WinResult.captures(player);
      expect(captureWin.isWin()).toBe(true);
      expect(captureWin.isCaptures()).toBe(true);
      expect(captureWin.winner).toEqual(player);
    });
  });

  // Test Group L: WinResult Queries
  describe('queries', () => {
    let player: Player;
    let line: Line;

    beforeEach(() => {
      player = Player.createLocal('test', 'white');
      line = Line.fromCoords([
        new Vector3(0, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, 2, 0),
        new Vector3(0, 3, 0),
        new Vector3(0, 4, 0)
      ]);
    });

    it('should detect wins correctly with isWin()', () => {
      const noWin = WinResult.noWin();
      const fiveWin = WinResult.fiveInARow(player, line);
      const captureWin = WinResult.captures(player);
      
      expect(noWin.isWin()).toBe(false);
      expect(fiveWin.isWin()).toBe(true);
      expect(captureWin.isWin()).toBe(true);
    });

    it('should identify five-in-a-row correctly', () => {
      const noWin = WinResult.noWin();
      const fiveWin = WinResult.fiveInARow(player, line);
      const captureWin = WinResult.captures(player);
      
      expect(noWin.isFiveInARow()).toBe(false);
      expect(fiveWin.isFiveInARow()).toBe(true);
      expect(captureWin.isFiveInARow()).toBe(false);
    });

    it('should identify captures correctly', () => {
      const noWin = WinResult.noWin();
      const fiveWin = WinResult.fiveInARow(player, line);
      const captureWin = WinResult.captures(player);
      
      expect(noWin.isCaptures()).toBe(false);
      expect(fiveWin.isCaptures()).toBe(false);
      expect(captureWin.isCaptures()).toBe(true);
    });

    it('should return false for all queries on no-win', () => {
      const noWin = WinResult.noWin();
      
      expect(noWin.isWin()).toBe(false);
      expect(noWin.isFiveInARow()).toBe(false);
      expect(noWin.isCaptures()).toBe(false);
    });

    it('should format toString() correctly', () => {
      const noWin = WinResult.noWin();
      const fiveWin = WinResult.fiveInARow(player, line);
      const captureWin = WinResult.captures(player);
      
      expect(noWin.toString()).toBe('WinResult(no winner)');
      expect(fiveWin.toString()).toBe('WinResult(test wins by five-in-a-row)');
      expect(captureWin.toString()).toBe('WinResult(test wins by captures)');
    });

    it('should serialize to JSON completely', () => {
      const fiveWin = WinResult.fiveInARow(player, line);
      const json = fiveWin.toJSON();
      
      expect(json.winner).toEqual(player.toJSON());
      expect(json.winningLine).toEqual(line.toJSON());
      expect(json.winType).toBe('five-in-a-row');
      
      const noWin = WinResult.noWin();
      const noWinJson = noWin.toJSON();
      
      expect(noWinJson.winner).toBeNull();
      expect(noWinJson.winningLine).toBeNull();
      expect(noWinJson.winType).toBeNull();
    });
  });

  // Additional tests for edge cases
  describe('edge cases', () => {
    it('should handle IPlayer interface in constructor', () => {
      const playerData = {
        id: 'player1',
        color: 'black' as const,
        isLocal: true,
        captures: 0
      };
      
      const lineData = {
        coords: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 }
        ],
        direction: { x: 1, y: 0, z: 0 },
        isComplete: false
      };
      
      const result = new WinResult(playerData, lineData, 'five-in-a-row');
      
      expect(result.winner).toBeInstanceOf(Player);
      expect(result.winner?.id).toBe('player1');
      expect(result.winningLine).toBeInstanceOf(Line);
    });

    it('should handle null values correctly', () => {
      const result = new WinResult(null, null, null);
      
      expect(result.winner).toBeNull();
      expect(result.winningLine).toBeNull();
      expect(result.winType).toBeNull();
      expect(result.isWin()).toBe(false);
    });

    it('should validate five-in-a-row requires line', () => {
      const player = Player.createLocal('test', 'black');
      const line = Line.fromCoords([
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0)
      ]);
      
      // Valid five-in-a-row
      expect(() => WinResult.fiveInARow(player, line)).not.toThrow();
      
      // Invalid - no line
      expect(() => new WinResult(player, null, 'five-in-a-row'))
        .toThrow('Five-in-a-row win must include winning line');
    });

    it('should allow captures win without line', () => {
      const player = Player.createLocal('test', 'white');
      
      // Captures doesn't need a line
      expect(() => WinResult.captures(player)).not.toThrow();
      
      const result = WinResult.captures(player);
      expect(result.winningLine).toBeNull();
      expect(result.isWin()).toBe(true);
    });

    it('should handle player with captures correctly', () => {
      let player = new Player('captor', 'black', true);
      // Simulate player with 5 captures (winning amount)
      player = player.incrementCaptures(5);
      
      const result = WinResult.captures(player);
      expect(result.winner?.captures).toBe(5);
      expect(result.isCaptures()).toBe(true);
    });
  });
});
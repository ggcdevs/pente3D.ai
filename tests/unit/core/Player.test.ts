import { Player } from '@/core/Player';
import { PlayerColor } from '@/types';

describe('Player', () => {
  describe('constructor', () => {
    it('creates valid local player', () => {
      const player = new Player('player1', 'black', true);
      expect(player.id).toBe('player1');
      expect(player.color).toBe('black');
      expect(player.isLocal).toBe(true);
      expect(player.captures).toBe(0);
    });

    it('creates valid remote player with connection ID', () => {
      const player = new Player('player2', 'white', false, 'conn123');
      expect(player.id).toBe('player2');
      expect(player.color).toBe('white');
      expect(player.isLocal).toBe(false);
      expect(player.connectionId).toBe('conn123');
    });

    it('throws error for empty ID', () => {
      expect(() => new Player('', 'black')).toThrow('Player ID must be a non-empty string');
      expect(() => new Player('   ', 'black')).toThrow('Player ID must be a non-empty string');
    });

    it('throws error for invalid color', () => {
      expect(() => new Player('player1', 'red' as PlayerColor)).toThrow('Player color must be "black" or "white"');
    });

    it('trims whitespace from ID', () => {
      const player = new Player('  player1  ', 'black');
      expect(player.id).toBe('player1');
    });
  });

  describe('factory methods', () => {
    it('createLocal creates local player', () => {
      const player = Player.createLocal('player1', 'black');
      expect(player.isLocal).toBe(true);
      expect(player.connectionId).toBeUndefined();
    });

    it('createRemote creates remote player', () => {
      const player = Player.createRemote('player2', 'white', 'conn123');
      expect(player.isLocal).toBe(false);
      expect(player.connectionId).toBe('conn123');
    });
  });

  describe('captures management', () => {
    let player: Player;

    beforeEach(() => {
      player = Player.createLocal('player1', 'black');
    });

    it('initial captures count is 0', () => {
      expect(player.captures).toBe(0);
    });

    it('incrementCaptures returns new instance', () => {
      const newPlayer = player.incrementCaptures();
      expect(newPlayer).not.toBe(player);
      expect(newPlayer.captures).toBe(1);
      expect(player.captures).toBe(0);
    });

    it('incrementCaptures with custom amount', () => {
      const newPlayer = player.incrementCaptures(3);
      expect(newPlayer.captures).toBe(3);
      expect(player.captures).toBe(0);
    });

    it('throws error for negative increment', () => {
      expect(() => player.incrementCaptures(-1)).toThrow('Capture increment must be non-negative');
    });

    it('resetCaptures returns new instance with 0 captures', () => {
      const playerWithCaptures = player.incrementCaptures(5);
      const resetPlayer = playerWithCaptures.resetCaptures();
      expect(resetPlayer).not.toBe(playerWithCaptures);
      expect(resetPlayer.captures).toBe(0);
      expect(playerWithCaptures.captures).toBe(5);
    });
  });

  describe('network status', () => {
    it('local player is always connected', () => {
      const player = Player.createLocal('player1', 'black');
      expect(player.isConnected()).toBe(true);
    });

    it('remote player with connectionId is connected', () => {
      const player = Player.createRemote('player2', 'white', 'conn123');
      expect(player.isConnected()).toBe(true);
    });

    it('remote player without connectionId is not connected', () => {
      const player = new Player('player2', 'white', false);
      expect(player.isConnected()).toBe(false);
    });
  });

  describe('utility methods', () => {
    let player1: Player;
    let player2: Player;

    beforeEach(() => {
      player1 = Player.createLocal('player1', 'black');
      player2 = Player.createLocal('player2', 'white');
    });

    it('equals compares players correctly', () => {
      const samePlayer = Player.createLocal('player1', 'black');
      const differentId = Player.createLocal('player3', 'black');
      const differentColor = Player.createLocal('player1', 'white');

      expect(player1.equals(samePlayer)).toBe(true);
      expect(player1.equals(differentId)).toBe(false);
      expect(player1.equals(differentColor)).toBe(false);
    });

    it('toString returns formatted string', () => {
      const player = player1.incrementCaptures(3);
      expect(player.toString()).toBe('Player(player1, black, captures: 3)');
    });

    it('toJSON serialization', () => {
      const json = player1.toJSON();
      expect(json).toEqual({
        id: 'player1',
        color: 'black',
        isLocal: true,
        captures: 0
      });
    });

    it('clone creates independent copy', () => {
      const cloned = player1.clone();
      expect(cloned).not.toBe(player1);
      expect(cloned.equals(player1)).toBe(true);
      expect(cloned.captures).toBe(player1.captures);
    });

    it('clone preserves captures and connectionId', () => {
      const player = Player.createRemote('player2', 'white', 'conn123');
      const withCaptures = player.incrementCaptures(5);
      const cloned = withCaptures.clone();
      
      expect(cloned.captures).toBe(5);
      expect(cloned.connectionId).toBe('conn123');
    });
  });

  describe('immutability', () => {
    it('operations return new instances', () => {
      const player = Player.createLocal('player1', 'black');
      const playerWithCaptures = player.incrementCaptures(2);
      const resetPlayer = playerWithCaptures.resetCaptures();
      
      // Verify all are different instances
      expect(playerWithCaptures).not.toBe(player);
      expect(resetPlayer).not.toBe(playerWithCaptures);
      expect(resetPlayer).not.toBe(player);
      
      // Verify original is unchanged
      expect(player.captures).toBe(0);
      expect(playerWithCaptures.captures).toBe(2);
      expect(resetPlayer.captures).toBe(0);
    });
  });
});
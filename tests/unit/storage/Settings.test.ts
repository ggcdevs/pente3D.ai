import { Settings } from '@/storage/Settings';

describe('Settings', () => {
  describe('constructor', () => {
    it('should create settings with default values', () => {
      const settings = new Settings();
      
      expect(settings.getGridDiagonals()).toBe(false);
      expect(settings.getPlayerColor(1)).toBe('#000000');
      expect(settings.getPlayerColor(2)).toBe('#FFFFFF');
      expect(settings.getCameraPosition()).toBeUndefined();
      expect(settings.getSoundEnabled()).toBe(true);
      expect(settings.getAnimationSpeed()).toBe(1.0);
    });

    it('should create settings with custom values', () => {
      const settings = new Settings({
        gridDiagonals: true,
        playerColors: {
          player1: '#FF0000',
          player2: '#0000FF'
        },
        cameraPosition: { x: 10, y: 20, z: 30 },
        soundEnabled: false,
        animationSpeed: 2.5
      });
      
      expect(settings.getGridDiagonals()).toBe(true);
      expect(settings.getPlayerColor(1)).toBe('#FF0000');
      expect(settings.getPlayerColor(2)).toBe('#0000FF');
      expect(settings.getCameraPosition()).toEqual({ x: 10, y: 20, z: 30 });
      expect(settings.getSoundEnabled()).toBe(false);
      expect(settings.getAnimationSpeed()).toBe(2.5);
    });
  });

  describe('gridDiagonals', () => {
    it('should get and set grid diagonals', () => {
      const settings = new Settings();
      
      expect(settings.getGridDiagonals()).toBe(false);
      
      settings.setGridDiagonals(true);
      expect(settings.getGridDiagonals()).toBe(true);
      
      settings.setGridDiagonals(false);
      expect(settings.getGridDiagonals()).toBe(false);
    });
  });

  describe('playerColors', () => {
    it('should get and set player colors', () => {
      const settings = new Settings();
      
      settings.setPlayerColor(1, '#FF0000');
      expect(settings.getPlayerColor(1)).toBe('#FF0000');
      
      settings.setPlayerColor(2, '#0000FF');
      expect(settings.getPlayerColor(2)).toBe('#0000FF');
    });

    it('should handle both player 1 and 2', () => {
      const settings = new Settings();
      
      settings.setPlayerColor(1, '#123456');
      settings.setPlayerColor(2, '#ABCDEF');
      
      expect(settings.getPlayerColor(1)).toBe('#123456');
      expect(settings.getPlayerColor(2)).toBe('#ABCDEF');
    });
  });

  describe('cameraPosition', () => {
    it('should get and set camera position', () => {
      const settings = new Settings();
      
      expect(settings.getCameraPosition()).toBeUndefined();
      
      const position = { x: 5, y: 10, z: 15 };
      settings.setCameraPosition(position);
      expect(settings.getCameraPosition()).toEqual(position);
      
      // Should return a copy, not the original
      const retrieved = settings.getCameraPosition();
      expect(retrieved).not.toBe(position);
      expect(retrieved).toEqual(position);
    });

    it('should handle undefined camera position', () => {
      const settings = new Settings();
      
      settings.setCameraPosition({ x: 1, y: 2, z: 3 });
      settings.setCameraPosition(undefined);
      
      expect(settings.getCameraPosition()).toBeUndefined();
    });
  });

  describe('soundEnabled', () => {
    it('should get and set sound enabled', () => {
      const settings = new Settings();
      
      expect(settings.getSoundEnabled()).toBe(true);
      
      settings.setSoundEnabled(false);
      expect(settings.getSoundEnabled()).toBe(false);
      
      settings.setSoundEnabled(true);
      expect(settings.getSoundEnabled()).toBe(true);
    });
  });

  describe('animationSpeed', () => {
    it('should get and set animation speed', () => {
      const settings = new Settings();
      
      expect(settings.getAnimationSpeed()).toBe(1.0);
      
      settings.setAnimationSpeed(2.5);
      expect(settings.getAnimationSpeed()).toBe(2.5);
    });

    it('should clamp animation speed to valid range', () => {
      const settings = new Settings();
      
      settings.setAnimationSpeed(0.05);
      expect(settings.getAnimationSpeed()).toBe(0.1);
      
      settings.setAnimationSpeed(10.0);
      expect(settings.getAnimationSpeed()).toBe(5.0);
      
      settings.setAnimationSpeed(-1.0);
      expect(settings.getAnimationSpeed()).toBe(0.1);
    });
  });

  describe('reset', () => {
    it('should reset all settings to defaults', () => {
      const settings = new Settings({
        gridDiagonals: true,
        playerColors: {
          player1: '#FF0000',
          player2: '#0000FF'
        },
        cameraPosition: { x: 10, y: 20, z: 30 },
        soundEnabled: false,
        animationSpeed: 2.5
      });
      
      settings.reset();
      
      expect(settings.getGridDiagonals()).toBe(false);
      expect(settings.getPlayerColor(1)).toBe('#000000');
      expect(settings.getPlayerColor(2)).toBe('#FFFFFF');
      expect(settings.getCameraPosition()).toBeUndefined();
      expect(settings.getSoundEnabled()).toBe(true);
      expect(settings.getAnimationSpeed()).toBe(1.0);
    });
  });

  describe('change listeners', () => {
    it('should notify listeners on changes', () => {
      const settings = new Settings();
      const listener = jest.fn();
      
      settings.addChangeListener(listener);
      
      settings.setGridDiagonals(true);
      expect(listener).toHaveBeenCalledWith(settings);
      expect(listener).toHaveBeenCalledTimes(1);
      
      settings.setPlayerColor(1, '#FF0000');
      expect(listener).toHaveBeenCalledTimes(2);
      
      settings.setCameraPosition({ x: 1, y: 2, z: 3 });
      expect(listener).toHaveBeenCalledTimes(3);
      
      settings.setSoundEnabled(false);
      expect(listener).toHaveBeenCalledTimes(4);
      
      settings.setAnimationSpeed(2.0);
      expect(listener).toHaveBeenCalledTimes(5);
      
      settings.reset();
      expect(listener).toHaveBeenCalledTimes(6);
    });

    it('should not notify if value does not change', () => {
      const settings = new Settings();
      const listener = jest.fn();
      
      settings.addChangeListener(listener);
      
      settings.setGridDiagonals(false); // Already false
      expect(listener).not.toHaveBeenCalled();
      
      settings.setSoundEnabled(true); // Already true
      expect(listener).not.toHaveBeenCalled();
      
      settings.setAnimationSpeed(1.0); // Already 1.0
      expect(listener).not.toHaveBeenCalled();
    });

    it('should support multiple listeners', () => {
      const settings = new Settings();
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      
      settings.addChangeListener(listener1);
      settings.addChangeListener(listener2);
      
      settings.setGridDiagonals(true);
      
      expect(listener1).toHaveBeenCalledWith(settings);
      expect(listener2).toHaveBeenCalledWith(settings);
    });

    it('should remove listeners', () => {
      const settings = new Settings();
      const listener = jest.fn();
      
      settings.addChangeListener(listener);
      settings.setGridDiagonals(true);
      expect(listener).toHaveBeenCalledTimes(1);
      
      settings.removeChangeListener(listener);
      settings.setGridDiagonals(false);
      expect(listener).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should handle removing non-existent listener', () => {
      const settings = new Settings();
      const listener = jest.fn();
      
      // Should not throw
      expect(() => settings.removeChangeListener(listener)).not.toThrow();
    });
  });

  describe('serialization', () => {
    it('should serialize to JSON', () => {
      const settings = new Settings({
        gridDiagonals: true,
        playerColors: {
          player1: '#FF0000',
          player2: '#0000FF'
        },
        cameraPosition: { x: 10, y: 20, z: 30 },
        soundEnabled: false,
        animationSpeed: 2.5
      });
      
      const json = settings.toJSON();
      
      expect(json).toEqual({
        gridDiagonals: true,
        playerColors: {
          player1: '#FF0000',
          player2: '#0000FF'
        },
        cameraPosition: { x: 10, y: 20, z: 30 },
        soundEnabled: false,
        animationSpeed: 2.5
      });
    });

    it('should deserialize from JSON', () => {
      const json = {
        gridDiagonals: true,
        playerColors: {
          player1: '#FF0000',
          player2: '#0000FF'
        },
        cameraPosition: { x: 10, y: 20, z: 30 },
        soundEnabled: false,
        animationSpeed: 2.5
      };
      
      const settings = Settings.fromJSON(json);
      
      expect(settings.getGridDiagonals()).toBe(true);
      expect(settings.getPlayerColor(1)).toBe('#FF0000');
      expect(settings.getPlayerColor(2)).toBe('#0000FF');
      expect(settings.getCameraPosition()).toEqual({ x: 10, y: 20, z: 30 });
      expect(settings.getSoundEnabled()).toBe(false);
      expect(settings.getAnimationSpeed()).toBe(2.5);
    });

    it('should handle undefined camera position in JSON', () => {
      const json = {
        gridDiagonals: false,
        playerColors: {
          player1: '#000000',
          player2: '#FFFFFF'
        },
        soundEnabled: true,
        animationSpeed: 1.0
      };
      
      const settings = Settings.fromJSON(json);
      expect(settings.getCameraPosition()).toBeUndefined();
    });
  });

  describe('clone', () => {
    it('should create a deep copy', () => {
      const original = new Settings({
        gridDiagonals: true,
        playerColors: {
          player1: '#FF0000',
          player2: '#0000FF'
        },
        cameraPosition: { x: 10, y: 20, z: 30 },
        soundEnabled: false,
        animationSpeed: 2.5
      });
      
      const clone = original.clone();
      
      expect(clone).not.toBe(original);
      expect(clone.getGridDiagonals()).toBe(true);
      expect(clone.getPlayerColor(1)).toBe('#FF0000');
      expect(clone.getPlayerColor(2)).toBe('#0000FF');
      expect(clone.getCameraPosition()).toEqual({ x: 10, y: 20, z: 30 });
      expect(clone.getSoundEnabled()).toBe(false);
      expect(clone.getAnimationSpeed()).toBe(2.5);
      
      // Changing clone should not affect original
      clone.setGridDiagonals(false);
      expect(original.getGridDiagonals()).toBe(true);
    });
  });

  describe('equals', () => {
    it('should return true for equal settings', () => {
      const settings1 = new Settings({
        gridDiagonals: true,
        playerColors: {
          player1: '#FF0000',
          player2: '#0000FF'
        },
        cameraPosition: { x: 10, y: 20, z: 30 },
        soundEnabled: false,
        animationSpeed: 2.5
      });
      
      const settings2 = new Settings({
        gridDiagonals: true,
        playerColors: {
          player1: '#FF0000',
          player2: '#0000FF'
        },
        cameraPosition: { x: 10, y: 20, z: 30 },
        soundEnabled: false,
        animationSpeed: 2.5
      });
      
      expect(settings1.equals(settings2)).toBe(true);
    });

    it('should return false for different settings', () => {
      const settings1 = new Settings();
      const settings2 = new Settings();
      
      settings2.setGridDiagonals(true);
      expect(settings1.equals(settings2)).toBe(false);
      
      settings1.setGridDiagonals(true);
      settings2.setPlayerColor(1, '#FF0000');
      expect(settings1.equals(settings2)).toBe(false);
    });

    it('should handle camera position comparison', () => {
      const settings1 = new Settings();
      const settings2 = new Settings();
      
      expect(settings1.equals(settings2)).toBe(true);
      
      settings1.setCameraPosition({ x: 1, y: 2, z: 3 });
      expect(settings1.equals(settings2)).toBe(false);
      
      settings2.setCameraPosition({ x: 1, y: 2, z: 3 });
      expect(settings1.equals(settings2)).toBe(true);
      
      settings2.setCameraPosition({ x: 1, y: 2, z: 4 });
      expect(settings1.equals(settings2)).toBe(false);
    });
  });
});
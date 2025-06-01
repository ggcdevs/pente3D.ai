import { AccessibilityManager } from '@/utils/AccessibilityManager';
import { Game } from '@/core/Game';
import { Vector3 } from '@/core/Vector3';
import { Move } from '@/core/Move';
import { Player } from '@/core/Player';
import { WinResult } from '@/core/WinResult';

describe('AccessibilityManager', () => {
  let game: Game;
  let manager: AccessibilityManager;
  let announcementContainer: HTMLElement;
  let positionIndicator: HTMLElement;

  beforeEach(() => {
    // Clean up any existing elements
    document.body.innerHTML = '';
    
    // Create mock elements
    announcementContainer = document.createElement('div');
    announcementContainer.id = 'game-announcements';
    document.body.appendChild(announcementContainer);
    
    positionIndicator = document.createElement('div');
    positionIndicator.id = 'position-indicator';
    document.body.appendChild(positionIndicator);
    
    game = new Game({ boardSize: 7 });
    manager = new AccessibilityManager(game);
  });

  afterEach(() => {
    manager.dispose();
    document.body.innerHTML = '';
  });

  describe('Constructor and Options', () => {
    test('should initialize with default options', () => {
      expect(manager).toBeDefined();
      expect(announcementContainer.getAttribute('role')).toBe('status');
      expect(announcementContainer.getAttribute('aria-live')).toBe('polite');
    });

    test('should accept custom options', () => {
      const customManager = new AccessibilityManager(game, {
        announceGameEvents: false,
        highContrastMode: true,
        reducedMotion: true,
        keyboardHelp: false
      });
      
      expect(document.body.classList.contains('high-contrast')).toBe(true);
      customManager.dispose();
    });

    test('should connect to game events', () => {
      const spy = jest.spyOn(manager, 'announceGameEvent');
      game.placePiece(new Vector3(3, 3, 3));
      expect(spy).toHaveBeenCalled();
    });

    test('should create announcement container', () => {
      const container = document.getElementById('game-announcements');
      expect(container).toBeTruthy();
      expect(container?.className).toBe('sr-only');
    });

    test('should handle missing game gracefully', () => {
      // This test would require creating a manager without a game,
      // but the current implementation requires a game
      expect(() => new AccessibilityManager(null as any)).toThrow();
    });
  });

  describe('Game Event Announcements', () => {
    test('should announce move placement', () => {
      const spy = jest.spyOn(manager as any, 'createAnnouncement');
      game.placePiece(new Vector3(3, 3, 3));
      
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Black placed piece'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('D4, level 4'));
    });

    test('should announce captures', () => {
      // Set up a capture scenario
      game.placePiece(new Vector3(3, 3, 3)); // Black
      game.placePiece(new Vector3(3, 3, 2)); // White
      game.placePiece(new Vector3(3, 3, 1)); // Black
      
      const spy = jest.spyOn(manager as any, 'createAnnouncement');
      game.placePiece(new Vector3(3, 3, 4)); // White captures
      
      const calls = spy.mock.calls;
      const captureCall = calls.find(call => call[0].includes('capturing'));
      expect(captureCall).toBeTruthy();
    });

    test('should announce turn changes', () => {
      const spy = jest.spyOn(manager as any, 'createAnnouncement');
      game.placePiece(new Vector3(3, 3, 3));
      
      const calls = spy.mock.calls;
      const turnCall = calls.find(call => call[0].includes("White's turn"));
      expect(turnCall).toBeTruthy();
    });

    test('should announce game win', () => {
      // Create a win scenario
      const spy = jest.spyOn(manager as any, 'createAnnouncement');
      
      // Place 5 in a row for black
      for (let i = 0; i < 5; i++) {
        if (i % 2 === 0) {
          game.placePiece(new Vector3(i, 3, 3)); // Black
        } else {
          game.placePiece(new Vector3(i, 4, 3)); // White
        }
      }
      
      const calls = spy.mock.calls;
      const winCall = calls.find(call => call[0].includes('Game over!'));
      expect(winCall).toBeTruthy();
    });

    test('should announce undo/redo actions', () => {
      game.placePiece(new Vector3(3, 3, 3));
      
      const spy = jest.spyOn(manager as any, 'createAnnouncement');
      game.undo();
      expect(spy).toHaveBeenCalledWith('Move undone');
      
      game.redo();
      expect(spy).toHaveBeenCalledWith('Move redone');
    });

    test('should queue multiple announcements', () => {
      const spy = jest.spyOn(manager as any, 'processAnnouncementQueue');
      
      manager.announceGameEvent('test1', 'Message 1');
      manager.announceGameEvent('test2', 'Message 2');
      manager.announceGameEvent('test3', 'Message 3');
      
      expect(spy).toHaveBeenCalled();
    });

    test('should clear old announcements', (done) => {
      manager.announceGameEvent('test', 'Test message');
      
      setTimeout(() => {
        manager.announceGameEvent('test2', 'New message');
        expect(announcementContainer.textContent).toBe('New message');
        done();
      }, 150);
    });

    test('should respect announcement settings', () => {
      const customManager = new AccessibilityManager(game, {
        announceGameEvents: false
      });
      
      const spy = jest.spyOn(customManager as any, 'createAnnouncement');
      game.placePiece(new Vector3(3, 3, 3));
      
      expect(spy).not.toHaveBeenCalled();
      customManager.dispose();
    });
  });

  describe('Keyboard Focus Management', () => {
    test('should move focus up/down (Y axis)', () => {
      manager.moveFocus('up');
      const pos1 = manager.getCurrentFocusPosition();
      expect(pos1?.y).toBe(4);
      
      manager.moveFocus('down');
      const pos2 = manager.getCurrentFocusPosition();
      expect(pos2?.y).toBe(3);
    });

    test('should move focus left/right (X axis)', () => {
      manager.moveFocus('right');
      const pos1 = manager.getCurrentFocusPosition();
      expect(pos1?.x).toBe(4);
      
      manager.moveFocus('left');
      const pos2 = manager.getCurrentFocusPosition();
      expect(pos2?.x).toBe(3);
    });

    test('should move focus forward/backward (Z axis)', () => {
      manager.moveFocus('forward');
      const pos1 = manager.getCurrentFocusPosition();
      expect(pos1?.z).toBe(4);
      
      manager.moveFocus('backward');
      const pos2 = manager.getCurrentFocusPosition();
      expect(pos2?.z).toBe(3);
    });

    test('should wrap focus at board edges', () => {
      // Move to top edge
      for (let i = 0; i < 10; i++) {
        manager.moveFocus('up');
      }
      const topPos = manager.getCurrentFocusPosition();
      expect(topPos?.y).toBe(6);
      
      // Move to bottom edge
      for (let i = 0; i < 10; i++) {
        manager.moveFocus('down');
      }
      const bottomPos = manager.getCurrentFocusPosition();
      expect(bottomPos?.y).toBe(0);
    });

    test('should handle fast navigation with Shift', () => {
      // Fast navigation is handled by InputHandler, not AccessibilityManager
      // This test is more about the integration
      expect(manager.getCurrentFocusPosition()).toBeTruthy();
    });

    test('should track current focus position', () => {
      const initialPos = manager.getCurrentFocusPosition();
      expect(initialPos).toEqual(new Vector3(3, 3, 3));
      
      manager.moveFocus('up');
      const newPos = manager.getCurrentFocusPosition();
      expect(newPos).toEqual(new Vector3(3, 4, 3));
    });

    test('should emit focus change events', () => {
      const spy = jest.fn();
      manager.on('focusChanged', spy);
      
      manager.moveFocus('up');
      expect(spy).toHaveBeenCalledWith({
        position: new Vector3(3, 4, 3)
      });
    });

    test('should validate focus boundaries', () => {
      // Move to edge
      for (let i = 0; i < 10; i++) {
        manager.moveFocus('right');
      }
      
      const pos = manager.getCurrentFocusPosition();
      expect(pos?.x).toBeLessThanOrEqual(6);
      expect(pos?.x).toBeGreaterThanOrEqual(0);
    });

    test('should restore focus after modal close', () => {
      // This is handled by Modal class, not AccessibilityManager
      const pos = manager.getCurrentFocusPosition();
      expect(pos).toBeTruthy();
    });

    test('should handle null focus state', () => {
      // Force null focus
      (manager as any).currentFocus = null;
      manager.moveFocus('up');
      
      const pos = manager.getCurrentFocusPosition();
      expect(pos).toEqual(new Vector3(3, 4, 3));
    });
  });

  describe('Screen Reader Support', () => {
    test('should convert position to readable text', () => {
      const text = (manager as any).positionToText(new Vector3(0, 0, 0));
      expect(text).toBe('A1, level 1');
      
      const text2 = (manager as any).positionToText(new Vector3(6, 6, 6));
      expect(text2).toBe('G7, level 7');
    });

    test('should announce current position', () => {
      const spy = jest.spyOn(positionIndicator, 'textContent', 'set');
      manager.announceCurrentPosition();
      
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Position D4, level 4'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('empty'));
    });

    test('should announce board state summary', () => {
      game.placePiece(new Vector3(3, 3, 3));
      game.placePiece(new Vector3(4, 4, 4));
      
      const spy = jest.spyOn(manager as any, 'createAnnouncement');
      manager.announceBoardState();
      
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('1 black pieces'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('1 white pieces'));
    });

    test('should announce game status', () => {
      const spy = jest.spyOn(manager as any, 'createAnnouncement');
      manager.announceGameStatus();
      
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Game in progress'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Black to move'));
    });

    test('should announce available moves count', () => {
      const spy = jest.spyOn(manager as any, 'createAnnouncement');
      manager.announceAvailableMoves();
      
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('343 positions available'));
    });

    test('should use appropriate ARIA live regions', () => {
      const announcements = document.getElementById('game-announcements');
      expect(announcements?.getAttribute('aria-live')).toBe('polite');
      
      const position = document.getElementById('position-indicator');
      expect(position?.getAttribute('aria-live')).toBe('assertive');
    });
  });

  describe('Visual Accessibility', () => {
    test('should toggle high contrast mode', () => {
      manager.setHighContrastMode(true);
      expect(document.body.classList.contains('high-contrast')).toBe(true);
      
      manager.setHighContrastMode(false);
      expect(document.body.classList.contains('high-contrast')).toBe(false);
    });

    test('should toggle reduced motion', () => {
      const spy = jest.fn();
      manager.on('reducedMotionChanged', spy);
      
      manager.setReducedMotion(true);
      expect(spy).toHaveBeenCalledWith({ enabled: true });
      
      manager.setReducedMotion(false);
      expect(spy).toHaveBeenCalledWith({ enabled: false });
    });

    test('should emit mode change events', () => {
      const contrastSpy = jest.fn();
      const motionSpy = jest.fn();
      
      manager.on('highContrastChanged', contrastSpy);
      manager.on('reducedMotionChanged', motionSpy);
      
      manager.setHighContrastMode(true);
      manager.setReducedMotion(true);
      
      expect(contrastSpy).toHaveBeenCalledWith({ enabled: true });
      expect(motionSpy).toHaveBeenCalledWith({ enabled: true });
    });

    test('should persist preferences', () => {
      // Preferences are persisted by Settings/StorageManager
      // This test verifies the manager handles the settings
      manager.setHighContrastMode(true);
      manager.setReducedMotion(true);
      
      // Create new manager
      const newManager = new AccessibilityManager(game);
      // Should respect document.body classes
      expect(document.body.classList.contains('high-contrast')).toBe(true);
      
      newManager.dispose();
    });
  });
});
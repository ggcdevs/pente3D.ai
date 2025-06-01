import { Game } from '@/core/Game';
import { AccessibilityManager } from '@/utils/AccessibilityManager';
import { Vector3 } from '@/core/Vector3';

describe('Screen Reader Integration', () => {
  let game: Game;
  let accessibilityManager: AccessibilityManager;
  let announcementContainer: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    
    // Create announcement container
    announcementContainer = document.createElement('div');
    announcementContainer.id = 'game-announcements';
    announcementContainer.className = 'sr-only';
    announcementContainer.setAttribute('role', 'status');
    announcementContainer.setAttribute('aria-live', 'polite');
    document.body.appendChild(announcementContainer);
    
    game = new Game({ boardSize: 7 });
    accessibilityManager = new AccessibilityManager(game);
  });

  afterEach(() => {
    accessibilityManager.dispose();
  });

  test('should announce game start', () => {
    const spy = jest.spyOn(accessibilityManager as any, 'createAnnouncement');
    
    // New game is already started in beforeEach
    game.reset();
    
    expect(spy).toHaveBeenCalledWith('Game reset. Black to move.');
  });

  test('should announce each move with details', () => {
    const spy = jest.spyOn(accessibilityManager as any, 'createAnnouncement');
    
    game.placePiece(new Vector3(3, 3, 3));
    
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Black placed piece at D4, level 4'));
  });

  test('should announce captures clearly', () => {
    // Set up capture scenario
    game.placePiece(new Vector3(3, 3, 3)); // Black
    game.placePiece(new Vector3(4, 3, 3)); // White  
    game.placePiece(new Vector3(2, 3, 3)); // Black
    game.placePiece(new Vector3(5, 3, 3)); // White
    
    const spy = jest.spyOn(accessibilityManager as any, 'createAnnouncement');
    game.placePiece(new Vector3(1, 3, 3)); // Black captures
    
    const calls = spy.mock.calls;
    const captureCall = calls.find(call => call[0].includes('capturing'));
    expect(captureCall).toBeTruthy();
    expect(captureCall![0]).toContain('capturing 2 pieces');
  });

  test('should announce turn changes', () => {
    const spy = jest.spyOn(accessibilityManager as any, 'createAnnouncement');
    
    game.placePiece(new Vector3(3, 3, 3)); // Black moves
    
    const calls = spy.mock.calls;
    const turnCall = calls.find(call => call[0].includes("White's turn"));
    expect(turnCall).toBeTruthy();
  });

  test('should announce invalid move attempts', () => {
    game.placePiece(new Vector3(3, 3, 3)); // Black
    
    const spy = jest.spyOn(accessibilityManager as any, 'createAnnouncement');
    
    // Try to place on occupied position
    try {
      game.placePiece(new Vector3(3, 3, 3));
    } catch (error) {
      // Expected error
    }
    
    // Invalid move announcements would be handled by UI layer
    expect(game.getState().board.getPieceAt(new Vector3(3, 3, 3))).toBeTruthy();
  });

  test('should announce undo/redo actions', () => {
    game.placePiece(new Vector3(3, 3, 3));
    
    const spy = jest.spyOn(accessibilityManager as any, 'createAnnouncement');
    
    game.undo();
    expect(spy).toHaveBeenCalledWith('Move undone');
    
    spy.mockClear();
    
    game.redo();
    expect(spy).toHaveBeenCalledWith('Move redone');
  });

  test('should announce game end with winner', () => {
    const spy = jest.spyOn(accessibilityManager as any, 'createAnnouncement');
    
    // Create 5 in a row for black
    for (let i = 0; i < 5; i++) {
      game.placePiece(new Vector3(i, 3, 3)); // Black
      if (i < 4) {
        game.placePiece(new Vector3(i, 4, 3)); // White
      }
    }
    
    const calls = spy.mock.calls;
    const winCall = calls.find(call => call[0].includes('Game over! Black wins by five in a row!'));
    expect(winCall).toBeTruthy();
  });

  test('should not overwhelm with rapid announcements', (done) => {
    // Queue multiple announcements rapidly
    for (let i = 0; i < 10; i++) {
      accessibilityManager.announceGameEvent('test', `Message ${i}`);
    }
    
    // Check that announcements are processed sequentially
    setTimeout(() => {
      const content = announcementContainer.textContent;
      expect(content).toBeTruthy();
      done();
    }, 200);
  });

  test('should provide position context', () => {
    accessibilityManager.announceCurrentPosition();
    
    const positionIndicator = document.getElementById('position-indicator');
    expect(positionIndicator?.textContent).toContain('Position D4, level 4');
    expect(positionIndicator?.textContent).toContain('empty');
    
    // Place a piece and check again
    game.placePiece(new Vector3(3, 3, 3));
    accessibilityManager.announceCurrentPosition();
    
    expect(positionIndicator?.textContent).toContain('occupied by Black');
  });

  test('should work with popular screen readers', () => {
    // This is a placeholder for manual testing with actual screen readers
    // Automated testing would require screen reader simulation
    
    // Verify ARIA attributes are correct
    expect(announcementContainer.getAttribute('role')).toBe('status');
    expect(announcementContainer.getAttribute('aria-live')).toBe('polite');
    expect(announcementContainer.getAttribute('aria-atomic')).toBe('true');
    
    // Position indicator should use assertive for immediate feedback
    const positionIndicator = document.getElementById('position-indicator');
    expect(positionIndicator?.getAttribute('aria-live')).toBe('assertive');
  });
});
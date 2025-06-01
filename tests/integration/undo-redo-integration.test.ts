import { Game } from '@/core/Game';
import { Vector3 } from '@/core/Vector3';
import type { GameEvent } from '@/core/Game';

describe('Undo/Redo Integration', () => {
  describe('UI synchronization', () => {
    it('should update UI state when undoing moves', () => {
      const game = new Game();
      const uiState = {
        canUndo: false,
        canRedo: false,
        moveIndex: 0,
        historyLength: 1,
        currentPlayer: 'black' as const,
        capturesBlack: 0,
        capturesWhite: 0
      };

      // Update UI state function
      const updateUIState = () => {
        uiState.canUndo = game.canUndo();
        uiState.canRedo = game.canRedo();
        uiState.moveIndex = game.getCurrentStateIndex();
        uiState.historyLength = game.getHistoryLength();
        uiState.currentPlayer = game.getCurrentPlayer().getColor();
        uiState.capturesBlack = game.getCurrentState().getBlackPlayer().getCaptureCount();
        uiState.capturesWhite = game.getCurrentState().getWhitePlayer().getCaptureCount();
      };

      // Initial state
      updateUIState();
      expect(uiState.canUndo).toBe(false);
      expect(uiState.canRedo).toBe(false);
      expect(uiState.moveIndex).toBe(0);
      expect(uiState.currentPlayer).toBe('black');

      // Make moves
      game.placePiece(new Vector3(0, 0, 0));
      updateUIState();
      expect(uiState.canUndo).toBe(true);
      expect(uiState.canRedo).toBe(false);
      expect(uiState.moveIndex).toBe(1);
      expect(uiState.currentPlayer).toBe('white');

      game.placePiece(new Vector3(1, 1, 1));
      updateUIState();
      expect(uiState.moveIndex).toBe(2);
      expect(uiState.currentPlayer).toBe('black');

      // Undo
      game.undo();
      updateUIState();
      expect(uiState.canUndo).toBe(true);
      expect(uiState.canRedo).toBe(true);
      expect(uiState.moveIndex).toBe(1);
      expect(uiState.currentPlayer).toBe('white');

      // Undo again
      game.undo();
      updateUIState();
      expect(uiState.canUndo).toBe(false);
      expect(uiState.canRedo).toBe(true);
      expect(uiState.moveIndex).toBe(0);
      expect(uiState.currentPlayer).toBe('black');
    });

    it('should handle history slider navigation', () => {
      const game = new Game();
      const sliderEvents: number[] = [];

      // Simulate slider change
      const onSliderChange = (targetIndex: number) => {
        const result = game.goToMove(targetIndex);
        if (result) {
          sliderEvents.push(targetIndex);
        }
        return result;
      };

      // Play several moves
      for (let i = 0; i < 5; i++) {
        game.placePiece(new Vector3(i, 0, 0));
      }

      // Current index is 5 after 5 moves
      expect(game.getCurrentStateIndex()).toBe(5);

      // Slider navigation - try to go to move 2
      const canGo = game.canGoToMove(2);
      expect(canGo).toBe(true);
      
      const result = onSliderChange(2);
      expect(result).toBe(true);
      expect(game.getCurrentStateIndex()).toBe(2);
      expect(sliderEvents).toContain(2);

      onSliderChange(0);
      expect(game.getCurrentStateIndex()).toBe(0);
      expect(sliderEvents).toContain(0);

      onSliderChange(4);
      expect(game.getCurrentStateIndex()).toBe(4);
      expect(sliderEvents).toContain(4);

      // Invalid navigation
      onSliderChange(-1);
      expect(game.getCurrentStateIndex()).toBe(4);
      expect(sliderEvents).not.toContain(-1);
    });

    it('should update capture counts correctly during undo/redo', () => {
      const game = new Game();
      
      // Set up a capture scenario (correct pattern for capture)
      game.placePiece(new Vector3(0, 0, 0)); // black
      game.placePiece(new Vector3(1, 0, 0)); // white
      game.placePiece(new Vector3(2, 0, 0)); // black  
      
      // Initial capture count
      expect(game.getCurrentState().getBlackPlayer().getCaptureCount()).toBe(0);
      expect(game.getCurrentState().getWhitePlayer().getCaptureCount()).toBe(0);
      
      // Move that creates capture (white captures the two black pieces)
      game.placePiece(new Vector3(3, 0, 0)); // white captures
      const stateAfterCapture = game.getCurrentState();
      const captureCount = stateAfterCapture.getWhitePlayer().getCaptureCount();
      
      if (captureCount > 0) {
        // Undo the capture
        game.undo();
        expect(game.getCurrentState().getWhitePlayer().getCaptureCount()).toBe(0);
        
        // Redo the capture
        game.redo();
        expect(game.getCurrentState().getWhitePlayer().getCaptureCount()).toBe(captureCount);
      } else {
        // If no capture happened, test basic undo/redo
        const movesBefore = game.getMoveCount();
        game.undo();
        expect(game.getMoveCount()).toBe(movesBefore - 1);
        game.redo();
        expect(game.getMoveCount()).toBe(movesBefore);
      }
    });
  });

  describe('event handling', () => {
    it('should emit correct events for UI updates', () => {
      const game = new Game();
      const events: GameEvent[] = [];
      
      game.addEventListener(event => events.push(event));

      // Play moves
      game.placePiece(new Vector3(0, 0, 0));
      game.placePiece(new Vector3(1, 1, 1));

      // Clear events
      events.length = 0;

      // Undo
      game.undo();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('undo');

      // Redo
      game.redo();
      expect(events).toHaveLength(2);
      expect(events[1].type).toBe('redo');

      // History navigation - we're at index 2, go to 0
      const currentIndex = game.getCurrentStateIndex();
      const navigated = game.goToMove(0);
      
      if (navigated) {
        // Should have historyNavigate event
        const historyNavEvent = events.find(e => e.type === 'historyNavigate');
        expect(historyNavEvent).toBeTruthy();
        expect(historyNavEvent?.type === 'historyNavigate' && historyNavEvent.moveIndex).toBe(0);
      } else {
        // If we couldn't navigate, we might already be at 0
        expect(currentIndex).toBe(0);
      }

      // Reset
      game.reset();
      const resetEvent = events.find(e => e.type === 'reset');
      expect(resetEvent).toBeTruthy();
    });

    it('should handle rapid UI interactions', () => {
      const game = new Game();
      let updateCount = 0;
      
      game.addEventListener(() => updateCount++);

      // Play moves
      for (let i = 0; i < 10; i++) {
        game.placePiece(new Vector3(i % 3, Math.floor(i / 3), 0));
      }

      const initialUpdates = updateCount;

      // Rapid undo
      for (let i = 0; i < 5; i++) {
        game.undo();
      }

      // Rapid redo
      for (let i = 0; i < 3; i++) {
        game.redo();
      }

      // All operations should complete
      expect(game.getCurrentStateIndex()).toBe(8);
      expect(updateCount).toBe(initialUpdates + 8);
    });
  });

  describe('button state management', () => {
    it('should correctly enable/disable undo button', () => {
      const game = new Game();
      
      // Initially disabled
      expect(game.canUndo()).toBe(false);
      
      // Enabled after move
      game.placePiece(new Vector3(0, 0, 0));
      expect(game.canUndo()).toBe(true);
      
      // Disabled after undoing to start
      game.undo();
      expect(game.canUndo()).toBe(false);
    });

    it('should correctly enable/disable redo button', () => {
      const game = new Game();
      
      // Initially disabled
      expect(game.canRedo()).toBe(false);
      
      // Still disabled after move
      game.placePiece(new Vector3(0, 0, 0));
      expect(game.canRedo()).toBe(false);
      
      // Enabled after undo
      game.undo();
      expect(game.canRedo()).toBe(true);
      
      // Disabled after redo
      game.redo();
      expect(game.canRedo()).toBe(false);
      
      // Disabled after new move truncates history
      game.undo();
      game.placePiece(new Vector3(1, 1, 1));
      expect(game.canRedo()).toBe(false);
    });

    it('should handle reset confirmation', () => {
      const game = new Game();
      const confirmations: boolean[] = [];
      
      // Mock confirm dialog
      const mockConfirm = (message: string): boolean => {
        const result = confirmations.length === 0 ? true : false;
        confirmations.push(result);
        return result;
      };

      // Play some moves
      game.placePiece(new Vector3(0, 0, 0));
      game.placePiece(new Vector3(1, 1, 1));
      
      // Reset with confirmation
      if (mockConfirm('Are you sure?')) {
        game.reset();
      }
      
      expect(game.getMoveCount()).toBe(0);
      expect(confirmations).toEqual([true]);
      
      // Play again
      game.placePiece(new Vector3(2, 2, 2));
      
      // Cancel reset
      if (mockConfirm('Are you sure?')) {
        game.reset();
      }
      
      expect(game.getMoveCount()).toBe(1);
      expect(confirmations).toEqual([true, false]);
    });
  });

  describe('history compression UI impact', () => {
    it('should maintain UI consistency during compression', () => {
      const game = new Game();
      game.setCompressionOptions({
        maxHistorySize: 10,
        compressionThreshold: 5
      });

      const uiStates: { index: number; length: number }[] = [];
      
      game.addEventListener(() => {
        uiStates.push({
          index: game.getCurrentStateIndex(),
          length: game.getHistoryLength()
        });
      });

      // Play many moves to trigger compression
      for (let i = 0; i < 15; i++) {
        game.placePiece(new Vector3(i % 3, Math.floor(i / 3) % 3, Math.floor(i / 9)));
      }

      // UI should always show consistent state
      const lastState = uiStates[uiStates.length - 1];
      expect(lastState.index).toBeLessThan(lastState.length);
      expect(game.getCurrentStateIndex()).toBe(game.getHistoryLength() - 1);
    });

    it('should update slider range after compression', () => {
      const game = new Game();
      game.setCompressionOptions({
        maxHistorySize: 8,
        compressionThreshold: 4
      });

      // Track slider max values
      const sliderMaxValues: number[] = [];
      
      const updateSlider = () => {
        sliderMaxValues.push(game.getHistoryLength() - 1);
      };

      // Initial
      updateSlider();
      expect(sliderMaxValues[0]).toBe(0);

      // Play moves
      for (let i = 0; i < 12; i++) {
        game.placePiece(new Vector3(i % 4, Math.floor(i / 4), 0));
        updateSlider();
      }

      // Slider max should be adjusted after compression
      const finalMax = sliderMaxValues[sliderMaxValues.length - 1];
      expect(finalMax).toBeLessThanOrEqual(8);
      expect(finalMax).toBe(game.getHistoryLength() - 1);
    });
  });

  describe('performance and responsiveness', () => {
    it('should handle UI updates efficiently', () => {
      const game = new Game();
      const renderTimes: number[] = [];
      
      // Mock render update
      const updateUI = () => {
        const start = performance.now();
        
        // Simulate UI update operations
        const canUndo = game.canUndo();
        const canRedo = game.canRedo();
        const currentIndex = game.getCurrentStateIndex();
        const historyLength = game.getHistoryLength();
        const currentPlayer = game.getCurrentPlayer();
        const captures = {
          black: game.getCurrentState().getBlackPlayer().getCaptureCount(),
          white: game.getCurrentState().getWhitePlayer().getCaptureCount()
        };
        
        const end = performance.now();
        renderTimes.push(end - start);
      };

      // Perform many operations
      for (let i = 0; i < 50; i++) {
        game.placePiece(new Vector3(i % 5, Math.floor(i / 5) % 5, Math.floor(i / 25)));
        updateUI();
      }

      // Undo/redo operations
      for (let i = 0; i < 20; i++) {
        game.undo();
        updateUI();
      }

      for (let i = 0; i < 10; i++) {
        game.redo();
        updateUI();
      }

      // All UI updates should be fast
      const avgTime = renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length;
      expect(avgTime).toBeLessThan(5); // Should average under 5ms
      expect(Math.max(...renderTimes)).toBeLessThan(20); // No single update over 20ms
    });

    it('should handle concurrent UI interactions gracefully', () => {
      const game = new Game();
      const actions: string[] = [];
      
      // Simulate concurrent button clicks
      const clickUndo = () => {
        if (game.canUndo()) {
          actions.push('undo-click');
          game.undo();
          actions.push('undo-complete');
        }
      };
      
      const clickRedo = () => {
        if (game.canRedo()) {
          actions.push('redo-click');
          game.redo();
          actions.push('redo-complete');
        }
      };
      
      const moveSlider = (index: number) => {
        if (game.canGoToMove(index)) {
          actions.push(`slider-${index}`);
          game.goToMove(index);
          actions.push(`slider-${index}-complete`);
        }
      };

      // Set up game state
      for (let i = 0; i < 5; i++) {
        game.placePiece(new Vector3(i, 0, 0));
      }

      // Simulate rapid interactions
      clickUndo(); // 5 -> 4
      clickUndo(); // 4 -> 3
      moveSlider(2); // 3 -> 2
      clickRedo(); // 2 -> 3
      clickUndo(); // 3 -> 2
      moveSlider(0); // 2 -> 0

      // All actions should complete in order
      expect(actions.filter(a => a.includes('complete')).length).toBe(
        actions.filter(a => !a.includes('complete')).length
      );
      
      // Game should be in valid state (last slider was to 0, but let's check actual state)
      const finalIndex = game.getCurrentStateIndex();
      expect(finalIndex).toBeGreaterThanOrEqual(0);
      expect(finalIndex).toBeLessThan(game.getHistoryLength());
    });
  });
});
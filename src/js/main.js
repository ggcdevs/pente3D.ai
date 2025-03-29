import { Game } from './game.js';
import { Settings } from './settings.js';

// Initialize the game when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const gameBoard = document.getElementById('game-board');
    const resetButton = document.getElementById('reset-game');
    const gameMessage = document.getElementById('game-message');
    
    // Create a new game instance
    const game = new Game(gameBoard);
    game.initialize();
    
    // Initialize settings manager after a small delay to ensure DOM is fully ready
    setTimeout(() => {
        const settings = new Settings(game);
        
        // Load saved settings (or defaults)
        if (settings.panel) { // Only if panel was found
            settings.loadSettings();
        }
    }, 100);
    
    // Add event listener for the reset button
    resetButton.addEventListener('click', () => {
        game.reset();
        gameMessage.classList.add('hidden');
    });
});
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
    
    // Initialize settings manager
    const settings = new Settings(game);
    
    // Load saved settings (or defaults)
    settings.loadSettings();
    
    // Add event listener for the reset button
    resetButton.addEventListener('click', () => {
        game.reset();
        gameMessage.classList.add('hidden');
    });
});
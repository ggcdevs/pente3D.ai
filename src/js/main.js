import { Game } from './game.js';

// Initialize the game when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const gameBoard = document.getElementById('game-board');
    const resetButton = document.getElementById('reset-game');
    const gameMessage = document.getElementById('game-message');
    
    // Create a new game instance
    const game = new Game(gameBoard);
    game.initialize();
    
    // Add event listener for the reset button
    resetButton.addEventListener('click', () => {
        game.reset();
        gameMessage.classList.add('hidden');
    });
});
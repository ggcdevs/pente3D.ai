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
    
    // Setup reset game confirmation modal
    const confirmModal = document.getElementById('confirm-modal');
    const confirmResetButton = document.getElementById('confirm-reset');
    const cancelResetButton = document.getElementById('cancel-reset');
    
    // Make sure the modal is hidden initially
    confirmModal.classList.add('hidden');
    confirmModal.style.display = 'none';
    
    // Show the confirmation modal when reset button is clicked
    resetButton.addEventListener('click', () => {
        confirmModal.classList.remove('hidden');
        confirmModal.style.display = 'flex';
    });
    
    // Cancel reset
    cancelResetButton.addEventListener('click', () => {
        confirmModal.classList.add('hidden');
        confirmModal.style.display = 'none';
    });
    
    // Confirm reset
    confirmResetButton.addEventListener('click', () => {
        game.reset();
        gameMessage.classList.add('hidden');
        confirmModal.classList.add('hidden');
        confirmModal.style.display = 'none';
    });
    
    // Also close modal when clicking outside of it
    confirmModal.addEventListener('click', (event) => {
        if (event.target === confirmModal) {
            confirmModal.classList.add('hidden');
            confirmModal.style.display = 'none';
        }
    });
});
# Pente3D.ai

A 3D web-based version of the classic Pente game.

## Game Rules

- 2 players take consecutive turns placing pieces on a 3D grid (9x9x9)
- First player to get 5 pieces in a row (in any direction, including diagonals) wins
- If a player surrounds 2 of their opponent's pieces with their own, they capture those pieces
- A player who captures 5 or more pieces wins the game

## How to Play

1. Open `index.html` in a modern web browser
2. The black player goes first, followed by white
3. Click on an intersection point to place a piece
4. Rotate and zoom the board using mouse controls:
   - Left-click and drag to rotate
   - Scroll to zoom in/out

## Features

- Full 3D visualization of the game board
- Piece capture mechanics
- Win detection for both 5-in-a-row and capture conditions
- Highlighted winning line
- Game state display (current player, capture counts)
- Reset button to start a new game

## Technical Details

This game is built using:
- Three.js for 3D rendering
- Vanilla JavaScript
- HTML5 and CSS3
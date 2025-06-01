# User Stories - Pente3D.ai

## Core Gameplay

### Story 1: Basic Game Setup
**As a** player  
**I want to** start a new 3D Pente game  
**So that** I can play against another player  

**Acceptance Criteria:**
- Game loads with a 9x9x9 3D grid by default
- Black player goes first
- Board displays intersection nodes as small spheres
- Horizontal and vertical gridlines are visible by default
- Score banner shows current player and capture counts

### Story 2: Piece Placement
**As a** player  
**I want to** click on an intersection to place my piece  
**So that** I can make moves in the game  

**Acceptance Criteria:**
- Clicking on an open intersection places the current player's piece
- Pieces are visually distinct (black vs white)
- Turn automatically switches to the other player
- Invalid moves (occupied intersections) are rejected
- Game state updates and is saved after each move

### Story 3: Board Interaction
**As a** player  
**I want to** rotate, pan, and zoom the 3D board  
**So that** I can view the game from different angles  

**Acceptance Criteria:**
- Right-click and drag rotates the board
- Shift-Left-click and drag rotates the board
- Left-click and drag pans the board
- Mouse scroll zooms in/out
- Camera controls are smooth and responsive
- Board remains centered during interactions

### Story 4: Win Condition - Five in a Row
**As a** player  
**I want to** be declared the winner when I get 5 pieces in a row  
**So that** the game ends with a clear victory  

**Acceptance Criteria:**
- Game detects 5 pieces in a row in any direction (26 possible directions in 3D)
- Winning line is highlighted
- Game displays winner announcement
- No further moves can be made
- Undo/redo still works after game ends

### Story 5: Win Condition - Captures
**As a** player  
**I want to** win by capturing 5 or more opponent pieces  
**So that** I have an alternative victory condition  

**Acceptance Criteria:**
- When a player surrounds 2 opponent pieces, those pieces are captured
- Captured pieces are removed from the board
- Capture count is incremented by 1 in the score banner
- Game declares winner when a player reaches 5 captures
- Captures work in all directions

## Visual Feedback and Interaction

### Story 6: Hover Highlighting - Nodes
**As a** player  
**I want to** see highlights when hovering over nodes  
**So that** I can better understand the board state  

**Acceptance Criteria:**
- Hovering over an open node highlights that node
- All active gridlines intersecting that node are highlighted
- All pieces on those intersecting gridlines are highlighted
- Highlighting is visually distinct and responsive

### Story 7: Hover Highlighting - Lines
**As a** player  
**I want to** see highlights when hovering over gridlines  
**So that** I can visualize potential moves and patterns  

**Acceptance Criteria:**
- Hovering over a gridline highlights the entire line
- All pieces on that gridline are highlighted
- Line highlighting works for horizontal, vertical, and diagonal lines
- Multiple lines can be highlighted simultaneously when hovering over intersections

### Story 8: Temporary Piece Placement
**As a** player  
**I want to** press 't' to enter temporary placement mode  
**So that** I can preview moves before committing  

**Acceptance Criteria:**
- Pressing 't' enables temporary placement mode
- Clicking places a translucent piece without ending the turn
- Pressing 't' again removes temporary pieces and exits mode
- Pressing 'Enter' accepts the temporary piece as a real move
- Only one temporary piece can be placed at a time

## Game Management

### Story 9: Undo/Redo Functionality
**As a** player  
**I want to** use Ctrl+Z to undo moves and Ctrl+Y to redo  
**So that** I can correct mistakes and explore different strategies  

**Acceptance Criteria:**
- Ctrl+Z undoes the last move and updates the board
- Ctrl+Shift+Z or Ctrl+Y redoes the last undone move
- Full move history is maintained throughout the game
- Undo/redo works even after the game is won
- Score and game state are correctly restored with each undo/redo

### Story 10: Game Reset
**As a** player  
**I want to** reset the game to start over  
**So that** I can play multiple rounds  

**Acceptance Criteria:**
- Reset button clears the board and resets all game state
- Confirmation dialog prevents accidental resets
- Black player goes first after reset
- Score counters are reset to zero
- Move history is cleared

### Story 11: Game State Persistence
**As a** player  
**I want to** have my game automatically saved  
**So that** I can continue playing after closing the browser  

**Acceptance Criteria:**
- Game state is automatically saved to localStorage after each move
- Game is restored when the page is refreshed
- Settings and visual configurations are also persisted
- Invalid or corrupted save data doesn't break the game

## Visual Customization

### Story 12: Diagonal Line Control
**As a** player  
**I want to** press 'd' to toggle diagonal gridlines  
**So that** I can control visual complexity  

**Acceptance Criteria:**
- Pressing 'd' toggles diagonal gridlines on/off
- Pressing Shift+D shows only diagonal lines (hides horizontal/vertical)
- Diagonal line state is preserved across game sessions
- Hover highlighting works correctly regardless of which lines are visible

### Story 13: Gridline Visibility
**As a** player  
**I want to** press 'v' to toggle all active gridlines  
**So that** I can see just the pieces when needed  

**Acceptance Criteria:**
- Pressing 'v' hides/shows all currently active gridlines
- Intersection nodes remain visible when gridlines are hidden
- Pieces remain visible and interactable
- Hover highlighting still works when gridlines are hidden

### Story 14: Visual Settings
**As a** player  
**I want to** customize colors and transparency of game elements  
**So that** I can personalize the visual experience  

**Acceptance Criteria:**
- Settings modal allows customization of all element colors
- Transparency/opacity can be adjusted for gridlines, nodes, and pieces
- Settings are saved to localStorage
- Preview shows changes in real-time
- Reset to defaults option is available

## Menu and Game Management

### Story 15: Main Menu
**As a** player  
**I want to** access a menu with game options  
**So that** I can manage different game modes and settings  

**Acceptance Criteria:**
- Menu button is prominently displayed
- Menu modal contains: Settings, Host Game, Join Game, Load Game, Export Game
- Menu can be closed by clicking outside or pressing Escape
- All menu options are clearly labeled and functional

### Story 16: Game Export/Import
**As a** player  
**I want to** export and import game states  
**So that** I can share games and continue them later  

**Acceptance Criteria:**
- Export creates a downloadable JSON file with complete game state
- Import loads a valid game JSON file
- Exported files include move history for full undo/redo capability
- Invalid import files show helpful error messages
- File format is human-readable and documented

### Story 17: Board Size Configuration
**As a** player  
**I want to** change the board size in settings  
**So that** I can play different variants of the game  

**Acceptance Criteria:**
- Settings allow board size selection (e.g., 7x7x7, 9x9x9, 11x11x11)
- Board size change resets the current game with confirmation
- All game logic scales correctly with different board sizes
- Performance remains acceptable on larger boards
- Board size setting is persisted

## Networking

### Story 18: Host Networked Game
**As a** host  
**I want to** create a game code to share with another player  
**So that** we can play together online  

**Acceptance Criteria:**
- Host Game generates a unique, shareable game code
- Game code is displayed prominently for easy sharing
- Host can copy the game code to clipboard
- Connection status is clearly indicated
- Host controls game settings (board size, etc.)

### Story 19: Join Networked Game
**As a** joining player  
**I want to** enter a game code to join someone's game  
**So that** I can play with friends remotely  

**Acceptance Criteria:**
- Join Game provides input field for game code
- Invalid codes show helpful error messages
- Successful connection shows opponent's information
- Joining player can see host's game settings
- Connection process has clear status indicators

### Story 20: Networked Gameplay
**As a** networked player  
**I want to** see my opponent's moves in real-time  
**So that** we can play together seamlessly  

**Acceptance Criteria:**
- Moves are synchronized between players immediately
- Each player can only move on their turn
- Network disconnection is detected and handled gracefully
- Conflicting game states are resolved automatically
- Chat or communication features are available

### Story 21: Network Conflict Resolution
**As a** networked player  
**I want to** have game state conflicts resolved automatically  
**So that** the game continues smoothly even with network issues  

**Acceptance Criteria:**
- When game states diverge, both clients find the common ancestor state
- Players are notified of the conflict resolution
- Game continues from the agreed-upon state
- No moves or game progress is permanently lost
- Resolution process is quick and transparent

## Advanced Features

### Story 22: Configurable Board Size
**As a** player  
**I want to** adjust the board size  
**So that** I can play different variants and difficulty levels  

**Acceptance Criteria:**
- Settings allow selection of board dimensions
- Supported sizes: 7x7x7, 9x9x9, 11x11x11, custom
- Win conditions scale appropriately (still 5 in a row)
- Performance is optimized for larger boards
- Board size affects game strategy and complexity

### Story 23: Keyboard Shortcuts
**As a** power user  
**I want to** use keyboard shortcuts for common actions  
**So that** I can play more efficiently  

**Acceptance Criteria:**
- All shortcuts are documented and discoverable
- Help overlay shows all available shortcuts

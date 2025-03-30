import * as THREE from 'three';
import { Utility } from './utility.js';

export class Board {
    constructor(size) {
        this.size = size;
        this.board = this.createEmptyBoard();
        this.intersectionPoints = [];
        this.gridLines = []; // Store all grid lines for highlighting
    }
    
    createEmptyBoard() {
        // Create a 3D array filled with null values
        const board = new Array(this.size);
        for (let x = 0; x < this.size; x++) {
            board[x] = new Array(this.size);
            for (let y = 0; y < this.size; y++) {
                board[x][y] = new Array(this.size).fill(null);
            }
        }
        return board;
    }
    
    createBoardMesh() {
        const boardGroup = new THREE.Group();
        const offset = (this.size - 1) / 2;
        
        // Get node spacing value from game if available, otherwise use default of 1.0
        const spacing = this.game?.nodeSpacing || 1.0;
        
        // Get gridline color and opacity from the game or use defaults
        const gridlineColor = this.game?.gridlineColor || 0x444444;
        const gridlineOpacity = 1 - ((this.game?.gridlineTranslucency || 50) / 100);
        const radius = 0.02 * spacing;
        
        // Create grid lines using cylinders for better hover detection
        for (let i = 0; i < this.size; i++) {
            for (let j = 0; j < this.size; j++) {
                // Define line endpoints with proper spacing
                const xStart = new THREE.Vector3(-offset * spacing, (i - offset) * spacing, (j - offset) * spacing);
                const xEnd = new THREE.Vector3(offset * spacing, (i - offset) * spacing, (j - offset) * spacing);
                
                const yStart = new THREE.Vector3((i - offset) * spacing, -offset * spacing, (j - offset) * spacing);
                const yEnd = new THREE.Vector3((i - offset) * spacing, offset * spacing, (j - offset) * spacing);
                
                const zStart = new THREE.Vector3((i - offset) * spacing, (j - offset) * spacing, -offset * spacing);
                const zEnd = new THREE.Vector3((i - offset) * spacing, (j - offset) * spacing, offset * spacing);
                
                // Create X-axis line with adjusted length
                const xLine = Utility.createCylinderLine(
                    xStart, 
                    xEnd, 
                    gridlineColor, 
                    radius, 
                    gridlineOpacity, 
                    { type: 'line', axis: 'x', i, j }
                );
                this.gridLines.push(xLine);
                boardGroup.add(xLine);
                
                // Create Y-axis line with adjusted length
                const yLine = Utility.createCylinderLine(
                    yStart, 
                    yEnd, 
                    gridlineColor, 
                    radius, 
                    gridlineOpacity, 
                    { type: 'line', axis: 'y', i, j }
                );
                this.gridLines.push(yLine);
                boardGroup.add(yLine);
                
                // Create Z-axis line with adjusted length
                const zLine = Utility.createCylinderLine(
                    zStart, 
                    zEnd, 
                    gridlineColor, 
                    radius, 
                    gridlineOpacity, 
                    { type: 'line', axis: 'z', i, j }
                );
                this.gridLines.push(zLine);
                boardGroup.add(zLine);
            }
        }
        
        // Create intersection points
        this.intersectionPoints = [];
        
        // Get node color and opacity from the game or use defaults
        const nodeColor = this.game?.nodeColor || 0x888888;
        const nodeOpacity = 1 - ((this.game?.nodeTranslucency || 50) / 100);
        
        // Scale point size with spacing to maintain proportions
        const pointRadius = 0.15 * spacing;
        const pointGeometry = new THREE.SphereGeometry(pointRadius, 16, 16);
        const pointMaterial = new THREE.MeshBasicMaterial({
            color: nodeColor,
            transparent: true,
            opacity: nodeOpacity
        });
        
        for (let x = 0; x < this.size; x++) {
            for (let y = 0; y < this.size; y++) {
                for (let z = 0; z < this.size; z++) {
                    const point = new THREE.Mesh(pointGeometry, pointMaterial.clone());
                    // Apply spacing to all point positions
                    point.position.set(
                        (x - offset) * spacing, 
                        (y - offset) * spacing, 
                        (z - offset) * spacing
                    );
                    point.userData = { x, y, z };
                    this.intersectionPoints.push(point);
                    boardGroup.add(point);
                }
            }
        }
        
        return boardGroup;
    }
    
    placePiece(x, y, z, color) {
        if (x < 0 || x >= this.size || y < 0 || y >= this.size || z < 0 || z >= this.size) {
            return false;
        }
        
        if (this.board[x][y][z] !== null) {
            return false;
        }
        
        // Create a piece object
        const piece = {
            color: color,
            mesh: null // Will be set by the Game class
        };
        
        this.board[x][y][z] = piece;
        return true;
    }
    
    getPieceAt(x, y, z) {
        if (x < 0 || x >= this.size || y < 0 || y >= this.size || z < 0 || z >= this.size) {
            return null;
        }
        return this.board[x][y][z];
    }
    
    isOccupied(position) {
        const offset = (this.size - 1) / 2;
        const spacing = this.game?.nodeSpacing || 1.0;
        
        // Adjust for spacing when converting from 3D position to board coordinates
        const x = Math.round((position.x / spacing) + offset);
        const y = Math.round((position.y / spacing) + offset);
        const z = Math.round((position.z / spacing) + offset);
        
        return this.getPieceAt(x, y, z) !== null;
    }
    
    resetHoverState() {
        // Reset intersection points - use custom colors if available
        const nodeColor = this.game?.nodeColor || 0x888888;
        const nodeOpacity = 1 - ((this.game?.nodeTranslucency || 50) / 100);
        
        for (const point of this.intersectionPoints) {
            point.material.color.set(nodeColor);
            point.material.opacity = nodeOpacity;
        }
        
        // Reset grid lines - use custom colors if available 
        const gridColor = this.game?.gridlineColor || 0x444444;
        const gridOpacity = 1 - ((this.game?.gridlineTranslucency || 50) / 100);
        
        for (const line of this.gridLines) {
            line.material.color.set(gridColor);
            line.material.opacity = gridOpacity;
        }
        
        // Reset any highlighted pieces to their original appearance
        this.forEachPiece((piece) => {
            if (piece.mesh && piece.isHighlighted) {
                // Get the color based on the piece's player color
                const colorHex = piece.color === 'black' 
                    ? this.game?.pieceSettings?.blackColor || '#111111'
                    : this.game?.pieceSettings?.whiteColor || '#ffffff';
                
                // Get opacity from game settings
                const opacity = this.game?.pieceSettings?.opacity || 0.85;
                
                piece.mesh.material.color.set(colorHex);
                piece.mesh.material.opacity = opacity;
                piece.mesh.material.emissive.set(0x000000); // Reset emissive
                piece.mesh.material.emissiveIntensity = 0;
                
                // Reset the highlighted flag
                piece.isHighlighted = false;
            }
        });
    }
    
    // Method to highlight a single grid line
    highlightGridLine(line) {
        if (line && line.userData && line.userData.type === 'line') {
            // Use settings if available, otherwise fallback to default
            const color = this.game?.gridlineHoverSettings?.color || '#00ff00';
            const opacity = this.game?.gridlineHoverSettings?.opacity || 0.8;
            
            line.material.color.set(color);
            line.material.opacity = opacity;
            
            // Highlight pieces that are along this gridline
            this.highlightPiecesAlongLine(line);
        }
    }
    
    // Method to highlight pieces along a gridline
    highlightPiecesAlongLine(line) {
        if (!line || !line.userData || line.userData.type !== 'line') return;
        
        const { axis, i, j } = line.userData;
        
        // Highlight pieces that lie on this gridline
        this.forEachPiece((piece, x, y, z) => {
            let isOnLine = false;
            
            // Check if the piece is on this gridline based on the axis
            if (axis === 'x' && y === i && z === j) {
                // Piece is on an X-axis line
                isOnLine = true;
            } else if (axis === 'y' && x === i && z === j) {
                // Piece is on a Y-axis line
                isOnLine = true;
            } else if (axis === 'z' && x === i && y === j) {
                // Piece is on a Z-axis line
                isOnLine = true;
            }
            
            if (isOnLine && piece.mesh) {
                // Highlight the piece
                const highlightColor = new THREE.Color(this.game?.gridlineHoverSettings?.color || '#00ff00');
                
                // Set the piece to have an emissive glow
                piece.mesh.material.emissive = highlightColor;
                piece.mesh.material.emissiveIntensity = 0.5;
                
                // Mark the piece as highlighted
                piece.isHighlighted = true;
            }
        });
    }
    
    // Method to highlight the 3 grid lines intersecting at a point
    highlightIntersectingLines(point) {
        if (!point || !point.userData) return;
        
        const { x, y, z } = point.userData;
        
        // Track the lines that we've highlighted to highlight pieces along them
        const highlightedLines = [];
        
        // Find and highlight the 3 grid lines that intersect this point
        for (const line of this.gridLines) {
            if (!line.userData || line.userData.type !== 'line') continue;
            
            const { axis, i, j } = line.userData;
            
            // Check if this grid line passes through the point
            if (
                (axis === 'x' && i === y && j === z) ||  // X-axis line at the point's Y and Z coordinates
                (axis === 'y' && i === x && j === z) ||  // Y-axis line at the point's X and Z coordinates
                (axis === 'z' && i === x && j === y)     // Z-axis line at the point's X and Y coordinates
            ) {
                // Use settings if available, otherwise fallback to default
                const color = this.game?.gridlineHoverSettings?.color || '#00ff00';
                const opacity = this.game?.gridlineHoverSettings?.opacity || 0.8;
                
                line.material.color.set(color);
                line.material.opacity = opacity;
                
                // Add to the list of highlighted lines
                highlightedLines.push(line);
            }
        }
        
        // Highlight all pieces along the three highlighted lines
        for (const line of highlightedLines) {
            this.highlightPiecesAlongLine(line);
        }
        
        // Also highlight any piece that might be at this exact point
        const pieceAtPoint = this.getPieceAt(x, y, z);
        if (pieceAtPoint && pieceAtPoint.mesh) {
            const highlightColor = new THREE.Color(this.game?.gridlineHoverSettings?.color || '#00ff00');
            pieceAtPoint.mesh.material.emissive = highlightColor;
            pieceAtPoint.mesh.material.emissiveIntensity = 0.7; // Slightly stronger at intersection
            pieceAtPoint.isHighlighted = true;
        }
    }
    
    checkCaptures(x, y, z, color) {
        const capturedPositions = [];
        const opponentColor = color === 'black' ? 'white' : 'black';
        
        // Define the 26 directions in 3D space
        const directions = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dy === 0 && dz === 0) continue; // Skip the center
                    directions.push({ dx, dy, dz });
                }
            }
        }
        
        // Check for captures in each direction
        for (const dir of directions) {
            // Check if there are two opponent pieces followed by a player piece
            const pos1 = { x: x + dir.dx, y: y + dir.dy, z: z + dir.dz };
            const pos2 = { x: x + 2 * dir.dx, y: y + 2 * dir.dy, z: z + 2 * dir.dz };
            const pos3 = { x: x + 3 * dir.dx, y: y + 3 * dir.dy, z: z + 3 * dir.dz };
            
            const piece1 = this.getPieceAt(pos1.x, pos1.y, pos1.z);
            const piece2 = this.getPieceAt(pos2.x, pos2.y, pos2.z);
            const piece3 = this.getPieceAt(pos3.x, pos3.y, pos3.z);
            
            if (piece1 && piece2 && piece3 &&
                piece1.color === opponentColor &&
                piece2.color === opponentColor &&
                piece3.color === color) {
                
                // Capture these two opponent pieces
                capturedPositions.push(pos1, pos2);
            }
        }
        
        return capturedPositions;
    }
    
    checkWin(x, y, z, color) {
        // Define the 13 directions in 3D space (we only need to check in one direction and its opposite)
        const directions = [
            { dx: 1, dy: 0, dz: 0 },  // X axis
            { dx: 0, dy: 1, dz: 0 },  // Y axis
            { dx: 0, dy: 0, dz: 1 },  // Z axis
            { dx: 1, dy: 1, dz: 0 },  // XY diagonal
            { dx: 1, dy: -1, dz: 0 }, // XY diagonal
            { dx: 1, dy: 0, dz: 1 },  // XZ diagonal
            { dx: 1, dy: 0, dz: -1 }, // XZ diagonal
            { dx: 0, dy: 1, dz: 1 },  // YZ diagonal
            { dx: 0, dy: 1, dz: -1 }, // YZ diagonal
            { dx: 1, dy: 1, dz: 1 },  // XYZ diagonal
            { dx: 1, dy: 1, dz: -1 }, // XYZ diagonal
            { dx: 1, dy: -1, dz: 1 }, // XYZ diagonal
            { dx: 1, dy: -1, dz: -1 } // XYZ diagonal
        ];
        
        // For each direction, check how many pieces are in a row
        for (const dir of directions) {
            const line = this.countLine(x, y, z, dir.dx, dir.dy, dir.dz, color);
            if (line.length >= 5) {
                return line;
            }
        }
        
        return [];
    }
    
    countLine(x, y, z, dx, dy, dz, color) {
        const line = [{ x, y, z }];
        
        // Count in the positive direction
        let count = 1;
        let i = 1;
        while (true) {
            const nx = x + i * dx;
            const ny = y + i * dy;
            const nz = z + i * dz;
            
            const piece = this.getPieceAt(nx, ny, nz);
            if (piece && piece.color === color) {
                line.push({ x: nx, y: ny, z: nz });
                count++;
                i++;
            } else {
                break;
            }
        }
        
        // Count in the negative direction
        i = 1;
        while (true) {
            const nx = x - i * dx;
            const ny = y - i * dy;
            const nz = z - i * dz;
            
            const piece = this.getPieceAt(nx, ny, nz);
            if (piece && piece.color === color) {
                line.unshift({ x: nx, y: ny, z: nz });
                count++;
                i++;
            } else {
                break;
            }
        }
        
        return line;
    }
    
    forEachPiece(callback) {
        for (let x = 0; x < this.size; x++) {
            for (let y = 0; y < this.size; y++) {
                for (let z = 0; z < this.size; z++) {
                    const piece = this.board[x][y][z];
                    if (piece) {
                        callback(piece, x, y, z);
                    }
                }
            }
        }
    }
}
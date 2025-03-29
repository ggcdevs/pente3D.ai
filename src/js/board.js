import * as THREE from 'three';

export class Board {
    constructor(size) {
        this.size = size;
        this.board = this.createEmptyBoard();
        this.intersectionPoints = [];
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
        
        // Create grid lines
        for (let i = 0; i < this.size; i++) {
            for (let j = 0; j < this.size; j++) {
                // X-axis lines
                const xLineGeometry = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(-offset, i - offset, j - offset),
                    new THREE.Vector3(offset, i - offset, j - offset)
                ]);
                
                // Y-axis lines
                const yLineGeometry = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(i - offset, -offset, j - offset),
                    new THREE.Vector3(i - offset, offset, j - offset)
                ]);
                
                // Z-axis lines
                const zLineGeometry = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(i - offset, j - offset, -offset),
                    new THREE.Vector3(i - offset, j - offset, offset)
                ]);
                
                const lineMaterial = new THREE.LineBasicMaterial({ 
                    color: 0x444444,
                    transparent: true,
                    opacity: 0.5
                });
                
                const xLine = new THREE.Line(xLineGeometry, lineMaterial);
                const yLine = new THREE.Line(yLineGeometry, lineMaterial);
                const zLine = new THREE.Line(zLineGeometry, lineMaterial);
                
                boardGroup.add(xLine);
                boardGroup.add(yLine);
                boardGroup.add(zLine);
            }
        }
        
        // Create intersection points
        this.intersectionPoints = [];
        const pointGeometry = new THREE.SphereGeometry(0.1, 16, 16);
        const pointMaterial = new THREE.MeshBasicMaterial({
            color: 0x888888,
            transparent: true,
            opacity: 0.5
        });
        
        for (let x = 0; x < this.size; x++) {
            for (let y = 0; y < this.size; y++) {
                for (let z = 0; z < this.size; z++) {
                    const point = new THREE.Mesh(pointGeometry, pointMaterial.clone());
                    point.position.set(x - offset, y - offset, z - offset);
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
        const x = Math.round(position.x + offset);
        const y = Math.round(position.y + offset);
        const z = Math.round(position.z + offset);
        
        return this.getPieceAt(x, y, z) !== null;
    }
    
    resetHoverState() {
        for (const point of this.intersectionPoints) {
            point.material.color.set(0x888888);
            point.material.opacity = 0.5;
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
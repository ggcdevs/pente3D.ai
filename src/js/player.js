import * as THREE from 'three';
import { Utility } from './utility.js';

export class Player {
    constructor(color, game) {
        this.color = color;
        this.captures = 0;
        this.game = game;
    }
    
    createPiece(isTemporary = false) {
        console.log('Creating piece, temporary:', isTemporary, 'color:', this.color);
        
        // Get node spacing to scale piece size appropriately
        const spacing = this.game?.nodeSpacing || 1.0;
        
        // Create a mesh for the piece with size proportional to node spacing
        const pieceRadius = 0.4 * spacing;
        const geometry = new THREE.SphereGeometry(pieceRadius, 32, 32);
        
        // Get piece color and opacity from game settings or use defaults
        let pieceColor = this.getPieceColor();
        let pieceOpacity = this.getPieceOpacity();
        
        // For temporary pieces, we add a slight tint and make them more transparent
        if (isTemporary) {
            console.log('Applying temporary piece styling');
            
            // Convert pieceColor to THREE.Color if it's not already
            pieceColor = this.ensureThreeColor(pieceColor);
            
            if (this.color === 'black') {
                // Brighten black pieces slightly to make them look less solid
                pieceColor = pieceColor.offsetHSL(0, 0, 0.15);
            } else {
                // Add a slight blue tint to white pieces to distinguish them
                pieceColor = pieceColor.offsetHSL(0.6, 0.2, -0.05);
            }
            
            // Make temporary pieces more transparent
            pieceOpacity = 0.6;
            
            console.log('Temporary piece color:', pieceColor);
        }
        
        const material = new THREE.MeshPhongMaterial({
            color: pieceColor,
            shininess: 100,
            specular: 0x444444,
            transparent: true,
            opacity: pieceOpacity
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        
        return mesh;
    }
    
    // Helper method to get the correct piece color from game settings
    getPieceColor() {
        if (this.game && this.game.pieceSettings) {
            return this.color === 'black' 
                ? this.game.pieceSettings.blackColor 
                : this.game.pieceSettings.whiteColor;
        }
        return this.color === 'black' ? 0x111111 : 0xffffff;
    }
    
    // Helper method to get the correct piece opacity from game settings
    getPieceOpacity() {
        if (this.game && this.game.pieceSettings) {
            return this.game.pieceSettings.opacity;
        }
        return 0.85; // Default 15% translucency
    }
    
    // Helper method to ensure we have a THREE.Color object
    ensureThreeColor(color) {
        if (color instanceof THREE.Color) {
            return color;
        }
        return new THREE.Color(color);
    }
}
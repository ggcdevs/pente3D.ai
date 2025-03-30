import * as THREE from 'three';

export class Player {
    constructor(color, game) {
        this.color = color;
        this.captures = 0;
        this.game = game;
    }
    
    createPiece(isTemporary = false) {
        // Get node spacing to scale piece size appropriately
        const spacing = this.game?.nodeSpacing || 1.0;
        
        // Create a mesh for the piece with size proportional to node spacing
        const pieceRadius = 0.4 * spacing;
        const geometry = new THREE.SphereGeometry(pieceRadius, 32, 32);
        
        // Use settings if available
        let pieceColor = this.color === 'black' ? 0x111111 : 0xffffff;
        let pieceOpacity = 0.85;  // Default 15% translucency
        
        // Apply settings if available
        if (this.game && this.game.pieceSettings) {
            if (this.color === 'black') {
                pieceColor = this.game.pieceSettings.blackColor;
            } else {
                pieceColor = this.game.pieceSettings.whiteColor;
            }
            pieceOpacity = this.game.pieceSettings.opacity;
        }
        
        // For temporary pieces, we add a slight tint and make them more transparent
        if (isTemporary) {
            if (this.color === 'black') {
                // Brighten black pieces slightly to make them look less solid
                pieceColor = new THREE.Color(pieceColor).offsetHSL(0, 0, 0.15).getHex();
            } else {
                // Add a slight blue tint to white pieces to distinguish them
                pieceColor = new THREE.Color(pieceColor).offsetHSL(0.6, 0.2, -0.05).getHex();
            }
            // Make temporary pieces more transparent
            pieceOpacity = 0.6;
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
}
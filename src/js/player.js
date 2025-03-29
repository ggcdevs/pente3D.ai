import * as THREE from 'three';

export class Player {
    constructor(color, game) {
        this.color = color;
        this.captures = 0;
        this.game = game;
    }
    
    createPiece() {
        // Create a mesh for the piece
        const geometry = new THREE.SphereGeometry(0.4, 32, 32);
        
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
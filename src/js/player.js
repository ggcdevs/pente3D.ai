import * as THREE from 'three';

export class Player {
    constructor(color) {
        this.color = color;
        this.captures = 0;
    }
    
    createPiece() {
        // Create a mesh for the piece
        const geometry = new THREE.SphereGeometry(0.4, 32, 32);
        const material = new THREE.MeshPhongMaterial({
            color: this.color === 'black' ? 0x111111 : 0xffffff,
            shininess: 100,
            specular: 0x444444,
            transparent: true,
            opacity: 0.9  // 10% translucency (90% opacity)
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        
        return mesh;
    }
}
import * as THREE from 'three';

// Utility functions for the Pente3D game
export class Utility {
    /**
     * Creates a cylinder representing a line between two points
     * @param {THREE.Vector3} start - Start point of the line
     * @param {THREE.Vector3} end - End point of the line
     * @param {string|number} color - Color of the line
     * @param {number} radius - Radius of the cylinder
     * @param {number} opacity - Opacity of the cylinder
     * @param {object} userData - Optional user data to attach to the cylinder
     * @returns {THREE.Mesh} - The cylinder mesh
     */
    static createCylinderLine(start, end, color, radius, opacity, userData = {}) {
        // Calculate the direction vector
        const direction = new THREE.Vector3().subVectors(end, start);
        const length = direction.length();
        
        // Create cylinder geometry
        const geometry = new THREE.CylinderGeometry(radius, radius, length, 8, 1);
        
        // Position and rotate the cylinder
        geometry.translate(0, length / 2, 0); // Move up so the bottom face is at the origin
        
        const material = new THREE.MeshBasicMaterial({ 
            color: color,
            transparent: true,
            opacity: opacity
        });
        
        const cylinder = new THREE.Mesh(geometry, material);
        
        // Position at the start point
        cylinder.position.copy(start);
        
        // Orient the cylinder to point from start to end
        if (direction.y > 0.99) {
            // Special case: vertical line (already aligned with Y-axis)
            // No rotation needed
        } else if (direction.y < -0.99) {
            // Special case: vertical line pointing down
            cylinder.rotateX(Math.PI); // Rotate 180 degrees around X axis
        } else {
            // General case: use lookAt
            cylinder.lookAt(end);
            cylinder.rotateX(Math.PI / 2); // Adjust to match THREE.js cylinder orientation
        }
        
        // Add user data
        cylinder.userData = userData;
        
        return cylinder;
    }
    
    /**
     * Toggles the visibility of a DOM element by adding/removing a 'hidden' class
     * @param {HTMLElement} element - The DOM element to toggle
     * @param {boolean} show - Whether to show or hide the element
     */
    static toggleElementVisibility(element, show) {
        if (!element) return;
        
        if (show) {
            element.classList.remove('hidden');
        } else {
            element.classList.add('hidden');
        }
    }
    
    /**
     * Creates or updates a visual indicator element
     * @param {string} id - The ID for the indicator element
     * @param {string} text - The text to display in the indicator
     * @param {boolean} show - Whether to show or hide the indicator
     * @param {string} containerSelector - The selector for the container element
     * @returns {HTMLElement} - The indicator element
     */
    static updateIndicator(id, text, show, containerSelector = '.game-container') {
        let indicator = document.getElementById(id);
        
        // Create the indicator if it doesn't exist
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = id;
            indicator.textContent = text;
            indicator.classList.add('mode-indicator');
            document.querySelector(containerSelector).appendChild(indicator);
        }
        
        // Update visibility
        Utility.toggleElementVisibility(indicator, show);
        
        return indicator;
    }
    
    /**
     * Calculates distance from a point to a line segment
     * @param {THREE.Vector3} point - The point
     * @param {THREE.Vector3} lineStart - Start point of the line segment
     * @param {THREE.Vector3} lineEnd - End point of the line segment
     * @returns {number} - The distance from the point to the line segment
     */
    static distancePointToLine(point, lineStart, lineEnd) {
        const lineDir = new THREE.Vector3().subVectors(lineEnd, lineStart);
        const projectedLength = new THREE.Vector3().subVectors(point, lineStart).dot(lineDir.normalize());
        const nearestPoint = lineStart.clone().add(lineDir.multiplyScalar(projectedLength / lineDir.length()));
        return nearestPoint.distanceTo(point);
    }
    
    /**
     * Determines if a point is on a line within a threshold distance
     * @param {THREE.Vector3} point - The point to check
     * @param {THREE.Vector3} start - Start point of the line
     * @param {THREE.Vector3} end - End point of the line
     * @param {number} threshold - Distance threshold
     * @returns {boolean} - Whether the point is on the line
     */
    static isPointOnLine(point, start, end, threshold) {
        const closestPoint = new THREE.Vector3();
        const line = new THREE.Line3(start, end);
        line.closestPointToPoint(point, true, closestPoint);
        return closestPoint.distanceTo(point) < threshold;
    }
    
    /**
     * Helper to ensure a point is within bounds
     * @param {THREE.Vector3} point - The point to clamp
     * @param {number} min - Minimum bound
     * @param {number} max - Maximum bound
     * @returns {THREE.Vector3} - The clamped point
     */
    static clampPointToBounds(point, min, max) {
        return new THREE.Vector3(
            Math.max(min, Math.min(max, point.x)),
            Math.max(min, Math.min(max, point.y)),
            Math.max(min, Math.min(max, point.z))
        );
    }
}
# Feature #001 Investigation Notes

## Current Implementation Analysis

### Settings Layer ✅ COMPLETE
The settings infrastructure is fully implemented and working:

```typescript
// Settings.ts
private gridDiagonals: boolean;

getGridDiagonals(): boolean {
  return this.gridDiagonals;
}

setGridDiagonals(enabled: boolean): void {
  if (this.gridDiagonals !== enabled) {
    this.gridDiagonals = enabled;
    this.notifyListeners();
  }
}
```

- Properly initialized in constructor
- Included in serialization (`toJSON()`)
- Part of equality checks
- Has change notification system

### Main Application Layer ⚠️ STUBBED
```typescript
// main.ts lines 253-256
if (settings.getGridDiagonals()) {
  // This would require adding a method to renderer to toggle diagonals
  // For now, we'll add this functionality later
}
```

**Issues:**
- Only checks setting at startup
- No listener for setting changes
- No method call to renderer

### Renderer Layer ❌ NOT IMPLEMENTED
The `Renderer.ts` file has no diagonal line generation:

```typescript
private createBoardGrid(): void {
  // Only creates orthogonal lines:
  // - X-axis lines (across all Y and Z)
  // - Y-axis lines (across all X and Z)  
  // - Z-axis lines (across all X and Y)
  
  // NO diagonal line generation
}
```

## Existing Line Drawing Infrastructure

### Line Highlighting System ✅
The renderer has sophisticated line drawing for game state visualization:

```typescript
highlightLine(line: Line, color: number = 0x00ff00): void {
  // Creates cylinders between points
  // Adds spheres at coordinates
  // Proper 3D positioning
  // Material and color management
}
```

**Key patterns to reuse:**
- Cylinder geometry for connections
- Position calculation with `halfSize` offset
- Material cloning for unique colors
- Group management for easy removal

### Coordinate Systems and Directions ✅
The game logic has complete 3D direction support:

```typescript
// From GameRules.ts and types/index.ts
DIRECTIONS_3D = [
  // 6 face directions
  { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
  
  // 12 edge directions (2D diagonals)
  { x: 1, y: 1, z: 0 }, { x: 1, y: -1, z: 0 },
  // ... etc
  
  // 8 corner directions (3D diagonals)
  { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: -1 },
  // ... etc
];
```

## Implementation Challenges

### 1. Performance Considerations
- 7x7x7 board = 343 nodes
- Face diagonals: ~294 line segments (6 faces × 7 × 7)
- Space diagonals: 4 long lines
- Edge diagonals: ~168 additional segments
- **Total**: ~466 additional line segments

**Solutions:**
- Use merged geometry for better performance
- Consider LOD (Level of Detail) for distant views
- Only render diagonals within view frustum

### 2. Visual Clarity
- Must be distinguishable from main grid
- Should not overwhelm the visual space
- Need to work with both light and dark themes

**Solutions:**
- Use lower opacity (0.3-0.5)
- Dashed or dotted line style
- Thinner line width
- Different color (slightly darker than grid)

### 3. Dynamic Updates
- Setting can change during gameplay
- Need to add/remove diagonals without disrupting game

**Solutions:**
- Separate diagonal lines into their own Group
- Cache geometry for quick toggle
- Connect to settings change listener

## Proposed Implementation

### 1. Add Method to Renderer
```typescript
private diagonalLinesGroup?: THREE.Group;

public setDiagonalLinesVisible(visible: boolean): void {
  if (visible && !this.diagonalLinesGroup) {
    this.createDiagonalLines();
  }
  if (this.diagonalLinesGroup) {
    this.diagonalLinesGroup.visible = visible;
    this.render();
  }
}

private createDiagonalLines(): void {
  this.diagonalLinesGroup = new THREE.Group();
  
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  
  // Generate all diagonal positions
  this.generateFaceDiagonals(positions);
  this.generateSpaceDiagonals(positions);
  
  geometry.setAttribute('position', 
    new THREE.Float32BufferAttribute(positions, 3)
  );
  
  const material = new THREE.LineDashedMaterial({
    color: this.gridMaterial.color,
    opacity: 0.3,
    transparent: true,
    dashSize: 0.1,
    gapSize: 0.05
  });
  
  const lines = new THREE.LineSegments(geometry, material);
  lines.computeLineDistances(); // Required for dashed lines
  
  this.diagonalLinesGroup.add(lines);
  this.scene.add(this.diagonalLinesGroup);
}
```

### 2. Update Main.ts
```typescript
// Initial setup
renderer.setDiagonalLinesVisible(settings.getGridDiagonals());

// Listen for changes
settings.addChangeListener((newSettings) => {
  renderer.setDiagonalLinesVisible(newSettings.getGridDiagonals());
  // ... other setting updates
});
```

### 3. Performance Optimizations
- Pre-calculate all diagonal positions once
- Use instanced rendering if available
- Consider distance-based culling
- Batch all diagonals into single draw call

## Testing Requirements

### Unit Tests
- Verify diagonal line generation algorithms
- Test coordinate calculations
- Ensure proper cleanup on disposal

### Integration Tests  
- Setting toggle updates renderer
- Diagonals appear/disappear correctly
- No interference with game mechanics

### Visual Tests
- Screenshot comparisons with diagonals on/off
- Verify appearance in different themes
- Check visibility at various camera angles

### Performance Tests
- Measure FPS impact with diagonals enabled
- Test on maximum board size (20x20x20)
- Memory usage comparison

## Alternative Approaches Considered

### 1. Individual Line Meshes
- **Pros**: Easy to implement, flexible styling per line
- **Cons**: Many draw calls, poor performance

### 2. Shader-Based Rendering
- **Pros**: Best performance, dynamic styling
- **Cons**: Complex implementation, harder to maintain

### 3. Texture-Based Grid
- **Pros**: Single draw call, good performance
- **Cons**: Less flexible, resolution dependent

**Chosen**: Merged geometry with dashed lines material as best balance of performance and flexibility.

## Next Steps

1. Implement basic diagonal line generation
2. Test performance impact
3. Iterate on visual style based on user feedback
4. Consider adding user customization options (opacity, style)
5. Document the feature in user guide

## Related Features to Consider

- **Grid opacity setting**: Allow users to adjust overall grid visibility
- **Selective diagonals**: Show only certain types (face/space/edge)
- **Highlight mode**: Temporarily show diagonals on hover
- **Learning mode**: Animate diagonal lines to teach winning patterns
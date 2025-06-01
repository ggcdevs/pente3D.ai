# Chunk 1.1: Basic Data Structures - Testing Guide

## Testing Overview
Comprehensive validation of all core data structure classes to ensure they are robust, immutable, well-typed, and handle edge cases correctly. This testing establishes the foundation for all game logic.

## Pre-Testing Setup
Ensure you have completed all steps in `development.md` and that Chunk 0.1 infrastructure is working.

## Automated Testing Protocols

### 1. Vector3 Class Testing

#### Test Group A: Construction and Validation
```bash
# Tests 1-6: Constructor validation
npm test -- --testNamePattern="Vector3.*constructor"
```

**Test Coverage:**
- **Test 1**: Valid integer coordinates
- **Test 2**: Valid decimal coordinates (should round)
- **Test 3**: Zero coordinates
- **Test 4**: Negative coordinates
- **Test 5**: Large coordinates
- **Test 6**: Invalid inputs (NaN, Infinity, null, undefined)

**Expected Results:**
- Valid coordinates create Vector3 instances
- Decimals are rounded to integers
- Invalid inputs throw clear error messages
- All coordinates are immutable (readonly)

#### Test Group B: Factory Methods
```bash
# Tests 7-10: Factory methods
npm test -- --testNamePattern="Vector3.*factory"
```

**Test Coverage:**
- **Test 7**: `Vector3.fromArray([1, 2, 3])`
- **Test 8**: `Vector3.fromObject({x: 1, y: 2, z: 3})`
- **Test 9**: `Vector3.zero()` creates (0, 0, 0)
- **Test 10**: Factory methods with invalid inputs

#### Test Group C: Arithmetic Operations
```bash
# Tests 11-16: Arithmetic operations
npm test -- --testNamePattern="Vector3.*arithmetic"
```

**Test Coverage:**
- **Test 11**: Addition returns new instance
- **Test 12**: Subtraction returns new instance
- **Test 13**: Scalar multiplication
- **Test 14**: Operations don't mutate original
- **Test 15**: Chained operations work correctly
- **Test 16**: Invalid scalar multiplication throws error

#### Test Group D: Utility Methods
```bash
# Tests 17-22: Utility methods
npm test -- --testNamePattern="Vector3.*utility"
```

**Test Coverage:**
- **Test 17**: `distance()` calculation accuracy
- **Test 18**: `magnitude()` calculation
- **Test 19**: `normalize()` creates unit vector
- **Test 20**: `equals()` comparison accuracy
- **Test 21**: `toString()` format consistency
- **Test 22**: `toJSON()` serialization

### 2. Player Class Testing

#### Test Group E: Player Construction
```bash
# Tests 23-28: Player construction
npm test -- --testNamePattern="Player.*constructor"
```

**Test Coverage:**
- **Test 23**: Valid local player creation
- **Test 24**: Valid remote player with connection ID
- **Test 25**: Invalid ID (empty, null, whitespace) throws error
- **Test 26**: Invalid color throws error
- **Test 27**: Factory methods `createLocal()` and `createRemote()`
- **Test 28**: Player immutability verification

#### Test Group F: Capture Management
```bash
# Tests 29-34: Capture management
npm test -- --testNamePattern="Player.*captures"
```

**Test Coverage:**
- **Test 29**: Initial captures count is 0
- **Test 30**: `incrementCaptures()` returns new instance
- **Test 31**: `incrementCaptures(3)` adds correct amount
- **Test 32**: Negative increment throws error
- **Test 33**: `resetCaptures()` returns new instance with 0
- **Test 34**: Original player unchanged after operations

#### Test Group G: Player Utility Methods
```bash
# Tests 35-40: Player utilities
npm test -- --testNamePattern="Player.*utility"
```

**Test Coverage:**
- **Test 35**: `isConnected()` for local players (always true)
- **Test 36**: `isConnected()` for remote players with/without connection ID
- **Test 37**: `equals()` comparison with same/different players
- **Test 38**: `toString()` format consistency
- **Test 39**: `toJSON()` serialization completeness
- **Test 40**: `clone()` creates independent copy

### 3. Move Class Testing

#### Test Group H: Move Construction
```bash
# Tests 41-46: Move construction
npm test -- --testNamePattern="Move.*constructor"
```

**Test Coverage:**
- **Test 41**: Simple move with Vector3 and Player
- **Test 42**: Move with captured pieces
- **Test 43**: Move with custom timestamp
- **Test 44**: Invalid coordinates throw error
- **Test 45**: Invalid player throws error
- **Test 46**: Odd number of captured pieces throws error

#### Test Group I: Move Factory Methods
```bash
# Tests 47-52: Move factories
npm test -- --testNamePattern="Move.*factory"
```

**Test Coverage:**
- **Test 47**: `createSimple()` factory method
- **Test 48**: `createCapture()` factory method
- **Test 49**: Factory methods with IVector3/IPlayer interfaces
- **Test 50**: Automatic timestamp generation
- **Test 51**: Captured pieces validation
- **Test 52**: Move immutability verification

#### Test Group J: Move Validation and Queries
```bash
# Tests 53-58: Move validation
npm test -- --testNamePattern="Move.*validation"
```

**Test Coverage:**
- **Test 53**: `isCapture()` returns correct boolean
- **Test 54**: `getCaptureCount()` returns correct number
- **Test 55**: `isValid()` validates complete moves
- **Test 56**: `isValid()` rejects invalid timestamps
- **Test 57**: `equals()` comparison accuracy
- **Test 58**: `toJSON()` and serialization roundtrip

### 4. Piece Class Testing

#### Test Group K: Piece Construction
```bash
# Tests 59-64: Piece construction
npm test -- --testNamePattern="Piece.*constructor"
```

**Test Coverage:**
- **Test 59**: Normal piece creation
- **Test 60**: Temporary piece creation
- **Test 61**: Piece with custom placement time
- **Test 62**: Invalid coordinates throw error
- **Test 63**: Invalid player throws error
- **Test 64**: Piece immutability verification

#### Test Group L: Piece Factory Methods
```bash
# Tests 65-70: Piece factories
npm test -- --testNamePattern="Piece.*factory"
```

**Test Coverage:**
- **Test 65**: `createNormal()` factory method
- **Test 66**: `createTemporary()` factory method
- **Test 67**: Factory methods with interface types
- **Test 68**: Automatic placement timestamp
- **Test 69**: `getType()` returns correct PieceType
- **Test 70**: State query methods accuracy

#### Test Group M: Piece Transformations
```bash
# Tests 71-76: Piece transformations
npm test -- --testNamePattern="Piece.*transform"
```

**Test Coverage:**
- **Test 71**: `makeTemporary()` transformation
- **Test 72**: `makePermanent()` transformation
- **Test 73**: `moveTo()` position change
- **Test 74**: Transformations return new instances
- **Test 75**: `belongsTo()` and `isAt()` queries
- **Test 76**: `isValid()` validation method

### 5. Integration Testing

#### Test Group N: Cross-Class Integration
```bash
# Tests 77-82: Integration tests
npm test -- --testNamePattern="Integration"
```

**Test Coverage:**
- **Test 77**: Vector3 used in Move and Piece
- **Test 78**: Player used in Move and Piece
- **Test 79**: Move creation with Piece coordinates
- **Test 80**: JSON serialization roundtrip for all classes
- **Test 81**: Class method chaining works correctly
- **Test 82**: No circular dependencies or memory leaks

## Performance Testing

### 6. Performance Benchmarks
```bash
# Tests 83-88: Performance validation
npm test -- --testNamePattern="Performance"
```

**Test Coverage:**
- **Test 83**: Vector3 operations complete in <1ms
- **Test 84**: Player operations complete in <1ms
- **Test 85**: Move creation completes in <1ms
- **Test 86**: Piece operations complete in <1ms
- **Test 87**: 1000 object creations complete in <100ms
- **Test 88**: Memory usage remains stable during operations

### Expected Performance Benchmarks:
- **Object Creation**: <0.1ms per instance
- **Method Calls**: <0.01ms per operation
- **Serialization**: <1ms for complex objects
- **Memory**: No memory leaks detected

## Error Handling Testing

### 7. Comprehensive Error Scenarios
```bash
# Tests 89-94: Error handling
npm test -- --testNamePattern="Error"
```

**Test Coverage:**
- **Test 89**: All classes reject null/undefined inputs
- **Test 90**: Numerical validation catches NaN/Infinity
- **Test 91**: String validation catches empty/whitespace
- **Test 92**: Type validation catches wrong types
- **Test 93**: Range validation catches out-of-bounds values
- **Test 94**: Error messages are clear and actionable

## Manual Testing Procedures

### 8. Browser Console Testing
**Test 95: Browser Integration**
1. Start dev server: `npm run dev`
2. Open browser console
3. Verify data structures load without errors
4. Check console output shows test instances

**Expected Results:**
- No TypeScript compilation errors
- Console shows: "Data structures loaded: {vector: ..., player: ..., move: ..., piece: ...}"
- All objects display correct `toString()` output
- No runtime errors during object creation

### 9. TypeScript Integration Testing
**Test 96: Type Safety**
1. Create test file with intentional type errors
2. Run `npm run type-check`
3. Verify TypeScript catches type mismatches
4. Confirm IntelliSense provides proper autocomplete

**Expected Results:**
- TypeScript catches incorrect property access
- Interface implementations are validated
- Generic type parameters work correctly
- Path mapping resolves `@/core` imports

### 10. Build Integration Testing
**Test 97: Production Build**
1. Run `npm run build`
2. Check bundle includes data structures
3. Verify no tree-shaking removes needed code
4. Test production bundle in browser

**Expected Results:**
- Build completes without errors
- Bundle size increases appropriately (expect ~5KB additional)
- All classes work correctly in production build
- No missing dependencies in bundle

## Test Coverage Requirements

### Minimum Passing Criteria
- [ ] All 97 tests pass without errors
- [ ] Code coverage >95% for all data structure classes
- [ ] TypeScript compilation with strict mode passes
- [ ] No ESLint warnings for implemented classes
- [ ] All classes maintain immutability guarantees
- [ ] Performance benchmarks met
- [ ] Error handling comprehensive and clear
- [ ] Browser integration works correctly
- [ ] Production build includes all functionality

### Performance Benchmarks
- [ ] Object creation: <0.1ms per instance
- [ ] Method calls: <0.01ms per operation
- [ ] Bulk operations: 1000 objects in <100ms
- [ ] Memory usage: No leaks detected
- [ ] Bundle size: <10KB additional overhead

### Quality Gates
- [ ] No TypeScript errors or warnings
- [ ] No runtime errors during normal operations
- [ ] All edge cases handled gracefully
- [ ] Error messages are clear and actionable
- [ ] Classes integrate seamlessly together
- [ ] JSON serialization works bidirectionally

## Test Implementation Guide

### Create Test Files Structure
```
tests/unit/core/
├── Vector3.test.ts
├── Player.test.ts
├── Move.test.ts
├── Piece.test.ts
└── integration.test.ts
```

### Sample Test Template
```typescript
describe('Vector3', () => {
  describe('constructor', () => {
    test('creates valid instance with integer coordinates', () => {
      const vector = new Vector3(1, 2, 3);
      expect(vector.x).toBe(1);
      expect(vector.y).toBe(2);
      expect(vector.z).toBe(3);
    });

    test('throws error for invalid coordinates', () => {
      expect(() => new Vector3(NaN, 2, 3)).toThrow('finite numbers');
      expect(() => new Vector3(1, Infinity, 3)).toThrow('finite numbers');
    });
  });

  describe('arithmetic operations', () => {
    test('addition returns new instance', () => {
      const v1 = new Vector3(1, 2, 3);
      const v2 = new Vector3(4, 5, 6);
      const result = v1.add(v2);
      
      expect(result).toEqual(new Vector3(5, 7, 9));
      expect(result).not.toBe(v1); // Immutability
      expect(v1).toEqual(new Vector3(1, 2, 3)); // Original unchanged
    });
  });
});
```

### Performance Test Template
```typescript
describe('Performance', () => {
  test('Vector3 operations complete quickly', () => {
    const start = performance.now();
    
    for (let i = 0; i < 1000; i++) {
      const v1 = new Vector3(i, i + 1, i + 2);
      const v2 = v1.add(new Vector3(1, 1, 1));
      v2.magnitude();
    }
    
    const end = performance.now();
    expect(end - start).toBeLessThan(100); // <100ms for 1000 operations
  });
});
```

## Troubleshooting Guide

### Common Issues and Solutions

**Issue: TypeScript import errors**
- Check `@/core` and `@/types` path mapping in config files
- Verify barrel export in `src/core/index.ts`
- Restart TypeScript language server

**Issue: Jest cannot resolve modules**
- Check `moduleNameMapper` in `jest.config.js`
- Verify test files are in correct directory structure
- Ensure setup files are properly configured

**Issue: Immutability tests failing**
- Check that methods return new instances
- Use `Object.freeze()` in tests to catch mutations
- Verify readonly properties are properly marked

**Issue: Performance tests failing**
- Run tests on isolated machine
- Check for memory leaks with heap snapshots
- Optimize object creation patterns

**Issue: Circular dependency errors**
- Review import statements between classes
- Use interfaces instead of concrete classes where possible
- Consider dependency injection patterns

## Documentation Requirements

After passing all tests, document:
1. Test execution results with timestamps
2. Performance benchmark measurements
3. Code coverage percentages
4. Any deviations from expected behavior
5. Browser compatibility test results
6. Bundle size impact analysis

This comprehensive testing ensures bulletproof data structures ready for complex game logic implementation.
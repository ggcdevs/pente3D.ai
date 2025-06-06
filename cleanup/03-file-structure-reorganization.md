# File Structure Reorganization

## 1. Root Directory Cleanup

### 1.1 Vestigial Completion Files
**Problem**: Multiple chunk completion files in root
```
CHUNK_4.2_COMPLETE.txt
CHUNK_5.3_COMPLETE.txt
CHUNK_6.1_COMPLETE.txt
CHUNK_6.2_COMPLETE.txt
PROJECT_COMPLETE.txt
```

**Solution**: Move to documentation archive
```
docs/
  archive/
    completion-history/
      CHUNK_4.2_COMPLETE.txt
      CHUNK_5.3_COMPLETE.txt
      CHUNK_6.1_COMPLETE.txt
      CHUNK_6.2_COMPLETE.txt
      PROJECT_COMPLETE.txt
```

### 1.2 Build and Launch Scripts
**Problem**: Multiple scripts in root directory
```
launch-manager.py
launch.sh
overnight_build.sh
overnight_build.log
.current_chunk_state
```

**Solution**: Organize in scripts directory
```
scripts/
  dev/
    launch-manager.py
    launch.sh
  build/
    overnight_build.sh
  logs/
    overnight_build.log  (add to .gitignore)
  state/
    .current_chunk_state  (add to .gitignore)
```

### 1.3 Image Files
**Problem**: Diagram image in root
```
feh_537025_000001_class-diagrams.png
```

**Solution**: Move to appropriate location
```
planning/
  diagrams/
    class-diagrams.png
    class-diagrams.gv  (already in planning/)
```

## 2. Documentation Organization

### 2.1 Scattered Documentation
**Problem**: Documentation spread across multiple locations
```
CLAUDE.md                    # Root
issues/README.md            # Issues directory
issues/TESTING-POLICY.md    # Issues directory
planning/                   # Various plans
.claudecontroller.d/PROJECT.md
.claudecontroller.d/README.md
```

**Solution**: Centralize documentation
```
docs/
  development/
    CLAUDE.md              # AI assistant notes
    TESTING-POLICY.md      # Testing guidelines
    CONTRIBUTING.md        # Contribution guidelines (new)
  project/
    README.md              # Main project readme
    PROJECT.md             # Project overview
    ARCHITECTURE.md        # System architecture (new)
  planning/
    Implementation-Plan.md
    Implementation-Overview.md
    user-stories.md
    basic-wants.md
```

### 2.2 Issues Directory Structure
**Problem**: Issue tracking mixed with documentation
```
issues/
  README.md
  FIXES-2025-06-01.md
  SYMLINK_STRUCTURE.md
  TESTING-POLICY.md
  active/
  all/
  resolved/
  todo/
```

**Solution**: Separate documentation from issues
```
issues/
  active/     (symlinks to current issues)
  archive/    (rename from 'all')
  resolved/
  todo/
  
docs/
  development/
    TESTING-POLICY.md
    SYMLINK_STRUCTURE.md
  issues/
    ISSUE_TEMPLATE.md
    WORKFLOW.md
```

## 3. Test Organization

### 3.1 Test File Duplication
**Problem**: Multiple test files for same issue
```
tests/e2e/issues/
  019-simple-click-test.spec.ts
  019-basic-test.spec.ts
  019-temporary-piece-mouse-test.spec.ts
  019-resolved-test.spec.ts
  019-final-visual-validation.spec.ts
  012-temporary-piece-click.spec.ts  (duplicate of 019)
```

**Solution**: Consolidate and organize
```
tests/e2e/
  features/
    temporary-pieces.spec.ts  (consolidated from all 019/012 tests)
    piece-placement.spec.ts
    board-controls.spec.ts
  regression/
    issue-005-pieces.spec.ts
    issue-006-zoom.spec.ts
    (other specific regression tests)
  smoke/
    app-loads.spec.ts
```

### 3.2 Debug Tests
**Problem**: Debug tests mixed with real tests
```
tests/e2e/debug/
  console-check.spec.ts
  console-errors.spec.ts
  network-detailed.spec.ts
  network-full.spec.ts
  websocket-error.spec.ts
```

**Solution**: Move to utilities or development tools
```
tools/
  debug/
    console-inspector.ts
    network-debugger.ts
    websocket-monitor.ts
tests/
  utils/
    debug-helpers.ts  (extracted utilities from debug tests)
```

### 3.3 Test Results and Reports
**Problem**: Test output directories in root
```
test-results/
playwright-report/
coverage/
```

**Solution**: Organize test output
```
.test-output/         (add to .gitignore)
  coverage/
  playwright-report/
  test-results/
  screenshots/
  videos/
```

## 4. Build and Distribution

### 4.1 Distribution Directory
**Current**: `dist/` in root
**Solution**: Keep in root (standard practice) but ensure proper .gitignore

### 4.2 Build Configuration
**Problem**: Config files scattered in root
```
eslint.config.js
jest.config.js
playwright.config.ts
tsconfig.json
vite.config.ts
.prettierrc
```

**Solution**: Keep in root (standard) but consider config directory for complex configs
```
config/              (optional for complex configurations)
  eslint/
  jest/
  playwright/
```

## 5. Development Tools

### 5.1 Claude Controller
**Problem**: Hidden directory with important tools
```
.claudecontroller.d/
claudecontroller (symlink)
```

**Solution**: Make development tools more visible
```
tools/
  claude/
    claudecontroller
    README.md
  scripts/
    (various development scripts)
```

### 5.2 Mocks Directory
**Problem**: Top-level __mocks__ directory
```
__mocks__/
  peerjs.ts
```

**Solution**: Move closer to tests
```
tests/
  __mocks__/
    peerjs.ts
    three.js
    (other global mocks)
```

## 6. Source Code Organization

### 6.1 Styles Organization
**Problem**: Mixed style files
```
src/
  style.css
  styles/
    high-contrast.css
```

**Solution**: Consolidate styles
```
src/
  styles/
    main.css          (renamed from style.css)
    high-contrast.css
    themes/
      dark.css        (future)
      light.css       (future)
```

### 6.2 Types Directory
**Problem**: Minimal types directory
```
src/types/
  index.ts
  three.d.ts
```

**Solution**: Expand type definitions
```
src/types/
  core.d.ts         (game types)
  network.d.ts      (network types)
  rendering.d.ts    (3D/Three.js types)
  ui.d.ts          (UI component types)
  global.d.ts      (window extensions, etc.)
  index.ts         (exports)
```

## 7. Proposed New Structure

```
pente3d.ai/
├── src/                    # Source code
│   ├── core/              # Game logic
│   ├── network/           # Networking
│   ├── rendering/         # 3D rendering
│   ├── ui/                # User interface
│   ├── utils/             # Utilities
│   ├── styles/            # All CSS/styles
│   └── types/             # TypeScript definitions
├── tests/                  # All tests
│   ├── __mocks__/         # Global mocks
│   ├── unit/              # Unit tests
│   ├── integration/       # Integration tests
│   ├── e2e/               # End-to-end tests
│   │   ├── features/      # Feature tests
│   │   ├── regression/    # Issue regression tests
│   │   └── smoke/         # Basic smoke tests
│   ├── fixtures/          # Test data
│   ├── utils/             # Test utilities
│   └── setup.ts           # Test setup
├── docs/                   # Documentation
│   ├── development/       # Dev docs
│   ├── project/           # Project docs
│   ├── api/               # API documentation
│   └── archive/           # Historical docs
├── tools/                  # Development tools
│   ├── claude/            # AI assistant tools
│   ├── debug/             # Debug utilities
│   └── scripts/           # Dev scripts
├── planning/               # Project planning
│   ├── phase/             # Phase plans
│   ├── diagrams/          # Architecture diagrams
│   └── testing/           # Test plans
├── issues/                 # Issue tracking
│   ├── active/            # Current issues
│   ├── archive/           # All issues
│   ├── resolved/          # Completed
│   └── todo/              # Backlog
├── scripts/                # Build/dev scripts
│   ├── build/             # Build scripts
│   ├── dev/               # Development scripts
│   └── test/              # Test scripts
├── config/                 # Complex configs (if needed)
├── dist/                   # Build output
├── node_modules/           # Dependencies
├── public/                 # Static assets
│   └── index.html         # Move from root
├── cleanup/                # Cleanup plans (temporary)
└── [config files]          # Root config files
```

## 8. Migration Plan

### Phase 1: Non-Breaking Changes
1. Create new directories
2. Copy files to new locations
3. Update imports gradually
4. Test everything works

### Phase 2: Remove Duplicates
1. Update all references
2. Remove old files
3. Update build scripts
4. Update documentation

### Phase 3: Git History Preservation
```bash
# Use git mv to preserve history
git mv CHUNK_*.txt docs/archive/completion-history/
git mv __mocks__ tests/__mocks__
git mv src/style.css src/styles/main.css
```

## 9. Benefits

1. **Cleaner Root**: Only essential config files
2. **Better Organization**: Related files grouped together
3. **Easier Navigation**: Clear directory purposes
4. **Standard Structure**: Follows common JS project patterns
5. **Scalability**: Room for growth without clutter
6. **Documentation**: Centralized and discoverable
7. **Testing**: Clear test organization
8. **Tools**: Development tools visible and organized

## 10. .gitignore Updates

Add to .gitignore:
```
# Test output
.test-output/
test-results/
playwright-report/
coverage/

# Logs
*.log
logs/

# State files
.current_chunk_state

# Debug output
debug/

# Temporary files
*.tmp
.tmp/
```
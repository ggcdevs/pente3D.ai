# Claude Development Notes

## Using claudecontroller for Long-Running Tests

The `claudecontroller` tool allows running long processes that exceed the 2-minute bash timeout. This is especially useful for running comprehensive test suites.

### Available Commands
```bash
./claudecontroller list-commands      # Show all available commands
./claudecontroller bash "command"     # Start a managed bash process
./claudecontroller bash-status        # Check status of all bash processes
./claudecontroller bash-watch <id>    # Watch output of a specific process
./claudecontroller bash-stop <id>     # Stop a running process
```

### Running Tests with claudecontroller

1. **Start a test run:**
```bash
cd /home/guy/code/git/github.com/ggcdevs/pente3d.ai
./claudecontroller bash "npx playwright test tests/e2e/test-helpers-individual.spec.ts --reporter=list --project=chromium"
```
This returns a process ID like `bash-npx-2055352`.

2. **Check progress periodically:**
```bash
# Wait and check status
sleep 30 && ./claudecontroller bash-status

# For longer tests, use longer sleep times
sleep 100 && ./claudecontroller bash-watch bash-npx-2055352 | tail -200
```

3. **Read logs directly if watch fails:**
The logs are stored in `.claudecontroller.d/logs/bash/`. You can read them with:
```bash
# Find the log file from the process output
Read .claudecontroller.d/logs/bash/20250604_235129_bash-npx-2055352.log

# Read last 100 lines for test results
Read .claudecontroller.d/logs/bash/20250604_235129_bash-npx-2055352.log -100 100
```

### Tips
- Use longer sleep times (100-300 seconds) for full test suites
- If `bash-watch` fails with encoding errors, read the log file directly
- Process status can be: RUNNING, FAILED (exit code), or STOPPED
- Logs contain full output including colors and test results

## Token Management

### Checking Token Usage
Use the `tokens` command to see current context usage:
```bash
# Brief status for quick checks
./claudecontroller tokens --brief

# Full detailed breakdown
./claudecontroller tokens

# See token usage breakdown by todo items
./claudecontroller tokens --todos

# Comprehensive task and todo analysis
./claudecontroller tokens --all
```

Example output:
```
🔤 Token Usage
========================================
Input tokens (current):     4
Cache creation tokens:      153,283
Cache read tokens:          0
Output tokens:              105
Total context tokens:       153,287

📊 Context Window
========================================
Model context window:       200,000
Claude Code cutoff:         165,000
Remaining tokens:           11,713
Usage:                      92.9%
Remaining:                  7.1%
```

### Token-Based Task Estimation
Based on actual data from `./claudecontroller tokens --todos`:

#### Actual Token Usage by Task Type:
- **Documentation/Notes** (1,000-1,700 tokens): Update issue notes, document fixes
- **Simple fixes** (1,400-1,900 tokens): Remove minus sign, change test expectation
- **Medium refactoring** (2,500-3,600 tokens): Add modal handling, test isolation
- **Complex implementation** (4,000-8,000 tokens): Create test helpers, debug issues
- **Major debugging** (15,000-20,000 tokens): Fix THREE.js dependencies, complex test failures

#### Real Examples from This Session:
- Fix zoom direction (#15): 1,875 tokens (removed `-delta`)
- Fix rotation expectations (#14): 1,374 tokens (changed 100 to 50)
- Fix test isolation (#17): 3,618 tokens (added beforeEach, unique positions)
- Fix network dialog (#16): 2,550 tokens (added modal handling)
- **Total for "10 minute" fixes**: 9,417 tokens

#### Token to Time Correlation:
- 1K tokens ≈ 30-60 seconds actual work
- 5K tokens ≈ 2-5 minutes
- 10K tokens ≈ 5-10 minutes
- 20K tokens ≈ 10-15 minutes

Note: TodoWrite uses non-unique IDs that reset when the list is cleared, making tracking challenging for renamed tasks.

### Context Management Strategy
- **< 80% usage**: Normal operation, tackle complex tasks
- **80-90% usage**: Focus on medium tasks, avoid deep rabbit holes
- **> 90% usage**: Only simple fixes, prepare for session wrap-up
- **Claude Code cutoff**: 165K tokens (82.5% of 200K model limit)

### Practical Task Planning
With remaining tokens, estimate capacity:
- **10K tokens left**: ~2 medium fixes OR 1 debugging session OR 6-7 simple fixes
- **20K tokens left**: ~1 major feature OR 2-3 debugging sessions OR 5-6 medium tasks
- **30K tokens left**: Full test suite implementation OR major refactoring

Always check `./claudecontroller tokens` before starting complex work!

### Why Token Estimates Beat Time Estimates
Human estimates are biased toward human speeds. A "2-hour task" might be:
- 50 tokens (30 seconds)
- 500 tokens (2-3 minutes) 
- 2000 tokens (5-10 minutes)

Token usage is much more predictable than human time!

## Best Practices

### Overuse TodoWrite for Better Metrics
Create todo items for EVERYTHING to generate token usage data:
- Updating documentation? Make it a todo
- Simple code change? Make it a todo  
- Reading and analyzing? Make it a todo

### Token Estimation in Todos
Include token estimates in todo items:
```javascript
TodoWrite("[~1,500] Update CLAUDE.md with new section")
TodoWrite("[~8,000] Debug failing test suite")
TodoWrite("[~500] Fix typo in comment")
```

This helps calibrate future estimates. If you consistently underestimate by 50%, you'll know to multiply future estimates by 2x.

### Todo Patterns for Common Tasks
Based on actual measurements:
- `[~1,500]` - Documentation updates
- `[~1,800]` - Simple fixes (constants, single-line changes)
- `[~3,000]` - Medium refactoring (test updates, small features)
- `[~8,000]` - Complex debugging or implementation
- `[~15,000]` - Major feature development

## Test Writing Best Practices

### Always Use Test Helper Functions

When writing E2E tests, **ALWAYS** use the helper functions from `tests/e2e/utils/` for consistency and reliability:

- **`game-interactions.ts`** - For game state queries, piece interactions, and board manipulation
  - `clickGridNode()` - Simulates realistic mouse movement and clicking
  - `hasPieceAt()` - Check for pieces at specific coordinates
  - `getGameState()` - Get comprehensive game state information
  - `rotateBoard()`, `zoomBoard()`, `panBoard()` - Camera controls

- **`threejs-helpers.ts`** - For 3D scene and WebGL interactions
  - `waitForSceneReady()` - Ensure Three.js is fully loaded
  - `getCanvasElement()` - Get the canvas element properly
  - `captureCanvas()` - Take screenshots for visual tests

- **`visual-regression.ts`** - For screenshot comparisons and visual testing

**DO NOT**:
- Use raw `page.click()` on the canvas
- Directly manipulate DOM elements
- Write custom coordinate conversion logic
- Implement your own mouse simulation

**DO**:
- Use `game.clickGridNode(x, y, z)` for placing pieces
- Use helper validation methods like `game.hasPieceAt()`
- Use `waitForSceneReady()` before any 3D interactions
- Follow existing test patterns for consistency

## Test Commands

### Lint and Type Checking
When completing a task, run these commands to ensure code quality:
```bash
npm run lint
npm run type-check  # Note: use type-check, not typecheck
```

## Active Cleanup Implementation

Currently executing comprehensive cleanup plan. Check these resources:
- **Progress Dashboard**: [cleanup/PROGRESS.md](cleanup/PROGRESS.md) - Current status of all cleanup work
- **Execution Plan**: [cleanup/CLEANUP_EXECUTION_PLAN.md](cleanup/CLEANUP_EXECUTION_PLAN.md) - Detailed implementation strategy
- **Active Issues**: Run `ls -la issues/active/story-cleanup-*` to see current work

### To Continue Cleanup Work:
```bash
# 1. Check what's currently being worked on
ls -la issues/active/story-cleanup-*

# 2. Read current progress
cat cleanup/PROGRESS.md

# 3. Find recently modified cleanup files
find . -type f -name "*.ts" -o -name "*.md" -mtime -1 | grep -E "(cleanup|story-cleanup)"

# 4. Check git status for uncommitted work
git status | grep -E "(cleanup|story-cleanup)"

# 5. Resume from active story notes
cat issues/active/story-cleanup-*/notes.md 2>/dev/null || echo "No active cleanup stories"

# 6. Check todos
./claudecontroller todos | grep cleanup
```

### Cleanup Phase Overview:
1. **Phase 0**: Quick Wins (~8k tokens) - Logging, TypeScript, error handling
2. **Phase 1**: Test Infrastructure (~10k tokens) - Test utilities, visual regression
3. **Phase 2**: Architecture (~12k tokens) - Event bus, DI, state management
4. **Phase 3**: Features (~10k tokens) - Diagonal lines, network, accessibility
5. **Phase 4**: Documentation (~8k tokens) - API docs, guides, final polish

### When Cleanup is Complete:
Remove this entire "Active Cleanup Implementation" section from CLAUDE.md and archive cleanup documents to `cleanup/archive/`.

## Context Management and Implementation Rules

### Core Implementation Completion Rules
**CRITICAL**: A code implementation job is NOT complete until:
1. **Test Coverage**: Comprehensive test plan exists with unit, integration, and E2E tests
2. **All Tests Pass**: Every test must be green before marking as complete
3. **Lint & Type Check**: `npm run lint` and `npm run type-check` pass without errors
4. **Documentation**: Code changes are documented in relevant places (CLAUDE.md, issue notes)
5. **Visual Verification**: For UI changes, visual tests or screenshots confirm correct behavior

### Context Loss Prevention Strategies

#### 1. Use TodoWrite as Implementation Checkpoints
```javascript
// Example for feature implementation
TodoWrite("[~2,000] Implement diagonal line generation logic")
TodoWrite("[~3,000] Write unit tests for diagonal line generation")
TodoWrite("[~2,000] Add integration tests for settings toggle")
TodoWrite("[~1,500] Run full test suite and fix failures")
TodoWrite("[~500] Run lint and type-check")
TodoWrite("[~1,000] Update documentation")
```

#### 2. Mandatory Test-First Approach
Before implementing ANY feature:
1. Write failing tests that define expected behavior
2. Implement code to make tests pass
3. Refactor while keeping tests green
4. Document test scenarios in issue notes

#### 3. Session Handoff Documentation
At >90% token usage, create a handoff note:
```markdown
## Session Handoff - [Date]
### Current State
- Working on: [feature/bug]
- Tests written: [list]
- Tests passing: [X/Y]
- Next steps: [specific tasks]
### Blockers
- [Any issues encountered]
### Commands to Run
```bash
npm test -- [specific test file]
npm run lint
npm run type-check
```
```

#### 4. Feature Flag Pattern
For partial implementations:
```typescript
// In Settings.ts
getFeatureFlags(): { diagonalLines: boolean } {
  return {
    diagonalLines: false  // Set true when tests pass
  };
}
```

#### 5. Automated Verification Checklist
Create a verification script:
```bash
#!/bin/bash
# verify-implementation.sh
echo "Running implementation verification..."

# 1. Run tests
npm test || { echo "Tests failed"; exit 1; }

# 2. Run lint
npm run lint || { echo "Lint failed"; exit 1; }

# 3. Run type check
npm run type-check || { echo "Type check failed"; exit 1; }

echo "✅ Implementation verified!"
```

### Issue Tracking Best Practices

#### 1. Issue Notes Must Include
- Current implementation status (0-100%)
- Test coverage status
- Failing tests list
- Next concrete steps
- Any architectural decisions made

#### 2. Use Symlinks for State Tracking
```bash
# Move to active when working
ln -s ../all/feature-001 ../active/feature-001

# Only move to resolved when ALL tests pass
mv ../active/feature-001 ../resolved/feature-001
```

#### 3. Test-Driven Issue Resolution
```markdown
## Issue Resolution Criteria
- [ ] Root cause identified and documented
- [ ] Failing test written that reproduces issue
- [ ] Fix implemented
- [ ] Original test now passes
- [ ] No regression in other tests
- [ ] Lint and type-check pass
```

### Context Recovery Patterns

When resuming after context loss:

1. **Check Implementation State**
```bash
# See what's in progress
ls -la issues/active/

# Check test status
npm test -- --listTests | grep -E "(fail|pass)"

# Review recent changes
git status && git diff
```

2. **Read Last Session Notes**
```bash
# Check issue notes
Read issues/active/*/notes.md

# Check CLAUDE.md for session handoffs
Read CLAUDE.md | grep -A 20 "Session Handoff"
```

3. **Verify Current State**
```bash
# Run verification script
./verify-implementation.sh

# Or manually
npm test -- [last worked on test]
npm run lint
npm run type-check
```

### Golden Rules for Implementation

1. **Never Mark Complete Without Tests**: If tests don't exist or don't pass, it's not done
2. **Document While Implementing**: Update notes.md in real-time, not after
3. **Incremental Commits**: Commit working states with descriptive messages
4. **Test Isolation**: Each test should be independent and not affect others
5. **Fail Fast**: If stuck for >5 minutes, document the blocker and move on
6. **Document Alignment**: After implementation, review all docs for consistency

### Example Implementation Flow

```bash
# 1. Start with failing test
TodoWrite("[~2,000] Write failing test for diagonal lines")
# Create test file, verify it fails

# 2. Minimal implementation 
TodoWrite("[~3,000] Implement minimal diagonal line rendering")
# Code until test passes

# 3. Expand test coverage
TodoWrite("[~2,000] Add edge cases and visual tests")
# Ensure robustness

# 4. Verify quality
TodoWrite("[~1,000] Run lint, type-check, and full test suite")
# Fix any issues

# 5. Document
TodoWrite("[~500] Update documentation and mark complete")
# Only NOW is it done
```

### Documentation Alignment Process

After ANY code implementation, ensure documentation consistency:

#### 1. Implementation Documentation Review
```bash
# Check issue documentation
Read issues/active/*/notes.md
# Ensure it reflects current implementation state

# Update with:
- Actual implementation approach taken
- Any deviations from original plan
- Test scenarios covered
- Performance considerations
```

#### 2. Project Documentation Review
```bash
# Review main docs
Read README.md          # Update features list if needed
Read CLAUDE.md          # Add new patterns/learnings
Read planning/*.md      # Update if architecture changed
```

#### 3. Code Documentation Checklist
- [ ] JSDoc/TSDoc comments for new public methods
- [ ] Inline comments for complex logic
- [ ] Type definitions properly documented
- [ ] Example usage in comments where helpful

#### 4. Test Documentation
- [ ] Test file has description header
- [ ] Each test has clear description
- [ ] Complex test scenarios explained
- [ ] Visual test screenshots documented

#### 5. Documentation Alignment Script
```bash
#!/bin/bash
# check-docs-alignment.sh

echo "Checking documentation alignment..."

# Find undocumented public methods
echo "Checking for undocumented exports..."
grep -r "export" src/ --include="*.ts" | grep -E "(class|function|interface)" | while read -r line; do
    file=$(echo "$line" | cut -d: -f1)
    # Check if line above has doc comment
    # This is simplified - real implementation would be more robust
done

# Check for outdated TODOs
echo "Checking for outdated TODOs..."
grep -r "TODO" . --include="*.md" | grep -v "node_modules"

# Verify issue notes exist for active issues
echo "Checking active issues have notes..."
for issue in issues/active/*; do
    if [ -d "$issue" ] && [ ! -f "$issue/notes.md" ]; then
        echo "WARNING: $issue missing notes.md"
    fi
done
```

#### 6. Documentation Update Patterns

**When Adding a Feature**:
1. Update feature list in README.md
2. Add usage example to relevant docs
3. Document in CLAUDE.md if it's a new pattern
4. Update planning docs if architecture impacted

**When Fixing a Bug**:
1. Document root cause in issue notes
2. Add test case description
3. Update CLAUDE.md with prevention pattern
4. Note in code comments if non-obvious fix

**When Refactoring**:
1. Document why refactoring was needed
2. Update architecture docs if structure changed
3. Ensure all renamed items are updated in docs
4. Add migration notes if breaking changes

### Example Post-Implementation Review

```bash
# After implementing diagonal lines feature

# 1. Update issue documentation
Edit issues/active/feature-001-diagonal-grid-lines/notes.md
# Add: implementation approach, test coverage, performance impact

# 2. Update project docs
Edit README.md
# Add: "- Diagonal grid lines visualization" to features

Edit CLAUDE.md  
# Add: New rendering pattern for optional visual elements

# 3. Check code docs
grep -B2 "function.*Diagonal" src/rendering/Renderer.ts
# Ensure has JSDoc comment

# 4. Verify test docs
Read tests/unit/rendering/Renderer.test.ts
# Check test descriptions are clear

# 5. Run alignment check
./scripts/check-docs-alignment.sh
```

### Session Handoff Template

Use [SESSION_HANDOFF_TEMPLATE.md](SESSION_HANDOFF_TEMPLATE.md) when context is near limit. Key sections:
- Current implementation status
- Test status checklist
- Known blockers
- Specific next steps
- Commands to resume work

### Documentation as Contract

Treat documentation as a contract between implementations:

1. **Issue Description** = Requirements contract
2. **Test Descriptions** = Behavior contract  
3. **Code Comments** = Implementation contract
4. **API Docs** = Interface contract
5. **Architecture Docs** = Design contract

If any of these are out of sync, the implementation is incomplete.
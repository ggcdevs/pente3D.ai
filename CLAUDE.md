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

## Test Commands

### Lint and Type Checking
When completing a task, run these commands to ensure code quality:
```bash
npm run lint
npm run typecheck
```
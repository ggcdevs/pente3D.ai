# Testing Policy for Issue Resolution

## Core Principle
**Work CANNOT begin on an issue until a headless test is able to replicate it.**

## Process

### 1. Issue Reported
When a new issue is identified:
- Create issue file in `issues/todo/`
- Document the problem clearly
- Add "Testing Policy" section at bottom

### 2. Before Starting Work
**REQUIRED STEPS:**
1. Create a failing E2E test that demonstrates the issue
2. Verify the test fails for the right reason
3. Update issue file with test location
4. Move issue from `todo/` to `active/`

### 3. During Development
- Use the failing test to guide fixes
- Run test frequently to check progress
- Test should pass when issue is resolved

### 4. Resolution
- Ensure test passes consistently
- Update issue with resolution details
- Move from `active/` to `resolved/`
- Keep test in suite for regression prevention

## Example Issue Footer

```markdown
---

## Testing Policy
**Work CANNOT begin on this issue until a headless test replicates it.**

Test file: `/home/guy/code/git/github.com/ggcdevs/pente3d.ai/tests/e2e/[test-file].spec.ts`
- Test name: "should [expected behavior]"
- Current status: FAILING (describe why)
```

## Benefits
1. **Reproducibility**: Issues can be consistently replicated
2. **Validation**: Fixes can be verified automatically
3. **Regression Prevention**: Tests ensure issues don't reappear
4. **Clear Success Criteria**: Test passing = issue resolved

## Running Tests
```bash
# Run specific test
npx playwright test path/to/test.spec.ts

# Run with UI to debug
npx playwright test --ui

# Run in headed mode to see browser
npx playwright test --headed
```

## Using Claude Controller for Long Tests
```bash
./claudecontroller bash "cd /path/to/project && npm run test:e2e"
```

This prevents timeout issues and captures all output for analysis.
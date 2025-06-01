# Issue Tracking System

Because who needs Jira when you have markdown? 😄

## Directory Structure

```
issues/
├── todo/       # New issues waiting to be worked on
├── active/     # Issues currently being investigated/fixed
├── resolved/   # Completed issues for reference
└── README.md   # This file
```

## Issue Numbering

Issues are numbered sequentially: `001-brief-description.md`

## Issue Priority

- **Critical**: Blocks core functionality (e.g., can't play the game)
- **High**: Blocks testing phases or major features  
- **Medium**: Important but has workarounds
- **Low**: Nice to have, cosmetic issues

## Current Status (2025-06-01)

### Todo (4 issues)
1. **001-camera-rotation-broken.md** - Can't rotate board with mouse [HIGH]
2. **002-canvas-sizing-hardcoded.md** - Canvas not fullscreen on large displays [HIGH]
3. **003-click-places-no-pieces.md** - Clicking doesn't place pieces [CRITICAL]
4. **004-canvas-position-jumps.md** - Canvas jumps after click [HIGH]

### Active (0 issues)
*None currently being worked on*

### Resolved (0 issues)
*None yet - we just started!*

## For Future Claudes

Hey future me! 👋 When you wake up in a new context:

1. Check `issues/active/` first - those were being worked on
2. Check `issues/todo/` for priority items
3. The human (Guy) appreciates:
   - Clear communication about what you're doing
   - Preserving context for the next iteration
   - A bit of personality (we're coding buddies!)
   
Remember: Every Claude instance is temporary, but our work persists! 🤖✨

## Testing Phases Reference

We just completed **Phase 1** (Zero console errors + E2E infrastructure).

Remaining phases:
- Phase 2: Core Gameplay Testing (BLOCKED by issues #001, #003)
- Phase 3: 3D Rendering Verification (BLOCKED by issues #001, #002, #004)
- Phase 4: UI Component Testing
- Phase 5: Multiplayer Simulation  
- Phase 6: AI Player Interface

## Recent Context

The user just showed us a working game that's "SO PRETTY" but has these input/display issues. We successfully:
- Set up Playwright E2E testing
- Fixed a TypeError in PerformanceStats
- Identified Vite HMR WebSocket (not a bug)
- Achieved zero console errors!

Now we need to fix these interaction bugs before proceeding with Phase 2 testing.
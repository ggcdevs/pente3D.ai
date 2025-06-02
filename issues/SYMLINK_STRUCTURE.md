# Issue Tracking System Structure

This directory uses symlinks to manage issue states efficiently.

## Directory Structure

```
issues/
├── all/                    # Contains ALL issue directories (actual files)
│   ├── 001-issue-name/
│   ├── 002-issue-name/
│   └── ...
├── active/                 # Symlinks to issues currently being worked on
│   └── 009-issue -> ../all/009-issue
├── resolved/              # Symlinks to completed issues
│   ├── 001-issue -> ../all/001-issue
│   └── ...
├── todo/                  # Symlinks to issues not yet started
│   └── 012-issue -> ../all/012-issue
└── SYMLINK_STRUCTURE.md   # This file
```

## How It Works

1. **All issues live in `all/`** - This is the single source of truth
2. **State folders contain symlinks** - active/, resolved/, and todo/ only contain symbolic links
3. **Moving issues is easy** - Just move the symlink, not the entire directory

## Managing Issues

### To move an issue from active to resolved:
```bash
cd issues/active
mv 009-board-jumping-performance ../resolved/
```

### To create a new issue:
```bash
# Create the issue directory in all/
mkdir issues/all/013-new-issue-name
# Create description.md and notes.md
# Then create a symlink in the appropriate state folder
cd issues/todo
ln -s ../all/013-new-issue-name .
```

### To check an issue's state:
```bash
# See which folder contains the symlink
find issues -name "009-*" -type l 2>/dev/null
```

## Benefits

- **No data loss** - Moving issues between states doesn't risk losing files
- **Clear history** - The issue directory keeps all its history
- **Easy state management** - Just move symlinks
- **Single source of truth** - All actual data is in one place

## For New Claude Instances

When you see a symlink (indicated by `->` in ls output), the actual files are in the `all/` directory. You can work with the symlinks normally - they act just like the real directories.
#!/usr/bin/env bash
#
# Install this repo's tracked git hooks (tools/git-hooks/*) into the repository's SHARED hooks
# directory, so every worktree gets them. Hooks themselves cannot be tracked in-place — git
# never version-controls .git/hooks — so they live under tools/ and are SYMLINKED in, which
# means editing the tracked file takes effect immediately with no reinstall.
#
# Idempotent: re-running relinks. Existing NON-symlink hooks are left alone and reported, so a
# local hook someone wrote by hand is never silently clobbered.
#
# Usage: tools/install-git-hooks.sh   (from anywhere inside the repo)

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
hooks_src="${repo_root}/tools/git-hooks"
hooks_dst="$(git rev-parse --git-common-dir)/hooks"

if [[ -n "$(git config --get core.hooksPath || true)" ]]; then
    printf 'WARNING: core.hooksPath is set to "%s" — git will IGNORE %s.\n' \
        "$(git config --get core.hooksPath)" "${hooks_dst}" >&2
    printf 'Unset it (git config --unset core.hooksPath) or install there instead.\n' >&2
fi

mkdir -p "${hooks_dst}"
installed=0

for src in "${hooks_src}"/*; do
    [[ -f "${src}" ]] || continue
    name="$(basename "${src}")"
    dst="${hooks_dst}/${name}"

    if [[ -e "${dst}" && ! -L "${dst}" ]]; then
        printf 'skipped %-12s (a non-symlink hook already exists at %s)\n' "${name}" "${dst}"
        continue
    fi

    chmod +x "${src}"
    ln -sfn "${src}" "${dst}"
    printf 'installed %-12s -> %s\n' "${name}" "${src}"
    installed=$((installed + 1))
done

printf '\n%d hook(s) installed into %s\n' "${installed}" "${hooks_dst}"

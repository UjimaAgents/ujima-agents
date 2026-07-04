# Release Version Bump: 0.0.62

**Status:** in progress
**Owner:** Carter Jordan
**Target version:** 0.0.62

## Goal

Bump the repo to version 0.0.62, keep the release metadata consistent, verify the pipeline passes, and push the changes.

## Plan

1. Run `release:prepare` first so the release package and changelog are stamped correctly.
2. Manually sync the version across every workspace package and the root package manifest.
3. Regenerate or update the lockfile if needed so it matches the manifest versions.
4. Run the verification pipeline and any release checks that apply.
5. Commit and push all changes.

## Notes

- The repo was on `0.0.61` before this work.
- The release target was chosen as a patch bump.
- I kept the change set limited to versioning, release metadata, and the lockfile update required by the new version.
- `bun run verify` completed successfully. The run emitted pre-existing warnings in `apps/web`, but the command exited 0.
- The working tree already contains unrelated edits from the broader branch, so I need a decision on whether to push only the version bump or the full dirty tree.

## Progress

- [x] Run release prepare
- [x] Sync versions across all package manifests
- [x] Update lockfile if needed
- [x] Run pipeline checks
- [ ] Commit and push

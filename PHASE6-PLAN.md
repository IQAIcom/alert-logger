# Phase 6: Publish — Implementation Plan

## Tasks

### 6.1 GitHub Actions CI
- Lint (tsc --noEmit), test (vitest), build (tsup) on push/PR
- Matrix: Node 18, 20, 22
- Use pnpm or npm

### 6.2 GitHub Actions Release
- Publish to npm on tag push (v*)
- Use NPM_TOKEN secret
- Semantic versioning

### 6.3 Package polish
- Add keywords, author, license fields to package.json
- Ensure package.json files field is correct
- Add CONTRIBUTING.md

### 6.4 Changelog
- CHANGELOG.md with initial release notes

### 6.5 Verification
- CI workflow valid YAML
- Build + test passes locally

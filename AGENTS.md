# Repository Guidelines

## Project Structure & Module Organization

This repository is currently a starting workspace: no source code, tests, assets, or build configuration are present. When adding the first implementation, organize application code under `src/`, automated tests under `tests/`, and static resources under `assets/` where appropriate. Keep related modules together and document the resulting layout in `README.md`.

The hidden `.agents/`, `.codex/`, `.aws/`, and `.git/` directories are environment-provided metadata locations. Do not use them for application code or commit credentials from them.

## Build, Test, and Development Commands

No build, test, or local development commands are configured yet. When introducing a language or framework, add its dependency manifest and document exact setup, development, build, and test commands in `README.md`. Prefer repository-defined scripts over commands that depend on undocumented global tools. Do not assume commands such as `npm test` or `make build` exist until their configuration is committed.

## Coding Style & Naming Conventions

Follow the standard conventions of the language selected for the project. Use consistent indentation within each language, descriptive identifiers, and filenames that match their modules. Configure an appropriate formatter and linter with the first implementation, and commit their configuration so contributors can reproduce checks locally.

## Testing Guidelines

No testing framework or coverage threshold is established. Add tests alongside new behavior, including important edge cases and failure paths. Use the selected framework's test discovery conventions and descriptive test names. Document how to run the full suite and individual tests; avoid introducing an arbitrary coverage requirement without project agreement.

## Commit & Pull Request Guidelines

No readable Git history is available to establish existing commit conventions. Use concise, imperative commit subjects, such as `Add initial application structure`, and keep changes focused.

Pull requests should explain the change, its purpose, and verification performed. Link relevant issues, include screenshots for visual changes, and identify any new dependencies or configuration requirements. Clearly state when tests could not be run and why.

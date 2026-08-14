# pi-commit

A Pi extension that generates, reviews, and creates Conventional Commits.

## Install from GitHub

Tag a release and install it with:

```bash
pi install git:github.com/<account>/pi-commit@v0.1.0
```

The npm package is intentionally not published yet. The package layout is npm-ready for a future `pi install npm:pi-commit` release.

## Usage

```text
/commit
/commit fix the login redirect
/commit include the new settings page
```

By default, `/commit` includes staged, modified, and untracked changes (equivalent to the legacy `/commit --all` behavior). The extension validates changes before sending them to the model and stages them only after confirmation. The `--all` option remains accepted as a backwards-compatible alias. The extension generates a Conventional Commit message with the active Pi model, opens it for editing, and always asks for confirmation before committing.

Supported types are `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`. The subject must be 72 characters or fewer.

## Requirements and safety

- Pi with an active model and configured credentials.
- Git and a repository with a checked-out branch.
- Interactive TUI mode.
- No detached HEAD, merge/rebase/cherry-pick operation, or unresolved conflicts.

Likely secret paths are blocked before model generation and automatic staging. This includes `.env` and other `.env.*` files (except `.env.example` and `.env.template`), private-key extensions (`.pem`, `.key`, `.p12`, `.pfx`), names beginning with `credentials` or `secrets`, service-account JSON files, and common SSH private-key names. Protected additions, modifications, and renames abort the command; protected deletions are allowed. Ignored files remain ignored. There is no automatic override: remove protected changes or commit them manually.

The selected model receives the relevant diff, file summary, and recent commit subjects. Diffs may contain sensitive information; use normal secret-management and Git ignore practices. Hooks and signing are not bypassed. The command refuses to commit if the repository changes during review.

## Development

```bash
npm install
npm run check
```

The test suite uses temporary Git repositories and does not publish or commit to the project repository.

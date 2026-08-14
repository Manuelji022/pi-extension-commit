import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { commitMessage, inspectRepository, stageAllSafely, validateAutoStage, type ExecResult } from "../src/git.ts";

const execFileAsync = promisify(execFile);
async function git(cwd: string, args: string[]): Promise<ExecResult> {
  try {
    const result = await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8" });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
}

async function repo() {
  const cwd = await mkdtemp(join(tmpdir(), "pi-commit-test-"));
  await git(cwd, ["init", "-q"]);
  await git(cwd, ["config", "user.email", "test@example.com"]);
  await git(cwd, ["config", "user.name", "Pi Test"]);
  await writeFile(join(cwd, "README.md"), "initial\n");
  await git(cwd, ["add", "."]);
  await git(cwd, ["commit", "-qm", "chore: initialize repository"]);
  return cwd;
}

test("inspects staged changes and commits a multiline message", async () => {
  const cwd = await repo();
  try {
    await writeFile(join(cwd, "README.md"), "changed\n");
    await git(cwd, ["add", "README.md"]);
    const exec = (args: string[], options?: { timeout?: number; signal?: AbortSignal }) => git(cwd, args);
    const state = await inspectRepository({ cwd, exec }, false);
    assert.equal(state.hasSelectedChanges, true);
    const hash = await commitMessage({ cwd, exec }, "docs: update readme\n\nExplain the project", false);
    assert.match(hash, /^[0-9a-f]+$/);
    const log = await git(cwd, ["log", "-1", "--format=%B"]);
    assert.match(log.stdout, /docs: update readme/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("staged-only inspection ignores unstaged changes", async () => {
  const cwd = await repo();
  try {
    await writeFile(join(cwd, "README.md"), "unstaged\n");
    const exec = (args: string[], options?: { timeout?: number; signal?: AbortSignal }) => git(cwd, args);
    const state = await inspectRepository({ cwd, exec }, false);
    assert.equal(state.hasSelectedChanges, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("all mode stages and commits untracked files", async () => {
  const cwd = await repo();
  try {
    await writeFile(join(cwd, "new.txt"), "new file\n");
    const exec = (args: string[], options?: { timeout?: number; signal?: AbortSignal }) => git(cwd, args);
    const state = await inspectRepository({ cwd, exec }, true);
    assert.equal(state.hasSelectedChanges, true);
    const hash = await commitMessage({ cwd, exec }, "feat: add new file", true);
    assert.match(hash, /^[0-9a-f]+$/);
    const tracked = await git(cwd, ["ls-files", "new.txt"]);
    assert.equal(tracked.stdout.trim(), "new.txt");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("all mode blocks an untracked environment file before staging", async () => {
  const cwd = await repo();
  try {
    await writeFile(join(cwd, ".env"), "TOKEN=secret\n");
    const exec = (args: string[], options?: { timeout?: number; signal?: AbortSignal }) => git(cwd, args);
    await assert.rejects(() => validateAutoStage({ cwd, exec }), /\.env.*No files were staged/);
    const staged = await git(cwd, ["diff", "--cached", "--name-only"]);
    assert.equal(staged.stdout, "");
    const status = await git(cwd, ["status", "--short"]);
    assert.match(status.stdout, /\?\? \.env/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("all mode blocks modified and pre-staged protected files", async () => {
  const cwd = await repo();
  try {
    await writeFile(join(cwd, ".env"), "TOKEN=initial\n");
    await git(cwd, ["add", ".env"]);
    await git(cwd, ["commit", "-qm", "chore: add environment file"]);
    await writeFile(join(cwd, ".env"), "TOKEN=changed\n");
    const exec = (args: string[], options?: { timeout?: number; signal?: AbortSignal }) => git(cwd, args);
    await assert.rejects(() => validateAutoStage({ cwd, exec }), /\.env/);
    await git(cwd, ["reset", "--quiet"]);
    await git(cwd, ["add", ".env"]);
    await assert.rejects(() => validateAutoStage({ cwd, exec }), /\.env/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("nested protected files are detected and reported before staging", async () => {
  const cwd = await repo();
  try {
    await mkdir(join(cwd, "config"), { recursive: true });
    await writeFile(join(cwd, "config", ".env.local"), "TOKEN=secret\n");
    const exec = (args: string[], options?: { timeout?: number; signal?: AbortSignal }) => git(cwd, args);
    await assert.rejects(() => validateAutoStage({ cwd, exec }), /config\/\.env\.local/);
    const staged = await git(cwd, ["diff", "--cached", "--name-only"]);
    assert.equal(staged.stdout, "");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("safe environment examples are allowed", async () => {
  const cwd = await repo();
  try {
    await writeFile(join(cwd, ".env.example"), "TOKEN=replace-me\n");
    const exec = (args: string[], options?: { timeout?: number; signal?: AbortSignal }) => git(cwd, args);
    await stageAllSafely({ cwd, exec });
    const staged = await git(cwd, ["diff", "--cached", "--name-only"]);
    assert.equal(staged.stdout.trim(), ".env.example");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("all mode allows deleting a tracked environment file", async () => {
  const cwd = await repo();
  try {
    await writeFile(join(cwd, ".env"), "TOKEN=secret\n");
    await git(cwd, ["add", ".env"]);
    await git(cwd, ["commit", "-qm", "chore: add environment file"]);
    await rm(join(cwd, ".env"));
    const exec = (args: string[], options?: { timeout?: number; signal?: AbortSignal }) => git(cwd, args);
    await stageAllSafely({ cwd, exec });
    const status = await git(cwd, ["status", "--short"]);
    assert.match(status.stdout, /D  \.env/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("all mode blocks a staged rename involving a protected path", async () => {
  const cwd = await repo();
  try {
    await writeFile(join(cwd, ".env"), "TOKEN=secret\n");
    await git(cwd, ["add", ".env"]);
    await git(cwd, ["commit", "-qm", "chore: add environment file"]);
    await git(cwd, ["mv", ".env", ".env.backup"]);
    const exec = (args: string[], options?: { timeout?: number; signal?: AbortSignal }) => git(cwd, args);
    await assert.rejects(() => validateAutoStage({ cwd, exec }), /\.env/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("ignored protected files are not candidates for all mode", async () => {
  const cwd = await repo();
  try {
    await writeFile(join(cwd, ".gitignore"), ".env\n");
    await writeFile(join(cwd, ".env"), "TOKEN=secret\n");
    const exec = (args: string[], options?: { timeout?: number; signal?: AbortSignal }) => git(cwd, args);
    await stageAllSafely({ cwd, exec });
    const staged = await git(cwd, ["diff", "--cached", "--name-only"]);
    assert.equal(staged.stdout, ".gitignore\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

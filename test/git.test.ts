import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { commitMessage, inspectRepository, type ExecResult } from "../src/git.ts";

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

test("default mode ignores unstaged changes", async () => {
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

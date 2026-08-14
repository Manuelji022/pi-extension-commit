import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  killed?: boolean;
}

export type GitExec = (
  args: string[],
  options?: { timeout?: number; signal?: AbortSignal },
) => Promise<ExecResult>;

export interface RepoState {
  root: string;
  branch: string;
  fingerprint: string;
  summary: string;
  diff: string;
  recentCommits: string;
  hasSelectedChanges: boolean;
  hasUnstagedChanges: boolean;
}

export interface GitContext {
  exec: GitExec;
  cwd: string;
}

function git(ctx: GitContext): GitExec {
  return (args, options) => ctx.exec(["-C", ctx.cwd, ...args], options);
}

function fail(result: ExecResult, fallback: string): never {
  throw new Error((result.stderr || result.stdout || fallback).trim());
}

interface StatusEntry {
  code: string;
  path: string;
  oldPath?: string;
}

function parseStatus(status: string): StatusEntry[] {
  const entries: StatusEntry[] = [];
  const parts = status.split("\0");
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;
    const code = part.slice(0, 2);
    const entry: StatusEntry = { code, path: part.slice(3) };
    if (code.includes("R") || code.includes("C")) {
      entry.oldPath = parts[++index] || undefined;
    }
    entries.push(entry);
  }
  return entries;
}

function protectedBasename(path: string): boolean {
  const basename = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (basename === ".env" || (basename.startsWith(".env.") && ![".env.example", ".env.template"].includes(basename))) {
    return true;
  }
  if ([".pem", ".key", ".p12", ".pfx"].some((extension) => basename.endsWith(extension))) return true;
  if (basename.startsWith("credentials") || basename.startsWith("secrets")) return true;
  if (/^service-account.*\.json$/.test(basename)) return true;
  return /^(id_rsa|id_dsa|id_ecdsa|id_ed25519|id_ed25519_sk|id_xmss)$/.test(basename);
}

function isProtectedPath(path: string): boolean {
  return protectedBasename(path);
}

function isPureDeletion(entry: StatusEntry): boolean {
  return (entry.code[0] === "D" || entry.code[1] === "D") && !entry.code.includes("R") && !entry.code.includes("C");
}

function protectedChanges(statuses: StatusEntry[]): string[] {
  return [...new Set(statuses.flatMap((entry) => {
    if (isPureDeletion(entry)) return [];
    const paths = [entry.path, ...(entry.oldPath ? [entry.oldPath] : [])];
    return paths.filter(isProtectedPath);
  }))].sort();
}

async function repositoryRoot(ctx: GitContext, run: GitExec): Promise<string> {
  const result = await run(["rev-parse", "--show-toplevel"]);
  if (result.code !== 0) fail(result, "The current directory is not inside a Git repository.");
  return result.stdout.trim();
}

async function ensureSafeState(run: GitExec, root: string): Promise<string> {
  const branch = await run(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch.code !== 0 || !branch.stdout.trim()) throw new Error("Cannot commit from a detached HEAD.");

  const gitDirResult = await run(["rev-parse", "--git-dir"]);
  if (gitDirResult.code !== 0) fail(gitDirResult, "Unable to locate the Git metadata directory.");
  const gitDir = resolve(root, gitDirResult.stdout.trim());
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
    try {
      await access(join(gitDir, marker));
      throw new Error(`Git operation in progress (${marker}); resolve it before committing.`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Git operation in progress")) throw error;
    }
  }

  const status = await run(["status", "--porcelain=v1", "-z"]);
  if (status.code !== 0) fail(status, "Unable to inspect Git status.");
  const conflicted = status.stdout.split("\0").some((entry) =>
    ["UU", "AA", "DD", "AU", "UA", "DU", "UD"].some((code) => entry.startsWith(code)),
  );
  if (conflicted) throw new Error("The index contains unresolved conflicts; resolve them before committing.");
  return branch.stdout.trim();
}

export async function validateAutoStage(ctx: GitContext): Promise<void> {
  const run = git(ctx);
  const root = await repositoryRoot(ctx, run);
  await ensureSafeState(run, root);
  const statusResult = await run(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (statusResult.code !== 0) fail(statusResult, "Unable to inspect Git status.");
  const blocked = protectedChanges(parseStatus(statusResult.stdout));
  if (blocked.length > 0) {
    throw new Error(`Refusing to stage protected paths with --all: ${blocked.join(", ")}. No files were staged.`);
  }
}

export async function stageAllSafely(ctx: GitContext): Promise<void> {
  await validateAutoStage(ctx);
  const add = await git(ctx)(["add", "-A"]);
  if (add.code !== 0) fail(add, "Git could not stage all changes.");
}

async function untrackedContent(
  root: string,
  statuses: Array<{ code: string; path: string }>,
  limit: number,
): Promise<string> {
  let remaining = limit;
  const sections: string[] = [];
  const absoluteRoot = resolve(root);
  for (const item of statuses.filter((entry) => entry.code === "??")) {
    if (remaining <= 0) break;
    const path = resolve(root, item.path);
    if (relative(absoluteRoot, path).startsWith("..")) continue;
    try {
      const data = await readFile(path);
      if (data.includes(0)) {
        sections.push(`Binary untracked file: ${item.path}`);
        continue;
      }
      const text = data.toString("utf8");
      const portion = text.slice(0, remaining);
      sections.push(`Untracked file: ${item.path}\n${portion}${portion.length < text.length ? "\n[content omitted]" : ""}`);
      remaining -= Buffer.byteLength(portion);
    } catch {
      sections.push(`Unreadable untracked file: ${item.path}`);
    }
  }
  return sections.join("\n\n");
}

export async function inspectRepository(ctx: GitContext, all: boolean, patchLimit = 50_000): Promise<RepoState> {
  const run = git(ctx);
  const root = await repositoryRoot(ctx, run);
  const branch = await ensureSafeState(run, root);
  const statusResult = await run(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (statusResult.code !== 0) fail(statusResult, "Unable to inspect Git status.");
  const statuses = parseStatus(statusResult.stdout);
  const diffArgs = all ? ["diff", "HEAD"] : ["diff", "--cached"];
  const statArgs = all ? ["diff", "HEAD", "--stat"] : ["diff", "--cached", "--stat"];
  const [diffResult, statResult, worktreeDiffResult, logResult, headResult] = await Promise.all([
    run(diffArgs),
    run(statArgs),
    run(["diff", "HEAD"]),
    run(["log", "-n", "20", "--format=%s"]),
    run(["rev-parse", "HEAD"]),
  ]);
  if (diffResult.code !== 0) fail(diffResult, "Unable to generate the Git diff.");
  if (statResult.code !== 0) fail(statResult, "Unable to generate the Git summary.");
  if (worktreeDiffResult.code !== 0) fail(worktreeDiffResult, "Unable to fingerprint the Git worktree.");
  if (logResult.code !== 0) fail(logResult, "Unable to read recent commits.");
  if (headResult.code !== 0) fail(headResult, "Unable to read HEAD.");

  let diff = diffResult.stdout;
  if (all) {
    const extra = await untrackedContent(root, statuses, Math.max(0, patchLimit - Buffer.byteLength(diff)));
    if (extra) diff += `\n\n${extra}`;
  }
  const omitted = Buffer.byteLength(diff) > patchLimit;
  if (omitted) {
    diff = Buffer.from(diff).subarray(0, patchLimit).toString("utf8") + "\n[diff content omitted due to size limit]";
  }

  const statusSummary = statuses.map((item) => `${item.code} ${item.path}`).join("\n");
  const summary = [statResult.stdout.trim(), all ? statusSummary : ""].filter(Boolean).join("\n");
  const fingerprintSource = `${headResult.stdout.trim()}\n${branch}\n${statusResult.stdout}\n${worktreeDiffResult.stdout}`;
  const fingerprint = createHash("sha256").update(fingerprintSource).digest("hex");
  const hasUnstagedChanges = statuses.some((item) => item.code[1] !== " " || item.code === "??");
  const hasSelectedChanges = all ? statuses.length > 0 : statuses.some((item) => item.code[0] !== " ");

  return {
    root,
    branch,
    fingerprint,
    summary: omitted ? `${summary}\n[diff content omitted]` : summary,
    diff: diff || "(no textual diff available; inspect the file summary)",
    recentCommits: logResult.stdout.trim(),
    hasSelectedChanges,
    hasUnstagedChanges,
  };
}

export async function currentFingerprint(ctx: GitContext): Promise<string> {
  return (await inspectRepository(ctx, true, 1)).fingerprint;
}

export async function commitMessage(ctx: GitContext, message: string, all: boolean): Promise<string> {
  const run = git(ctx);
  const tempDir = await mkdtemp(join(tmpdir(), "pi-commit-"));
  const messageFile = join(tempDir, "message.txt");
  try {
    if (all) await stageAllSafely(ctx);
    await writeFile(messageFile, `${message.trim()}\n`, { encoding: "utf8", mode: 0o600 });
    const result = await run(["commit", "--file", messageFile], { timeout: 120_000 });
    if (result.code !== 0) fail(result, "Git could not create the commit.");
    const hash = await run(["rev-parse", "--short", "HEAD"]);
    if (hash.code !== 0) fail(hash, "Commit created, but its hash could not be read.");
    return hash.stdout.trim();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

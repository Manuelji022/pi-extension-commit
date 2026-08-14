import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { commitMessage, currentFingerprint, inspectRepository, type GitContext } from "./git.ts";
import { generateCommitMessage } from "./model.ts";
import { validateCommitMessage } from "./conventional.ts";
import type { CommitArgs } from "./args.ts";

export async function prepareCommit(pi: ExtensionAPI, ctx: ExtensionContext, args: CommitArgs) {
  const git: GitContext = {
    cwd: ctx.cwd,
    exec: (command, options) => pi.exec("git", command, options),
  };
  const state = await inspectRepository(git, args.all);
  if (!state.hasSelectedChanges) {
    throw new Error(args.all
      ? "There are no changes to commit."
      : "There are no staged changes. Stage changes or use /commit --all.");
  }
  const generated = await generateCommitMessage(ctx, {
    diff: state.diff,
    summary: state.summary,
    recentCommits: state.recentCommits,
    hint: args.hint,
  });
  return { git, state, message: generated };
}

export async function finishCommit(
  prepared: Awaited<ReturnType<typeof prepareCommit>>,
  message: string,
  all: boolean,
): Promise<string> {
  const validation = validateCommitMessage(message);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  const fingerprint = await currentFingerprint(prepared.git);
  if (fingerprint !== prepared.state.fingerprint) {
    throw new Error("The repository changed while preparing this commit. Run /commit again.");
  }
  return commitMessage(prepared.git, message, all);
}

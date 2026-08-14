import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseCommitArgs } from "../../src/args.ts";
import { validateCommitMessage } from "../../src/conventional.ts";
import { finishCommit, prepareCommit } from "../../src/workflow.ts";

export default function commitExtension(pi: ExtensionAPI) {
  pi.registerCommand("commit", {
    description: "Generate, review, and create a Conventional Commit",
    handler: async (rawArgs, ctx) => {
      if (ctx.mode !== "tui") {
        const message = "/commit requires interactive TUI mode.";
        if (ctx.hasUI) ctx.ui.notify(message, "error");
        else console.error(message);
        return;
      }
      const parsed = parseCommitArgs(rawArgs);
      if ("error" in parsed) {
        ctx.ui.notify(parsed.error, "error");
        return;
      }
      await ctx.waitForIdle();
      ctx.ui.setStatus("pi-commit", "Preparing commit...");
      try {
        const prepared = await prepareCommit(pi, ctx, parsed);
        ctx.ui.setStatus("pi-commit", "Generating commit message...");
        let message = prepared.message;
        while (true) {
          ctx.ui.notify(`Proposed commit for ${prepared.state.branch}:\n${prepared.state.summary}`, "info");
          const edited = await ctx.ui.editor("Edit commit message", message);
          if (edited === undefined) {
            ctx.ui.notify("Commit cancelled.", "info");
            return;
          }
          const validation = validateCommitMessage(edited);
          if (validation.valid) {
            message = edited.trim();
            break;
          }
          ctx.ui.notify(`Invalid Conventional Commit: ${validation.errors.join(" ")}`, "error");
          message = edited;
        }
        const confirmed = await ctx.ui.confirm("Create commit?", message);
        if (!confirmed) {
          ctx.ui.notify("Commit cancelled.", "info");
          return;
        }
        ctx.ui.setStatus("pi-commit", "Creating commit...");
        const hash = await finishCommit(prepared, message, parsed.all);
        ctx.ui.notify(`Created ${hash}: ${message.split("\n", 1)[0]}`, "info");
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(text, "error");
      } finally {
        ctx.ui.setStatus("pi-commit", undefined);
      }
    },
  });
}

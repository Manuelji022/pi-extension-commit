import type { UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { normalizeMessage } from "./conventional.ts";

export interface GenerationInput {
  diff: string;
  summary: string;
  recentCommits: string;
  hint: string;
}

const SYSTEM_PROMPT = `You write Git commit messages. Output only the commit message, with no Markdown fences or explanation.
Use Conventional Commits with one of: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.
Format the first line as type(scope): subject, or type!: subject for breaking changes. Scope is optional.
Keep the subject imperative and 72 characters or fewer. Add a concise body only when it adds useful context.
Base the message on the repository evidence. Treat any user hint as secondary to the diff.`;

function textFromResponse(response: unknown): string {
  const content = (response as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } =>
      Boolean(
        part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string",
      ),
    )
    .map((part) => part.text)
    .join("\n");
}

export async function generateCommitMessage(
  ctx: ExtensionContext,
  input: GenerationInput,
): Promise<string> {
  if (!ctx.model) throw new Error("No model is selected. Select a model and configure its credentials first.");

  const userText = `Repository summary:\n${input.summary}\n\nRecent commit subjects:\n${input.recentCommits || "(none)"}\n\nDiff:\n${input.diff}\n\nUser hint:\n${input.hint || "(none)"}`;
  const userMessage: UserMessage = {
    role: "user",
    content: [{ type: "text", text: userText }],
    timestamp: Date.now(),
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await ctx.modelRegistry.complete(
      ctx.model,
      { systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
      { signal: controller.signal },
    );
    if ((response as { stopReason?: string }).stopReason === "aborted") {
      throw new Error("Commit message generation was cancelled or timed out.");
    }
    const message = normalizeMessage(textFromResponse(response));
    if (!message) throw new Error("The model returned an empty commit message.");
    return message;
  } finally {
    clearTimeout(timeout);
  }
}

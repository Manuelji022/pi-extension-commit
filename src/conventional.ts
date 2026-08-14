export const COMMIT_TYPES = [
  "feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert",
] as const;

const HEADER = new RegExp(
  `^(${COMMIT_TYPES.join("|")})(?:\\(([a-z0-9][a-z0-9._/-]*)\\))?(!)?: (.+)$`,
);

export interface CommitValidation {
  valid: boolean;
  errors: string[];
  type?: string;
  scope?: string;
  breaking?: boolean;
  subject?: string;
}

export function normalizeMessage(value: string): string {
  let message = value.trim();
  if (message.startsWith("```") && message.endsWith("```")) {
    const lines = message.split("\n");
    if (lines.length >= 2) message = lines.slice(1, -1).join("\n").trim();
  }
  return message;
}

export function validateCommitMessage(value: string): CommitValidation {
  const message = value.trim();
  const errors: string[] = [];
  const header = message.split("\n")[0]?.trimEnd() ?? "";
  const match = HEADER.exec(header);

  if (!header) errors.push("The commit message cannot be empty.");
  if (!match) errors.push("Use a Conventional Commit header such as `fix(auth): handle expired sessions`.");

  const subject = match?.[4];
  if (subject && subject.length > 72) errors.push("The subject must be 72 characters or fewer.");
  if (subject && !subject.trim()) errors.push("The subject cannot be empty.");

  return {
    valid: errors.length === 0,
    errors,
    type: match?.[1],
    scope: match?.[2],
    breaking: Boolean(match?.[3]),
    subject,
  };
}

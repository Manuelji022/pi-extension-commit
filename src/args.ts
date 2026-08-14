export interface CommitArgs {
  all: boolean;
  hint: string;
}

export function parseCommitArgs(raw: string): CommitArgs | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { all: false, hint: "" };

  const parts = trimmed.split(/\s+/);
  if (parts[0] === "--all") {
    return { all: true, hint: parts.slice(1).join(" ") };
  }
  if (parts.some((part) => part.startsWith("--"))) {
    return { error: "Unknown option. Usage: /commit [hint] or /commit --all [hint]" };
  }
  return { all: false, hint: trimmed };
}

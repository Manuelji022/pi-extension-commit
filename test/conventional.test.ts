import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMessage, validateCommitMessage } from "../src/conventional.ts";

test("validates Conventional Commit headers", () => {
  assert.equal(validateCommitMessage("fix(auth): handle expired sessions").valid, true);
  assert.equal(validateCommitMessage("feat!: change the API").breaking, true);
  assert.equal(validateCommitMessage("unknown: change").valid, false);
  assert.equal(validateCommitMessage(`fix: ${"x".repeat(73)}`).valid, false);
});

test("normalizes fenced model output", () => {
  assert.equal(normalizeMessage("```text\nfix: update login\n```"), "fix: update login");
});

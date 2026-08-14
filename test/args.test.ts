import test from "node:test";
import assert from "node:assert/strict";
import { parseCommitArgs } from "../src/args.ts";

test("parses commit arguments", () => {
  assert.deepEqual(parseCommitArgs(""), { all: false, hint: "" });
  assert.deepEqual(parseCommitArgs("fix login redirect"), { all: false, hint: "fix login redirect" });
  assert.deepEqual(parseCommitArgs("--all fix login"), { all: true, hint: "fix login" });
  assert.match(String((parseCommitArgs("fix --bad") as { error: string }).error), /Unknown option/);
});

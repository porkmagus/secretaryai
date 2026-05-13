import { strict as assert } from "node:assert";
import { test } from "node:test";
import { selectRuntimeTurnBranch } from "./turn-orchestrator.js";

test("selectRuntimeTurnBranch prefers tool runtime handling first", () => {
  assert.equal(
    selectRuntimeTurnBranch({
      agent_job_launch: true,
      agent_job_requirement: true,
      tool_approval: true,
      tool_runtime: true,
    }),
    "tool_runtime",
  );
});

test("selectRuntimeTurnBranch falls through ordered immediate branches", () => {
  assert.equal(
    selectRuntimeTurnBranch({
      tool_approval: true,
      agent_job_requirement: true,
      agent_job_launch: true,
    }),
    "tool_approval",
  );
  assert.equal(
    selectRuntimeTurnBranch({
      agent_job_requirement: true,
      agent_job_launch: true,
    }),
    "agent_job_requirement",
  );
  assert.equal(selectRuntimeTurnBranch({ agent_job_launch: true }), "agent_job_launch");
});

test("selectRuntimeTurnBranch returns chat when no immediate branch handled the turn", () => {
  assert.equal(selectRuntimeTurnBranch({}), "chat");
});

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import * as schemaModule from "./schema";

describe("schema table exports", () => {
  test("exports all 20 tables", () => {
    const tableNames = [
      "users",
      "personas",
      "conversations",
      "messages",
      "memoryEntries",
      "memoryLinks",
      "tasks",
      "integrations",
      "tools",
      "toolExecutions",
      "voiceProfiles",
      "speechArtifacts",
      "jobs",
      "agentJobs",
      "agentJobLaunchIntents",
      "agentJobSteps",
      "agentJobArtifacts",
      "agentJobRequirements",
      "activityTraces",
    ];

    for (const name of tableNames) {
      assert.ok(name in schemaModule, `schema should export "${name}"`);
      const table = (schemaModule as Record<string, unknown>)[name];
      assert.ok(typeof table === "object" && table !== null, `"${name}" should be an object`);
    }
  });

  test("users table has expected column names", () => {
    const users = schemaModule.users;
    assert.ok("id" in users);
    assert.ok("displayName" in users);
    assert.ok("defaultPersonaId" in users);
    assert.ok("createdAt" in users);
    assert.ok("updatedAt" in users);
  });

  test("personas table has expected columns", () => {
    const personas = schemaModule.personas;
    assert.ok("id" in personas);
    assert.ok("name" in personas);
    assert.ok("toneProfile" in personas);
    assert.ok("behaviorRules" in personas);
    assert.ok("promptTemplate" in personas);
    assert.ok("isDefault" in personas);
    assert.ok("voiceProfileId" in personas);
  });

  test("conversations table has expected columns", () => {
    const conversations = schemaModule.conversations;
    assert.ok("id" in conversations);
    assert.ok("userId" in conversations);
    assert.ok("channelType" in conversations);
    assert.ok("channelRef" in conversations);
    assert.ok("status" in conversations);
    assert.ok("lastMessageAt" in conversations);
  });

  test("messages table has expected columns", () => {
    const messages = schemaModule.messages;
    assert.ok("id" in messages);
    assert.ok("conversationId" in messages);
    assert.ok("role" in messages);
    assert.ok("contentText" in messages);
    assert.ok("contentJson" in messages);
    assert.ok("parentMessageId" in messages);
  });

  test("memoryEntries table has expected columns", () => {
    const entries = schemaModule.memoryEntries;
    assert.ok("id" in entries);
    assert.ok("memoryType" in entries);
    assert.ok("contentText" in entries);
    assert.ok("contentJson" in entries);
    assert.ok("tags" in entries);
    assert.ok("importanceScore" in entries);
    assert.ok("confidenceScore" in entries);
    assert.ok("pinned" in entries);
    assert.ok("suppressed" in entries);
  });

  test("tasks table has expected columns", () => {
    const tasks = schemaModule.tasks;
    assert.ok("id" in tasks);
    assert.ok("userId" in tasks);
    assert.ok("title" in tasks);
    assert.ok("status" in tasks);
    assert.ok("dueAt" in tasks);
    assert.ok("reminderAt" in tasks);
    assert.ok("deliveredAt" in tasks);
  });

  test("agentJobs table has expected columns", () => {
    const agentJobs = schemaModule.agentJobs;
    assert.ok("jobId" in agentJobs);
    assert.ok("requestedByUserId" in agentJobs);
    assert.ok("title" in agentJobs);
    assert.ok("goal" in agentJobs);
    assert.ok("workspacePath" in agentJobs);
    assert.ok("approvalMode" in agentJobs);
  });

  test("agentJobSteps table has expected columns", () => {
    const steps = schemaModule.agentJobSteps;
    assert.ok("id" in steps);
    assert.ok("jobId" in steps);
    assert.ok("stepKey" in steps);
    assert.ok("title" in steps);
    assert.ok("stepKind" in steps);
    assert.ok("status" in steps);
    assert.ok("sequence" in steps);
  });
});

describe("phase table arrays", () => {
  test("phaseOneTables contains 7 tables", () => {
    assert.strictEqual(schemaModule.phaseOneTables.length, 7);
    assert.ok(schemaModule.phaseOneTables.includes("users"));
    assert.ok(schemaModule.phaseOneTables.includes("personas"));
    assert.ok(schemaModule.phaseOneTables.includes("conversations"));
    assert.ok(schemaModule.phaseOneTables.includes("messages"));
    assert.ok(schemaModule.phaseOneTables.includes("memory_entries"));
    assert.ok(schemaModule.phaseOneTables.includes("jobs"));
    assert.ok(schemaModule.phaseOneTables.includes("activity_traces"));
  });

  test("phaseTwoTables adds memory_links and tasks", () => {
    assert.strictEqual(schemaModule.phaseTwoTables.length, 9);
    assert.ok(schemaModule.phaseTwoTables.includes("memory_links"));
    assert.ok(schemaModule.phaseTwoTables.includes("tasks"));
    // Should include all phase one tables
    for (const t of schemaModule.phaseOneTables) {
      assert.ok(schemaModule.phaseTwoTables.includes(t));
    }
  });

  test("phaseThreeTables adds integrations", () => {
    assert.strictEqual(schemaModule.phaseThreeTables.length, 10);
    assert.ok(schemaModule.phaseThreeTables.includes("integrations"));
  });

  test("phaseFourTables adds voice_profiles and speech_artifacts", () => {
    assert.strictEqual(schemaModule.phaseFourTables.length, 12);
    assert.ok(schemaModule.phaseFourTables.includes("voice_profiles"));
    assert.ok(schemaModule.phaseFourTables.includes("speech_artifacts"));
  });

  test("phaseFiveTables adds tools and tool_executions", () => {
    assert.strictEqual(schemaModule.phaseFiveTables.length, 14);
    assert.ok(schemaModule.phaseFiveTables.includes("tools"));
    assert.ok(schemaModule.phaseFiveTables.includes("tool_executions"));
  });

  test("phaseSixTables adds agent job tables", () => {
    assert.strictEqual(schemaModule.phaseSixTables.length, 19);
    assert.ok(schemaModule.phaseSixTables.includes("agent_jobs"));
    assert.ok(schemaModule.phaseSixTables.includes("agent_job_launch_intents"));
    assert.ok(schemaModule.phaseSixTables.includes("agent_job_steps"));
    assert.ok(schemaModule.phaseSixTables.includes("agent_job_artifacts"));
    assert.ok(schemaModule.phaseSixTables.includes("agent_job_requirements"));
  });

  test("each phase is a superset of the previous", () => {
    const phases = [
      schemaModule.phaseOneTables as readonly string[],
      schemaModule.phaseTwoTables as readonly string[],
      schemaModule.phaseThreeTables as readonly string[],
      schemaModule.phaseFourTables as readonly string[],
      schemaModule.phaseFiveTables as readonly string[],
      schemaModule.phaseSixTables as readonly string[],
    ];

    for (let i = 1; i < phases.length; i++) {
      const prev = phases[i - 1];
      const curr = phases[i];
      for (const table of prev) {
        assert.ok(curr.includes(table), `phase ${i + 1} should include "${table}" from phase ${i}`);
      }
      assert.ok(
        curr.length > prev.length,
        `phase ${i + 1} should have more tables than phase ${i}`,
      );
    }
  });
});

describe("schema index exports", () => {
  test("re-exports phase table type names", () => {
    // These are type-only exports; we verify the module loaded without errors.
    // The phase table arrays are the runtime equivalents we tested above.
    assert.ok(Array.isArray(schemaModule.phaseOneTables));
    assert.ok(Array.isArray(schemaModule.phaseTwoTables));
    assert.ok(Array.isArray(schemaModule.phaseThreeTables));
    assert.ok(Array.isArray(schemaModule.phaseFourTables));
    assert.ok(Array.isArray(schemaModule.phaseFiveTables));
    assert.ok(Array.isArray(schemaModule.phaseSixTables));
  });

  test("all phase arrays contain string table names", () => {
    for (const phase of [
      schemaModule.phaseOneTables,
      schemaModule.phaseTwoTables,
      schemaModule.phaseThreeTables,
      schemaModule.phaseFourTables,
      schemaModule.phaseFiveTables,
      schemaModule.phaseSixTables,
    ]) {
      for (const entry of phase) {
        assert.strictEqual(typeof entry, "string", "all phase table entries should be strings");
      }
    }
  });

  test("phaseOneTables is a readonly array (as const)", () => {
    // as const is a compile-time assertion; at runtime we verify it's an array
    // with correct length and content
    assert.ok(Array.isArray(schemaModule.phaseOneTables));
    assert.strictEqual(schemaModule.phaseOneTables.length, 7);
  });
});

describe("createDbClient", () => {
  test("client module exports createDbClient function", async () => {
    const { createDbClient } = await import("./client");
    assert.strictEqual(typeof createDbClient, "function");
  });
});

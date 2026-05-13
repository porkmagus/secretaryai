import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  cancelAgentJob,
  getAgentJobDetail,
  listAgentJobs,
  markAgentJobFailed,
  resumeAgentJob,
} from "./agent-job-runtime";

function makeDbClient(
  options: {
    selectRows?: unknown[];
    jobRow?: unknown | null;
    steps?: unknown[];
    artifacts?: unknown[];
  } = {},
) {
  const selectRows = options.selectRows ?? [];
  const jobRow = options.jobRow ?? null;
  const steps = options.steps ?? [];
  const artifacts = options.artifacts ?? [];

  // Build a flexible select chain that works for both listAgentJobs (orderBy)
  // and getAgentJobRow (where->limit)
  const orderByResult = selectRows;
  const whereFn = mock.fn(() => ({
    limit: mock.fn(() => Promise.resolve(selectRows.slice(0, 1))),
  }));
  const orderByFn = mock.fn(() => orderByResult);
  const innerJoinFn = mock.fn(() => ({
    orderBy: orderByFn,
    where: whereFn,
  }));
  const fromFn = mock.fn(() => ({ innerJoin: innerJoinFn }));
  const selectFn = mock.fn(() => ({ from: fromFn }));

  return {
    db: {
      select: selectFn,
      query: {
        agentJobs: { findFirst: mock.fn(() => Promise.resolve(jobRow)) },
        conversations: { findFirst: mock.fn(() => Promise.resolve({ id: "conv-123" })) },
        agentJobArtifacts: { findMany: mock.fn(() => artifacts) },
        agentJobSteps: { findMany: mock.fn(() => steps) },
      },
      update: mock.fn(() => ({
        set: mock.fn(() => ({ where: mock.fn(() => Promise.resolve({})) })),
      })),
      insert: mock.fn(() => ({
        values: mock.fn(() => Promise.resolve({})),
      })),
      transaction: mock.fn(async (fn) => {
        const tx = {
          insert: mock.fn(() => ({ values: mock.fn(() => Promise.resolve({})) })),
          update: mock.fn(() => ({
            set: mock.fn(() => ({ where: mock.fn(() => Promise.resolve({})) })),
          })),
          query: {
            messages: { findFirst: mock.fn(() => Promise.resolve(null)) },
          },
        };
        return fn(tx);
      }),
    },
    pool: {} as unknown as Record<string, unknown>,
    checkHealth: mock.fn(() => Promise.resolve()),
    close: mock.fn(() => Promise.resolve()),
  };
}

function makeConfig() {
  return {
    defaultUserId: "local-owner",
    defaultPersonaId: "secretary-default",
    appBaseUrl: "http://localhost:3000",
    workerBaseUrl: "http://localhost:4000",
    databaseUrl: "postgres://test",
    redisUrl: "redis://test",
    logLevel: "info" as const,
    openai: { apiKey: "test", model: "gpt-4" },
    searxngBaseUrl: "http://test",
    sttBaseUrl: "http://test",
    ttsBaseUrl: "http://test",
    telegramBotToken: null as string | null,
    telegramWebhookUrl: null as string | null,
    telegramPollingEnabled: false,
    telegramWebhookEnabled: false,
    webPort: 3000,
    workerPort: 4000,
    crawl4aiBaseUrl: "http://test",
  };
}

function makeQueue() {
  return {
    enqueue: mock.fn(() => Promise.resolve()),
  };
}

function makeJobRow(overrides = {}) {
  const now = new Date();
  return {
    job: {
      id: "test-job-123",
      jobType: "agent.build",
      status: "running",
      payloadJson: { goal: "Test goal" },
      resultJson: null,
      errorText: null,
      scheduledFor: now,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    },
    agent: {
      jobId: "test-job-123",
      title: "Test Job",
      goal: "Test goal",
      workspacePath: "/tmp/test",
      requestedByUserId: "local-owner",
      conversationId: "conv-123",
      approvalMode: "restrictive",
      blockerSummary: null,
      currentStepId: null,
      resultSummary: null,
      executionBackend: "host_native",
      createdAt: now,
      updatedAt: now,
    },
  };
}

test("listAgentJobs returns jobs array from db", async () => {
  const dbClient = makeDbClient({ selectRows: [makeJobRow()] });

  const result = await listAgentJobs(dbClient as any);

  assert.ok(Array.isArray(result.jobs));
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].id, "test-job-123");
});

test("listAgentJobs returns empty array when no jobs", async () => {
  const dbClient = makeDbClient({ selectRows: [] });

  const result = await listAgentJobs(dbClient as any);

  assert.ok(Array.isArray(result.jobs));
  assert.equal(result.jobs.length, 0);
});

test("getAgentJobDetail returns null when job not found", async () => {
  const dbClient = makeDbClient({ jobRow: null });

  const result = await getAgentJobDetail(dbClient as any, "nonexistent-job");

  assert.equal(result, null);
});

test("markAgentJobFailed updates job status and records trace", async () => {
  const jobRow = makeJobRow();
  const dbClient = makeDbClient({
    selectRows: [jobRow],
    jobRow: jobRow,
  });
  const config = makeConfig();

  await markAgentJobFailed(config as any, dbClient as any, "test-job-123", "Something went wrong");

  // Verify update was called at least twice (for jobs and agentJobs tables)
  assert.ok((dbClient.db.update as ReturnType<typeof mock.fn>).mock.callCount() >= 2);
});

test("cancelAgentJob returns null when job not found", async () => {
  const dbClient = makeDbClient({ jobRow: null });
  const config = makeConfig();

  const result = await cancelAgentJob({
    config: config as any,
    dbClient: dbClient as any,
    jobId: "nonexistent-job",
  });

  assert.equal(result, null);
});

test("resumeAgentJob returns null when job not found", async () => {
  const dbClient = makeDbClient({ jobRow: null });
  const config = makeConfig();
  const queue = makeQueue();

  const result = await resumeAgentJob({
    config: config as any,
    dbClient: dbClient as any,
    queue,
    jobId: "nonexistent-job",
  });

  assert.equal(result, null);
});

test("resumeAgentJob returns unchanged for completed job", async () => {
  const completedRow = makeJobRow({
    status: "completed",
    finishedAt: new Date(),
  });
  const dbClient = makeDbClient({
    selectRows: [completedRow],
    jobRow: completedRow,
  });
  const config = makeConfig();
  const queue = makeQueue();

  const result = await resumeAgentJob({
    config: config as any,
    dbClient: dbClient as any,
    queue,
    jobId: "test-job-123",
  });

  assert.ok(result !== null);
  assert.equal(result.job.id, "test-job-123");
  assert.equal(queue.enqueue.mock.callCount(), 0);
});

test("resumeAgentJob returns unchanged for cancelled job", async () => {
  const cancelledRow = makeJobRow({
    status: "cancelled",
    finishedAt: new Date(),
  });
  const dbClient = makeDbClient({
    selectRows: [cancelledRow],
    jobRow: cancelledRow,
  });
  const config = makeConfig();
  const queue = makeQueue();

  const result = await resumeAgentJob({
    config: config as any,
    dbClient: dbClient as any,
    queue,
    jobId: "test-job-123",
  });

  assert.ok(result !== null);
  assert.equal(result.job.id, "test-job-123");
  assert.equal(queue.enqueue.mock.callCount(), 0);
});

test("cancelAgentJob updates job state when job exists", async () => {
  const runningRow = makeJobRow({ status: "running" });
  const dbClient = makeDbClient({
    selectRows: [runningRow],
    jobRow: runningRow,
  });
  const config = makeConfig();

  const result = await cancelAgentJob({
    config: config as any,
    dbClient: dbClient as any,
    jobId: "test-job-123",
  });

  assert.ok(result !== null);
  // Should call update for steps, agentJobs, jobs
  assert.ok((dbClient.db.update as ReturnType<typeof mock.fn>).mock.callCount() >= 2);
});

import type { AppConfig } from "@secretary/config";
import { createDbClient } from "@secretary/db";
import { createAgentJobQueue } from "./agent-job-queue.js";
import { markAgentJobFailed, processAgentJob } from "./agent-job-runtime.js";
import { markMemoryCandidateJobFailed, processMemoryCandidateJob } from "./memory-engine.js";
import { createMemoryQueue } from "./memory-queue.js";
import { ensureDefaultVoiceProfile } from "./speech-runtime.js";
import { ensureSpeechStorageLayout } from "./speech-storage.js";

export async function createInfrastructure(config: AppConfig) {
  const dbClient = createDbClient(config.databaseUrl);
  await ensureSpeechStorageLayout();
  await ensureDefaultVoiceProfile(dbClient);
  const memoryQueue = createMemoryQueue(config.redisUrl, {
    async processCandidate(jobId, payload) {
      try {
        await processMemoryCandidateJob({
          dbClient,
          payload,
          jobId,
        });
      } catch (error) {
        await markMemoryCandidateJobFailed({
          dbClient,
          jobId,
          traceId: payload.traceId,
          conversationId: payload.conversationId,
          errorText: error instanceof Error ? error.message : "Unknown memory worker error",
        });

        throw error;
      }
    },
  });
  const agentJobQueue = createAgentJobQueue(config.redisUrl, {
    async processJob(payload) {
      try {
        await processAgentJob(config, dbClient, payload.jobId, agentJobQueue);
      } catch (error) {
        await markAgentJobFailed(
          config,
          dbClient,
          payload.jobId,
          error instanceof Error ? error.message : "Unknown agent worker error",
        );

        throw error;
      }
    },
  });

  return {
    dbClient,
    memoryQueue,
    agentJobQueue,
    async checkHealth() {
      const [postgres, memoryRedis, agentRedis] = await Promise.allSettled([
        dbClient.checkHealth(),
        memoryQueue.checkHealth(),
        agentJobQueue.checkHealth(),
      ]);

      const redisError =
        memoryRedis.status === "rejected"
          ? memoryRedis.reason
          : agentRedis.status === "rejected"
            ? agentRedis.reason
            : null;

      return {
        postgres:
          postgres.status === "fulfilled"
            ? "ok"
            : postgres.reason instanceof Error
              ? postgres.reason.message
              : "error",
        redis: !redisError ? "ok" : redisError instanceof Error ? redisError.message : "error",
      };
    },
    async close() {
      await Promise.allSettled([dbClient.close(), memoryQueue.close(), agentJobQueue.close()]);
    },
  };
}

export type Infrastructure = Awaited<ReturnType<typeof createInfrastructure>>;

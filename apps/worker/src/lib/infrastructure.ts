import { createDbClient } from "@secretary/db";
import type { AppConfig } from "@secretary/config";
import { createMemoryQueue } from "./memory-queue.js";
import {
  markMemoryCandidateJobFailed,
  processMemoryCandidateJob,
} from "./memory-engine.js";
import { ensureSpeechStorageLayout } from "./speech-storage.js";
import { ensureDefaultVoiceProfile } from "./speech-runtime.js";

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

  return {
    dbClient,
    memoryQueue,
    async checkHealth() {
      const [postgres, redis] = await Promise.allSettled([
        dbClient.checkHealth(),
        memoryQueue.checkHealth(),
      ]);

      return {
        postgres:
          postgres.status === "fulfilled"
            ? "ok"
            : postgres.reason instanceof Error
              ? postgres.reason.message
              : "error",
        redis:
          redis.status === "fulfilled"
            ? "ok"
            : redis.reason instanceof Error
              ? redis.reason.message
              : "error",
      };
    },
    async close() {
      await Promise.allSettled([dbClient.close(), memoryQueue.close()]);
    },
  };
}

export type Infrastructure = Awaited<ReturnType<typeof createInfrastructure>>;

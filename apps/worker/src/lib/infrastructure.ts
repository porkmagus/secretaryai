import { createDbClient } from "@secretary/db";
import type { AppConfig } from "@secretary/config";
import { createMemoryQueue } from "./memory-queue.js";

export function createInfrastructure(config: AppConfig) {
  const dbClient = createDbClient(config.databaseUrl);
  const memoryQueue = createMemoryQueue(config.redisUrl);

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

export type Infrastructure = ReturnType<typeof createInfrastructure>;

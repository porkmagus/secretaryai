import { Queue } from "bullmq";
import type { MemoryCandidateJobPayload } from "@secretary/core-runtime";

export const memoryCandidateQueueName = "memory.extract_candidates";

export function createMemoryQueue(redisUrl: string) {
  const url = new URL(redisUrl);
  const connection = {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname ? Number(url.pathname.slice(1) || 0) : 0,
    connectTimeout: 1000,
    lazyConnect: true,
    maxRetriesPerRequest: null,
    retryStrategy: () => null,
  };

  const queue = new Queue<
    MemoryCandidateJobPayload,
    void,
    typeof memoryCandidateQueueName
  >(memoryCandidateQueueName, {
    connection,
  });

  void queue.client
    .then((client) => {
      client.on("error", () => undefined);
    })
    .catch(() => undefined);

  return {
    queue,
    async enqueue(jobId: string, payload: MemoryCandidateJobPayload) {
      await queue.add(memoryCandidateQueueName, payload, {
        jobId,
        removeOnComplete: 500,
        removeOnFail: 500,
      });
    },
    async checkHealth() {
      const client = await queue.client;
      await client.ping();
    },
    async close() {
      await queue.close();
    },
  };
}

export type MemoryQueue = ReturnType<typeof createMemoryQueue>;

import { Queue, Worker } from "bullmq";
import type { MemoryCandidateJobPayload } from "@secretary/core-runtime";

export const memoryCandidateQueueName = "memory-extract-candidates";
export type MemoryQueueAdapter = {
  enqueue(jobId: string, payload: MemoryCandidateJobPayload): Promise<void>;
};

type CreateMemoryQueueOptions = {
  processCandidate?: (jobId: string, payload: MemoryCandidateJobPayload) => Promise<void>;
};

export function createMemoryQueue(
  redisUrl: string,
  options: CreateMemoryQueueOptions = {},
) {
  const url = new URL(redisUrl);
  const connection = {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname ? Number(url.pathname.slice(1) || 0) : 0,
    connectTimeout: 10000,
    lazyConnect: true,
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => {
      if (times > 10) {
        return null; // Stop retrying after 10 attempts
      }
      return Math.min(times * 1000, 30000); // Exponential backoff, max 30 seconds
    },
  };

  const queue = new Queue<
    MemoryCandidateJobPayload,
    void,
    typeof memoryCandidateQueueName
  >(memoryCandidateQueueName, {
    connection,
  });
  const worker = options.processCandidate
    ? new Worker<MemoryCandidateJobPayload, void, typeof memoryCandidateQueueName>(
        memoryCandidateQueueName,
        async (job) => {
          await options.processCandidate?.(job.id ?? memoryCandidateQueueName, job.data);
        },
        {
          connection,
          concurrency: 1,
        },
      )
    : null;

  void queue.client
    .then((client) => {
      client.on("error", (err) => {
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          service: "worker",
          event: "memory_queue.redis_error",
          error: err instanceof Error ? err.message : String(err),
        }));
      });
    })
    .catch((err) => {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        service: "worker",
        event: "memory_queue.client_init_failed",
        error: err instanceof Error ? err.message : String(err),
      }));
    });

  if (worker) {
    void worker.client
      .then((client) => {
        client.on("error", (err) => {
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            service: "worker",
            event: "memory_worker.redis_error",
            error: err instanceof Error ? err.message : String(err),
          }));
        });
      })
      .catch((err) => {
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          service: "worker",
          event: "memory_worker.client_init_failed",
          error: err instanceof Error ? err.message : String(err),
        }));
      });
  }

  return {
    queue,
    worker,
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
      await Promise.all([
        queue.close(),
        worker?.close(),
      ]);
    },
  };
}

export type MemoryQueue = ReturnType<typeof createMemoryQueue>;

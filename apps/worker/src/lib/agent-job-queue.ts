import { Queue, Worker } from "bullmq";

export const agentJobQueueName = "agent-build-jobs";

export type AgentJobQueuePayload = {
  jobId: string;
};

export type AgentJobQueueAdapter = {
  enqueue(jobId: string): Promise<void>;
};

type CreateAgentJobQueueOptions = {
  processJob?: (payload: AgentJobQueuePayload) => Promise<void>;
};

export function createAgentJobQueue(
  redisUrl: string,
  options: CreateAgentJobQueueOptions = {},
) {
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
    AgentJobQueuePayload,
    void,
    typeof agentJobQueueName
  >(agentJobQueueName, {
    connection,
  });

  const worker = options.processJob
    ? new Worker<AgentJobQueuePayload, void, typeof agentJobQueueName>(
        agentJobQueueName,
        async (job) => {
          await options.processJob?.(job.data);
        },
        {
          connection,
          concurrency: 1,
        },
      )
    : null;

  void queue.client
    .then((client) => {
      client.on("error", () => undefined);
    })
    .catch(() => undefined);

  if (worker) {
    void worker.client
      .then((client) => {
        client.on("error", () => undefined);
      })
      .catch(() => undefined);
  }

  return {
    queue,
    worker,
    async enqueue(jobId: string) {
      await queue.add(agentJobQueueName, { jobId }, {
        jobId: `${jobId}--${Date.now()}`,
        removeOnComplete: 500,
        removeOnFail: 500,
      });
    },
    async checkHealth() {
      const client = await queue.client;
      await client.ping();
    },
    async close() {
      await Promise.all([queue.close(), worker?.close()]);
    },
  };
}

export type AgentJobQueue = ReturnType<typeof createAgentJobQueue>;

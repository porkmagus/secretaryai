import { readFile } from "node:fs/promises";
import type { AppConfig } from "@secretary/config";
import type {
  AgentJobActionResponse,
  AgentJobDetailResponse,
  AgentJobListResponse,
  AgentJobRequirementDecisionRequest,
  AgentJobSettingsResponse,
  CreateAgentJobRequest,
  UpdateAgentJobSettingsRequest,
} from "@secretary/core-runtime";
import type { FastifyInstance } from "fastify";
import { resolveManagedAgentJobArtifactPath } from "../lib/agent-job-artifact-storage.js";
import {
  cancelAgentJob,
  createAgentJob,
  decideAgentJobRequirement,
  getAgentJobDetail,
  getAgentJobSettings,
  listAgentJobs,
  resumeAgentJob,
  updateAgentJobSettings,
} from "../lib/agent-job-runtime.js";
import type { Infrastructure } from "../lib/infrastructure.js";

export async function registerAgentJobsRoutes(
  app: FastifyInstance,
  config: AppConfig,
  infrastructure: Infrastructure,
  logger: ReturnType<typeof import("@secretary/observability").createLogger>,
): Promise<void> {
  app.get("/runtime/agent-jobs", async (_, reply) => {
    try {
      const response: AgentJobListResponse = await listAgentJobs(infrastructure.dbClient);

      return response;
    } catch (error) {
      logger.error("runtime.agent_jobs.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load agent jobs.",
      });
    }
  });

  app.post<{ Body: CreateAgentJobRequest }>("/runtime/agent-jobs", async (request, reply) => {
    try {
      const job = await createAgentJob({
        config,
        dbClient: infrastructure.dbClient,
        queue: infrastructure.agentJobQueue,
        request: request.body,
      });

      return reply.status(201).send({
        job,
      });
    } catch (error) {
      logger.error("runtime.agent_job.create_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to create agent job.",
      });
    }
  });

  app.get<{
    Params: {
      jobId: string;
    };
  }>("/runtime/agent-jobs/:jobId", async (request, reply) => {
    try {
      const response: AgentJobDetailResponse | null = await getAgentJobDetail(
        infrastructure.dbClient,
        request.params.jobId,
      );

      if (!response) {
        return reply.status(404).send({
          error: "Agent job not found.",
        });
      }

      return response;
    } catch (error) {
      logger.error("runtime.agent_job.failed", {
        error: error instanceof Error ? error.message : error,
        jobId: request.params.jobId,
      });

      return reply.status(500).send({
        error: "Unable to load agent job.",
      });
    }
  });

  app.get<{
    Querystring: {
      storageKey?: string;
      mimeType?: string;
    };
  }>("/runtime/agent-jobs/artifacts/file", async (request, reply) => {
    try {
      if (!request.query.storageKey) {
        return reply.status(400).send({
          error: "storageKey is required.",
        });
      }

      const filePath = resolveManagedAgentJobArtifactPath(request.query.storageKey);
      const fileBuffer = await readFile(filePath);
      reply.header("Content-Type", request.query.mimeType ?? "application/octet-stream");
      return reply.send(fileBuffer);
    } catch (error) {
      logger.error("runtime.agent_job.artifact_file_failed", {
        error: error instanceof Error ? error.message : error,
        storageKey: request.query.storageKey ?? null,
      });

      return reply.status(404).send({
        error: "Agent job artifact is unavailable.",
      });
    }
  });

  app.post<{
    Params: {
      jobId: string;
    };
  }>("/runtime/agent-jobs/:jobId/resume", async (request, reply) => {
    try {
      const response: AgentJobActionResponse | null = await resumeAgentJob({
        config,
        dbClient: infrastructure.dbClient,
        queue: infrastructure.agentJobQueue,
        jobId: request.params.jobId,
      });

      if (!response) {
        return reply.status(404).send({
          error: "Agent job not found.",
        });
      }

      return response;
    } catch (error) {
      logger.error("runtime.agent_job.resume_failed", {
        error: error instanceof Error ? error.message : error,
        jobId: request.params.jobId,
      });

      return reply.status(500).send({
        error: "Unable to resume agent job.",
      });
    }
  });

  app.post<{
    Params: {
      jobId: string;
    };
  }>("/runtime/agent-jobs/:jobId/cancel", async (request, reply) => {
    try {
      const response: AgentJobActionResponse | null = await cancelAgentJob({
        config,
        dbClient: infrastructure.dbClient,
        jobId: request.params.jobId,
      });

      if (!response) {
        return reply.status(404).send({
          error: "Agent job not found.",
        });
      }

      return response;
    } catch (error) {
      logger.error("runtime.agent_job.cancel_failed", {
        error: error instanceof Error ? error.message : error,
        jobId: request.params.jobId,
      });

      return reply.status(500).send({
        error: "Unable to cancel agent job.",
      });
    }
  });

  app.post<{
    Params: {
      jobId: string;
      requirementId: string;
    };
    Body: AgentJobRequirementDecisionRequest;
  }>("/runtime/agent-jobs/:jobId/requirements/:requirementId/decision", async (request, reply) => {
    try {
      const response: AgentJobActionResponse | null = await decideAgentJobRequirement({
        config,
        dbClient: infrastructure.dbClient,
        queue: infrastructure.agentJobQueue,
        jobId: request.params.jobId,
        requirementId: request.params.requirementId,
        decision: request.body,
      });

      if (!response) {
        return reply.status(404).send({
          error: "Agent job requirement not found.",
        });
      }

      return response;
    } catch (error) {
      logger.error("runtime.agent_job.requirement_failed", {
        error: error instanceof Error ? error.message : error,
        jobId: request.params.jobId,
        requirementId: request.params.requirementId,
      });

      return reply.status(500).send({
        error: "Unable to update agent job requirement.",
      });
    }
  });

  app.get("/runtime/agent-job-settings", async (_, reply) => {
    try {
      const response: AgentJobSettingsResponse = await getAgentJobSettings();
      return response;
    } catch (error) {
      logger.error("runtime.agent_job_settings.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load agent job settings.",
      });
    }
  });

  app.patch<{ Body: UpdateAgentJobSettingsRequest }>(
    "/runtime/agent-job-settings",
    async (request, reply) => {
      try {
        const response: AgentJobSettingsResponse = await updateAgentJobSettings(request.body);
        return response;
      } catch (error) {
        logger.error("runtime.agent_job_settings.update_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: "Unable to update agent job settings.",
        });
      }
    },
  );
}

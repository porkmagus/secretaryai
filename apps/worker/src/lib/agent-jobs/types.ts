import type { AppConfig } from "@secretary/config";
import type {
  AgentJobStepKind,
  AgentJobStepStatus,
  CreateAgentJobRequest,
} from "@secretary/core-runtime";
import type { DbClient } from "@secretary/db";
import type { AgentJobQueueAdapter } from "../agent-job-queue.js";

export type CreateAgentJobParams = {
  config: AppConfig;
  dbClient: DbClient;
  queue: AgentJobQueueAdapter;
  request: CreateAgentJobRequest;
};

export type StepPlan = {
  stepKey: string;
  title: string;
  detail: string;
  kind: AgentJobStepKind;
  status: AgentJobStepStatus;
  dependsOnStepIds: string[];
  toolKey?: string | null;
  summary?: string | null;
};

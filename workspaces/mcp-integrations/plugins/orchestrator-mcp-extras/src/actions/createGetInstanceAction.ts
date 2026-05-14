/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {
  AuthService,
  BackstageCredentials,
  DiscoveryService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { ActionsRegistryService } from '@backstage/backend-plugin-api/alpha';
import { orchestratorFetch } from './orchestratorApi';

export interface ProcessInstanceDTO {
  id: string;
  processId: string;
  processName?: string;
  state?: string;
  start?: string;
  end?: string;
  duration?: string;
  description?: string;
  workflowdata?: Record<string, unknown>;
}

export async function fetchInstance(options: {
  discovery: DiscoveryService;
  auth: AuthService;
  logger: LoggerService;
  credentials: BackstageCredentials;
  instanceId: string;
}): Promise<ProcessInstanceDTO> {
  const { instanceId, ...fetchOpts } = options;

  const response = await orchestratorFetch({
    ...fetchOpts,
    path: `/v2/workflows/instances/${encodeURIComponent(instanceId)}`,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to get instance '${instanceId}': ${response.status} ${text}`,
    );
  }

  return response.json() as Promise<ProcessInstanceDTO>;
}

export const createGetInstanceAction = ({
  actionsRegistry,
  auth,
  discovery,
  logger,
}: {
  actionsRegistry: ActionsRegistryService;
  auth: AuthService;
  discovery: DiscoveryService;
  logger: LoggerService;
}) => {
  actionsRegistry.register({
    name: 'orchestrator-instance-get',
    title: 'Get Orchestrator Workflow Instance',
    attributes: {
      destructive: false,
      readOnly: true,
      idempotent: true,
    },
    description: `Get the status and details of a workflow execution instance by its ID.
Returns the current state, start/end timestamps, workflow data, and any error information.
Use the instanceId returned from orchestrator-workflow-execute to track progress.

Example invocations:
  # Check the status of a workflow execution
  orchestrator-instance-get instanceId:"abc-123-def-456"
  Output: {
    "id": "abc-123-def-456",
    "workflowId": "greeting",
    "status": "COMPLETED",
    "startedAt": "2025-01-15T10:30:00Z",
    "completedAt": "2025-01-15T10:30:05Z",
    "workflowdata": { "greeting": "Hello from YAML Workflow" }
  }
`,
    schema: {
      input: z =>
        z.object({
          instanceId: z
            .string()
            .min(1)
            .describe(
              'The unique identifier of the workflow instance to retrieve',
            ),
        }),
      output: z =>
        z.object({
          id: z.string().optional().describe('The instance ID'),
          workflowId: z
            .string()
            .optional()
            .describe('The workflow definition ID'),
          status: z
            .string()
            .optional()
            .describe(
              'Current execution status (ACTIVE, ERROR, COMPLETED, ABORTED, SUSPENDED, PENDING)',
            ),
          startedAt: z
            .string()
            .optional()
            .describe('ISO 8601 timestamp when execution started'),
          completedAt: z
            .string()
            .optional()
            .describe(
              'ISO 8601 timestamp when execution completed (if finished)',
            ),
          duration: z.string().optional().describe('Execution duration'),
          description: z.string().optional().describe('Instance description'),
          workflowdata: z
            .string()
            .optional()
            .describe(
              'JSON-encoded workflow output data including results and messages',
            ),
          error: z
            .string()
            .optional()
            .describe('Error message if the request failed'),
        }),
    },
    action: async ({ input, credentials }) => {
      try {
        const instance = await fetchInstance({
          discovery,
          auth,
          logger,
          credentials,
          instanceId: input.instanceId,
        });
        return {
          output: {
            id: instance.id,
            workflowId: instance.processId,
            status: instance.state,
            startedAt: instance.start,
            completedAt: instance.end,
            duration: instance.duration,
            description: instance.description,
            workflowdata: instance.workflowdata
              ? JSON.stringify(instance.workflowdata)
              : undefined,
            error: undefined,
          },
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(
          `orchestrator-instance-get: Error fetching instance '${input.instanceId}':`,
          error instanceof Error ? error : undefined,
        );
        return {
          output: {
            id: undefined,
            workflowId: undefined,
            status: undefined,
            startedAt: undefined,
            completedAt: undefined,
            duration: undefined,
            description: undefined,
            workflowdata: undefined,
            error: message,
          },
        };
      }
    },
  });
};

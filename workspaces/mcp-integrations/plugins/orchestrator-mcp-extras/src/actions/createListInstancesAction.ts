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
import { ProcessInstanceDTO } from './createGetInstanceAction';
import { orchestratorFetch } from './orchestratorApi';

export interface ProcessInstanceListResult {
  items: ProcessInstanceDTO[];
  paginationInfo: Record<string, unknown>;
}

export async function fetchInstances(options: {
  discovery: DiscoveryService;
  auth: AuthService;
  logger: LoggerService;
  credentials: BackstageCredentials;
}): Promise<ProcessInstanceListResult> {
  const response = await orchestratorFetch({
    ...options,
    path: '/v2/workflows/instances',
    method: 'POST',
    body: {},
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to fetch workflow instances: ${response.status} ${text}`,
    );
  }

  return response.json() as Promise<ProcessInstanceListResult>;
}

export const createListInstancesAction = ({
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
    name: 'orchestrator-instances-list',
    title: 'List Orchestrator Workflow Instances',
    attributes: {
      destructive: false,
      readOnly: true,
      idempotent: true,
    },
    description: `List all executed workflow instances from the RHDH Orchestrator backend.
Returns a summary of each workflow execution including its ID, workflow ID, status, and timestamps.

Example invocations:
  # List all executed workflow instances
  orchestrator-instances-list
  Output: {
    "instances": [
      {
        "id": "abc-123-def-456",
        "workflowId": "greeting",
        "status": "COMPLETED",
        "startedAt": "2025-01-15T10:30:00Z",
        "completedAt": "2025-01-15T10:30:05Z",
        "description": "YAML based greeting workflow"
      }
    ]
  }
`,
    schema: {
      input: z => z.object({}),
      output: z =>
        z.object({
          instances: z
            .array(
              z.object({
                id: z.string().describe('The instance ID'),
                workflowId: z.string().describe('The workflow definition ID'),
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
                  .nullable()
                  .describe(
                    'ISO 8601 timestamp when execution completed (null if still running)',
                  ),
                description: z
                  .string()
                  .optional()
                  .describe('Instance description'),
              }),
            )
            .describe('Array of workflow execution instance summaries'),
          error: z
            .string()
            .optional()
            .describe('Error message if the request failed'),
        }),
    },
    action: async ({ credentials }) => {
      try {
        const result = await fetchInstances({
          discovery,
          auth,
          logger,
          credentials,
        });
        return {
          output: {
            instances: (result.items ?? []).map(inst => ({
              id: inst.id,
              workflowId: inst.processId,
              status: inst.state,
              startedAt: inst.start,
              completedAt: inst.end,
              description: inst.description,
            })),
            error: undefined,
          },
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(
          'orchestrator-instances-list: Error fetching instances:',
          error instanceof Error ? error : undefined,
        );
        return {
          output: {
            instances: [],
            error: message,
          },
        };
      }
    },
  });
};

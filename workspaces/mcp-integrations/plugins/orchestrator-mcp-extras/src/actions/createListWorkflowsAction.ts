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

export interface WorkflowOverviewDTO {
  workflowId: string;
  name?: string;
  format: string;
  lastRunId?: string;
  lastTriggeredMs?: number;
  lastRunStatus?: string;
  description?: string;
  isAvailable?: boolean;
}

export interface WorkflowOverviewListResult {
  overviews: WorkflowOverviewDTO[];
  paginationInfo: Record<string, unknown>;
}

export async function fetchWorkflowOverviews(options: {
  discovery: DiscoveryService;
  auth: AuthService;
  logger: LoggerService;
  credentials: BackstageCredentials;
}): Promise<WorkflowOverviewListResult> {
  const response = await orchestratorFetch({
    ...options,
    path: '/v2/workflows/overview',
    method: 'POST',
    body: {},
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch workflows: ${response.status} ${text}`);
  }

  return response.json() as Promise<WorkflowOverviewListResult>;
}

export const createListWorkflowsAction = ({
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
    name: 'orchestrator:workflows:list',
    title: 'List Orchestrator Workflows',
    attributes: {
      destructive: false,
      readOnly: true,
      idempotent: true,
    },
    description: `List all available orchestrator workflows from the RHDH Orchestrator backend.
Returns a summary of each workflow including its ID, name, description, format, availability status, and information about the last execution.

Example invocations:
  # List all available workflows
  orchestrator:workflows:list
  Output: {
    "workflows": [
      {
        "workflowId": "greeting",
        "name": "Greeting Workflow",
        "description": "A simple greeting workflow",
        "format": "yaml",
        "isAvailable": true,
        "lastRunStatus": "COMPLETED"
      }
    ]
  }
`,
    schema: {
      input: z => z.object({}),
      output: z =>
        z.object({
          workflows: z
            .array(
              z.object({
                workflowId: z.string().describe('Unique workflow identifier'),
                name: z
                  .string()
                  .optional()
                  .describe('Human-readable workflow name'),
                description: z
                  .string()
                  .optional()
                  .describe('Workflow description'),
                format: z.string().describe('Workflow definition format'),
                isAvailable: z
                  .boolean()
                  .optional()
                  .describe('Whether the workflow service is reachable'),
                lastRunStatus: z
                  .string()
                  .optional()
                  .describe(
                    'Status of the most recent execution (ACTIVE, ERROR, COMPLETED, ABORTED, SUSPENDED, PENDING)',
                  ),
                lastTriggeredMs: z
                  .number()
                  .optional()
                  .describe(
                    'Timestamp in milliseconds of the last execution trigger',
                  ),
              }),
            )
            .describe('Array of workflow overview summaries'),
          error: z
            .string()
            .optional()
            .describe('Error message if the request failed'),
        }),
    },
    action: async ({ credentials }) => {
      try {
        const result = await fetchWorkflowOverviews({
          discovery,
          auth,
          logger,
          credentials,
        });
        return {
          output: {
            workflows: (result.overviews ?? []).map(w => ({
              workflowId: w.workflowId,
              name: w.name,
              description: w.description,
              format: w.format,
              isAvailable: w.isAvailable,
              lastRunStatus: w.lastRunStatus,
              lastTriggeredMs: w.lastTriggeredMs,
            })),
            error: undefined,
          },
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(
          'orchestrator:workflows:list: Error fetching workflows:',
          error instanceof Error ? error : undefined,
        );
        return {
          output: {
            workflows: [],
            error: message,
          },
        };
      }
    },
  });
};

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

export interface WorkflowGetResult {
  overview: WorkflowOverviewDTO;
  inputSchema?: Record<string, unknown>;
}

export async function fetchWorkflowDetails(options: {
  discovery: DiscoveryService;
  auth: AuthService;
  logger: LoggerService;
  credentials: BackstageCredentials;
  workflowId: string;
}): Promise<WorkflowGetResult> {
  const { workflowId, ...fetchOpts } = options;
  const encodedId = encodeURIComponent(workflowId);

  const [overviewResponse, schemaResponse] = await Promise.all([
    orchestratorFetch({
      ...fetchOpts,
      path: `/v2/workflows/${encodedId}/overview`,
    }),
    orchestratorFetch({
      ...fetchOpts,
      path: `/v2/workflows/${encodedId}/inputSchema`,
    }),
  ]);

  if (!overviewResponse.ok) {
    const text = await overviewResponse.text();
    throw new Error(
      `Failed to get workflow '${workflowId}': ${overviewResponse.status} ${text}`,
    );
  }

  const overview =
    (await overviewResponse.json()) as unknown as WorkflowOverviewDTO;

  let inputSchema: Record<string, unknown> | undefined;
  if (schemaResponse.ok) {
    inputSchema = (await schemaResponse.json()) as Record<string, unknown>;
  } else {
    options.logger.warn(
      `orchestrator-workflow-get: Could not fetch input schema for '${workflowId}': ${schemaResponse.status}`,
    );
  }

  return { overview, inputSchema };
}

export const createGetWorkflowAction = ({
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
    name: 'orchestrator-workflow-get',
    title: 'Get Orchestrator Workflow Details',
    attributes: {
      destructive: false,
      readOnly: true,
      idempotent: true,
    },
    description: `Get detailed information about a specific workflow including its input schema.
Returns the workflow overview (ID, name, description, format, availability, last run status)
and the input schema that defines the required and optional input fields for execution.

Use this tool before orchestrator-workflow-execute to discover what inputData a workflow expects.

Example invocations:
  # Get details and input schema for the greeting workflow
  orchestrator-workflow-get workflowId:"greeting"
  Output: {
    "workflowId": "greeting",
    "name": "Greeting Workflow",
    "description": "A simple greeting workflow",
    "format": "yaml",
    "isAvailable": true,
    "lastRunStatus": "COMPLETED",
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": { "type": "string", "description": "Name to greet" },
        "language": { "type": "string", "description": "Greeting language" }
      },
      "required": ["name"]
    }
  }
`,
    schema: {
      input: z =>
        z.object({
          workflowId: z
            .string()
            .min(1)
            .describe(
              'The unique identifier of the workflow to retrieve (e.g. "greeting")',
            ),
        }),
      output: z =>
        z.object({
          workflowId: z.string().optional().describe('The workflow ID'),
          name: z.string().optional().describe('Display name of the workflow'),
          description: z
            .string()
            .optional()
            .describe('Human-readable description of the workflow'),
          format: z
            .string()
            .optional()
            .describe('Workflow definition format (e.g. "yaml", "json")'),
          isAvailable: z
            .boolean()
            .optional()
            .describe(
              'Whether the workflow is currently available for execution',
            ),
          lastRunStatus: z
            .string()
            .optional()
            .describe('Status of the most recent execution'),
          lastTriggeredMs: z
            .number()
            .optional()
            .describe('Epoch timestamp (ms) of the last execution'),
          inputSchema: z
            .string()
            .optional()
            .describe(
              'JSON-encoded input schema defining the required and optional fields for workflow execution',
            ),
          error: z
            .string()
            .optional()
            .describe('Error message if the request failed'),
        }),
    },
    action: async ({ input, credentials }) => {
      try {
        const result = await fetchWorkflowDetails({
          discovery,
          auth,
          logger,
          credentials,
          workflowId: input.workflowId,
        });
        return {
          output: {
            workflowId: result.overview.workflowId,
            name: result.overview.name,
            description: result.overview.description,
            format: result.overview.format,
            isAvailable: result.overview.isAvailable,
            lastRunStatus: result.overview.lastRunStatus,
            lastTriggeredMs: result.overview.lastTriggeredMs,
            inputSchema: result.inputSchema
              ? JSON.stringify(result.inputSchema)
              : undefined,
            error: undefined,
          },
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(
          `orchestrator-workflow-get: Error fetching workflow '${input.workflowId}':`,
          error instanceof Error ? error : undefined,
        );
        return {
          output: {
            workflowId: undefined,
            name: undefined,
            description: undefined,
            format: undefined,
            isAvailable: undefined,
            lastRunStatus: undefined,
            lastTriggeredMs: undefined,
            inputSchema: undefined,
            error: message,
          },
        };
      }
    },
  });
};

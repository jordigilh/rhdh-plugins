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

export async function executeWorkflow(options: {
  discovery: DiscoveryService;
  auth: AuthService;
  logger: LoggerService;
  credentials: BackstageCredentials;
  workflowId: string;
  inputData: Record<string, unknown>;
}): Promise<{ id: string }> {
  const { workflowId, inputData, ...fetchOpts } = options;

  const response = await orchestratorFetch({
    ...fetchOpts,
    path: `/v2/workflows/${encodeURIComponent(workflowId)}/execute`,
    method: 'POST',
    body: { inputData },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to execute workflow '${workflowId}': ${response.status} ${text}`,
    );
  }

  return response.json() as Promise<{ id: string }>;
}

export const createExecuteWorkflowAction = ({
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
    name: 'orchestrator:workflow:execute',
    title: 'Execute Orchestrator Workflow',
    attributes: {
      destructive: true,
      readOnly: false,
      idempotent: false,
    },
    description: `Execute a workflow by its ID with the provided input data.
The workflow is executed using the caller's credentials and respects RBAC permissions.
Returns the instance ID of the newly created workflow execution that can be used to track progress.

Example invocations:
  # Execute a greeting workflow
  orchestrator:workflow:execute workflowId:"greeting" inputData:{"name":"Alice","language":"English"}
  Output: {
    "instanceId": "abc-123-def-456",
  }
`,
    schema: {
      input: z =>
        z.object({
          workflowId: z
            .string()
            .min(1)
            .describe(
              'The unique identifier of the workflow to execute (e.g. "greeting")',
            ),
          inputData: z
            .record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.null(),
                z.array(z.unknown()),
                z.record(z.string(), z.unknown()),
              ]),
            )
            .describe(
              'Key-value pairs of input data required by the workflow. Check the workflow input schema for required fields.',
            ),
        }),
      output: z =>
        z.object({
          instanceId: z
            .string()
            .optional()
            .describe(
              'The instance ID of the workflow execution. Use with orchestrator:instance:get to check status.',
            ),
          error: z
            .string()
            .optional()
            .describe('Error message if execution failed'),
        }),
    },
    action: async ({ input, credentials }) => {
      try {
        const result = await executeWorkflow({
          discovery,
          auth,
          logger,
          credentials,
          workflowId: input.workflowId,
          inputData: input.inputData,
        });
        return {
          output: {
            instanceId: result.id,
            error: undefined,
          },
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(
          `orchestrator:workflow:execute: Error executing workflow '${input.workflowId}':`,
          error instanceof Error ? error : undefined,
        );
        return {
          output: {
            instanceId: undefined,
            error: message,
          },
        };
      }
    },
  });
};

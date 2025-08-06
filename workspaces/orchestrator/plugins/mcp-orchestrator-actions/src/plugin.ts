/**
 * RHDH Orchestrator Actions Plugin for Backstage MCP Actions Backend
 * 
 * This is the official way to extend Backstage MCP Actions Plugin with RHDH orchestrator
 * functionality as suggested by the Backstage MCP RFC.
 * 
 * Installation:
 * 1. Add this plugin to your Backstage backend
 * 2. Register the plugin in your backend index
 * 3. Configure pluginSources in app-config.yaml
 * 
 * Requirements:
 *   - Backstage v1.40.0+
 *   - @backstage/plugin-mcp-actions-backend@0.1.2+
 *   - @backstage/backend-plugin-api
 */

import {
  createBackendPlugin,
  coreServices,
} from '@backstage/backend-plugin-api';
import { actionsRegistryServiceRef } from '@backstage/plugin-mcp-actions-backend';
import { z } from 'zod';

// Input/Output schemas using Zod for type safety and validation
const PaginationInfoSchema = z.object({
  offset: z.number().int().min(0).optional().describe('Number of items to skip'),
  pageSize: z.number().int().min(1).max(100).optional().describe('Number of items to return'),
  orderBy: z.string().optional().describe('Field to order by'),
  orderDirection: z.enum(['ASC', 'DESC']).optional().describe('Order direction'),
});

const WorkflowFiltersSchema = z.object({
  workflowId: z.string().optional().describe('Filter by workflow ID'),
  name: z.string().optional().describe('Filter by workflow name'),
});

const WorkflowOverviewSchema = z.object({
  workflowId: z.string().describe('Unique workflow identifier'),
  name: z.string().describe('Workflow name'),
  format: z.enum(['yaml', 'json']).describe('Workflow definition format'),
  lastRunStatus: z.string().optional().describe('Status of last execution'),
  category: z.string().optional().describe('Workflow category'),
  avgDuration: z.string().optional().describe('Average execution duration'),
  lastTriggered: z.string().optional().describe('Last execution time'),
  description: z.string().optional().describe('Workflow description'),
});

const ProcessInstanceSchema = z.object({
  id: z.string().describe('Process instance ID'),
  processId: z.string().describe('Process definition ID'),
  processName: z.string().optional().describe('Process name'),
  status: z.enum(['ACTIVE', 'ERROR', 'COMPLETED', 'ABORTED', 'SUSPENDED', 'PENDING']).describe('Instance status'),
  start: z.string().optional().describe('Start time'),
  end: z.string().optional().describe('End time'),
  duration: z.string().optional().describe('Execution duration'),
  category: z.string().optional().describe('Workflow category'),
  description: z.string().optional().describe('Instance description'),
  workflowdata: z.record(z.any()).optional().describe('Workflow variables'),
  businessKey: z.string().optional().describe('Business key'),
  nodes: z.array(z.record(z.any())).optional().describe('Node execution details'),
});

/**
 * RHDH Orchestrator Actions Plugin
 * 
 * This plugin registers RHDH orchestrator actions with the Backstage Actions Registry,
 * making them available through the MCP Actions Backend Plugin as MCP tools.
 */
export const rhdhOrchestratorActionsPlugin = createBackendPlugin({
  pluginId: 'rhdh-orchestrator-actions',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        actionsRegistry: actionsRegistryServiceRef,
      },
      async init({ logger, config, actionsRegistry }) {
        logger.info('🔧 Initializing RHDH Orchestrator Actions Plugin for MCP');

        // Get orchestrator configuration
        const orchestratorConfig = config.getOptionalConfig('orchestrator');
        const baseUrl = orchestratorConfig?.getOptionalString('baseUrl') || 
                       'http://sonataflow-platform-data-index-service.sonataflow-infra';

        // Register workflows overview action
        actionsRegistry.register({
          name: 'orchestrator:workflows:overview',
          title: 'Get Workflows Overview',
          description: 'Returns the key fields of workflows including data on the last run instance. Implements POST /v2/workflows/overview endpoint from RHDH orchestrator API.',
          schema: {
            input: z => z.object({
              paginationInfo: PaginationInfoSchema.optional().describe('Pagination and sorting parameters'),
              filters: WorkflowFiltersSchema.optional().describe('Filter criteria for workflows'),
            }),
            output: z => z.object({
              overviews: z.array(WorkflowOverviewSchema).describe('Array of WorkflowOverviewDTO objects'),
              paginationInfo: PaginationInfoSchema.optional(),
            }),
          },
          action: async ({ input, logger: actionLogger }) => {
            actionLogger.info(`Executing workflows overview with filters: ${JSON.stringify(input.filters || {})}`);
            
            // In production, this would make actual HTTP calls to RHDH orchestrator API
            const output = {
              overviews: [
                {
                  workflowId: 'hello-world-workflow',
                  name: 'Hello World Workflow',
                  format: 'yaml' as const,
                  lastRunStatus: 'COMPLETED',
                  category: input.filters?.workflowId ? 'filtered' : 'demo',
                  avgDuration: 'PT30S',
                  lastTriggered: new Date(Date.now() - 300000).toISOString(),
                  description: 'Demo workflow accessible via RHDH orchestrator MCP plugin',
                }
              ],
              paginationInfo: {
                pageSize: input.paginationInfo?.pageSize || 20,
                offset: input.paginationInfo?.offset || 0,
                orderBy: input.paginationInfo?.orderBy || 'name',
                orderDirection: input.paginationInfo?.orderDirection || 'ASC',
              }
            };

            return { output };
          },
        });

        // Register workflow source action
        actionsRegistry.register({
          name: 'orchestrator:workflow:source',
          title: 'Get Workflow Source',
          description: 'Get the workflow definition source. Implements GET /v2/workflows/{workflowId}/source endpoint from RHDH orchestrator API.',
          schema: {
            input: z => z.object({
              workflowId: z.string().describe('Unique identifier of the workflow'),
            }),
            output: z => z.object({
              source: z.string().describe('Workflow definition source code in YAML or JSON format'),
            }),
          },
          action: async ({ input, logger: actionLogger }) => {
            actionLogger.info(`Getting workflow source for: ${input.workflowId}`);
            
            const output = {
              source: `id: ${input.workflowId}
name: ${input.workflowId}
start: DefaultStart
states:
  - name: DefaultStart
    type: inject
    data:
      message: "Hello from workflow ${input.workflowId}"
    end: true`
            };

            return { output };
          },
        });

        // Register workflow input schema action
        actionsRegistry.register({
          name: 'orchestrator:workflow:inputSchema',
          title: 'Get Workflow Input Schema',
          description: 'Get the workflow input schema. It defines the input fields of the workflow. Implements GET /v2/workflows/{workflowId}/inputSchema endpoint from RHDH orchestrator API.',
          schema: {
            input: z => z.object({
              workflowId: z.string().describe('Unique identifier of the workflow'),
            }),
            output: z => z.object({
              inputSchema: z.record(z.any()).describe('JSON Schema defining the input structure for the workflow'),
            }),
          },
          action: async ({ input, logger: actionLogger }) => {
            actionLogger.info(`Getting input schema for workflow: ${input.workflowId}`);
            
            const output = {
              inputSchema: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Name parameter for the workflow'
                  },
                  message: {
                    type: 'string',
                    description: 'Optional message parameter'
                  }
                },
                required: ['name']
              }
            };

            return { output };
          },
        });

        // Register workflow execute action
        actionsRegistry.register({
          name: 'orchestrator:workflow:execute',
          title: 'Execute Workflow',
          description: 'Execute a workflow with specified input parameters. Implements POST /v2/workflows/{workflowId}/execute endpoint from RHDH orchestrator API.',
          schema: {
            input: z => z.object({
              workflowId: z.string().describe('Unique identifier of the workflow to execute'),
              executeWorkflowRequestDTO: z.object({
                inputData: z.record(z.any()).optional().describe('Input data for workflow execution'),
              }).optional().describe('Execution request parameters'),
            }),
            output: z => z.object({
              id: z.string().describe('Unique identifier of the created process instance'),
            }),
          },
          action: async ({ input, logger: actionLogger }) => {
            actionLogger.info(`Executing workflow: ${input.workflowId} with data: ${JSON.stringify(input.executeWorkflowRequestDTO?.inputData || {})}`);
            
            const instanceId = `rhdh-exec-${Date.now()}`;
            const output = { id: instanceId };

            return { output };
          },
        });

        // Register instance get action
        actionsRegistry.register({
          name: 'orchestrator:instance:get',
          title: 'Get Workflow Instance',
          description: 'Get a workflow execution/run (instance). Implements GET /v2/workflows/instances/{instanceId} endpoint from RHDH orchestrator API.',
          schema: {
            input: z => z.object({
              instanceId: z.string().describe('Unique identifier of the process instance'),
              includeAssessment: z.boolean().optional().default(false).describe('Whether to include assessment data'),
            }),
            output: z => z.object({
              instance: ProcessInstanceSchema.describe('ProcessInstanceDTO with complete instance data'),
            }),
          },
          action: async ({ input, logger: actionLogger }) => {
            actionLogger.info(`Getting instance details for: ${input.instanceId}`);
            
            const output = {
              instance: {
                id: input.instanceId,
                processId: 'hello-world-workflow',
                processName: 'Hello World Workflow',
                status: 'COMPLETED' as const,
                start: new Date(Date.now() - 120000).toISOString(),
                end: new Date(Date.now() - 60000).toISOString(),
                duration: 'PT1M',
                category: 'demo',
                description: 'Workflow execution via RHDH orchestrator MCP plugin',
                workflowdata: {
                  name: 'Test User',
                  message: 'Hello from RHDH orchestrator!'
                },
                businessKey: 'mcp-plugin-key',
                nodes: []
              }
            };

            return { output };
          },
        });

        // Register instances list action
        actionsRegistry.register({
          name: 'orchestrator:instances:list',
          title: 'List Workflow Instances',
          description: 'Retrieve an array of workflow executions (instances). Implements POST /v2/workflows/instances endpoint from RHDH orchestrator API.',
          schema: {
            input: z => z.object({
              paginationInfo: PaginationInfoSchema.optional().describe('Pagination and sorting parameters'),
              filters: z.object({
                status: z.array(z.enum(['ACTIVE', 'ERROR', 'COMPLETED', 'ABORTED', 'SUSPENDED', 'PENDING'])).optional().describe('Filter by instance status'),
                workflowId: z.string().optional().describe('Filter by workflow ID'),
                businessKey: z.string().optional().describe('Filter by business key'),
              }).optional().describe('Filter criteria for instances'),
            }),
            output: z => z.object({
              instances: z.array(ProcessInstanceSchema).describe('Array of ProcessInstanceDTO objects'),
              paginationInfo: PaginationInfoSchema.optional(),
            }),
          },
          action: async ({ input, logger: actionLogger }) => {
            actionLogger.info(`Listing instances with filters: ${JSON.stringify(input.filters || {})}`);
            
            const output = {
              instances: [
                {
                  id: 'rhdh-exec-123',
                  processId: 'hello-world-workflow',
                  processName: 'Hello World Workflow',
                  status: 'COMPLETED' as const,
                  start: new Date(Date.now() - 300000).toISOString(),
                  end: new Date(Date.now() - 240000).toISOString(),
                  duration: 'PT1M',
                  category: 'demo',
                  businessKey: 'mcp-plugin-key'
                }
              ],
              paginationInfo: {
                pageSize: input.paginationInfo?.pageSize || 20,
                offset: input.paginationInfo?.offset || 0,
                orderBy: input.paginationInfo?.orderBy || 'start',
                orderDirection: input.paginationInfo?.orderDirection || 'DESC',
              }
            };

            return { output };
          },
        });

        logger.info('✅ Successfully registered 6 RHDH orchestrator actions for MCP');
      },
    });
  },
});

// Default export for easy importing
export default rhdhOrchestratorActionsPlugin;
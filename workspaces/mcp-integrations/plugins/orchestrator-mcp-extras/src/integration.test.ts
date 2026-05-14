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

import * as http from 'http';
import { AddressInfo } from 'net';
import { mockServices, mockCredentials } from '@backstage/backend-test-utils';
import { BackstageCredentials } from '@backstage/backend-plugin-api';
import { createOrchestratorActions } from './actions';

interface RegisteredAction {
  name: string;
  action: (ctx: {
    input: any;
    credentials: BackstageCredentials;
  }) => Promise<{ output: any }>;
}

function createActionsRegistryCapture() {
  const actions: RegisteredAction[] = [];
  return {
    registry: {
      register(opts: any) {
        actions.push({ name: opts.name, action: opts.action });
      },
    },
    getAction(name: string) {
      return actions.find(a => a.name === name);
    },
    get actions() {
      return actions;
    },
  };
}

/**
 * Starts a local HTTP server that simulates the orchestrator backend API.
 * Returns the server and base URL. Caller must close().
 */
function startMockOrchestratorServer(handlers: {
  overviews?: object;
  executeResult?: object;
  instanceResult?: object;
  instancesResult?: object;
  workflowOverview?: object;
  workflowInputSchema?: object;
  statusCode?: number;
  customHandler?: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => boolean;
}): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (handlers.customHandler?.(req, res)) return;

      const url = req.url ?? '';

      if (req.method === 'POST' && url === '/v2/workflows/overview') {
        res.writeHead(handlers.statusCode ?? 200, {
          'Content-Type': 'application/json',
        });
        res.end(
          JSON.stringify(
            handlers.overviews ?? { overviews: [], paginationInfo: {} },
          ),
        );
        return;
      }

      const overviewMatch = url.match(/^\/v2\/workflows\/([^/]+)\/overview$/);
      if (req.method === 'GET' && overviewMatch) {
        res.writeHead(handlers.statusCode ?? 200, {
          'Content-Type': 'application/json',
        });
        res.end(
          JSON.stringify(
            handlers.workflowOverview ?? {
              workflowId: decodeURIComponent(overviewMatch[1]),
              name: 'Test Workflow',
              format: 'yaml',
              isAvailable: true,
            },
          ),
        );
        return;
      }

      const schemaMatch = url.match(/^\/v2\/workflows\/([^/]+)\/inputSchema$/);
      if (req.method === 'GET' && schemaMatch) {
        if (handlers.workflowInputSchema) {
          res.writeHead(handlers.statusCode ?? 200, {
            'Content-Type': 'application/json',
          });
          res.end(JSON.stringify(handlers.workflowInputSchema));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No input schema' }));
        }
        return;
      }

      const executeMatch = url.match(/^\/v2\/workflows\/([^/]+)\/execute$/);
      if (req.method === 'POST' && executeMatch) {
        res.writeHead(handlers.statusCode ?? 200, {
          'Content-Type': 'application/json',
        });
        res.end(
          JSON.stringify(
            handlers.executeResult ?? {
              id: 'test-instance-id',
            },
          ),
        );
        return;
      }

      if (req.method === 'POST' && url === '/v2/workflows/instances') {
        res.writeHead(handlers.statusCode ?? 200, {
          'Content-Type': 'application/json',
        });
        res.end(
          JSON.stringify(
            handlers.instancesResult ?? { items: [], paginationInfo: {} },
          ),
        );
        return;
      }

      const instanceMatch = url.match(/^\/v2\/workflows\/instances\/([^/]+)$/);
      if (req.method === 'GET' && instanceMatch) {
        res.writeHead(handlers.statusCode ?? 200, {
          'Content-Type': 'application/json',
        });
        res.end(
          JSON.stringify(
            handlers.instanceResult ?? {
              id: instanceMatch[1],
              processId: 'greeting',
              state: 'COMPLETED',
              start: '2026-01-15T10:00:00Z',
              end: '2026-01-15T10:00:05Z',
              duration: '5s',
            },
          ),
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `path not found: ${url}` }));
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

const serviceCredentials = mockCredentials.service();

describe('orchestrator-mcp-extras integration', () => {
  let server: http.Server;
  let baseUrl: string;
  let capture: ReturnType<typeof createActionsRegistryCapture>;
  const mockLogger = mockServices.logger.mock();

  afterEach(() => {
    if (server) server.close();
    jest.restoreAllMocks();
  });

  function setupActions(
    handlers: Parameters<typeof startMockOrchestratorServer>[0] = {},
  ) {
    return (async () => {
      const result = await startMockOrchestratorServer(handlers);
      server = result.server;
      baseUrl = result.baseUrl;

      const mockDiscovery = {
        getBaseUrl: jest.fn().mockResolvedValue(baseUrl),
      };
      const mockAuth = {
        getPluginRequestToken: jest
          .fn()
          .mockResolvedValue({ token: 'mock-s2s-token' }),
      };

      capture = createActionsRegistryCapture();

      createOrchestratorActions({
        actionsRegistry: capture.registry as any,
        auth: mockAuth as any,
        discovery: mockDiscovery as any,
        logger: mockLogger,
      });

      return { mockDiscovery, mockAuth };
    })();
  }

  describe('action registration', () => {
    it('should register all five orchestrator actions', async () => {
      await setupActions();

      expect(capture.actions).toHaveLength(5);

      const names = capture.actions.map(a => a.name);
      expect(names).toContain('orchestrator-workflows-list');
      expect(names).toContain('orchestrator-workflow-execute');
      expect(names).toContain('orchestrator-instance-get');
      expect(names).toContain('orchestrator-workflow-get');
      expect(names).toContain('orchestrator-instances-list');
    });
  });

  describe('orchestrator-workflows-list', () => {
    it('should return workflows from mock orchestrator', async () => {
      await setupActions({
        overviews: {
          overviews: [
            {
              workflowId: 'greeting',
              name: 'Greeting Workflow',
              description: 'A greeting workflow',
              format: 'yaml',
              isAvailable: true,
              lastRunStatus: 'COMPLETED',
              lastTriggeredMs: 1700000000000,
            },
          ],
          paginationInfo: {},
        },
      });

      const action = capture.getAction('orchestrator-workflows-list')!;
      const result = await action.action({
        input: {},
        credentials: serviceCredentials,
      });

      expect(result.output.error).toBeUndefined();
      expect(result.output.workflows).toHaveLength(1);
      expect(result.output.workflows[0]).toEqual(
        expect.objectContaining({
          workflowId: 'greeting',
          name: 'Greeting Workflow',
          format: 'yaml',
          isAvailable: true,
        }),
      );
    });

    it('should handle empty workflow list', async () => {
      await setupActions({
        overviews: { overviews: [], paginationInfo: {} },
      });

      const action = capture.getAction('orchestrator-workflows-list')!;
      const result = await action.action({
        input: {},
        credentials: serviceCredentials,
      });

      expect(result.output.error).toBeUndefined();
      expect(result.output.workflows).toEqual([]);
    });

    it('should handle orchestrator server error gracefully', async () => {
      await setupActions({ statusCode: 500 });

      const action = capture.getAction('orchestrator-workflows-list')!;
      const result = await action.action({
        input: {},
        credentials: serviceCredentials,
      });

      expect(result.output.error).toBeDefined();
      expect(result.output.error).toContain('500');
      expect(result.output.workflows).toEqual([]);
    });
  });

  describe('orchestrator-workflow-execute', () => {
    it('should execute a workflow and return instance ID', async () => {
      await setupActions({
        executeResult: { id: 'exec-instance-001' },
      });

      const action = capture.getAction('orchestrator-workflow-execute')!;
      const result = await action.action({
        input: {
          workflowId: 'greeting',
          inputData: { name: 'IntegrationTest', language: 'English' },
        },
        credentials: serviceCredentials,
      });

      expect(result.output.error).toBeUndefined();
      expect(result.output.instanceId).toBe('exec-instance-001');
    });

    it('should correctly URL-encode workflow IDs with special characters', async () => {
      let capturedUrl = '';
      await setupActions({
        customHandler: (req, res) => {
          capturedUrl = req.url ?? '';
          if (req.method === 'POST' && req.url?.includes('/execute')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: 'encoded-instance' }));
            return true;
          }
          return false;
        },
      });

      const action = capture.getAction('orchestrator-workflow-execute')!;
      await action.action({
        input: {
          workflowId: 'workflow/with spaces',
          inputData: {},
        },
        credentials: serviceCredentials,
      });

      expect(capturedUrl).toBe(
        '/v2/workflows/workflow%2Fwith%20spaces/execute',
      );
    });

    it('should handle execution failure', async () => {
      await setupActions({ statusCode: 500 });

      const action = capture.getAction('orchestrator-workflow-execute')!;
      const result = await action.action({
        input: { workflowId: 'bad-workflow', inputData: {} },
        credentials: serviceCredentials,
      });

      expect(result.output.error).toBeDefined();
      expect(result.output.error).toContain('bad-workflow');
      expect(result.output.instanceId).toBeUndefined();
    });
  });

  describe('orchestrator-instance-get', () => {
    it('should fetch instance details', async () => {
      await setupActions({
        instanceResult: {
          id: 'inst-999',
          processId: 'greeting',
          processName: 'Greeting Workflow',
          state: 'COMPLETED',
          start: '2026-04-28T10:00:00Z',
          end: '2026-04-28T10:00:05Z',
          duration: '0 hours, 0 minutes, 5.000 seconds',
          description: 'YAML based greeting workflow',
          workflowdata: {
            greeting: 'Hello from YAML Workflow',
            name: 'Alice',
          },
        },
      });

      const action = capture.getAction('orchestrator-instance-get')!;
      const result = await action.action({
        input: { instanceId: 'inst-999' },
        credentials: serviceCredentials,
      });

      expect(result.output.error).toBeUndefined();
      expect(result.output.id).toBe('inst-999');
      expect(result.output.workflowId).toBe('greeting');
      expect(result.output.status).toBe('COMPLETED');
      expect(result.output.startedAt).toBe('2026-04-28T10:00:00Z');
      expect(result.output.completedAt).toBe('2026-04-28T10:00:05Z');
      expect(result.output.workflowdata).toContain('Hello from YAML Workflow');
    });

    it('should handle non-existent instance', async () => {
      await setupActions({
        customHandler: (req, res) => {
          if (
            req.method === 'GET' &&
            req.url?.includes('/v2/workflows/instances/')
          ) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Process instance not found' }));
            return true;
          }
          return false;
        },
      });

      const action = capture.getAction('orchestrator-instance-get')!;
      const result = await action.action({
        input: { instanceId: 'nonexistent-id' },
        credentials: serviceCredentials,
      });

      expect(result.output.error).toBeDefined();
      expect(result.output.error).toContain('nonexistent-id');
      expect(result.output.id).toBeUndefined();
    });
  });

  describe('orchestrator-workflow-get', () => {
    it('should return workflow overview and input schema', async () => {
      await setupActions({
        workflowOverview: {
          workflowId: 'greeting',
          name: 'Greeting Workflow',
          description: 'A greeting workflow',
          format: 'yaml',
          isAvailable: true,
          lastRunStatus: 'COMPLETED',
          lastTriggeredMs: 1700000000000,
        },
        workflowInputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name to greet' },
            language: { type: 'string', description: 'Language' },
          },
          required: ['name'],
        },
      });

      const action = capture.getAction('orchestrator-workflow-get')!;
      const result = await action.action({
        input: { workflowId: 'greeting' },
        credentials: serviceCredentials,
      });

      expect(result.output.error).toBeUndefined();
      expect(result.output.workflowId).toBe('greeting');
      expect(result.output.name).toBe('Greeting Workflow');
      expect(result.output.format).toBe('yaml');
      expect(result.output.isAvailable).toBe(true);

      const schema = JSON.parse(result.output.inputSchema);
      expect(schema.type).toBe('object');
      expect(schema.properties.name.type).toBe('string');
      expect(schema.required).toContain('name');
    });

    it('should return overview without schema when inputSchema is unavailable', async () => {
      await setupActions({
        workflowOverview: {
          workflowId: 'simple',
          name: 'Simple Workflow',
          format: 'json',
          isAvailable: true,
        },
      });

      const action = capture.getAction('orchestrator-workflow-get')!;
      const result = await action.action({
        input: { workflowId: 'simple' },
        credentials: serviceCredentials,
      });

      expect(result.output.error).toBeUndefined();
      expect(result.output.workflowId).toBe('simple');
      expect(result.output.inputSchema).toBeUndefined();
    });

    it('should handle non-existent workflow', async () => {
      await setupActions({
        customHandler: (req, res) => {
          if (req.method === 'GET' && req.url?.includes('/overview')) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Workflow not found' }));
            return true;
          }
          if (req.method === 'GET' && req.url?.includes('/inputSchema')) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Workflow not found' }));
            return true;
          }
          return false;
        },
      });

      const action = capture.getAction('orchestrator-workflow-get')!;
      const result = await action.action({
        input: { workflowId: 'nonexistent' },
        credentials: serviceCredentials,
      });

      expect(result.output.error).toBeDefined();
      expect(result.output.error).toContain('nonexistent');
      expect(result.output.workflowId).toBeUndefined();
    });
  });

  describe('orchestrator-instances-list', () => {
    it('should return instances from mock orchestrator', async () => {
      await setupActions({
        instancesResult: {
          items: [
            {
              id: 'inst-001',
              processId: 'greeting',
              processName: 'Greeting Workflow',
              state: 'COMPLETED',
              start: '2026-04-28T10:00:00Z',
              end: '2026-04-28T10:00:05Z',
              description: 'Greeting run',
            },
            {
              id: 'inst-002',
              processId: 'create-ocp-project',
              state: 'ACTIVE',
              start: '2026-04-28T11:00:00Z',
            },
          ],
          paginationInfo: {},
        },
      });

      const action = capture.getAction('orchestrator-instances-list')!;
      const result = await action.action({
        input: {},
        credentials: serviceCredentials,
      });

      expect(result.output.error).toBeUndefined();
      expect(result.output.instances).toHaveLength(2);
      expect(result.output.instances[0]).toEqual(
        expect.objectContaining({
          id: 'inst-001',
          workflowId: 'greeting',
          status: 'COMPLETED',
          startedAt: '2026-04-28T10:00:00Z',
          completedAt: '2026-04-28T10:00:05Z',
        }),
      );
      expect(result.output.instances[1]).toEqual(
        expect.objectContaining({
          id: 'inst-002',
          workflowId: 'create-ocp-project',
          status: 'ACTIVE',
        }),
      );
    });

    it('should handle empty instances list', async () => {
      await setupActions({
        instancesResult: { items: [], paginationInfo: {} },
      });

      const action = capture.getAction('orchestrator-instances-list')!;
      const result = await action.action({
        input: {},
        credentials: serviceCredentials,
      });

      expect(result.output.error).toBeUndefined();
      expect(result.output.instances).toEqual([]);
    });

    it('should handle orchestrator server error gracefully', async () => {
      await setupActions({
        customHandler: (req, res) => {
          if (req.method === 'POST' && req.url === '/v2/workflows/instances') {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
            return true;
          }
          return false;
        },
      });

      const action = capture.getAction('orchestrator-instances-list')!;
      const result = await action.action({
        input: {},
        credentials: serviceCredentials,
      });

      expect(result.output.error).toBeDefined();
      expect(result.output.error).toContain('500');
      expect(result.output.instances).toEqual([]);
    });
  });

  describe('full workflow lifecycle', () => {
    it('should list → execute → get instance in sequence', async () => {
      const instanceId = 'lifecycle-instance-001';

      await setupActions({
        overviews: {
          overviews: [
            {
              workflowId: 'greeting',
              name: 'Greeting',
              format: 'yaml',
              isAvailable: true,
            },
          ],
          paginationInfo: {},
        },
        executeResult: { id: instanceId },
        instanceResult: {
          id: instanceId,
          processId: 'greeting',
          state: 'COMPLETED',
          start: '2026-04-28T12:00:00Z',
          end: '2026-04-28T12:00:01Z',
          workflowdata: { greeting: 'Hello' },
        },
      });

      const listAction = capture.getAction('orchestrator-workflows-list')!;
      const listResult = await listAction.action({
        input: {},
        credentials: serviceCredentials,
      });
      expect(listResult.output.workflows).toHaveLength(1);
      expect(listResult.output.workflows[0].workflowId).toBe('greeting');

      const execAction = capture.getAction('orchestrator-workflow-execute')!;
      const execResult = await execAction.action({
        input: {
          workflowId: 'greeting',
          inputData: { name: 'Lifecycle', language: 'English' },
        },
        credentials: serviceCredentials,
      });
      expect(execResult.output.instanceId).toBe(instanceId);

      const getAction = capture.getAction('orchestrator-instance-get')!;
      const getResult = await getAction.action({
        input: { instanceId },
        credentials: serviceCredentials,
      });
      expect(getResult.output.status).toBe('COMPLETED');
      expect(getResult.output.workflowId).toBe('greeting');
    });
  });

  describe('authentication flow', () => {
    it('should pass correct service-to-service token to orchestrator', async () => {
      let capturedAuthHeader = '';
      await setupActions({
        customHandler: (req, res) => {
          capturedAuthHeader = req.headers.authorization ?? '';
          if (req.method === 'POST' && req.url === '/v2/workflows/overview') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ overviews: [], paginationInfo: {} }));
            return true;
          }
          return false;
        },
      });

      const action = capture.getAction('orchestrator-workflows-list')!;
      await action.action({ input: {}, credentials: serviceCredentials });

      expect(capturedAuthHeader).toBe('Bearer mock-s2s-token');
    });

    it('should request token on behalf of caller credentials', async () => {
      const { mockAuth } = await setupActions();

      const action = capture.getAction('orchestrator-workflows-list')!;
      await action.action({ input: {}, credentials: serviceCredentials });

      expect(mockAuth.getPluginRequestToken).toHaveBeenCalledWith({
        onBehalfOf: serviceCredentials,
        targetPluginId: 'orchestrator',
      });
    });
  });
});

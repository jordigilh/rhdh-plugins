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
import { actionsRegistryServiceMock } from '@backstage/backend-test-utils/alpha';
import { mockServices } from '@backstage/backend-test-utils';
import { createListWorkflowsAction } from './createListWorkflowsAction';
import { createExecuteWorkflowAction } from './createExecuteWorkflowAction';
import { createGetInstanceAction } from './createGetInstanceAction';

describe('orchestrator actions (actionsRegistryServiceMock)', () => {
  const mockLogger = mockServices.logger.mock();
  let mockAuth: ReturnType<typeof mockServices.auth.mock>;
  let mockDiscovery: { getBaseUrl: jest.Mock };

  beforeEach(() => {
    jest.resetAllMocks();
    mockAuth = mockServices.auth.mock();
    mockAuth.getPluginRequestToken.mockResolvedValue({
      token: 'mock-s2s-token',
    });
    mockDiscovery = {
      getBaseUrl: jest
        .fn()
        .mockResolvedValue('http://localhost:7007/api/orchestrator'),
    };
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('orchestrator:workflows:list', () => {
    function setup() {
      const registry = actionsRegistryServiceMock();
      createListWorkflowsAction({
        actionsRegistry: registry,
        auth: mockAuth,
        discovery: mockDiscovery as any,
        logger: mockLogger,
      });
      return registry;
    }

    it('should return mapped workflow summaries on success', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
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
              {
                workflowId: 'onboarding',
                format: 'json',
                isAvailable: false,
              },
            ],
            paginationInfo: {},
          }),
      });

      const registry = setup();
      const result = await registry.invoke({
        id: 'test:orchestrator:workflows:list',
        input: {},
      });

      expect(result.output.workflows).toHaveLength(2);
      expect(result.output.workflows[0]).toEqual(
        expect.objectContaining({
          workflowId: 'greeting',
          name: 'Greeting Workflow',
          format: 'yaml',
          isAvailable: true,
          lastRunStatus: 'COMPLETED',
          lastTriggeredMs: 1700000000000,
        }),
      );
      expect(result.output.workflows[1]).toEqual(
        expect.objectContaining({
          workflowId: 'onboarding',
          format: 'json',
          isAvailable: false,
        }),
      );
      expect(result.output.error).toBeUndefined();
    });

    it('should return empty workflows array when none exist', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ overviews: [], paginationInfo: {} }),
      });

      const registry = setup();
      const result = await registry.invoke({
        id: 'test:orchestrator:workflows:list',
        input: {},
      });

      expect(result.output.workflows).toEqual([]);
      expect(result.output.error).toBeUndefined();
    });

    it('should return error in output on server failure', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      const registry = setup();
      const result = await registry.invoke({
        id: 'test:orchestrator:workflows:list',
        input: {},
      });

      expect(result.output.error).toContain('500');
      expect(result.output.workflows).toEqual([]);
    });

    it('should pass caller credentials through to auth service', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ overviews: [], paginationInfo: {} }),
      });

      const registry = setup();
      await registry.invoke({
        id: 'test:orchestrator:workflows:list',
        input: {},
      });

      expect(mockAuth.getPluginRequestToken).toHaveBeenCalledWith(
        expect.objectContaining({
          targetPluginId: 'orchestrator',
        }),
      );
    });
  });

  describe('orchestrator:workflow:execute', () => {
    function setup() {
      const registry = actionsRegistryServiceMock();
      createExecuteWorkflowAction({
        actionsRegistry: registry,
        auth: mockAuth,
        discovery: mockDiscovery as any,
        logger: mockLogger,
      });
      return registry;
    }

    it('should execute a workflow and return instance ID', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'exec-instance-001' }),
      });

      const registry = setup();
      const result = await registry.invoke({
        id: 'test:orchestrator:workflow:execute',
        input: {
          workflowId: 'greeting',
          inputData: { name: 'Alice', language: 'English' },
        },
      });

      expect(result.output.instanceId).toBe('exec-instance-001');
      expect(result.output.error).toBeUndefined();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/orchestrator/v2/workflows/greeting/execute',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            inputData: { name: 'Alice', language: 'English' },
          }),
        }),
      );
    });

    it('should accept nested objects in inputData', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'nested-instance' }),
      });

      const registry = setup();
      const result = await registry.invoke({
        id: 'test:orchestrator:workflow:execute',
        input: {
          workflowId: 'complex-workflow',
          inputData: {
            name: 'Bob',
            config: { timeout: 30, retries: 3 },
            tags: ['prod', 'critical'],
          },
        },
      });

      expect(result.output.instanceId).toBe('nested-instance');
      expect(result.output.error).toBeUndefined();
    });

    it('should return error in output on server failure', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Exceeded maximum number of retries'),
      });

      const registry = setup();
      const result = await registry.invoke({
        id: 'test:orchestrator:workflow:execute',
        input: { workflowId: 'greeting', inputData: {} },
      });

      expect(result.output.error).toContain('greeting');
      expect(result.output.error).toContain('500');
      expect(result.output.instanceId).toBeUndefined();
    });

    it('should URL-encode the workflow ID in the request path', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'encoded-instance' }),
      });

      const registry = setup();
      await registry.invoke({
        id: 'test:orchestrator:workflow:execute',
        input: {
          workflowId: 'workflow/with spaces',
          inputData: {},
        },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          '/v2/workflows/workflow%2Fwith%20spaces/execute',
        ),
        expect.anything(),
      );
    });
  });

  describe('orchestrator:instance:get', () => {
    function setup() {
      const registry = actionsRegistryServiceMock();
      createGetInstanceAction({
        actionsRegistry: registry,
        auth: mockAuth,
        discovery: mockDiscovery as any,
        logger: mockLogger,
      });
      return registry;
    }

    it('should return mapped instance details on success', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'inst-999',
            processId: 'greeting',
            processName: 'Greeting Workflow',
            state: 'COMPLETED',
            start: '2026-04-28T10:00:00Z',
            end: '2026-04-28T10:00:05Z',
            duration: '5s',
            description: 'Greeting run',
            workflowdata: {
              greeting: 'Hello from YAML Workflow',
              name: 'Alice',
            },
          }),
      });

      const registry = setup();
      const result = await registry.invoke({
        id: 'test:orchestrator:instance:get',
        input: { instanceId: 'inst-999' },
      });

      expect(result.output.id).toBe('inst-999');
      expect(result.output.workflowId).toBe('greeting');
      expect(result.output.status).toBe('COMPLETED');
      expect(result.output.startedAt).toBe('2026-04-28T10:00:00Z');
      expect(result.output.completedAt).toBe('2026-04-28T10:00:05Z');
      expect(result.output.duration).toBe('5s');
      expect(result.output.description).toBe('Greeting run');
      expect(result.output.error).toBeUndefined();

      const workflowdata = JSON.parse(result.output.workflowdata);
      expect(workflowdata.greeting).toBe('Hello from YAML Workflow');
    });

    it('should return error in output for non-existent instance', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Process instance not found'),
      });

      const registry = setup();
      const result = await registry.invoke({
        id: 'test:orchestrator:instance:get',
        input: { instanceId: 'nonexistent-id' },
      });

      expect(result.output.error).toContain('nonexistent-id');
      expect(result.output.error).toContain('404');
      expect(result.output.id).toBeUndefined();
    });

    it('should JSON-encode workflowdata in the output', async () => {
      const workflowdata = { result: 'success', nested: { key: 'value' } };
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'inst-json',
            processId: 'test-wf',
            state: 'COMPLETED',
            workflowdata,
          }),
      });

      const registry = setup();
      const result = await registry.invoke({
        id: 'test:orchestrator:instance:get',
        input: { instanceId: 'inst-json' },
      });

      expect(typeof result.output.workflowdata).toBe('string');
      expect(JSON.parse(result.output.workflowdata)).toEqual(workflowdata);
    });

    it('should return undefined workflowdata when instance has none', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'inst-no-data',
            processId: 'test-wf',
            state: 'ACTIVE',
          }),
      });

      const registry = setup();
      const result = await registry.invoke({
        id: 'test:orchestrator:instance:get',
        input: { instanceId: 'inst-no-data' },
      });

      expect(result.output.workflowdata).toBeUndefined();
      expect(result.output.status).toBe('ACTIVE');
    });
  });

  describe('input schema validation', () => {
    it('should reject orchestrator:workflows:list with non-object input', async () => {
      const registry = actionsRegistryServiceMock();
      createListWorkflowsAction({
        actionsRegistry: registry,
        auth: mockAuth,
        discovery: mockDiscovery as any,
        logger: mockLogger,
      });

      await expect(
        registry.invoke({
          id: 'test:orchestrator:workflows:list',
          input: 'not-an-object' as any,
        }),
      ).rejects.toThrow();
    });

    it('should reject orchestrator:workflow:execute with missing workflowId', async () => {
      const registry = actionsRegistryServiceMock();
      createExecuteWorkflowAction({
        actionsRegistry: registry,
        auth: mockAuth,
        discovery: mockDiscovery as any,
        logger: mockLogger,
      });

      await expect(
        registry.invoke({
          id: 'test:orchestrator:workflow:execute',
          input: { inputData: { name: 'test' } },
        }),
      ).rejects.toThrow();
    });

    it('should reject orchestrator:workflow:execute with empty workflowId', async () => {
      const registry = actionsRegistryServiceMock();
      createExecuteWorkflowAction({
        actionsRegistry: registry,
        auth: mockAuth,
        discovery: mockDiscovery as any,
        logger: mockLogger,
      });

      await expect(
        registry.invoke({
          id: 'test:orchestrator:workflow:execute',
          input: { workflowId: '', inputData: {} },
        }),
      ).rejects.toThrow();
    });

    it('should reject orchestrator:workflow:execute with non-string workflowId', async () => {
      const registry = actionsRegistryServiceMock();
      createExecuteWorkflowAction({
        actionsRegistry: registry,
        auth: mockAuth,
        discovery: mockDiscovery as any,
        logger: mockLogger,
      });

      await expect(
        registry.invoke({
          id: 'test:orchestrator:workflow:execute',
          input: { workflowId: 123, inputData: {} },
        }),
      ).rejects.toThrow();
    });

    it('should reject orchestrator:workflow:execute with missing inputData', async () => {
      const registry = actionsRegistryServiceMock();
      createExecuteWorkflowAction({
        actionsRegistry: registry,
        auth: mockAuth,
        discovery: mockDiscovery as any,
        logger: mockLogger,
      });

      await expect(
        registry.invoke({
          id: 'test:orchestrator:workflow:execute',
          input: { workflowId: 'greeting' },
        }),
      ).rejects.toThrow();
    });

    it('should reject orchestrator:instance:get with missing instanceId', async () => {
      const registry = actionsRegistryServiceMock();
      createGetInstanceAction({
        actionsRegistry: registry,
        auth: mockAuth,
        discovery: mockDiscovery as any,
        logger: mockLogger,
      });

      await expect(
        registry.invoke({
          id: 'test:orchestrator:instance:get',
          input: {},
        }),
      ).rejects.toThrow();
    });

    it('should reject orchestrator:instance:get with empty instanceId', async () => {
      const registry = actionsRegistryServiceMock();
      createGetInstanceAction({
        actionsRegistry: registry,
        auth: mockAuth,
        discovery: mockDiscovery as any,
        logger: mockLogger,
      });

      await expect(
        registry.invoke({
          id: 'test:orchestrator:instance:get',
          input: { instanceId: '' },
        }),
      ).rejects.toThrow();
    });

    it('should reject orchestrator:instance:get with non-string instanceId', async () => {
      const registry = actionsRegistryServiceMock();
      createGetInstanceAction({
        actionsRegistry: registry,
        auth: mockAuth,
        discovery: mockDiscovery as any,
        logger: mockLogger,
      });

      await expect(
        registry.invoke({
          id: 'test:orchestrator:instance:get',
          input: { instanceId: 42 },
        }),
      ).rejects.toThrow();
    });
  });
});

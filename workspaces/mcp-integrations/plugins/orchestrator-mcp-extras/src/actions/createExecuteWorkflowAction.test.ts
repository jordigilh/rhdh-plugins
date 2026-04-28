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
import { executeWorkflow } from './createExecuteWorkflowAction';
import { mockServices, mockCredentials } from '@backstage/backend-test-utils';

describe('createExecuteWorkflowAction', () => {
  describe('executeWorkflow', () => {
    const mockLogger = mockServices.logger.mock();
    const serviceCredentials = mockCredentials.service();

    let mockDiscovery: { getBaseUrl: jest.Mock };
    let mockAuth: { getPluginRequestToken: jest.Mock };

    beforeEach(() => {
      jest.clearAllMocks();
      mockDiscovery = {
        getBaseUrl: jest
          .fn()
          .mockResolvedValue('http://localhost:7007/api/orchestrator'),
      };
      mockAuth = {
        getPluginRequestToken: jest
          .fn()
          .mockResolvedValue({ token: 'mock-service-token' }),
      };
      global.fetch = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should execute a workflow and return instance ID', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'instance-abc-123' }),
      });

      const result = await executeWorkflow({
        discovery: mockDiscovery as any,
        auth: mockAuth as any,
        logger: mockLogger,
        credentials: serviceCredentials,
        workflowId: 'greeting',
        inputData: { name: 'Alice', language: 'English' },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/orchestrator/v2/workflows/greeting/execute',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            inputData: { name: 'Alice', language: 'English' },
          }),
        }),
      );
      expect(result.id).toBe('instance-abc-123');
    });

    it('should URL-encode the workflow ID', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'instance-456' }),
      });

      await executeWorkflow({
        discovery: mockDiscovery as any,
        auth: mockAuth as any,
        logger: mockLogger,
        credentials: serviceCredentials,
        workflowId: 'my workflow/v2',
        inputData: {},
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/orchestrator/v2/workflows/my%20workflow%2Fv2/execute',
        expect.anything(),
      );
    });

    it('should throw on HTTP error response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        text: () =>
          Promise.resolve('{"error":"Exceeded maximum number of retries"}'),
      });

      await expect(
        executeWorkflow({
          discovery: mockDiscovery as any,
          auth: mockAuth as any,
          logger: mockLogger,
          credentials: serviceCredentials,
          workflowId: 'greeting',
          inputData: { name: 'Bob' },
        }),
      ).rejects.toThrow("Failed to execute workflow 'greeting': 500");
    });

    it('should throw on network failure', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(
        executeWorkflow({
          discovery: mockDiscovery as any,
          auth: mockAuth as any,
          logger: mockLogger,
          credentials: serviceCredentials,
          workflowId: 'greeting',
          inputData: {},
        }),
      ).rejects.toThrow('Network error');
    });

    it('should pass empty inputData correctly', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'instance-empty' }),
      });

      await executeWorkflow({
        discovery: mockDiscovery as any,
        auth: mockAuth as any,
        logger: mockLogger,
        credentials: serviceCredentials,
        workflowId: 'no-input-workflow',
        inputData: {},
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/no-input-workflow/execute'),
        expect.objectContaining({
          body: JSON.stringify({ inputData: {} }),
        }),
      );
    });
  });
});

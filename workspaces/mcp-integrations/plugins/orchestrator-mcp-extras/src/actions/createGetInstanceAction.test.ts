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
import { fetchInstance } from './createGetInstanceAction';
import { mockServices, mockCredentials } from '@backstage/backend-test-utils';

describe('createGetInstanceAction', () => {
  describe('fetchInstance', () => {
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

    it('should return a completed instance', async () => {
      const mockInstance = {
        id: 'instance-abc-123',
        processId: 'greeting',
        processName: 'Greeting Workflow',
        state: 'COMPLETED',
        start: '2025-01-15T10:30:00Z',
        end: '2025-01-15T10:30:05Z',
        duration: 'PT5S',
        description: 'Greeting run',
        workflowdata: {
          greeting: 'Hello from YAML Workflow',
          result: { completedWith: 'success' },
        },
        nodes: [],
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockInstance),
      });

      const result = await fetchInstance({
        discovery: mockDiscovery as any,
        auth: mockAuth as any,
        logger: mockLogger,
        credentials: serviceCredentials,
        instanceId: 'instance-abc-123',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/orchestrator/v2/workflows/instances/instance-abc-123',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-service-token',
          }),
        }),
      );
      expect(result.id).toBe('instance-abc-123');
      expect(result.processId).toBe('greeting');
      expect(result.state).toBe('COMPLETED');
      expect(result.workflowdata).toEqual({
        greeting: 'Hello from YAML Workflow',
        result: { completedWith: 'success' },
      });
    });

    it('should return an active (in-progress) instance', async () => {
      const mockInstance = {
        id: 'instance-active-789',
        processId: 'long-running',
        state: 'ACTIVE',
        start: '2025-01-15T10:30:00Z',
        nodes: [],
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockInstance),
      });

      const result = await fetchInstance({
        discovery: mockDiscovery as any,
        auth: mockAuth as any,
        logger: mockLogger,
        credentials: serviceCredentials,
        instanceId: 'instance-active-789',
      });

      expect(result.state).toBe('ACTIVE');
      expect(result.end).toBeUndefined();
    });

    it('should return an errored instance', async () => {
      const mockInstance = {
        id: 'instance-err-456',
        processId: 'failing-workflow',
        state: 'ERROR',
        start: '2025-01-15T10:30:00Z',
        end: '2025-01-15T10:30:02Z',
        nodes: [],
        error: {
          nodeDefinitionId: 'step1',
          message: 'Connection refused',
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockInstance),
      });

      const result = await fetchInstance({
        discovery: mockDiscovery as any,
        auth: mockAuth as any,
        logger: mockLogger,
        credentials: serviceCredentials,
        instanceId: 'instance-err-456',
      });

      expect(result.state).toBe('ERROR');
      expect(result.processId).toBe('failing-workflow');
    });

    it('should throw on 404 for unknown instance', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Instance not found'),
      });

      await expect(
        fetchInstance({
          discovery: mockDiscovery as any,
          auth: mockAuth as any,
          logger: mockLogger,
          credentials: serviceCredentials,
          instanceId: 'nonexistent',
        }),
      ).rejects.toThrow(
        "Failed to get instance 'nonexistent': 404 Instance not found",
      );
    });

    it('should throw on server error', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(
        fetchInstance({
          discovery: mockDiscovery as any,
          auth: mockAuth as any,
          logger: mockLogger,
          credentials: serviceCredentials,
          instanceId: 'some-instance',
        }),
      ).rejects.toThrow("Failed to get instance 'some-instance': 500");
    });

    it('should URL-encode the instance ID', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'special/id',
            processId: 'test',
            state: 'COMPLETED',
            nodes: [],
          }),
      });

      await fetchInstance({
        discovery: mockDiscovery as any,
        auth: mockAuth as any,
        logger: mockLogger,
        credentials: serviceCredentials,
        instanceId: 'special/id',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/orchestrator/v2/workflows/instances/special%2Fid',
        expect.anything(),
      );
    });
  });
});

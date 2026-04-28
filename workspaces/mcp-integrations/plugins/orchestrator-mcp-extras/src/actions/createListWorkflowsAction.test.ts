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
import { fetchWorkflowOverviews } from './createListWorkflowsAction';
import { mockServices, mockCredentials } from '@backstage/backend-test-utils';

describe('createListWorkflowsAction', () => {
  describe('fetchWorkflowOverviews', () => {
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

    it('should return workflow overviews on success', async () => {
      const mockResponse = {
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
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await fetchWorkflowOverviews({
        discovery: mockDiscovery as any,
        auth: mockAuth as any,
        logger: mockLogger,
        credentials: serviceCredentials,
      });

      expect(mockDiscovery.getBaseUrl).toHaveBeenCalledWith('orchestrator');
      expect(mockAuth.getPluginRequestToken).toHaveBeenCalledWith({
        onBehalfOf: serviceCredentials,
        targetPluginId: 'orchestrator',
      });
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/orchestrator/v2/workflows/overview',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-service-token',
          }),
        }),
      );
      expect(result.overviews).toHaveLength(2);
      expect(result.overviews[0].workflowId).toBe('greeting');
    });

    it('should return empty overviews when none exist', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ overviews: [], paginationInfo: {} }),
      });

      const result = await fetchWorkflowOverviews({
        discovery: mockDiscovery as any,
        auth: mockAuth as any,
        logger: mockLogger,
        credentials: serviceCredentials,
      });

      expect(result.overviews).toEqual([]);
    });

    it('should throw on HTTP error response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(
        fetchWorkflowOverviews({
          discovery: mockDiscovery as any,
          auth: mockAuth as any,
          logger: mockLogger,
          credentials: serviceCredentials,
        }),
      ).rejects.toThrow('Failed to fetch workflows: 500 Internal Server Error');
    });

    it('should throw when discovery service fails', async () => {
      mockDiscovery.getBaseUrl.mockRejectedValue(
        new Error('Discovery unavailable'),
      );

      await expect(
        fetchWorkflowOverviews({
          discovery: mockDiscovery as any,
          auth: mockAuth as any,
          logger: mockLogger,
          credentials: serviceCredentials,
        }),
      ).rejects.toThrow('Discovery unavailable');
    });

    it('should throw when auth service fails', async () => {
      mockAuth.getPluginRequestToken.mockRejectedValue(
        new Error('Auth token error'),
      );

      await expect(
        fetchWorkflowOverviews({
          discovery: mockDiscovery as any,
          auth: mockAuth as any,
          logger: mockLogger,
          credentials: serviceCredentials,
        }),
      ).rejects.toThrow('Auth token error');
    });
  });
});

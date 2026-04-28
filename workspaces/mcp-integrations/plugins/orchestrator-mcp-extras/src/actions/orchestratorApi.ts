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

const ORCHESTRATOR_PLUGIN_ID = 'orchestrator';
const DEFAULT_TIMEOUT_MS = 30_000;

export async function orchestratorFetch(options: {
  discovery: DiscoveryService;
  auth: AuthService;
  logger: LoggerService;
  credentials: BackstageCredentials;
  path: string;
  method?: string;
  body?: unknown;
  timeoutMs?: number;
}): Promise<Response> {
  const { discovery, auth, logger, credentials, path, method, body } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const baseUrl = await discovery.getBaseUrl(ORCHESTRATOR_PLUGIN_ID);
  const url = `${baseUrl}${path}`;

  const { token } = await auth.getPluginRequestToken({
    onBehalfOf: credentials,
    targetPluginId: ORCHESTRATOR_PLUGIN_ID,
  });

  logger.debug(`orchestrator-mcp: ${method ?? 'GET'} ${path}`);

  return fetch(url, {
    method: method ?? 'GET',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

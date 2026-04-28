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
  DiscoveryService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { ActionsRegistryService } from '@backstage/backend-plugin-api/alpha';
import { createListWorkflowsAction } from './createListWorkflowsAction';
import { createExecuteWorkflowAction } from './createExecuteWorkflowAction';
import { createGetInstanceAction } from './createGetInstanceAction';

export { createListWorkflowsAction } from './createListWorkflowsAction';
export { createExecuteWorkflowAction } from './createExecuteWorkflowAction';
export { createGetInstanceAction } from './createGetInstanceAction';

export const createOrchestratorActions = (options: {
  actionsRegistry: ActionsRegistryService;
  auth: AuthService;
  discovery: DiscoveryService;
  logger: LoggerService;
}) => {
  createListWorkflowsAction(options);
  createExecuteWorkflowAction(options);
  createGetInstanceAction(options);
};

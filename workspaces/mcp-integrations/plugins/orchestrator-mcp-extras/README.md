# Orchestrator MCP Extras

This Backstage backend plugin exposes [RHDH Orchestrator](https://docs.redhat.com/en/documentation/red_hat_developer_hub/) workflow management capabilities as [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) tools, enabling LLM-powered clients (Red Hat Lightspeed, Claude Desktop, GitHub Copilot, etc.) to discover, execute, and monitor orchestrator workflows through natural language.

## MCP Tools

| Tool Name                       | Description                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `orchestrator-workflows-list`   | List all available orchestrator workflows with their status and metadata      |
| `orchestrator-workflow-get`     | Get detailed info about a workflow including its input schema                 |
| `orchestrator-workflow-execute` | Execute a workflow by ID with input data, returns an instance ID for tracking |
| `orchestrator-instance-get`     | Get the status and output of a workflow execution instance                    |
| `orchestrator-instances-list`   | List all executed workflow instances with their status and timestamps         |

## Prerequisites

- RHDH instance with the **Orchestrator backend plugin** enabled (`@red-hat-developer-hub/backstage-plugin-orchestrator-backend`)
- **MCP Actions backend** plugin installed (`@backstage/plugin-mcp-actions-backend`)
- A running SonataFlow platform with at least one deployed workflow

## Installation

Add the plugin to your Backstage backend:

```bash
yarn --cwd packages/backend add @red-hat-developer-hub/backstage-plugin-orchestrator-mcp-extras
```

Register it in `packages/backend/src/index.ts`:

```typescript
// MCP Server core (required)
backend.add(import('@backstage/plugin-mcp-actions-backend'));

// Orchestrator MCP tools
backend.add(
  import('@red-hat-developer-hub/backstage-plugin-orchestrator-mcp-extras'),
);
```

### Required Configuration

Add the following to your `app-config.yaml` to tell the MCP actions framework which plugins provide tools:

```yaml
backend:
  actions:
    pluginSources:
      - orchestrator-mcp-extras
```

This configuration is **required**. Without it, `tools/list` returns an empty array because the `DefaultActionsService` relies on `backend.actions.pluginSources` to discover which plugins expose actions via the internal `/.backstage/actions/v1/actions` endpoint.

## Dynamic Plugin Deployment (RHDH on OpenShift)

This section provides step-by-step instructions for deploying the plugin as a dynamic plugin in Red Hat Developer Hub on OpenShift.

### Step 1: Build and Push the OCI Image

From the plugin source directory:

```bash
# Build the dynamic plugin
yarn tsc
yarn workspace @red-hat-developer-hub/backstage-plugin-orchestrator-mcp-extras build
npx @red-hat-developer-hub/cli@latest plugin export \
  --no-embed --clean

# Package as OCI image
cd dist-dynamic
cat > Containerfile <<'EOF'
FROM scratch
COPY package.json package.json
COPY dist/ dist/
EOF

export PLUGIN_VERSION="0.1.0"
export REGISTRY="quay.io/<your-org>/rhdh-plugin-orchestrator-mcp-extras"

podman build -t "${REGISTRY}:${PLUGIN_VERSION}" .
podman push "${REGISTRY}:${PLUGIN_VERSION}"
```

### Step 2: Configure Registry Authentication (if using private registry)

Create a secret with registry credentials so the RHDH init container can pull OCI images:

```bash
oc create secret generic dynamic-plugins-registry-auth \
  --from-file=auth.json=$HOME/.config/containers/auth.json \
  -n <rhdh-namespace>
```

### Step 3: Configure Dynamic Plugins

Update the `dynamic-plugins-rhdh` ConfigMap (or equivalent) to include the orchestrator backend, MCP actions backend, and this plugin:

```yaml
plugins:
  # Orchestrator backend
  - disabled: false
    package: 'oci://registry.access.redhat.com/rhdh/red-hat-developer-hub-backstage-plugin-orchestrator-backend@sha256:<digest>'
    pluginConfig:
      orchestrator:
        dataIndexService:
          url: <data-index-service-url>

  # MCP Actions backend (pre-built OCI from RHDH overlay registry)
  - disabled: false
    package: 'oci://ghcr.io/redhat-developer/rhdh-plugin-export-overlays/backstage-plugin-mcp-actions-backend:bs_1.45.3__0.1.5!backstage-plugin-mcp-actions-backend'

  # Orchestrator MCP Extras
  - disabled: false
    package: 'oci://<your-registry>/rhdh-plugin-orchestrator-mcp-extras:<version>!red-hat-developer-hub-backstage-plugin-orchestrator-mcp-extras'
```

> **Note:** The `!<plugin-name>` suffix in the package URL specifies the directory name under `dynamic-plugins-root/`.

### Step 4: Configure app-config

Update the `app-config-rhdh` ConfigMap to include the required `backend.actions.pluginSources` and `orchestrator.dataIndexService.url`:

```yaml
backend:
  actions:
    pluginSources:
      - orchestrator-mcp-extras

orchestrator:
  dataIndexService:
    url: <data-index-url>
```

**Important:** The `orchestrator.dataIndexService.url` in `app-config-rhdh` takes precedence over the same key in `pluginConfig` within the dynamic plugins ConfigMap. Ensure consistency.

For SonataFlow deployments using the `dev` profile with an embedded Data Index, point the URL to the SonataFlow service directly (e.g., `http://greeting.sonataflow-infra:80`).

### Step 5: Restart RHDH

```bash
oc rollout restart deploy/backstage-backstage -n <rhdh-namespace>
oc rollout status deploy/backstage-backstage -n <rhdh-namespace> --timeout=120s
```

### Step 6: Verify

Test the MCP endpoint:

```bash
BACKEND_SECRET=$(oc get secret backstage-backend-auth-secret -n <ns> \
  -o jsonpath='{.data.BACKEND_SECRET}' | base64 -d)

# Tools list
oc exec -n <ns> deploy/backstage-backstage -- \
  curl -s -X POST "http://localhost:7007/api/mcp-actions/v1" \
  -H "Authorization: Bearer $BACKEND_SECRET" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

You should see all three tools in the response.

## MCP Endpoint

The MCP protocol is available at two transport endpoints:

| Transport       | Path                      | Description                                       |
| --------------- | ------------------------- | ------------------------------------------------- |
| Streamable HTTP | `/api/mcp-actions/v1`     | Single request-response (recommended for testing) |
| SSE             | `/api/mcp-actions/v1/sse` | Server-Sent Events (persistent connection)        |

Both endpoints require a `Bearer` token in the `Authorization` header.

### Authentication

- **Read-only operations** (`tools/list`, `orchestrator-workflows-list`): Work with both service tokens (e.g., `BACKEND_SECRET`) and user tokens.
- **Write operations** (`orchestrator-workflow-execute`): **Require user credentials.** The orchestrator backend enforces user identity for workflow execution. Use a Backstage user session token or guest auth token.

To obtain a guest user token for testing:

```bash
curl -s -X POST "http://localhost:7007/api/auth/guest/refresh" \
  -H "Content-Type: application/json" | jq -r '.backstageIdentity.token'
```

## Troubleshooting

### `tools/list` returns empty tools array

**Cause:** `backend.actions.pluginSources` is not configured.

The `DefaultActionsService` discovers tool-providing plugins by reading `backend.actions.pluginSources` from the app config. Without this setting, it has no plugins to query.

**Fix:** Add to `app-config-rhdh`:

```yaml
backend:
  actions:
    pluginSources:
      - orchestrator-mcp-extras
```

### "Only user credentials are supported" error on execute

**Cause:** The MCP endpoint is being called with a service/static token instead of a user token.

The orchestrator backend requires user credentials for workflow execution to enforce RBAC and audit trails.

**Fix:** Authenticate as a user (via guest auth, OAuth, or OIDC session) before calling the MCP endpoint. Service tokens work for read operations but not for execute.

### "Exceeded maximum number of retries for async function" on execute

**Cause:** The orchestrator backend cannot find the workflow instance in the Data Index after execution.

This happens when:

1. **Eventing is disabled:** `kogito.events.processinstances.enabled=false` in the SonataFlow workflow's managed-props ConfigMap.
2. **Data Index URL mismatch:** The orchestrator backend is querying an external Data Index, but the workflow uses an embedded in-memory Data Index (common in `dev` profile).

**Fix for eventing:** Patch the workflow's managed-props ConfigMap:

```yaml
kogito.events.processinstances.enabled = true
mp.messaging.outgoing.kogito-processinstances-events.connector = quarkus-http
mp.messaging.outgoing.kogito-processinstances-events.url = http://<data-index-service>/processes
```

**Fix for Data Index URL:** Point `orchestrator.dataIndexService.url` to the embedded Data Index of the SonataFlow pod:

```yaml
orchestrator:
  dataIndexService:
    url: http://<sonataflow-service>.<namespace>:80
```

### Duplicate plugin configuration error

**Cause:** The RHDH operator injects default disabled entries for orchestrator plugins that conflict with explicit enabled entries.

**Fix:** Scale down the RHDH operator temporarily, edit the `backstage-dynamic-plugins-backstage` ConfigMap directly, then restart RHDH.

### Plugin loads but MCP endpoint returns 404

**Cause:** Wrong endpoint path. The MCP actions backend uses `/api/mcp-actions/v1` (streamable) and `/api/mcp-actions/v1/sse` (SSE), not `/api/mcp/sse`.

## Example LLM Interactions

### Discover available workflows

> **User:** What workflows are available in the orchestrator?
>
> **LLM** calls `orchestrator-workflows-list` -> receives list of workflows
>
> **LLM:** There is 1 workflow available:
>
> 1. **greeting** (JSON) - YAML based greeting workflow - Available, last run: COMPLETED

### Execute a workflow

> **User:** Run the greeting workflow for Alice in English
>
> **LLM** calls `orchestrator-workflow-execute` with `workflowId: "greeting"`, `inputData: {"name": "Alice", "language": "English"}`
>
> **LLM:** I've started the greeting workflow. The execution ID is `abc-123-def-456`. Let me check the result...

### Check execution status

> **User:** What's the status of that workflow run?
>
> **LLM** calls `orchestrator-instance-get` with `instanceId: "abc-123-def-456"`
>
> **LLM:** The greeting workflow completed successfully in 0.004 seconds. The output greeting is: _"Hello from YAML Workflow"_

## Testing

### Unit Tests

```bash
yarn workspace @red-hat-developer-hub/backstage-plugin-orchestrator-mcp-extras test
```

### Integration Tests

The integration tests use a mock HTTP server to simulate the orchestrator backend and validate the full action registration and invocation flow:

```bash
yarn workspace @red-hat-developer-hub/backstage-plugin-orchestrator-mcp-extras test -- --testPathPattern integration
```

### E2E Tests

E2E tests run against a live RHDH + Orchestrator deployment on OpenShift:

```bash
# Prerequisites: oc login, RHDH deployed with all plugins
./e2e/run-e2e.sh

# Custom namespace and workflow
./e2e/run-e2e.sh --namespace my-namespace --workflow my-workflow

# Skip workflow execution tests
SKIP_EXECUTE=true ./e2e/run-e2e.sh
```

The E2E suite includes 20 tests across 6 groups:

| Group            | Tests | Description                                                                          |
| ---------------- | ----- | ------------------------------------------------------------------------------------ |
| MCP Protocol     | 4     | Initialize handshake, tools/list, metadata validation, invalid method handling       |
| workflows:list   | 4     | Non-empty results, target workflow presence, field population, service token support |
| workflow:execute | 3     | Successful execution, UUID format, service token rejection                           |
| instance:get     | 4     | Retrieval, COMPLETED status, workflow data, workflowId matching                      |
| Error Handling   | 4     | Non-existent tool/workflow/instance, unauthenticated access                          |
| Full Lifecycle   | 1     | End-to-end: list -> execute -> get                                                   |

## Development

```bash
cd workspaces/mcp-integrations

# Install dependencies
yarn install

# Run all tests
yarn workspace @red-hat-developer-hub/backstage-plugin-orchestrator-mcp-extras test

# Build
yarn tsc && yarn workspace @red-hat-developer-hub/backstage-plugin-orchestrator-mcp-extras build

# Lint
yarn workspace @red-hat-developer-hub/backstage-plugin-orchestrator-mcp-extras lint

# Export as dynamic plugin
npx @red-hat-developer-hub/cli@latest plugin export --no-embed --clean
```

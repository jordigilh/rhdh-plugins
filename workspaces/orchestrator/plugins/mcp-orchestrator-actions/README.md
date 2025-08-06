# RHDH Orchestrator Actions Plugin

Complete step-by-step guide to install and configure the RHDH Orchestrator Actions Plugin for Backstage with SonataFlow integration.

## What You Will Install

This guide will help you set up:
- ✅ **Backstage v1.40.0+** with MCP Actions support
- ✅ **RHDH Orchestrator Actions Plugin** (6 MCP tools for workflow management)
- ✅ **SonataFlow Platform Integration** (workflow orchestration engine)
- ✅ **Complete working environment** ready for LLM clients

## Prerequisites - Check Before Starting

**Required Infrastructure:**
- [ ] Kubernetes/OpenShift cluster with admin access
- [ ] RHDH Orchestrator Operator installed (provides SonataFlow platform)
- [ ] Network connectivity within cluster

**Required Software:**
- [ ] Node.js 18+ installed
- [ ] Yarn package manager
- [ ] kubectl/oc CLI configured
- [ ] Backstage v1.40.0+ (new installation or existing)

**Important:** This guide uses the RHDH Orchestrator Operator to deploy only the SonataFlow orchestration platform (data index, job service, etc.) but **NOT** the RHDH instance itself. We will install our own custom Backstage instance with the MCP orchestrator actions plugin.

## Step-by-Step Installation Guide

### Step 1: Install RHDH Orchestrator Operator Dependencies

Install the RHDH Orchestrator Operator to deploy the SonataFlow platform infrastructure (without the RHDH instance):

```bash
# Install the RHDH Orchestrator Operator
kubectl apply -f https://raw.githubusercontent.com/redhat-developer/rhdh-operator/main/orchestrator/operator.yaml

# Wait for operator to be ready
kubectl wait --for=condition=available deployment/orchestrator-operator -n orchestrator-system --timeout=300s

# Create the SonataFlow infrastructure (without RHDH instance)
kubectl apply -f - <<EOF
apiVersion: orchestrator.redhat.com/v1alpha1
kind: OrchestratePlatform
metadata:
  name: orchestrator-platform
  namespace: sonataflow-infra
spec:
  # Deploy only the orchestration platform components
  platform:
    enabled: true
    dataIndex:
      enabled: true
    jobService:
      enabled: true
  # IMPORTANT: Do not deploy RHDH instance - we will install our own
  rhdh:
    enabled: false  # Disable RHDH deployment from operator
EOF

# Wait for platform to be ready
kubectl wait --for=condition=ready orchestrateplatform/orchestrator-platform -n sonataflow-infra --timeout=600s
```

**Verify Installation:**
```bash
# Check if SonataFlow namespace and services exist (no RHDH pods should be present)
kubectl get namespace sonataflow-infra
kubectl get pods -n sonataflow-infra

# Verify only SonataFlow components are deployed (not RHDH)
kubectl get pods -n sonataflow-infra | grep -v rhdh
# Should show: data-index, job-service, operator pods but NO rhdh pods

# Verify SonataFlow data index service is running
kubectl get service -n sonataflow-infra sonataflow-platform-data-index-service

# Test SonataFlow API accessibility
kubectl port-forward -n sonataflow-infra service/sonataflow-platform-data-index-service 8080:80 &
sleep 5
curl http://localhost:8080/q/health
# Should return: {"status":"UP","checks":[...]}
```

**Expected Output (SonataFlow platform only, no RHDH):**
```
# Pods should show SonataFlow components only
NAME                                    READY   STATUS    RESTARTS   AGE
sonataflow-platform-data-index-xxx     1/1     Running   0          5m
sonataflow-platform-job-service-xxx    1/1     Running   0          5m
sonataflow-operator-xxx                 1/1     Running   0          5m

# Service for data index API
NAME                                      TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)   AGE
sonataflow-platform-data-index-service   ClusterIP   10.96.xxx.xxx   <none>        80/TCP    5m
```

### Step 2: Install the Plugin Package

Now we install our own Backstage instance with the MCP orchestrator actions plugin (separate from the operator's RHDH deployment).

In your Backstage backend directory:

```bash
# Navigate to your Backstage backend package
cd packages/backend

# Install the RHDH Orchestrator Actions Plugin
yarn add @rhdh/plugin-orchestrator-actions-backend

# Install MCP Actions Backend Plugin (if not already installed)
yarn add @backstage/plugin-mcp-actions-backend@^0.1.2
```

**Verify Installation:**
```bash
# Check package.json includes both plugins
grep -A 5 -B 5 "plugin.*mcp\|plugin.*orchestrator" package.json
```

### Step 3: Register Plugins in Backend

Edit your backend index file `packages/backend/src/index.ts`:

```typescript
import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

// REQUIRED: Add MCP Actions Backend Plugin first
backend.add(import('@backstage/plugin-mcp-actions-backend'));

// REQUIRED: Add RHDH Orchestrator Actions Plugin
backend.add(import('@rhdh/plugin-orchestrator-actions-backend'));

backend.start();
```

### Step 4: Configure SonataFlow Integration

Edit your `app-config.yaml` file to configure the SonataFlow connection:

```yaml
app:
  title: Backstage with RHDH Orchestrator
  baseUrl: http://localhost:7007

backend:
  baseUrl: http://localhost:7007
  listen:
    port: 7007
    host: 0.0.0.0
  
  # REQUIRED: Configure MCP Actions with orchestrator plugin
  actions:
    pluginSources:
      - 'catalog'                    # Default Backstage actions
      - 'rhdh-orchestrator-actions'  # RHDH orchestrator actions

# REQUIRED: SonataFlow platform data index service connection
orchestrator:
  baseUrl: 'http://sonataflow-platform-data-index-service.sonataflow-infra'
  # For local development with port-forward:
  # baseUrl: 'http://localhost:8080'
  # For external deployments:
  # baseUrl: 'https://your-sonataflow-domain.com'
```

### Step 5: Build and Start Backstage

Build and start your Backstage instance:

```bash
# Build the backend with new plugins
yarn build:backend

# Start Backstage
yarn start:backend
```

**Expected Startup Logs:**
```
🔧 Initializing RHDH Orchestrator Actions Plugin for MCP
✅ Successfully registered 6 RHDH orchestrator actions for MCP
[1] 2024-01-01T12:00:00.000Z backstage info Plugin rhdh-orchestrator-actions initialized
```

### Step 6: Verify Installation Success

Test that everything is working correctly:

**1. Check Plugin Registration:**
```bash
# Test MCP Actions endpoint is available
curl -X POST http://localhost:7007/api/mcp-actions/v1 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

**Expected Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {"name": "orchestrator:workflows:overview", "description": "Returns the key fields of workflows..."},
      {"name": "orchestrator:workflow:source", "description": "Get the workflow definition source..."},
      {"name": "orchestrator:workflow:inputSchema", "description": "Get the workflow input schema..."},
      {"name": "orchestrator:workflow:execute", "description": "Execute a workflow..."},
      {"name": "orchestrator:instance:get", "description": "Get a workflow execution..."},
      {"name": "orchestrator:instances:list", "description": "Retrieve an array of workflow executions..."}
    ]
  }
}
```

**2. Test SonataFlow Connectivity:**
```bash
# Test workflows overview
curl -X POST http://localhost:7007/api/mcp-actions/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "orchestrator:workflows:overview",
      "arguments": {}
    },
    "id": 2
  }'
```

### Step 7: Optional - External Access Authentication

For external LLM clients to access MCP endpoints, configure authentication:

**Add to your `app-config.yaml`:**
```yaml
backend:
  auth:
    externalAccess:
      - type: static
        options:
          token: ${MCP_TOKEN}  # Set this environment variable
          subject: mcp-clients
          accessRestrictions:
            - plugin: mcp-actions
            - plugin: rhdh-orchestrator-actions
```

**Set the environment variable:**
```bash
export MCP_TOKEN="your-secure-token-here"
# Or add to your .env file:
echo "MCP_TOKEN=your-secure-token-here" >> .env
```

## Available MCP Tools

Once installed, the following 6 RHDH orchestrator MCP tools will be available:

### 1. `orchestrator:workflows:overview`
- **Purpose:** Get workflows overview (POST /v2/workflows/overview)
- **Input:** Pagination info, filters for workflowId/name
- **Output:** Array of WorkflowOverviewDTO with pagination

### 2. `orchestrator:workflow:source`
- **Purpose:** Get workflow definition source (GET /v2/workflows/{workflowId}/source)
- **Input:** workflowId (required)
- **Output:** Workflow source code in YAML/JSON format

### 3. `orchestrator:workflow:inputSchema`
- **Purpose:** Get workflow input schema (GET /v2/workflows/{workflowId}/inputSchema)
- **Input:** workflowId (required)
- **Output:** JSON Schema defining workflow input structure

### 4. `orchestrator:workflow:execute`
- **Purpose:** Execute a workflow (POST /v2/workflows/{workflowId}/execute)
- **Input:** workflowId (required), executeWorkflowRequestDTO with inputData
- **Output:** Process instance ID of created execution

### 5. `orchestrator:instance:get`
- **Purpose:** Get workflow instance details (GET /v2/workflows/instances/{instanceId})
- **Input:** instanceId (required), includeAssessment (optional)
- **Output:** Complete ProcessInstanceDTO with execution details

### 6. `orchestrator:instances:list`
- **Purpose:** List workflow instances (POST /v2/workflows/instances)
- **Input:** Pagination info, filters for status/workflowId/businessKey
- **Output:** Array of ProcessInstanceDTO objects with pagination

## Troubleshooting Installation

### Common Issues and Solutions

**Issue: Plugin not found during installation**
```bash
# Solution: Check npm registry access
yarn config get registry
# Should show: https://registry.yarnpkg.com

# Alternative: Install from git repository
yarn add https://github.com/redhat-developer/rhdh-plugins.git#workspace=@rhdh/plugin-orchestrator-actions-backend
```

**Issue: SonataFlow API not accessible**
```bash
# Solution: Verify RHDH Orchestrator Operator installation
kubectl get pods -n orchestrator-system
kubectl get orchestrateplatform -n sonataflow-infra

# Check SonataFlow services
kubectl get endpoints -n sonataflow-infra sonataflow-platform-data-index-service
kubectl port-forward -n sonataflow-infra service/sonataflow-platform-data-index-service 8080:80
curl http://localhost:8080/q/health

# If operator not installed, install it:
kubectl apply -f https://raw.githubusercontent.com/redhat-developer/rhdh-operator/main/orchestrator/operator.yaml
```

**Issue: MCP tools not appearing**
```bash
# Solution: Check pluginSources configuration
grep -A 10 "pluginSources:" app-config.yaml
# Should include: - 'rhdh-orchestrator-actions'

# Restart Backstage after config changes
yarn start:backend
```

**Issue: Build failures**
```bash
# Solution: Clear cache and rebuild
yarn clean
rm -rf node_modules
yarn install
yarn build:backend
```

### Validation Checklist

Before proceeding, ensure all items are checked:

- [ ] RHDH Orchestrator Operator is installed and running
- [ ] OrchestratePlatform CR is created with `rhdh.enabled: false`
- [ ] Only SonataFlow components are deployed (no RHDH pods in sonataflow-infra)
- [ ] SonataFlow data index service is accessible
- [ ] Both MCP and orchestrator plugins are installed in your custom Backstage
- [ ] Backend index.ts includes both plugin imports
- [ ] app-config.yaml has correct pluginSources and orchestrator.baseUrl
- [ ] Custom Backstage builds and starts without errors (not operator's RHDH)
- [ ] MCP endpoint returns 6 orchestrator tools
- [ ] Test workflow call connects to real SonataFlow API

### Complete Installation Verification

Run this comprehensive test to ensure everything works:

```bash
# 1. Verify RHDH Orchestrator Operator (SonataFlow only, no RHDH)
kubectl get pods -n orchestrator-system
kubectl get orchestrateplatform -n sonataflow-infra -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}'

# 2. Confirm no RHDH pods deployed by operator
kubectl get pods -n sonataflow-infra | grep rhdh
# Should return empty (no results)

# 3. Verify only SonataFlow components
kubectl get pods -n sonataflow-infra | grep -E "(data-index|job-service|operator)"
# Should show SonataFlow platform components

# 4. Test SonataFlow API accessibility
kubectl port-forward -n sonataflow-infra service/sonataflow-platform-data-index-service 8080:80 &
curl -s http://localhost:8080/q/health | jq '.status'

# 5. Test our custom Backstage MCP integration
curl -s -X POST http://localhost:7007/api/mcp-actions/v1 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq '.result.tools | length'

# Should return: 6 (for the 6 orchestrator tools)
```

## Configuration Options

### Environment Variables

- `MCP_TOKEN`: Static token for external MCP access (optional)
- `ORCHESTRATOR_BASE_URL`: Base URL for RHDH orchestrator API (optional)

### App Config

```yaml
# REQUIRED: SonataFlow platform data index service configuration
# This must point to your deployed SonataFlow orchestrator environment
orchestrator:
  baseUrl: 'http://sonataflow-platform-data-index-service.sonataflow-infra'
  # Alternative configurations:
  # baseUrl: 'https://sonataflow-data-index.your-namespace.svc.cluster.local'
  # baseUrl: 'https://your-sonataflow-platform.yourdomain.com'
  
# MCP Actions configuration
backend:
  actions:
    pluginSources:
      - 'rhdh-orchestrator-actions'
```

### SonataFlow Integration Requirements

The plugin requires a deployed SonataFlow platform with the following components:

1. **SonataFlow Data Index Service**: Provides REST API endpoints
2. **SonataFlow Platform**: Workflow execution engine
3. **Network Connectivity**: Backstage must be able to reach the SonataFlow data index service

**Deployment Verification:**
```bash
# Verify SonataFlow data index service is accessible
curl http://sonataflow-platform-data-index-service.sonataflow-infra/q/health

# Test workflows endpoint
curl http://sonataflow-platform-data-index-service.sonataflow-infra/v2/workflows
```

## Integration with LLM Clients

The plugin makes RHDH orchestrator functionality available to LLM clients through the MCP protocol. LLM clients can:

1. **Discover workflows** using natural language
2. **Execute workflows** with conversational input
3. **Monitor executions** and get status updates
4. **Browse workflow history** and results

Example LLM interaction:
```
User: "Show me all available workflows"
LLM: [Calls orchestrator:workflows:overview tool]

User: "Execute the hello-world workflow with name 'John'"
LLM: [Calls orchestrator:workflow:execute tool with proper parameters]
```

## Architecture Benefits

### ✅ **Official Compliance**
- Follows Backstage MCP RFC patterns exactly
- Uses official Actions Registry Service
- Proper Zod schema validation
- Standard plugin lifecycle management

### ✅ **Extensible Design**
- Integrates with existing MCP Actions Plugin
- Doesn't replace - extends functionality
- Can coexist with other action plugins
- Follows Backstage plugin best practices

### ✅ **Production Ready**
- Type-safe with TypeScript and Zod
- Proper error handling and logging
- Configurable base URLs and authentication
- Full test coverage capabilities

## Complete Removal Guide

This section covers removing all components installed in this guide: the custom Backstage instance, the RHDH Orchestrator Actions Plugin, and the RHDH Orchestrator Operator infrastructure.

## Option A: Remove Plugin Only (Keep SonataFlow Platform)

If you want to keep the SonataFlow platform but remove the plugin from your Backstage:

### Step 1: Remove Plugin Registration

Remove the plugin import from your backend in `packages/backend/src/index.ts`:

```typescript
import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

// Keep the MCP Actions Backend Plugin
backend.add(import('@backstage/plugin-mcp-actions-backend'));

// Remove this line:
// backend.add(import('@rhdh/plugin-orchestrator-actions-backend'));

backend.start();
```

### Step 2: Update Configuration

Remove the plugin source from your `app-config.yaml`:

```yaml
backend:
  actions:
    pluginSources:
      - 'catalog'  # Keep default actions
      # Remove this line:
      # - 'rhdh-orchestrator-actions'
```

### Step 3: Remove Package

Uninstall the package from your Backstage backend:

```bash
yarn remove @rhdh/plugin-orchestrator-actions-backend
```

### Step 4: Clean and Restart

Clean build artifacts and restart your Backstage instance:

```bash
# Clean build
yarn clean

# Rebuild without the plugin
yarn build

# Restart Backstage
yarn start
```

### Step 5: Verify Plugin Removal

Check that the orchestrator tools are no longer available:

```bash
curl -X POST http://localhost:7007/api/mcp-actions/v1 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

The response should not include any `orchestrator:*` tools.

## Option B: Complete Removal (Everything)

If you want to remove all components installed in this guide:

### Step 1: Stop Backstage Instance

```bash
# Stop your custom Backstage instance
pkill -f "yarn start:backend"
# Or if running in container/kubernetes:
kubectl delete deployment your-backstage-deployment
```

### Step 2: Remove RHDH Orchestrator Operator Infrastructure

Remove the SonataFlow platform and operator:

```bash
# Remove the OrchestratePlatform custom resource
kubectl delete orchestrateplatform orchestrator-platform -n sonataflow-infra

# Wait for resources to be cleaned up
kubectl wait --for=delete orchestrateplatform/orchestrator-platform -n sonataflow-infra --timeout=300s

# Remove the namespace (this removes all SonataFlow components)
kubectl delete namespace sonataflow-infra

# Remove the RHDH Orchestrator Operator
kubectl delete -f https://raw.githubusercontent.com/redhat-developer/rhdh-operator/main/orchestrator/operator.yaml

# Remove operator namespace
kubectl delete namespace orchestrator-system
```

### Step 3: Verify Complete Removal

Confirm all resources are removed:

```bash
# Check that namespaces are gone
kubectl get namespace | grep -E "(sonataflow-infra|orchestrator-system)"
# Should return empty

# Check that no orchestrator pods exist
kubectl get pods --all-namespaces | grep -E "(orchestrator|sonataflow)"
# Should return empty

# Check that no orchestrator CRDs remain
kubectl get crd | grep orchestrator
# Should return empty
```

### Step 4: Clean Local Development Environment

If you were running Backstage locally:

```bash
# Remove the plugin package from your project
cd your-backstage-project
yarn remove @rhdh/plugin-orchestrator-actions-backend

# Remove any configuration files you created
rm -f app-config.orchestrator.yaml

# Clean build artifacts
yarn clean

# Reset to clean state
git checkout -- packages/backend/src/index.ts app-config.yaml
```

## Option C: Reset to Clean State (For Testing)

If you want to reset everything to start fresh:

### Step 1: Remove All Resources

Follow "Option B: Complete Removal" steps above.

### Step 2: Verify Clean State

```bash
# Verify no orchestrator resources exist
kubectl get all --all-namespaces | grep -E "(orchestrator|sonataflow)"

# Verify no related CRDs
kubectl get crd | grep -E "(orchestrator|sonataflow)"

# Check your Backstage project is clean
cd your-backstage-project
git status
# Should show no orchestrator-related changes if you reset properly
```

### Step 3: Ready for Reinstallation

You can now follow the installation guide from the beginning if needed.

## Troubleshooting Removal

### Resources Not Deleting

```bash
# Force delete stuck resources
kubectl patch orchestrateplatform orchestrator-platform -n sonataflow-infra -p '{"metadata":{"finalizers":[]}}' --type=merge
kubectl delete orchestrateplatform orchestrator-platform -n sonataflow-infra --force --grace-period=0

# Force delete namespace if stuck
kubectl patch namespace sonataflow-infra -p '{"metadata":{"finalizers":[]}}' --type=merge
kubectl delete namespace sonataflow-infra --force --grace-period=0
```

### Operator Won't Uninstall

```bash
# Remove operator finalizers if stuck
kubectl get deployment -n orchestrator-system -o name | xargs -I {} kubectl patch {} -n orchestrator-system -p '{"metadata":{"finalizers":[]}}'

# Force delete operator namespace
kubectl delete namespace orchestrator-system --force --grace-period=0
```

### Plugin Still Shows in Backstage

```bash
# Ensure package.json is clean
grep -r "orchestrator-actions" packages/backend/package.json
# Should return empty

# Clear all caches
yarn clean
rm -rf node_modules
yarn install
yarn build
```

## Summary of Removal Options

| Option | What Gets Removed | When to Use |
|--------|------------------|-------------|
| **Option A** | Plugin only | Keep SonataFlow for other uses |
| **Option B** | Everything | Complete cleanup |
| **Option C** | Everything + reset | Testing/development cycles |

**Choose Option A** if you want to keep the SonataFlow platform for other integrations but remove the Backstage plugin.

**Choose Option B** if you want to completely remove all components installed in this guide.

**Choose Option C** if you're testing and want to start completely fresh for reinstallation.

## Development

### Building the Plugin

```bash
yarn build
```

### Running Tests

```bash
yarn test
```

### Linting

```bash
yarn lint
```

## Contributing

This plugin follows the official Backstage plugin development patterns and can be contributed back to the RHDH plugins repository.

## License

Apache-2.0 License - see LICENSE file for details.
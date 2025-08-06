# RHDH Orchestrator Actions Plugin - Installation Guide

## Quick Installation

### 1. Install the Plugin

```bash
yarn add @rhdh/plugin-orchestrator-actions-backend
```

### 2. Add to Backend

```typescript
// packages/backend/src/index.ts
import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

// Add MCP Actions Plugin (base functionality)
backend.add(import('@backstage/plugin-mcp-actions-backend'));

// Add RHDH Orchestrator Actions Plugin (extension)
backend.add(import('@rhdh/plugin-orchestrator-actions-backend'));

backend.start();
```

### 3. Configure App Config

```yaml
# app-config.yaml
backend:
  actions:
    pluginSources:
      - 'catalog'                    # Default actions
      - 'rhdh-orchestrator-actions'  # RHDH orchestrator actions

# Optional: Configure orchestrator endpoint
orchestrator:
  baseUrl: 'http://your-orchestrator-api.com'
```

### 4. Test Installation

```bash
# Test MCP tools discovery
curl -X POST http://localhost:7007/api/mcp-actions/v1 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## LLM Client Configuration

### Claude Code CLI

```bash
# Add MCP server
claude mcp add --transport http rhdh-orchestrator http://localhost:7007/api/mcp-actions/v1

# Test connection
claude mcp get rhdh-orchestrator
```

### Project-Level Configuration

Create `.mcp.json`:

```json
{
  "mcpServers": {
    "rhdh-orchestrator": {
      "command": null,
      "transport": {
        "type": "http",
        "url": "http://localhost:7007/api/mcp-actions/v1"
      },
      "description": "RHDH Orchestrator MCP Tools via Backstage",
      "scope": "project"
    }
  }
}
```

## Verification

You should see 6 orchestrator tools available:
- `orchestrator:workflows:overview`
- `orchestrator:workflow:source`
- `orchestrator:workflow:inputSchema`
- `orchestrator:workflow:execute`
- `orchestrator:instance:get`
- `orchestrator:instances:list`

## Troubleshooting

### Plugin Not Loading
Check backend logs for:
```
🔧 Initializing RHDH Orchestrator Actions Plugin for MCP
✅ Successfully registered 6 RHDH orchestrator actions for MCP
```

### Tools Not Available
Verify `pluginSources` configuration includes `'rhdh-orchestrator-actions'`

### Connection Issues
Test the MCP endpoint health:
```bash
curl http://localhost:7007/api/mcp-actions/v1/health
```
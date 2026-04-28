# @red-hat-developer-hub/backstage-plugin-orchestrator-mcp-extras

## 0.1.0

### Minor Changes

- Initial release of the Orchestrator MCP extras plugin
- Register three MCP actions for the RHDH Orchestrator backend API:
  - `orchestrator:workflows:list` - List available orchestrator workflows
  - `orchestrator:workflow:execute` - Execute a workflow by ID with input data
  - `orchestrator:instance:get` - Get workflow instance status and details
- Service-to-service authentication with credential forwarding
- Dynamic plugin support for RHDH deployment

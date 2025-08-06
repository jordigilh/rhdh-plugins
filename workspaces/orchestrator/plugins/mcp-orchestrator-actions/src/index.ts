/**
 * RHDH Orchestrator Actions Plugin for Backstage MCP Actions Backend
 * 
 * Entry point for the extractable RHDH orchestrator actions plugin.
 * This plugin extends the Backstage MCP Actions Plugin with RHDH orchestrator functionality.
 */

export { rhdhOrchestratorActionsPlugin, rhdhOrchestratorActionsPlugin as default } from './plugin';

// Re-export types and schemas for advanced usage
export type { Plugin } from '@backstage/backend-plugin-api';
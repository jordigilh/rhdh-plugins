export interface Config {
  /**
   * Configuration for the RHDH Orchestrator integration.
   * @visibility backend
   */
  orchestrator?: {
    /**
     * Base URL for the RHDH Orchestrator API
     * @visibility backend
     */
    baseUrl?: string;
  };
}
/**
 * Shared platform client for the MCP server. Reuses the exact same client the
 * CLI uses (from @invariance/soma-cli/agent-core) so the two surfaces never
 * drift in how they reach the Soma backend or shape its data.
 */

import { platformClientFromEnv, type PlatformClient } from "@invariance/soma-cli/agent-core";

let cached: PlatformClient | null = null;

/** A process-wide client built from env (SOMA_BACKEND_URL/ADMIN_TOKEN/WORKSPACE_ID). */
export function client(): PlatformClient {
  if (!cached) cached = platformClientFromEnv();
  return cached;
}

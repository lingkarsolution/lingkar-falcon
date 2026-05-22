import type { FastifyPluginAsync } from "fastify";

// ---------------------------------------------------------------------------
// Public config — only expose values that are safe to send to the browser.
// Never include secrets, tokens, or connection strings here.
// ---------------------------------------------------------------------------

interface AppConfig {
  appName: string;
  appVersion: string;
  environment: string;
  featureFlags: {
    analyticsEnabled: boolean;
    maintenanceMode: boolean;
  };
}

function buildConfig(): AppConfig {
  return {
    appName: process.env.APP_NAME ?? "Dark Factory Starter",
    appVersion: process.env.APP_VERSION ?? "1.0.0",
    environment: process.env.NODE_ENV ?? "development",
    featureFlags: {
      analyticsEnabled: process.env.FEATURE_ANALYTICS_ENABLED === "true",
      maintenanceMode: process.env.FEATURE_MAINTENANCE_MODE === "true",
    },
  };
}

export const configRoutes: FastifyPluginAsync = async (fastify) => {
  /** GET /api/config — returns public runtime configuration */
  fastify.get("/config", async (_request, reply) => {
    return reply.send({ data: buildConfig() });
  });
};

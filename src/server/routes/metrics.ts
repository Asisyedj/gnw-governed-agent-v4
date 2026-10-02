import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";
import { getInterlock } from "../repo.js";
import { renderMetrics } from "../metrics.js";
declare module "fastify" { interface FastifyInstance { db: Db; } }
export const metricsRoutes: FastifyPluginAsync = async app => {
  app.get("/metrics", async (_req, reply) => {
    const lock = await getInterlock(app.db);
    return reply.type("text/plain; version=0.0.4").send(renderMetrics(lock));
  });
};

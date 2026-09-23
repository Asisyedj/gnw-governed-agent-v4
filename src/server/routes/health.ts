import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";
import { getInterlock } from "../repo.js";

declare module "fastify" {
  interface FastifyInstance { db: Db; }
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_req, reply) => {
    return reply.send({ ok: true, ts: new Date().toISOString() });
  });

  app.get("/ready", async (_req, reply) => {
    try {
      const lock = await getInterlock(app.db);
      const degraded = lock.killSwitch || lock.circuitOpen;
      return reply.status(degraded ? 503 : 200).send({
        ok: !degraded,
        killSwitch: lock.killSwitch,
        circuitOpen: lock.circuitOpen,
        generation: lock.generation,
        ts: new Date().toISOString(),
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(503).send({ ok: false, error: "DB unavailable" });
    }
  });
};

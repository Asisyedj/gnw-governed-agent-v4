import { readFileSync } from "node:fs";
import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";
import { getInterlock } from "../repo.js";

declare module "fastify" {
  interface FastifyInstance { db: Db; }
}

const APP_VERSION = (JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8")
) as { version?: string }).version ?? "unknown";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_req, reply) => {
    return reply.send({
      status: "ok",
      ok: true,
      version: APP_VERSION,
      ts: new Date().toISOString()
    });
  });

  app.get("/ready", async (_req, reply) => {
    try {
      const lock = await getInterlock(app.db);
      return reply.status(200).send({
        ok: true,
        status: lock.killSwitch || lock.circuitOpen ? "degraded" : "ready",
        governedActionsReady: !lock.killSwitch && !lock.circuitOpen,
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

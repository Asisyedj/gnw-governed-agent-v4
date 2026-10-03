import { readFileSync } from "node:fs";
import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";
import { getInterlock } from "../repo.js";
import { ENV } from "../env.js";

declare module "fastify" {
  interface FastifyInstance { db: Db; }
}

const APP_VERSION = (JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8")
) as { version?: string }).version ?? "unknown";

function executionDependenciesReady():boolean {
  const executorReady=Boolean(ENV.executorUrl&&ENV.executorSecret);
  const grantsReady=!ENV.requireSignedGrants || Boolean(ENV.grantPrivateKeyPem&&ENV.grantPublicKeyPem&&ENV.leasePrivateKeyPem&&ENV.leasePublicKeyPem);
  const teeReady=!ENV.teeAttestationRequired || Boolean(ENV.teeAttestationIssuer&&ENV.teeAttestationPublicKeyPem&&/^[0-9a-f]{64}$/.test(ENV.teeAttestationMeasurement));
  const mpcReady=!ENV.requireMpcTrustAnchor || Boolean(ENV.mpcTrustAnchor&&ENV.mpcTrustAnchor.requireTee);
  const releaseBindingReady=!ENV.isProduction || Boolean(process.env.GNW_RELEASE_COMMIT_SHA||process.env.GITHUB_SHA);
  return executorReady&&grantsReady&&teeReady&&mpcReady&&releaseBindingReady;
}

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
      const dependenciesReady=executionDependenciesReady();
      const degraded=lock.killSwitch||lock.circuitOpen;
      if(!dependenciesReady) {
        return reply.status(503).send({
          ok:false,
          status:"not_ready",
          governedActionsReady:false,
          dependenciesReady:false,
          killSwitch:lock.killSwitch,
          circuitOpen:lock.circuitOpen,
          generation:lock.generation,
          ts:new Date().toISOString(),
        });
      }
      return reply.status(200).send({
        ok:true,
        status:degraded?"degraded":"ready",
        governedActionsReady:!degraded,
        dependenciesReady:true,
        killSwitch:lock.killSwitch,
        circuitOpen:lock.circuitOpen,
        generation:lock.generation,
        ts:new Date().toISOString(),
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(503).send({ ok: false, error: "DB unavailable" });
    }
  });
};

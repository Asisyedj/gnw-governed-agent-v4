import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";

export const requestIdPlugin: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (req) => {
    (req as unknown as Record<string, unknown>)["requestId"] =
      (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
  });
};

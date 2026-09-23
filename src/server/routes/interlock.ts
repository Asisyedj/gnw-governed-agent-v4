import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { resolveSession } from "./auth.js";
import { findUserById, getInterlock, setInterlock, insertAuditLog } from "../repo.js";
import type { Db } from "../db/index.js";

declare module "fastify" { interface FastifyInstance { db: Db; } }

const patchSchema = z.object({
  killSwitch: z.boolean().optional(),
  circuitOpen: z.boolean().optional(),
}).refine(d => d.killSwitch !== undefined || d.circuitOpen !== undefined, { message: "Provide at least one field" });

export const interlockRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req, reply) => {
    const session = await resolveSession(app.db, req.cookies as Record<string, string>);
    if (!session) return reply.status(401).send({ error: "Unauthenticated" });
    const lock = await getInterlock(app.db);
    return reply.send(lock);
  });

  app.patch("/", async (req, reply) => {
    const session = await resolveSession(app.db, req.cookies as Record<string, string>);
    if (!session) return reply.status(401).send({ error: "Unauthenticated" });

    const user = await findUserById(app.db, session.userId, session.tenantId);
    if (!user) return reply.status(401).send({ error: "Unauthenticated" });
    if (!(["owner", "admin"] as string[]).includes(user.role)) {
      return reply.status(403).send({ error: "Only owner/admin can modify interlock.", code: "forbidden" });
    }

    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid input", details: parsed.error.issues });

    const updated = await setInterlock(app.db, parsed.data, session.userId);
    await insertAuditLog(app.db, {
      eventType: "interlock.update",
      actorId: session.userId,
      tenantId: session.tenantId,
      outcome: "success",
      detail: { patch: parsed.data, generation: updated.generation },
      ipAddress: req.ip,
    });
    return reply.send({ ok: true, interlock: updated });
  });
};

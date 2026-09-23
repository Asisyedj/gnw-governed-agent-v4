import type { FastifyPluginAsync } from "fastify";
import { resolveSession } from "./auth.js";
import { findUserById, findTenantBySlug, countUsersByTenant } from "../repo.js";
import type { Db } from "../db/index.js";

declare module "fastify" { interface FastifyInstance { db: Db; } }

const ALLOW_SELF_REGISTRATION = process.env.ALLOW_SELF_REGISTRATION === "true";

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.get("/me", async (req, reply) => {
    const session = await resolveSession(app.db, req.cookies as Record<string, string>);
    const tenant = await findTenantBySlug(app.db, "default");
    const count = tenant ? await countUsersByTenant(app.db, tenant.id) : 0;
    const bootstrap = !tenant || count === 0;

    if (!session) {
      return reply.send({ user: null, bootstrap, allowSelfRegistration: bootstrap || ALLOW_SELF_REGISTRATION });
    }

    const user = await findUserById(app.db, session.userId, session.tenantId);
    if (!user) {
      return reply.send({ user: null, bootstrap, allowSelfRegistration: bootstrap || ALLOW_SELF_REGISTRATION });
    }

    return reply.send({
      user: { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId },
      bootstrap,
      allowSelfRegistration: ALLOW_SELF_REGISTRATION,
    });
  });
};

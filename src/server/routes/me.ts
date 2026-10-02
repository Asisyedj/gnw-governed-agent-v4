import type { FastifyPluginAsync } from 'fastify';
import { resolveSession } from './auth.js';
import { findUserById } from '../repo.js';
import type { Db } from '../db/index.js';

declare module 'fastify' { interface FastifyInstance { db: Db; } }

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me', async (req, reply) => {
    const session = await resolveSession(app.db, req.cookies as Record<string, string>);
    if (!session) return reply.status(401).send({ error: 'Unauthenticated', code: 'unauthenticated' });

    const user = await findUserById(app.db, session.userId, session.tenantId);
    if (!user) return reply.status(401).send({ error: 'Unauthenticated', code: 'unauthenticated' });

    return reply.send({
      user: { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId },
      allowSelfRegistration: false,
    });
  });
};

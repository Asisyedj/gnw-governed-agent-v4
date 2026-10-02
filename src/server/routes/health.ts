import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/index.js';
import { getInterlock } from '../repo.js';
declare module 'fastify' { interface FastifyInstance { db: Db; } }
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (_req, reply) => reply.send({
    status:'ok', ok:true, version:process.env.APP_VERSION??'1.0.0', ts:new Date().toISOString()
  }));
  app.get('/ready', async (_req, reply) => {
    try {
      const lock=await getInterlock(app.db);
      const degraded=Boolean(lock.killSwitch||lock.circuitOpen);
      return reply.status(200).send({
        status:degraded?'degraded':'ok', ok:!degraded, serviceReady:true,
        killSwitch:lock.killSwitch, circuitOpen:lock.circuitOpen, generation:lock.generation, ts:new Date().toISOString()
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(503).send({status:'degraded',ok:false,serviceReady:false,error:'DB unavailable'});
    }
  });
};

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { resolveSession } from './auth.js';
import { findUserById, getInterlock, setInterlock, insertAuditLog } from '../repo.js';
import type { Db } from '../db/index.js';
declare module 'fastify' { interface FastifyInstance { db: Db; } }

const patchSchema = z.object({ killSwitch:z.boolean().optional(), circuitOpen:z.boolean().optional() })
  .refine(d=>d.killSwitch!==undefined||d.circuitOpen!==undefined,{message:'Provide at least one field'});
const enabledSchema = z.object({ enabled:z.boolean() });

async function authorizeMutation(app:{db:Db},req:any,reply:any){
  const s=await resolveSession(app.db,req.cookies as Record<string,string>);
  if(!s){reply.status(401).send({error:'Unauthenticated',code:'unauthenticated'});return null;}
  const u=await findUserById(app.db,s.userId,s.tenantId);
  if(!u){reply.status(401).send({error:'Unauthenticated',code:'unauthenticated'});return null;}
  if(!['owner','admin'].includes(u.role)){reply.status(403).send({error:'Only owner/admin can modify interlock.',code:'forbidden'});return null;}
  return {s,u};
}

async function applyPatch(app:{db:Db},req:any,reply:any,patch:Partial<{killSwitch:boolean;circuitOpen:boolean}>){
  const actor=await authorizeMutation(app,req,reply); if(!actor)return;
  const updated=await setInterlock(app.db,patch,actor.s.userId);
  const eventType=patch.killSwitch!==undefined?'kill_switch.engage':'circuit_breaker.update';
  await insertAuditLog(app.db,{eventType,actorId:actor.s.userId,tenantId:actor.s.tenantId,outcome:'success',detail:{patch,generation:updated.generation},ipAddress:req.ip});
  return reply.send({ok:true,interlock:updated});
}

export const interlockRoutes: FastifyPluginAsync = async app => {
  app.get('/', async (_req,reply)=>reply.send(await getInterlock(app.db)));

  app.patch('/', async (req,reply)=>{
    const p=patchSchema.safeParse(req.body);
    if(!p.success)return reply.status(400).send({error:'Invalid input',details:p.error.issues});
    const patch:Partial<{killSwitch:boolean;circuitOpen:boolean}>={};
    if(p.data.killSwitch!==undefined)patch.killSwitch=p.data.killSwitch;
    if(p.data.circuitOpen!==undefined)patch.circuitOpen=p.data.circuitOpen;
    return applyPatch(app,req,reply,patch);
  });

  app.post('/kill-switch', async (req,reply)=>{
    const p=enabledSchema.safeParse(req.body);
    if(!p.success)return reply.status(400).send({error:'Invalid input'});
    return applyPatch(app,req,reply,{killSwitch:p.data.enabled});
  });

  app.post('/circuit-breaker', async (req,reply)=>{
    const p=enabledSchema.safeParse(req.body);
    if(!p.success)return reply.status(400).send({error:'Invalid input'});
    return applyPatch(app,req,reply,{circuitOpen:p.data.enabled});
  });
};

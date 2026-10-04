import type { FastifyPluginAsync } from "fastify";
import { sql, eq, and } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import { schema, type Db } from "../db/index.js";
import { findTenantBySlug, findUserByEmail, updateUserLastLogin, countUsersByTenant, createSession, findSessionByTokenHash, deleteSession, insertAuditLog } from "../repo.js";

declare module "fastify" { interface FastifyInstance { db: Db; } }

const { tenants, users } = schema;
const SESSION_TTL_MS=7*24*60*60*1000;
const SALT_ROUNDS=12;
const DEFAULT_TENANT_SLUG="default";
const ALLOW_SELF_REGISTRATION=process.env.ALLOW_SELF_REGISTRATION==="true";
const MAX_USERS_PER_TENANT=50;

class RegistrationError extends Error { constructor(public readonly code:string){super(code);} }
function hashToken(token:string){return createHash("sha256").update(token).digest("hex");}
function setCookieToken(reply:unknown,token:string){
  (reply as {setCookie:(n:string,v:string,o:unknown)=>void}).setCookie("session",token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:SESSION_TTL_MS/1000});
}
const loginSchema=z.object({email:z.string().email(),password:z.string().min(1)});
const registerSchema=z.object({email:z.string().email(),password:z.string().min(12)});

export const authRoutes:FastifyPluginAsync=async(app)=>{
  app.get("/bootstrap",async(_req,reply)=>{
    const tenant=await findTenantBySlug(app.db,DEFAULT_TENANT_SLUG);
    if(!tenant)return reply.send({bootstrap:true,allowSelfRegistration:true});
    const count=await countUsersByTenant(app.db,tenant.id);
    return reply.send({bootstrap:count===0,allowSelfRegistration:ALLOW_SELF_REGISTRATION});
  });

  app.post("/register",async(req,reply)=>{
    const parsed=registerSchema.safeParse(req.body);
    if(!parsed.success)return reply.status(400).send({error:"Invalid input",code:"invalid_input"});
    const {email,password}=parsed.data;
    const passwordHash=await bcrypt.hash(password,SALT_ROUNDS);

    let result:{tenantId:number;userId:number;role:"owner"|"viewer"};
    try{
      result=await app.db.transaction(async tx=>{
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('gnw:default-bootstrap-registration'))`);
        let tenant=await tx.query.tenants.findFirst({where:eq(tenants.slug,DEFAULT_TENANT_SLUG)});
        if(!tenant){
          const [created]=await tx.insert(tenants).values({slug:DEFAULT_TENANT_SLUG,displayName:"Default Workspace"}).returning();
          tenant=created!;
        }
        await tx.execute(sql`select set_config('app.tenant_id', ${String(tenant.id)}, true)`);
        const [row]=await tx.select({count:sql<number>`count(*)`}).from(users).where(eq(users.tenantId,tenant.id));
        const count=Number(row?.count??0);
        const isBootstrap=count===0;
        if(!isBootstrap&&!ALLOW_SELF_REGISTRATION)throw new RegistrationError("registration_closed");
        if(count>=MAX_USERS_PER_TENANT)throw new RegistrationError("limit_reached");
        const existing=await tx.query.users.findFirst({where:and(eq(users.email,email.trim().toLowerCase()),eq(users.tenantId,tenant.id))});
        if(existing)throw new RegistrationError("email_taken");
        const role=isBootstrap?"owner":"viewer";
        const [user]=await tx.insert(users).values({tenantId:tenant.id,email:email.trim().toLowerCase(),passwordHash,role}).returning();
        return {tenantId:tenant.id,userId:user!.id,role};
      });
    }catch(e){
      if(e instanceof RegistrationError){
        const map:Record<string,[number,string]>={registration_closed:[403,"Self-registration is disabled."],limit_reached:[403,"Workspace user limit reached."],email_taken:[409,"Email already registered."]};
        const [status,message]=map[e.code]??[409,e.code];
        return reply.status(status).send({error:message,code:e.code});
      }
      throw e;
    }

    const token=randomBytes(32).toString("hex");
    await createSession(app.db,result.userId,result.tenantId,hashToken(token),new Date(Date.now()+SESSION_TTL_MS));
    setCookieToken(reply,token);
    await insertAuditLog(app.db,{eventType:"user.register",actorId:result.userId,tenantId:result.tenantId,outcome:"success",ipAddress:req.ip});
    return reply.status(201).send({ok:true});
  });

  app.post("/login",async(req,reply)=>{
    const parsed=loginSchema.safeParse(req.body);
    if(!parsed.success)return reply.status(400).send({error:"Invalid input",code:"invalid_input"});
    const {email,password}=parsed.data;
    const tenant=await findTenantBySlug(app.db,DEFAULT_TENANT_SLUG);
    if(!tenant)return reply.status(401).send({error:"Invalid credentials.",code:"invalid_credentials"});
    const user=await findUserByEmail(app.db,tenant.id,email);
    if(!user){await bcrypt.hash(password,SALT_ROUNDS);return reply.status(401).send({error:"Invalid credentials.",code:"invalid_credentials"});}
    const valid=await bcrypt.compare(password,user.passwordHash);
    if(!valid){await insertAuditLog(app.db,{eventType:"user.login_failed",actorId:user.id,tenantId:tenant.id,outcome:"failure",ipAddress:req.ip});return reply.status(401).send({error:"Invalid credentials.",code:"invalid_credentials"});}
    const token=randomBytes(32).toString("hex");
    await createSession(app.db,user.id,tenant.id,hashToken(token),new Date(Date.now()+SESSION_TTL_MS));
    await updateUserLastLogin(app.db,user.id,tenant.id);
    setCookieToken(reply,token);
    await insertAuditLog(app.db,{eventType:"user.login",actorId:user.id,tenantId:tenant.id,outcome:"success",ipAddress:req.ip});
    return reply.send({ok:true});
  });

  app.post("/logout",async(req,reply)=>{
    const token=(req.cookies as Record<string,string>)["session"];
    if(token){
      const session=await findSessionByTokenHash(app.db,hashToken(token));
      if(session){await deleteSession(app.db,session.id);await insertAuditLog(app.db,{eventType:"user.logout",actorId:session.userId,tenantId:session.tenantId,outcome:"success",ipAddress:req.ip});}
    }
    reply.clearCookie("session",{path:"/"});
    return reply.send({ok:true});
  });
};

export async function resolveSession(db:Db,cookies:Record<string,string>){
  const token=cookies["session"];if(!token)return null;
  const session=await findSessionByTokenHash(db,hashToken(token));if(!session)return null;
  if(session.expiresAt<new Date()){await deleteSession(db,session.id,session.tenantId);return null;}
  return session;
}
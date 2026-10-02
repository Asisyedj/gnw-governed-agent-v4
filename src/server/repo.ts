import { eq,and,desc,asc,sql,lt } from "drizzle-orm";
import type { Db } from "./db/index.js";
import { withTenant } from "./db/index.js";
import { schema } from "./db/index.js";
import type { Interlock } from "./governance.js";
import { randomUUID } from "node:crypto";
const {tenants,users,sessions,tasks,taskSteps,approvals,nonces,interlocks,auditLog,budgetReservations,artifacts}=schema;
const tenantRead=withTenant;
export async function findTenantBySlug(db:Db,slug:string){return db.query.tenants.findFirst({where:eq(tenants.slug,slug)});}
export async function createTenant(db:Db,slug:string,displayName:string){const[r]=await db.insert(tenants).values({slug,displayName}).returning();return r!;}
export async function findUserByEmail(db:Db,tenantId:number,email:string){return tenantRead(db,tenantId,tx=>tx.query.users.findFirst({where:and(eq(users.email,email.trim().toLowerCase()),eq(users.tenantId,tenantId))}));}
export async function findUserById(db:Db,id:number,tenantId:number){return tenantRead(db,tenantId,tx=>tx.query.users.findFirst({where:and(eq(users.id,id),eq(users.tenantId,tenantId))}));}
export async function countUsersByTenant(db:Db,tenantId:number){return tenantRead(db,tenantId,async tx=>{const[r]=await tx.select({count:sql<number>`count(*)`}).from(users).where(eq(users.tenantId,tenantId));return Number(r?.count??0);});}
export async function createUser(db:Db,input:{tenantId:number;email:string;passwordHash:string;role?:"owner"|"admin"|"operator"|"viewer"}){return tenantRead(db,input.tenantId,async tx=>{const[r]=await tx.insert(users).values({tenantId:input.tenantId,email:input.email.trim().toLowerCase(),passwordHash:input.passwordHash,role:input.role??"viewer"}).returning();return r!;});}
export async function updateUserLastLogin(db:Db,userId:number,tenantId:number){await tenantRead(db,tenantId,tx=>tx.update(users).set({lastLoginAt:new Date(),updatedAt:new Date()}).where(and(eq(users.id,userId),eq(users.tenantId,tenantId))));}
export async function listUsersByTenant(db:Db,tenantId:number){return tenantRead(db,tenantId,tx=>tx.query.users.findMany({where:eq(users.tenantId,tenantId),orderBy:asc(users.id)}));}
export async function createSession(db:Db,userId:number,tenantId:number,tokenHash:string,expiresAt:Date){return tenantRead(db,tenantId,async tx=>{const[r]=await tx.insert(sessions).values({id:randomUUID(),userId,tenantId,tokenHash,expiresAt}).returning();return r!;});}
export async function findSessionByTokenHash(db:Db,tokenHash:string){return db.query.sessions.findFirst({where:eq(sessions.tokenHash,tokenHash)});}
export async function deleteSession(db:Db,id:string){await db.delete(sessions).where(eq(sessions.id,id));}
export async function deleteExpiredSessions(db:Db){await db.delete(sessions).where(lt(sessions.expiresAt,new Date()));}
export async function createTask(db:Db,input:{tenantId:number;createdByUserId:number;title:string;description?:string;classification?:string;budgetTokensAllocated?:number;budgetBytesAllocated?:number;metadata?:unknown}){return tenantRead(db,input.tenantId,async tx=>{const[r]=await tx.insert(tasks).values({tenantId:input.tenantId,createdByUserId:input.createdByUserId,title:input.title,description:input.description??null,classification:input.classification??"standard",budgetTokensAllocated:input.budgetTokensAllocated??10000,budgetBytesAllocated:input.budgetBytesAllocated??10485760,metadata:input.metadata??null}).returning();return r!;});}
export async function findTaskById(db:Db,id:number,tenantId:number){return tenantRead(db,tenantId,tx=>tx.query.tasks.findFirst({where:and(eq(tasks.id,id),eq(tasks.tenantId,tenantId))}));}
export async function listTasksByTenant(db:Db,tenantId:number,limit=50,offset=0){return tenantRead(db,tenantId,tx=>tx.query.tasks.findMany({where:eq(tasks.tenantId,tenantId),orderBy:desc(tasks.createdAt),limit,offset}));}
export async function updateTaskStatus(db:Db,id:number,tenantId:number,status:"pending"|"running"|"waiting_approval"|"done"|"failed"|"cancelled",errorMessage?:string){await tenantRead(db,tenantId,tx=>tx.update(tasks).set({status,errorMessage:errorMessage??null,updatedAt:new Date(),...(status==="running"?{startedAt:new Date()}:{}),...([ "done","failed","cancelled"].includes(status)?{completedAt:new Date()}: {})}).where(and(eq(tasks.id,id),eq(tasks.tenantId,tenantId))));}
export async function incrementTaskBudgetUsed(db:Db,id:number,tenantId:number,tokens:number,bytes:number){await tenantRead(db,tenantId,tx=>tx.update(tasks).set({budgetTokensUsed:sql`${tasks.budgetTokensUsed}+${tokens}`,budgetBytesUsed:sql`${tasks.budgetBytesUsed}+${bytes}`,updatedAt:new Date()}).where(and(eq(tasks.id,id),eq(tasks.tenantId,tenantId))));}
export async function updateTaskTrajectory(db:Db,id:number,tenantId:number,rootHash:string,steps:number){await tenantRead(db,tenantId,tx=>tx.update(tasks).set({trajectoryRootHash:rootHash,trajectorySteps:steps,updatedAt:new Date()}).where(and(eq(tasks.id,id),eq(tasks.tenantId,tenantId))));}
export async function createTaskStep(db:Db,input:{taskId:number;tenantId:number;stepIndex:number;agentRole:string;toolName:string;operation:string;inputDigest:string;chainHash:string;prevChainHash?:string|null}){return tenantRead(db,input.tenantId,async tx=>{const[r]=await tx.insert(taskSteps).values({...input,prevChainHash:input.prevChainHash??null}).returning();return r!;});}
export async function updateTaskStep(db:Db,id:number,tenantId:number,update:{outputDigest?:string;status?:"pending"|"running"|"done"|"failed"|"denied";governanceDecision?:unknown;durationMs?:number;errorMessage?:string}){await tenantRead(db,tenantId,tx=>tx.update(taskSteps).set({...update,updatedAt:new Date()} as Record<string,unknown>).where(and(eq(taskSteps.id,id),eq(taskSteps.tenantId,tenantId))));}
export async function listTaskSteps(db:Db,taskId:number,tenantId:number){return tenantRead(db,tenantId,tx=>tx.query.taskSteps.findMany({where:and(eq(taskSteps.taskId,taskId),eq(taskSteps.tenantId,tenantId)),orderBy:asc(taskSteps.stepIndex)}));}
export async function createApproval(db:Db,input:{tenantId:number;taskId?:number;requestedByUserId?:number;actionDigest:string;requestId?:string;expiresAt:Date}){return tenantRead(db,input.tenantId,async tx=>{const[r]=await tx.insert(approvals).values({tenantId:input.tenantId,taskId:input.taskId??null,requestedByUserId:input.requestedByUserId??null,actionDigest:input.actionDigest,requestId:input.requestId??null,nonce:randomUUID(),expiresAt:input.expiresAt}).returning();return r!;});}
export async function findApprovalById(db:Db,id:number,tenantId:number){return tenantRead(db,tenantId,tx=>tx.query.approvals.findFirst({where:and(eq(approvals.id,id),eq(approvals.tenantId,tenantId))}));}
export async function findPendingApprovalByDigest(db:Db,tenantId:number,actionDigest:string){return tenantRead(db,tenantId,tx=>tx.query.approvals.findFirst({where:and(eq(approvals.tenantId,tenantId),eq(approvals.actionDigest,actionDigest),eq(approvals.status,"pending"))}));}
export async function listPendingApprovals(db:Db,tenantId:number){return tenantRead(db,tenantId,tx=>tx.query.approvals.findMany({where:and(eq(approvals.tenantId,tenantId),eq(approvals.status,"pending")),orderBy:asc(approvals.createdAt)}));}
export async function reviewApproval(db:Db,id:number,tenantId:number,reviewedByUserId:number,status:"approved"|"denied",reason?:string){return tenantRead(db,tenantId,async tx=>{const[r]=await tx.update(approvals).set({status,reason:reason??null,reviewedByUserId,reviewedAt:new Date()}).where(and(eq(approvals.id,id),eq(approvals.tenantId,tenantId),eq(approvals.status,"pending"))).returning();return r;});}
export async function claimNonce(db:Db,kind:string,nonce:string,taskId?:number){try{await db.insert(nonces).values({kind,nonce,taskId:taskId??null});return true;}catch{return false;}}
export async function getInterlock(db:Db):Promise<Interlock>{const r=await db.query.interlocks.findFirst({orderBy:desc(interlocks.updatedAt)});return r??{killSwitch:false,circuitOpen:false,generation:0};}
export async function setInterlock(db:Db,patch:Partial<Interlock>,updatedByUserId?:number){const c=await getInterlock(db);const[r]=await db.insert(interlocks).values({killSwitch:patch.killSwitch??c.killSwitch,circuitOpen:patch.circuitOpen??c.circuitOpen,generation:(c.generation??0)+1,updatedByUserId:updatedByUserId??null}).returning();return r!;}
export async function reserveBudget(db:Db,tenantId:number,taskId:number,grantNonce:string,tokens:number,bytes:number){return tenantRead(db,tenantId,async tx=>{try{await tx.insert(budgetReservations).values({tenantId,taskId,grantNonce,reservedTokens:tokens,reservedBytes:bytes});return true;}catch{return false;}});}
export async function insertAuditLog(db:Db,entry:{eventType:string;actorId?:number;tenantId?:number;taskId?:number;resourceType?:string;resourceId?:string;outcome?:"success"|"failure"|"denied"|"error";detail?:unknown;requestId?:string;ipAddress?:string}){if(entry.tenantId){return tenantRead(db,entry.tenantId,tx=>tx.insert(auditLog).values({...entry,detail:entry.detail??null}));}return db.insert(auditLog).values({...entry,detail:entry.detail??null});}
export async function listAuditLog(db:Db,tenantId:number,limit=100,offset=0){return tenantRead(db,tenantId,tx=>tx.query.auditLog.findMany({where:eq(auditLog.tenantId,tenantId),orderBy:desc(auditLog.createdAt),limit,offset}));}
export async function createArtifact(db:Db,input:{tenantId:number;taskId?:number;stepId?:number;storageKey:string;filename:string;contentType:string;size:number;sha256:string}){return tenantRead(db,input.tenantId,async tx=>{const[r]=await tx.insert(artifacts).values({...input,taskId:input.taskId??null,stepId:input.stepId??null}).returning();return r!;});}
export async function listArtifacts(db:Db,taskId:number,tenantId:number){return tenantRead(db,tenantId,tx=>tx.query.artifacts.findMany({where:and(eq(artifacts.taskId,taskId),eq(artifacts.tenantId,tenantId))}));}
export async function registerDefaultUserAtomic(db:Db,input:{tenantSlug:string;email:string;passwordHash:string;tokenHash:string;expiresAt:Date;allowSelfRegistration:boolean;maxUsers:number}){
 return db.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('gnw:default-bootstrap',0))`);
  let tenant=await tx.query.tenants.findFirst({where:eq(tenants.slug,input.tenantSlug)});
  if(!tenant){const[r]=await tx.insert(tenants).values({slug:input.tenantSlug,displayName:"Default Workspace"}).returning();tenant=r!;}
  await tx.execute(sql`select set_config('app.tenant_id',${String(tenant.id)},true)`);
  const[rCount]=await tx.select({count:sql<number>`count(*)`}).from(users).where(eq(users.tenantId,tenant.id));
  const count=Number(rCount?.count??0);
  if(count>0&&!input.allowSelfRegistration)throw new Error("registration_closed");
  if(count>=input.maxUsers)throw new Error("limit_reached");
  const email=input.email.trim().toLowerCase();
  const existing=await tx.query.users.findFirst({where:and(eq(users.email,email),eq(users.tenantId,tenant.id))});
  if(existing)throw new Error("email_taken");
  const[user]=await tx.insert(users).values({tenantId:tenant.id,email,passwordHash:input.passwordHash,role:count===0?"owner":"viewer"}).returning();
  if(!user)throw new Error("registration_failed");
  const[session]=await tx.insert(sessions).values({id:randomUUID(),userId:user.id,tenantId:tenant.id,tokenHash:input.tokenHash,expiresAt:input.expiresAt}).returning();
  if(!session)throw new Error("registration_failed");
  return{tenant,user,session};
 });
}
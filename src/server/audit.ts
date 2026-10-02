import type { Db } from "./db/index.js";
import { insertAuditLog, setInterlock } from "./repo.js";
import { randomUUID } from "node:crypto";

export type AuditEventType="auth.signin"|"auth.signout"|"auth.failed"|"user.register"|"user.login"|"user.login_failed"|"user.logout"|"task.create"|"task.cancel"|"task.approve"|"task.deny"|"task.stop"|"task.complete"|"task.fail"|"grant.issue"|"grant.deny"|"grant.expire"|"grant.replay"|"approval.create"|"approval.use"|"approval.expire"|"approval.replay"|"capability.lease"|"capability.consume"|"capability.signature_verified"|"capability.expire"|"governance.pass"|"governance.fail"|"governance.deny"|"kill_switch.engage"|"kill_switch.release"|"kill_switch_block"|"circuit_breaker_block"|"interlock.update"|"secret.rotate"|"backup.create"|"backup.verify"|"tool.invoke"|"tool.deny"|"tool.result"|"video.create"|"video.approve"|"video.deny"|"video.stop"|"workspace.create"|"workspace.update"|"user.create"|"user.update"|"user.role_change"|"admin.action"|"system.startup"|"system.readiness";
export interface AuditEvent{eventType:AuditEventType;actorId?:number|null;tenantId?:number|null;taskId?:number|null;resourceType?:string|null;resourceId?:string|null;outcome:"success"|"failure"|"denied";detail?:Record<string,unknown>|null;requestId?:string|null;ipAddress?:string|null;}

export async function audit(db:Db,event:AuditEvent,options:{required?:boolean}={}):Promise<void>{
 const entry:{eventType:string;actorId?:number;tenantId?:number;taskId?:number;resourceType?:string;resourceId?:string;outcome:"success"|"failure"|"denied";detail?:unknown;requestId?:string;ipAddress?:string}={eventType:event.eventType,outcome:event.outcome};
 if(event.actorId !== null && event.actorId !== undefined)entry.actorId=event.actorId;
 if(event.tenantId !== null && event.tenantId !== undefined)entry.tenantId=event.tenantId;
 if(event.taskId !== null && event.taskId !== undefined)entry.taskId=event.taskId;
 if(event.resourceType !== null && event.resourceType !== undefined)entry.resourceType=event.resourceType;
 if(event.resourceId !== null && event.resourceId !== undefined)entry.resourceId=event.resourceId;
 if(event.detail !== null && event.detail !== undefined)entry.detail=event.detail;
 if(event.requestId !== null && event.requestId !== undefined)entry.requestId=event.requestId;
 if(event.ipAddress !== null && event.ipAddress !== undefined)entry.ipAddress=event.ipAddress;
 try{await insertAuditLog(db,entry);}
 catch(err){
   if(options.required){
     try { await setInterlock(db,{circuitOpen:true},event.actorId ?? undefined); } catch { /* preserve the original audit failure */ }
     throw err;
   }
   console.error("[audit] failed to write audit log:",err);
 }
}

export function getRequestId(req:{headers:Record<string,string|string[]|undefined>}):string{
 const v=req.headers["x-request-id"];
 if(typeof v!=="string")return randomUUID();
 const id=v.trim();
 return /^[A-Za-z0-9._:-]{1,64}$/.test(id)?id:randomUUID();
}

export function getIpAddress(req:{ip?:string}):string{
 return typeof req.ip==="string"?req.ip:"";
}

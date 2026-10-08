import { ImmutableLedger, type LedgerEventType, type LedgerTaskStatus } from "../ledger/ImmutableLedger.js";

export type ApexTransition = "TASK_CREATED"|"TASK_STARTED"|"TASK_WAITING_APPROVAL"|"PROOF_RECORDED"|"TASK_VERIFIED"|"TASK_COMPLETED"|"TASK_FAILED"|"TASK_CANCELLED";
const events:Record<ApexTransition,LedgerEventType>={TASK_CREATED:"TASK_CREATED",TASK_STARTED:"TASK_STARTED",TASK_WAITING_APPROVAL:"TASK_WAITING_APPROVAL",PROOF_RECORDED:"PROOF_RECORDED",TASK_VERIFIED:"TASK_VERIFIED",TASK_COMPLETED:"TASK_COMPLETED",TASK_FAILED:"TASK_FAILED",TASK_CANCELLED:"TASK_CANCELLED"};
export type ApexTask=Readonly<{taskId:string;missionId:string;status:LedgerTaskStatus;version:number;lastEventId:string}>;

export class ApexOrchestrator {
  private readonly tasks=new Map<string,ApexTask>();
  constructor(private readonly ledger:ImmutableLedger){}
  snapshot(taskId:string,missionId:string){const v=this.tasks.get(`${missionId}:${taskId}`);return v?structuredClone(v):undefined;}
  transition(i:{taskId:string;missionId:string;event:ApexTransition;payload:Record<string,unknown>;expectedVersion?:number;proofId?:string}):ApexTask{
    const key=`${i.missionId}:${i.taskId}`,cur=this.tasks.get(key);
    if(i.event==="TASK_CREATED"){if(cur)throw new Error("apex_task_already_exists");const e=this.ledger.append({eventId:`apex:${i.missionId}:${i.taskId}:1`,taskId:i.taskId,missionId:i.missionId,eventType:"TASK_CREATED",payload:structuredClone(i.payload) as never});const n:Object=ApexOrchestrator.freeze({taskId:i.taskId,missionId:i.missionId,status:"created",version:1,lastEventId:e.eventId});this.tasks.set(key,n as ApexTask);return structuredClone(n) as ApexTask;}
    if(!cur)throw new Error("apex_task_not_found");if(i.expectedVersion!==undefined&&i.expectedVersion!==cur.version)throw new Error("apex_version_conflict");if(cur.status==="done"||cur.status==="failed"||cur.status==="cancelled")throw new Error("apex_terminal_state");if(i.event==="TASK_VERIFIED"&&!i.proofId)throw new Error("apex_proof_required");
    const e=this.ledger.append({eventId:`apex:${i.missionId}:${i.taskId}:${cur.version+1}`,taskId:i.taskId,missionId:i.missionId,eventType:events[i.event],causalParentId:cur.lastEventId,...(i.proofId?{proofId:i.proofId}:{}),payload:structuredClone(i.payload) as never});const status=this.ledger.getTaskStatus(i.taskId,i.missionId);if(!status)throw new Error("apex_ledger_state_missing");const n:Object=ApexOrchestrator.freeze({taskId:i.taskId,missionId:i.missionId,status,version:cur.version+1,lastEventId:e.eventId});this.tasks.set(key,n as ApexTask);return structuredClone(n) as ApexTask;
  }
  verify(){return this.ledger.verify();}
  private static freeze<T extends object>(v:T):T{Object.freeze(v);return v;}
}

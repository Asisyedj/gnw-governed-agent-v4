export type OutboxStatus="PENDING"|"PROCESSING"|"FAILED"|"QUARANTINED"|"SENT";
export type OutboxRecord={id:string;tenantId:number;topic:string;payload:Record<string,unknown>;status:OutboxStatus;attempts:number;maxAttempts:number;availableAt:number;leaseOwner?:string;leaseExpiresAt?:number;idempotencyKey:string};
export type OutboxStore={recoverStale(now:number,owner:string):Promise<number>;claim(now:number,owner:string):Promise<OutboxRecord|undefined>;markSent(id:string,owner:string,receipt:string):Promise<void>;markFailed(id:string,owner:string,reason:string,next:number,quarantine:boolean):Promise<void>};
export type OutboxDispatcher=(r:OutboxRecord)=>Promise<{receipt:string}>;
export class StaleOutboxRecovery{
 constructor(private readonly store:OutboxStore,private readonly dispatch:OutboxDispatcher,private readonly owner:string,private readonly now=Date.now){}
 recover(){return this.store.recoverStale(this.now(),this.owner);}
 async processOne(){const r=await this.store.claim(this.now(),this.owner);if(!r)return"idle" as const;try{const d=await this.dispatch(r);if(!d.receipt||d.receipt.length>512)throw new Error("outbox_delivery_receipt_invalid");await this.store.markSent(r.id,this.owner,d.receipt);return"sent" as const;}catch(e){const reason=(e instanceof Error?e.message:String(e)).slice(0,1000),attempts=r.attempts+1,q=attempts>=r.maxAttempts,delay=Math.min(900000,1000*2**Math.min(attempts,10));await this.store.markFailed(r.id,this.owner,reason,this.now()+delay,q);return"failed" as const;}}
}

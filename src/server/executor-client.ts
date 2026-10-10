import { createHash, createHmac, randomUUID } from "node:crypto";
import type { Env } from "./env.js";
export type ExecutorResult={stdout:string;stderr:string;exitCode:number};
function bodyDigest(body:string){return createHash("sha256").update(body).digest("hex");}
function token(env:Env,requestId:string,issuedAt:number,digest:string){
  if(!env.executorSecret)throw new Error("executor_secret_missing");
  return createHmac("sha256",env.executorSecret).update(`gnw-executor-v2|${requestId}|${issuedAt}|${digest}`).digest("base64url");
}
export async function callExecutor(env:Env,command:string[],opts?:{cwd?:string;timeoutMs?:number;requestId?:string;actionDigest?:string;signal?:AbortSignal}):Promise<ExecutorResult>{
  if(!env.executorUrl)throw new Error("executor_url_not_configured");
  const url=new URL(`${env.executorUrl}/execute`);
  if(env.isProduction&&url.protocol!=="https:")throw new Error("executor_https_required");
  const requestId=opts?.requestId??randomUUID(),issuedAt=Date.now();
  if(env.isProduction&&!opts?.actionDigest)throw new Error("executor_action_digest_required");
  const payload=JSON.stringify({requestId,issuedAt,actionDigest:opts?.actionDigest??null,command,cwd:opts?.cwd,timeoutMs:opts?.timeoutMs??30_000});
  const digest=bodyDigest(payload);
  const res=await fetch(url,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${token(env,requestId,issuedAt,digest)}`,"x-gnw-request-id":requestId,"x-gnw-issued-at":String(issuedAt),"x-gnw-body-sha256":digest},body:payload,redirect:"error",signal:opts?.signal ? AbortSignal.any([opts.signal,AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000)});
  if(!res.ok)throw new Error(`Executor HTTP ${res.status}`);
  const data=await res.json() as unknown;
  if(!data||typeof data!=="object")throw new Error("executor_response_invalid");
  return data as ExecutorResult;
}
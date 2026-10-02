import { createHash, createHmac, timingSafeEqual } from "node:crypto";
export function executorBodyDigest(body:string){return createHash("sha256").update(body).digest("hex");}
export function makeExecutorToken(shared:string,requestId:string,issuedAt:number,bodyDigest:string){
  if(!shared) throw new Error("executor_secret_missing");
  return createHmac("sha256",shared).update(`gnw-executor-v2|${requestId}|${issuedAt}|${bodyDigest}`).digest("base64url");
}
export function verifyExecutorToken(token:string,shared:string,requestId:string,issuedAt:number,bodyDigest:string,now=Date.now(),maxSkewMs=60_000){
  if(!token||!shared||!requestId||!Number.isInteger(issuedAt)||Math.abs(now-issuedAt)>maxSkewMs)return false;
  try{const expected=makeExecutorToken(shared,requestId,issuedAt,bodyDigest),a=Buffer.from(token.trim()),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}catch{return false;}
}
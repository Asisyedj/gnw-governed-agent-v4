import { createHash } from "node:crypto";
import { canonicalize } from "./security.js";

export type ActionEnvelope={taskId:string;tenantId:string;actorId:string;operation:string;tool:string;parameters:unknown;grantId:string;nonce:string;issuedAt:number};
export type EnvelopeBinding={taskId:number|string;tenantId:number|string;actorId:number|string;grantId:string;nonce:string;operation:string;tool:string};
export function digestEnvelope(env:ActionEnvelope):string{
  const canonical=canonicalize([env.taskId,env.tenantId,env.actorId,env.operation,env.tool,env.parameters,env.grantId,env.nonce,env.issuedAt]);
  return createHash("sha256").update(canonical).digest("hex");
}
export function validateEnvelope(env:ActionEnvelope, nowMs=Date.now(), maxAgeMs=300_000, binding?:EnvelopeBinding):void{
  if(!env.taskId||!env.tenantId||!env.actorId||!env.operation||!env.tool||!env.grantId||!env.nonce)throw new Error("ActionEnvelope: missing required field");
  if(!Number.isInteger(env.issuedAt))throw new Error("ActionEnvelope: issuedAt invalid");
  const age=nowMs-env.issuedAt;if(age<0||age>maxAgeMs)throw new Error(`ActionEnvelope: issuedAt outside window (age=${age}ms)`);
  if(binding){
    if(String(env.taskId)!==String(binding.taskId)||String(env.tenantId)!==String(binding.tenantId)||String(env.actorId)!==String(binding.actorId))throw new Error("ActionEnvelope: context_binding");
    if(env.grantId!==binding.grantId||env.nonce!==binding.nonce||env.operation!==binding.operation||env.tool!==binding.tool)throw new Error("ActionEnvelope: authorization_binding");
  }
}
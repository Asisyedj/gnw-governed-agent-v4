import type { FastifyRequest } from "fastify";
import { ENV } from "./env.js";
export function isMcpRequestAllowed(req:FastifyRequest):boolean{
  const origin=typeof req.headers.origin==="string"?req.headers.origin:"";
  if(!origin)return Boolean(ENV.deepResearchMcpUrl&&ENV.deepResearchMcpLabel);
  if(ENV.corsOrigin&&origin===ENV.corsOrigin)return true;
  return false;
}
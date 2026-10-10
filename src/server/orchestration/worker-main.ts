import { hostname } from "node:os";
import { closeDb } from "../db/index.js";
import { runTenantWorker } from "./worker.js";

const rawTenantIds=process.env.GNW_WORKER_TENANT_IDS;
if(!rawTenantIds?.trim()) throw new Error("GNW_WORKER_TENANT_IDS is required; workers must be explicitly tenant-scoped");
const tenantIds=[...new Set(rawTenantIds.split(",").map(value=>Number(value.trim())))];
if(tenantIds.some(value=>!Number.isSafeInteger(value)||value<=0)) throw new Error("GNW_WORKER_TENANT_IDS must be comma-separated positive integers");

const shutdown=new AbortController();
const onSignal=()=>shutdown.abort("process_shutdown");
process.once("SIGINT",onSignal);
process.once("SIGTERM",onSignal);

try{
  const host=hostname().replace(/[^a-zA-Z0-9._-]/g,"-").slice(0,80);
  await Promise.all(tenantIds.map(tenantId=>runTenantWorker({
    tenantId,
    workerId:`${host}-${process.pid}-${tenantId}`,
    signal:shutdown.signal,
  })));
}catch(error){
  console.error(JSON.stringify({event:"gnw.worker.fatal",error:error instanceof Error?error.message:String(error)}));
  process.exitCode=1;
}finally{
  process.removeListener("SIGINT",onSignal);
  process.removeListener("SIGTERM",onSignal);
  await closeDb();
}

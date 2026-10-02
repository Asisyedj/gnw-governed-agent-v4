import "dotenv/config";
import { generateKeyPairSync } from "node:crypto";

const devEphemeralKeys=generateKeyPairSync("ed25519",{privateKeyEncoding:{type:"pkcs8",format:"pem"},publicKeyEncoding:{type:"spki",format:"pem"}});
export type Readiness="ok"|"missing"|"degraded";
export type ReadinessReport={ready:boolean;checks:Record<string,Readiness>;notes:Record<string,string>};
function bool(v:string|undefined,f=false){if(v===undefined)return f;return ["1","true","yes","on"].includes(v.toLowerCase());}
function int(v:string|undefined,f:number){const n=Number.parseInt(v??"",10);return Number.isFinite(n)?n:f;}
export function loadEnv(source:NodeJS.ProcessEnv=process.env){
 const nodeEnv=source.NODE_ENV??"development",isProduction=nodeEnv==="production";
 const executorSecret=source.EXECUTOR_SECRET??"";
 const grantPrivateKeyPem=source.GNW_GRANT_PRIVATE_KEY_PEM??(isProduction?"":devEphemeralKeys.privateKey);
 const grantPublicKeyPem=source.GNW_GRANT_PUBLIC_KEY_PEM??(isProduction?"":devEphemeralKeys.publicKey);
 const leasePrivateKeyPem=source.GNW_LEASE_PRIVATE_KEY_PEM??(isProduction?"":devEphemeralKeys.privateKey);
 return {
  nodeEnv,isProduction,isTest:nodeEnv==="test",port:int(source.PORT,8787),sessionSecret:source.SESSION_SECRET??(isProduction?"":"dev-insecure-secret"),
  databaseUrl:source.DATABASE_URL??"",postgresSslRequired:bool(source.GNW_POSTGRES_SSL_REQUIRED,isProduction),
  ownerEmail:(source.OWNER_EMAIL??"").trim().toLowerCase(),ownerPassword:source.OWNER_PASSWORD??"",allowSelfRegistration:bool(source.ALLOW_SELF_REGISTRATION,false),
  llmBaseUrl:(source.LLM_BASE_URL??"https://api.openai.com/v1").replace(/\/$/,""),llmApiKey:source.LLM_API_KEY??"",llmModel:source.LLM_MODEL??"gpt-4o-mini",
  deepResearchBaseUrl:(source.GNW_DEEP_RESEARCH_BASE_URL??source.LLM_BASE_URL??"https://api.openai.com/v1").replace(/\/$/,""),deepResearchApiKey:source.GNW_DEEP_RESEARCH_API_KEY??source.LLM_API_KEY??"",deepResearchModel:source.GNW_DEEP_RESEARCH_MODEL??"o3-deep-research",
  deepResearchMaxToolCalls:int(source.GNW_DEEP_RESEARCH_MAX_TOOL_CALLS,50),deepResearchTimeoutMs:int(source.GNW_DEEP_RESEARCH_TIMEOUT_MS,3600000),deepResearchUseCodeInterpreter:bool(source.GNW_DEEP_RESEARCH_USE_CODE_INTERPRETER,true),
  deepResearchAllowedDomains:(source.GNW_DEEP_RESEARCH_ALLOWED_DOMAINS??"").split(",").map(v=>v.trim().toLowerCase()).filter(Boolean),deepResearchMcpUrl:(source.GNW_DEEP_RESEARCH_MCP_URL??"").replace(/\/$/,""),deepResearchMcpLabel:(source.GNW_DEEP_RESEARCH_MCP_LABEL??"").trim(),
  llmTimeoutMs:int(source.LLM_TIMEOUT_MS,45000),storageDriver:(source.STORAGE_DRIVER??"local") as "local"|"s3",artifactDir:source.ARTIFACT_DIR??"./data/artifacts",
  s3:{bucket:source.S3_BUCKET??"",region:source.S3_REGION??"",endpoint:source.S3_ENDPOINT??"",accessKeyId:source.S3_ACCESS_KEY_ID??"",secretAccessKey:source.S3_SECRET_ACCESS_KEY??"",publicBaseUrl:source.S3_PUBLIC_BASE_URL??""},
  videoProvider:source.VIDEO_PROVIDER??"stub",videoProviderUrl:source.VIDEO_PROVIDER_URL??"",videoProviderApiKey:source.VIDEO_PROVIDER_API_KEY??"",notifyWebhookUrl:source.NOTIFY_WEBHOOK_URL??"",
  corsOrigin:source.CORS_ORIGIN??"same-origin",executorUrl:(source.EXECUTOR_URL??(isProduction?"":"http://localhost:8788")).replace(/\/$/,""),executorSecret,
  grantIssuer:source.GNW_GRANT_ISSUER??"gnw-dev",grantPrivateKeyPem,grantPublicKeyPem,leasePrivateKeyPem,requireSignedGrants:bool(source.GNW_REQUIRE_SIGNED_GRANTS,isProduction),
  councilMode:(source.GNW_COUNCIL_MODE??"disabled") as "disabled"|"shadow",killSwitchUrl:source.GNW_KILL_SWITCH_URL??"",egressAllowList:(source.GNW_EGRESS_ALLOW_LIST??"").split(",").map(s=>s.trim()).filter(Boolean),
  maxRequestBodyBytes:int(source.GNW_MAX_REQUEST_BODY_BYTES,10*1024*1024),rateLimitWindowMs:int(source.GNW_RATE_LIMIT_WINDOW_MS,60000),rateLimitMaxRequests:int(source.GNW_RATE_LIMIT_MAX_REQUESTS,120),
 } as const;
}
export type Env=ReturnType<typeof loadEnv>;
export const ENV:Env=loadEnv();

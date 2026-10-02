import type { Env } from "./env.js";
import { governedFetch } from "./security.js";
export type ChatMessage={role:"system"|"user"|"assistant";content:string};
export type LlmOptions={model?:string;temperature?:number;maxTokens?:number;timeoutMs?:number};
export type LlmResult={content:string;usage?:{promptTokens:number;completionTokens:number;totalTokens:number}};
export class LlmClient{
 constructor(private readonly env:Env){}
 async chat(messages:ChatMessage[],opts:LlmOptions={}):Promise<LlmResult>{
  const timeout=AbortSignal.timeout(opts.timeoutMs??this.env.llmTimeoutMs);
  const url=new URL(`${this.env.llmBaseUrl}/chat/completions`);
  if(this.env.isProduction&&!this.env.egressAllowList.some(rule=>rule===url.hostname.toLowerCase()||(rule.startsWith("*.")&&url.hostname.toLowerCase().endsWith(rule.slice(1)))))throw new Error("llm_destination_not_allowlisted");
  const body=JSON.stringify({model:opts.model??this.env.llmModel,messages,temperature:opts.temperature??0.3,max_tokens:opts.maxTokens});
  const resp=await governedFetch(url.toString(),{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${this.env.llmApiKey}`},body,signal:timeout,__allowedHosts:this.env.egressAllowList} as RequestInit&{__allowedHosts:readonly string[]},4*1024*1024);
  if(!resp.ok)throw new Error(`LLM API error: ${resp.status} ${resp.statusText}`);
  const json=await resp.json() as {choices:Array<{message:{content:string}}>;usage?:{prompt_tokens:number;completion_tokens:number;total_tokens:number}};
  const content=json.choices[0]?.message?.content??"";
  const usage=json.usage?{promptTokens:json.usage.prompt_tokens,completionTokens:json.usage.completion_tokens,totalTokens:json.usage.total_tokens}:undefined;
  return{content,usage};
 }
}
export function createLlmClient(env:Env){return new LlmClient(env);}
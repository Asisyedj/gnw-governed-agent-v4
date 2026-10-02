type Point={count:number;sumSeconds:number;buckets:number[]};
const points=new Map<string,Point>();
const BUCKETS=[0.05,0.1,0.25,0.5,1,2,5,10];
function label(v:string){return v.replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\n/g,"\\n");}
export function recordRequest(method:string,route:string,status:number,durationMs:number){
 const key=method+"|"+route+"|"+status;
 let p=points.get(key);
 if(!p){p={count:0,sumSeconds:0,buckets:Array(BUCKETS.length).fill(0)};points.set(key,p);}
 p.count+=1;p.sumSeconds+=durationMs/1000;
 for(let i=0;i<BUCKETS.length;i++) if(durationMs/1000<=BUCKETS[i]!) p.buckets[i]!+=1;
}
export function renderMetrics(interlock:{killSwitch:boolean;circuitOpen:boolean}){
 const out=[
  "# HELP gnw_kill_switch_active GNW kill switch state.",
  "# TYPE gnw_kill_switch_active gauge",
  `gnw_kill_switch_active ${interlock.killSwitch?1:0}`,
  "# HELP gnw_circuit_breaker_open GNW circuit breaker state.",
  "# TYPE gnw_circuit_breaker_open gauge",
  `gnw_circuit_breaker_open ${interlock.circuitOpen?1:0}`,
  "# HELP http_requests_total Total HTTP requests.",
  "# TYPE http_requests_total counter",
  "# HELP http_request_duration_seconds HTTP request duration.",
  "# TYPE http_request_duration_seconds histogram",
 ];
 for(const [key,p] of points){const [method,route,status]=key.split("|");let cumulative=0;for(let i=0;i<BUCKETS.length;i++){cumulative+=p.buckets[i]!;out.push(`http_request_duration_seconds_bucket{app="gnw",method="${label(method!)}",route="${label(route!)}",status="${label(status!)}",le="${BUCKETS[i]}"} ${cumulative}`);}out.push(`http_request_duration_seconds_bucket{app="gnw",method="${label(method!)}",route="${label(route!)}",status="${label(status!)}",le="+Inf"} ${p.count}`);out.push(`http_request_duration_seconds_sum{app="gnw",method="${label(method!)}",route="${label(route!)}",status="${label(status!)}"} ${p.sumSeconds}`);out.push(`http_request_duration_seconds_count{app="gnw",method="${label(method!)}",route="${label(route!)}",status="${label(status!)}"} ${p.count}`);out.push(`http_requests_total{app="gnw",method="${label(method!)}",route="${label(route!)}",status="${label(status!)}"} ${p.count}`);}
 return out.join("\n")+"\n";
}
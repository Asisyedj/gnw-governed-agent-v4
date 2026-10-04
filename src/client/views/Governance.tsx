import { useEffect, useState } from "react";
import { api, type GovernanceContract } from "../api";

export default function GovernanceView(){
 const [data,setData]=useState<GovernanceContract|null>(null);
 const [error,setError]=useState<string|null>(null);
 useEffect(()=>{void api.governance.contract().then(setData).catch((e:unknown)=>setError(e instanceof Error?e.message:"Failed to load"));},[]);
 if(error)return <div className="alert alert-error">{error}</div>;
 if(!data)return <div className="row"><span className="spinner"/><span className="muted">Loading governance contract…</span></div>;
 return <div className="gap-16">
  <div className="card"><div className="card-header"><span className="card-title">Governance pipeline</span><span className="muted text-sm">{data.pipeline.length} roles</span></div>
   <div className="gap-8">{data.pipeline.map((role,i)=><div key={role} className="row" style={{justifyContent:"space-between",padding:"10px 0",borderBottom:i===data.pipeline.length-1?"none":"1px solid var(--border)"}}>
    <span><span className="mono text-sm">{i+1}.</span> {role}</span><span className="muted text-xs">{data.roles.find(r=>r.role===role)?.capabilities.join(" · ")}</span>
   </div>)}</div>
  </div>
  <div className="grid-2">
   <div className="card"><div className="card-header"><span className="card-title">Justice dimensions</span></div>{data.justiceDimensions.map((d,i)=><div key={d} className="row" style={{padding:"8px 0"}}><span className="badge">{i+1}</span><span>{d.replaceAll("_"," ")}</span></div>)}</div>
   <div className="card"><div className="card-header"><span className="card-title">Non-negotiables</span></div>{Object.entries(data.invariants).map(([k,v])=><div key={k} className="row" style={{justifyContent:"space-between",padding:"8px 0"}}><span>{k}</span><span className={"status-chip "+(v?"status-done":"status-failed")}>{v?"ON":"OFF"}</span></div>)}</div>
  </div>
 </div>;
}
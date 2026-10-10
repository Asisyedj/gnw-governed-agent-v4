import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export type CancelResource = { name: string; close: (reason: string) => Promise<void> | void };

function waitForChildExit(child:ChildProcess,timeoutMs:number):Promise<boolean>{
  if(child.exitCode!==null||child.signalCode!==null) return Promise.resolve(true);
  return new Promise(resolve=>{
    let settled=false;
    const finish=(exited:boolean)=>{
      if(settled) return;
      settled=true;
      clearTimeout(timer);
      child.removeListener("exit",onExit);
      resolve(exited);
    };
    const onExit=()=>finish(true);
    const timer=setTimeout(()=>finish(child.exitCode!==null||child.signalCode!==null),timeoutMs);
    child.once("exit",onExit);
  });
}

function processGroupExists(pid:number):boolean{
  try{process.kill(-pid,0);return true;}
  catch(error){
    const code=(error as NodeJS.ErrnoException).code;
    if(code==="ESRCH") return false;
    if(code==="EPERM") return true;
    throw error;
  }
}

async function waitForProcessGroupExit(pid:number,timeoutMs:number):Promise<boolean>{
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    if(!processGroupExists(pid)) return true;
    await new Promise<void>(resolve=>setTimeout(resolve,50));
  }
  return !processGroupExists(pid);
}

function killWindowsProcessTree(pid:number):Promise<void>{
  return new Promise((resolve,reject)=>{
    execFile("taskkill.exe",["/PID",String(pid),"/T","/F"],{windowsHide:true,timeout:10_000},error=>{
      if(error) reject(error);
      else resolve();
    });
  });
}

export class ExecutionCancellation {
  private readonly controller = new AbortController();
  private readonly resources = new Map<string,CancelResource>();
  private cancellationPromise: Promise<void> | null = null;
  get signal(): AbortSignal { return this.controller.signal; }

  register(resource: CancelResource): () => void {
    if (this.controller.signal.aborted) throw new Error("CANCELLATION_ALREADY_STARTED");
    if (this.resources.has(resource.name)) throw new Error("DUPLICATE_CANCEL_RESOURCE");
    this.resources.set(resource.name,resource);
    return () => { this.resources.delete(resource.name); };
  }

  registerBrowserContext(name: string, context: { close: () => Promise<void> }): () => void {
    return this.register({name,close:()=>context.close()});
  }

  /**
   * On POSIX, callers must spawn the process with detached:true so its PID is a
   * dedicated process-group ID. On Windows, taskkill /T terminates the process tree.
   * Cancellation is confirmed only when the OS reports that the tree has exited.
   */
  registerChildProcess(name: string, child: ChildProcess, graceMs=1500): () => void {
    if (!Number.isInteger(graceMs) || graceMs < 100 || graceMs > 10000) throw new Error("INVALID_CANCEL_GRACE");
    return this.register({name,close:async()=>{
      const pid=child.pid;
      if(pid===undefined){
        if(child.exitCode!==null||child.signalCode!==null) return;
        throw new Error("PROCESS_PID_UNAVAILABLE");
      }

      if(process.platform==="win32"){
        if(child.exitCode!==null||child.signalCode!==null){
          throw new Error("WINDOWS_PROCESS_TREE_TERMINATION_UNCONFIRMED");
        }
        await killWindowsProcessTree(pid);
        if(!await waitForChildExit(child,Math.max(graceMs,1000))){
          throw new Error("WINDOWS_PROCESS_TREE_TERMINATION_UNCONFIRMED");
        }
        return;
      }

      // If the child was not detached, its PID is not its process-group ID. We may
      // signal the root as a best effort, but must not report the whole tree stopped.
      if(!processGroupExists(pid)){
        if(child.exitCode!==null||child.signalCode!==null) return;
        try{child.kill("SIGTERM");}catch{/* best effort; confirmation below is authoritative */}
        await waitForChildExit(child,graceMs);
        if(child.exitCode===null&&child.signalCode===null){
          try{child.kill("SIGKILL");}catch{/* confirmation below is authoritative */}
          await waitForChildExit(child,Math.max(graceMs,1000));
        }
        throw new Error("PROCESS_GROUP_UNAVAILABLE");
      }

      try{process.kill(-pid,"SIGTERM");}
      catch(error){
        if(!processGroupExists(pid)) return;
        throw new Error("PROCESS_GROUP_TERM_FAILED:"+(error instanceof Error?error.message:String(error)));
      }

      if(!await waitForProcessGroupExit(pid,graceMs)){
        try{process.kill(-pid,"SIGKILL");}
        catch(error){
          if(processGroupExists(pid)) throw new Error("PROCESS_GROUP_KILL_FAILED:"+(error instanceof Error?error.message:String(error)));
        }
        if(!await waitForProcessGroupExit(pid,Math.max(graceMs,1000))){
          throw new Error("PROCESS_TREE_TERMINATION_UNCONFIRMED");
        }
      }
    }});
  }

  cancel(reason="governed cancellation"): Promise<void> {
    if (this.cancellationPromise) return this.cancellationPromise;
    this.controller.abort(reason);
    const resources=[...this.resources.values()].reverse();
    this.cancellationPromise=(async()=>{
      const failures:string[]=[];
      for(const resource of resources){
        try{await resource.close(reason);}
        catch{failures.push(resource.name);}
      }
      this.resources.clear();
      if(failures.length) throw new Error("CANCELLATION_INCOMPLETE:"+failures.join(","));
    })();
    return this.cancellationPromise;
  }
}

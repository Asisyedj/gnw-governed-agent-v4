import type { ChildProcess } from "node:child_process";

export type CancelResource = { name: string; close: (reason: string) => Promise<void> | void };
export class ExecutionCancellation {
  private readonly controller = new AbortController();
  private readonly resources = new Map<string,CancelResource>();
  private cancellationPromise: Promise<void> | null = null;
  get signal(): AbortSignal { return this.controller.signal; }
  register(resource: CancelResource): () => void {
    if (this.controller.signal.aborted) {
      void Promise.resolve(resource.close(String(this.controller.signal.reason ?? "cancelled")));
      return () => undefined;
    }
    if (this.resources.has(resource.name)) throw new Error("DUPLICATE_CANCEL_RESOURCE");
    this.resources.set(resource.name,resource);
    return () => { this.resources.delete(resource.name); };
  }
  registerBrowserContext(name: string, context: { close: () => Promise<void> }): () => void {
    return this.register({name,close:()=>context.close()});
  }
  registerChildProcess(name: string, child: ChildProcess, graceMs=1500): () => void {
    if (!Number.isInteger(graceMs) || graceMs < 100 || graceMs > 10000) throw new Error("INVALID_CANCEL_GRACE");
    return this.register({name,close:async()=>{
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid,"SIGTERM");
        else child.kill("SIGTERM");
      } catch { try { child.kill("SIGTERM"); } catch { /* process may have exited */ } }
      await Promise.race([
        new Promise<void>(resolve=>child.once("exit",()=>resolve())),
        new Promise<void>(resolve=>setTimeout(resolve,graceMs))
      ]);
      if (child.exitCode === null && child.signalCode === null) {
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid,"SIGKILL");
          else child.kill("SIGKILL");
        } catch { try { child.kill("SIGKILL"); } catch { /* process may have exited */ } }
      }
    }});
  }
  cancel(reason="governed cancellation"): Promise<void> {
    if (this.cancellationPromise) return this.cancellationPromise;
    this.controller.abort(reason);
    const resources=[...this.resources.values()].reverse();
    this.cancellationPromise=(async()=>{
      const outcomes=await Promise.allSettled(resources.map(r=>Promise.resolve().then(()=>r.close(reason))));
      this.resources.clear();
      const failures=outcomes.flatMap((o,i)=>o.status==="rejected"?[resources[i].name]:[]);
      if(failures.length) throw new Error("CANCELLATION_INCOMPLETE:"+failures.join(","));
    })();
    return this.cancellationPromise;
  }
}

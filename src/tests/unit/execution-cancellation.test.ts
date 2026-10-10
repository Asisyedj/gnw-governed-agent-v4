import { spawn } from "node:child_process";
import { describe,expect,it,vi } from "vitest";
import { ExecutionCancellation } from "../../server/orchestration/cancellation.js";

describe("execution cancellation",()=>{
  it("aborts signal and closes registered resources in reverse order",async()=>{
    const c=new ExecutionCancellation(); const calls:string[]=[];
    c.register({name:"browser",close:()=>{calls.push("browser");}});
    c.register({name:"worker",close:()=>{calls.push("worker");}});
    await c.cancel("user requested");
    expect(c.signal.aborted).toBe(true);
    expect(calls).toEqual(["worker","browser"]);
  });
  it("is idempotent and does not run cancellation twice",async()=>{
    const c=new ExecutionCancellation(); const close=vi.fn();
    c.register({name:"resource",close});
    await Promise.all([c.cancel(),c.cancel()]);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it.skipIf(process.platform==="win32")("terminates a real detached OS child process and confirms it exited",async()=>{
    const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{
      detached:true,
      stdio:"ignore",
    });
    await new Promise<void>((resolve,reject)=>{
      child.once("spawn",()=>resolve());
      child.once("error",reject);
    });
    expect(child.pid).toBeGreaterThan(0);
    const cancellation=new ExecutionCancellation();
    cancellation.registerChildProcess("real-node-child",child,500);
    await expect(cancellation.cancel("integration test")).resolves.toBeUndefined();
    expect(child.exitCode!==null||child.signalCode!==null).toBe(true);
  });

  it("closes an attached browser context resource and waits for close completion",async()=>{
    const cancellation=new ExecutionCancellation();
    let closed=false;
    cancellation.registerBrowserContext("browser-context",{
      close:async()=>{await Promise.resolve();closed=true;},
    });
    await cancellation.cancel("browser user requested");
    expect(closed).toBe(true);
  });

  it("reports resources that failed to close",async()=>{
    const c=new ExecutionCancellation();
    c.register({name:"stuck-browser",close:()=>{throw new Error("still running");}});
    await expect(c.cancel()).rejects.toThrow("CANCELLATION_INCOMPLETE:stuck-browser");
  });
});

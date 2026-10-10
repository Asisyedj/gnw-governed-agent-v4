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
  it("reports resources that failed to close",async()=>{
    const c=new ExecutionCancellation();
    c.register({name:"stuck-browser",close:()=>{throw new Error("still running");}});
    await expect(c.cancel()).rejects.toThrow("CANCELLATION_INCOMPLETE:stuck-browser");
  });
});

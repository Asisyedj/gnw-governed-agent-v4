import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage } from "../../server/storage.js";

describe("artifact storage",()=>{
  it("rejects path traversal and absolute keys",async()=>{
    const dir=await mkdtemp(join(tmpdir(),"gnw-storage-"));
    try{
      const env={
        storageDriver:"local",
        artifactDir:dir,
        port:3000,
        isProduction:true,
        sharedStorageConfirmed:true,
      } as any;
      const storage=createStorage(env);
      await expect(storage.put("../escape.txt",Buffer.from("x"),"text/plain")).rejects.toThrow(/invalid_storage_key|storage_path_escape/);
      await expect(storage.get("/absolute.txt")).rejects.toThrow("invalid_storage_key");
    } finally {
      await rm(dir,{recursive:true,force:true});
    }
  });
});

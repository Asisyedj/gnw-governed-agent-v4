import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile as fsWriteFile, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage, writeAtomically } from "../../server/storage.js";

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


describe("atomic storage writes", () => {
  it("removes a partially written temp object when the storage write rejects", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gnw-storage-partial-"));
    const tmpPath = join(dir, "artifact.bin.unique.tmp");
    const targetPath = join(dir, "artifact.bin");
    try {
      await expect(writeAtomically(tmpPath, targetPath, Buffer.from("complete"), {
        writeFile: async (path, _data, options) => {
          await fsWriteFile(path, Buffer.from("partial"), options);
          throw new Error("simulated_partial_write");
        },
        rename,
        unlink,
      })).rejects.toThrow("simulated_partial_write");
      await expect(readFile(tmpPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("removes the temporary object when rename fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gnw-storage-rename-"));
    const tmpPath = join(dir, "artifact.bin.unique.tmp");
    const targetPath = join(dir, "artifact.bin");
    try {
      await expect(writeAtomically(tmpPath, targetPath, Buffer.from("complete"), {
        writeFile: fsWriteFile,
        rename: async () => { throw new Error("simulated_rename_failure"); },
        unlink,
      })).rejects.toThrow("simulated_rename_failure");
      await expect(readFile(tmpPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

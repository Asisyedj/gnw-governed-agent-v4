import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { Env } from "./env.js";

export type StorageObject = {
  key: string;
  url: string;
  contentType: string;
  size: number;
  uploadedAt: Date;
};

export interface StorageDriver {
  put(key: string, data: Buffer | Uint8Array, contentType: string): Promise<StorageObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  url(key: string): string;
  list(prefix?: string): Promise<StorageObject[]>;
}

class LocalStorageDriver implements StorageDriver {
  constructor(private readonly dir: string, private readonly baseUrl: string) {}

  private safePath(key: string): string {
    if (!key || key.length > 1024 || key.includes("\\") || isAbsolute(key)) {
      throw new Error("invalid_storage_key");
    }
    const root = resolve(this.dir);
    const target = resolve(root, key);
    const rel = relative(root, target);
    if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
      throw new Error("invalid_storage_key");
    }
    return target;
  }

  async put(key: string, data: Buffer | Uint8Array, contentType: string): Promise<StorageObject> {
    const filePath = this.safePath(key);
    await mkdir(resolve(filePath, ".."), { recursive: true });
    const tmpPath = filePath + "." + randomUUID() + ".tmp";
    await writeFile(tmpPath, data, { flag: "wx" });
    await rename(tmpPath, filePath);
    const info = await stat(filePath);
    return { key, url: this.url(key), contentType, size: info.size, uploadedAt: info.mtime };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.safePath(key));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.safePath(key)).catch(() => {});
  }

  url(key: string): string {
    return this.baseUrl.replace(/\/$/, "") + "/artifacts/" +
      key.split("/").map(encodeURIComponent).join("/");
  }

  async list(prefix = ""): Promise<StorageObject[]> {
    const root = resolve(this.dir);
    const entries = await readdir(root, { withFileTypes: true, recursive: true }).catch(() => []);
    const result: StorageObject[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const parent = String((entry as { parentPath?: string; path?: string }).parentPath ??
        (entry as { path?: string }).path ?? root);
      const abs = resolve(parent, entry.name);
      const key = relative(root, abs).split(sep).join("/");
      if (!key || !key.startsWith(prefix)) continue;
      const info = await stat(abs).catch(() => null);
      if (!info) continue;
      result.push({
        key,
        url: this.url(key),
        contentType: "application/octet-stream",
        size: info.size,
        uploadedAt: info.mtime,
      });
    }
    return result;
  }
}

export function createStorage(env: Env): StorageDriver {
  if (env.storageDriver !== "local") throw new Error("unsupported_storage_driver");
  if (env.isProduction && !env.sharedStorageConfirmed) {
    throw new Error("shared_storage_required");
  }
  return new LocalStorageDriver(env.artifactDir, "http://localhost:" + env.port);
}

export function newArtifactKey(prefix: string, ext: string): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 128);
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16) || "bin";
  return safePrefix + "/" + randomUUID() + "." + safeExt;
}

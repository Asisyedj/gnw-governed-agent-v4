import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import type { Env } from "./env.js";

export type StorageObject = {
  key: string; url: string;
  contentType: string; size: number;
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

  async put(key: string, data: Buffer | Uint8Array, contentType: string): Promise<StorageObject> {
    const filePath = join(this.dir, key);
    await mkdir(join(this.dir, key.split("/").slice(0, -1).join("/")), { recursive: true });
    await import("node:fs/promises").then(fs => fs.writeFile(filePath, data));
    const info = await stat(filePath);
    return { key, url: this.url(key), contentType, size: info.size, uploadedAt: info.mtime };
  }

  async get(key: string): Promise<Buffer> {
    const fs = await import("node:fs/promises");
    return fs.readFile(join(this.dir, key));
  }

  async delete(key: string): Promise<void> { await unlink(join(this.dir, key)).catch(() => {}); }

  url(key: string): string { return `${this.baseUrl}/artifacts/${key}`; }

  async list(prefix = ""): Promise<StorageObject[]> {
    const fs = await import("node:fs/promises");
    const entries = await fs.readdir(this.dir, { withFileTypes: true, recursive: true }).catch(() => []);
    const result: StorageObject[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const key = join(entry.path ?? "", entry.name).replace(this.dir, "").replace(/^\//, "");
      if (!key.startsWith(prefix)) continue;
      const info = await stat(join(this.dir, key)).catch(() => null);
      if (!info) continue;
      result.push({ key, url: this.url(key), contentType: "application/octet-stream", size: info.size, uploadedAt: info.mtime });
    }
    return result;
  }
}

export function createStorage(env: Env): StorageDriver {
  return new LocalStorageDriver(env.artifactDir, `http://localhost:${env.port}`);
}

export function newArtifactKey(prefix: string, ext: string): string {
  return `${prefix}/${randomUUID()}.${ext}`;
}

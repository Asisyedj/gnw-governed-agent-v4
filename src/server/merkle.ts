import { createHash } from "node:crypto";

export type MerkleNode = { hash: string; left?: MerkleNode; right?: MerkleNode; data?: string };

export function hashLeaf(data: string): string {
  return createHash("sha256").update("leaf:").update(data).digest("hex");
}

export function hashInternal(left: string, right: string): string {
  return createHash("sha256").update("node:").update(left).update(right).digest("hex");
}

export function buildMerkleTree(leaves: string[]): MerkleNode {
  if (leaves.length === 0) throw new Error("Cannot build Merkle tree from empty leaves");
  let nodes: MerkleNode[] = leaves.map(data => ({ hash: hashLeaf(data), data }));
  while (nodes.length > 1) {
    const next: MerkleNode[] = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i]!;
      const right = i + 1 < nodes.length ? nodes[i + 1]! : left;
      next.push({ hash: hashInternal(left.hash, right.hash), left, right });
    }
    nodes = next;
  }
  return nodes[0]!;
}

export function merkleRoot(leaves: string[]): string {
  return buildMerkleTree(leaves).hash;
}

export function getMerkleProof(leaves: string[], index: number): { root: string; proof: Array<{ hash: string; side: "left" | "right" }> } {
  if (index < 0 || index >= leaves.length) throw new RangeError("index out of bounds");
  const hashes = leaves.map(hashLeaf);
  const proof: Array<{ hash: string; side: "left" | "right" }> = [];
  let idx = index;
  let layer = hashes;
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const right = i + 1 < layer.length ? layer[i + 1]! : left;
      if (idx === i) proof.push({ hash: right, side: "right" });
      else if (idx === i + 1) proof.push({ hash: left, side: "left" });
      next.push(hashInternal(left, right));
    }
    idx = Math.floor(idx / 2);
    layer = next;
  }
  return { root: layer[0]!, proof };
}

export function verifyMerkleProof(leaf: string, proof: Array<{ hash: string; side: "left" | "right" }>, root: string): boolean {
  let current = hashLeaf(leaf);
  for (const { hash, side } of proof) {
    current = side === "right" ? hashInternal(current, hash) : hashInternal(hash, current);
  }
  return current === root;
}

export type TrajectoryEntry = { step: number; digest: string; prev: string | null; chainHash: string };

export function chainEntry(step: number, digest: string, prev: TrajectoryEntry | null): TrajectoryEntry {
  const prevHash = prev?.chainHash ?? "genesis";
  const chainHash = createHash("sha256").update(`chain:${step}:${digest}:${prevHash}`).digest("hex");
  return { step, digest, prev: prevHash, chainHash };
}

export function verifyChain(entries: TrajectoryEntry[]): boolean {
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const prevHash = i === 0 ? "genesis" : entries[i - 1]!.chainHash;
    if (e.prev !== prevHash) return false;
    const expected = createHash("sha256").update(`chain:${e.step}:${e.digest}:${prevHash}`).digest("hex");
    if (e.chainHash !== expected) return false;
  }
  return true;
}

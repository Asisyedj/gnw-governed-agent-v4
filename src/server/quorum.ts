import { randomUUID } from "node:crypto";
import { sha256, canonicalize } from "./security.js";

export type QuorumPolicy = { threshold: number; memberCount: number; ttlMs: number; role: string };
export type QuorumVote = { quorumId: string; memberId: string; vote: "approve" | "reject"; reason?: string; timestamp: number; signature?: string };
export type QuorumSession = { quorumId: string; policy: QuorumPolicy; subjectDigest: string; votes: QuorumVote[]; status: "open" | "approved" | "rejected" | "expired"; openedAt: number; closedAt?: number };

export function openQuorum(policy: QuorumPolicy, subject: Record<string, unknown>): QuorumSession {
  return {
    quorumId: randomUUID(),
    policy,
    subjectDigest: sha256(canonicalize(subject)),
    votes: [],
    status: "open",
    openedAt: Date.now(),
  };
}

export function castVote(session: QuorumSession, memberId: string, vote: "approve" | "reject", reason?: string): QuorumSession {
  if (session.status !== "open") throw new Error(`Quorum session is ${session.status}`);
  if (Date.now() > session.openedAt + session.policy.ttlMs) {
    return { ...session, status: "expired", closedAt: Date.now() };
  }
  const already = session.votes.find(v => v.memberId === memberId);
  if (already) throw new Error("Member has already voted");
  const newVotes = [...session.votes, { quorumId: session.quorumId, memberId, vote, reason, timestamp: Date.now() }];
  const approvals = newVotes.filter(v => v.vote === "approve").length;
  const rejections = newVotes.filter(v => v.vote === "reject").length;
  let status: QuorumSession["status"] = "open";
  if (approvals >= session.policy.threshold) status = "approved";
  else if (rejections > session.policy.memberCount - session.policy.threshold) status = "rejected";
  return { ...session, votes: newVotes, status, closedAt: status !== "open" ? Date.now() : undefined };
}

export function checkExpiry(session: QuorumSession): QuorumSession {
  if (session.status === "open" && Date.now() > session.openedAt + session.policy.ttlMs) {
    return { ...session, status: "expired", closedAt: Date.now() };
  }
  return session;
}

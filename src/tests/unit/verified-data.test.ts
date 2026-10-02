import { describe, expect, it } from "vitest";
import { canonicalize, sha256 } from "../../server/security.js";
import {
  asEvidenceId,
  asRequestId,
  asSha256,
  asTaskId,
  asTenantId,
  immutable,
  buildVerifiedRagInput,
  verifyIngestion,
  verifyDataStage,
  verifyEvidenceRecord,
  verifyGroundedAnswer,
  verifyInvariantSet,
  verifyRetrieval,
  type EvidenceRecord,
} from "../../server/verified-data.js";

const digest=(v:unknown)=>sha256(canonicalize(v));
const tenant=asTenantId(7);
const task=asTaskId(11);

function evidence(id:string,chunkIndex:number,quote:string):EvidenceRecord{
  const sourceUri="https://example.com/source";
  const sourceVersion="v1";
  const contentHash=digest({sourceUri,sourceVersion,quote});
  return {
    id:asEvidenceId(id),
    tenantId:tenant,
    sourceUri,
    sourceVersion,
    contentHash:asSha256(contentHash),
    chunkHash:asSha256(digest({chunkIndex,quote})),
    chunkIndex,
    authorizationDigest:asSha256(digest({tenant,task,permission:"read"})),
    permissionContext:"tenant:7|task:11|read",
    observedAt:"2026-10-03T00:00:00.000Z",
    quote,
  };
}

describe("immutable invariant engine",()=>{
  it("brands critical identifiers at runtime",()=>{
    expect(asSha256("a".repeat(64))).toBe("a".repeat(64));
    expect(asTenantId(7)).toBe(7);
    expect(asTaskId(11)).toBe(11);
    expect(asRequestId("req-1")).toBe("req-1");
    expect(()=>asSha256("bad")).toThrow("invalid_sha256_digest");
    expect(()=>asTenantId(0)).toThrow("invalid_tenant_id");
    expect(()=>asTaskId(-1)).toThrow("invalid_task_id");
  });

  it("returns deterministic verification reports and is itself immutable",()=>{
    const a=verifyInvariantSet("sample",[
      ["one",true,"ok"],
      ["two",true,"ok"],
    ]);
    const b=verifyInvariantSet("sample",[
      ["one",true,"ok"],
      ["two",true,"ok"],
    ]);
    expect(a.ok).toBe(true);
    expect(a.digest).toBe(b.digest);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.violations)).toBe(true);
  });

  it("rejects mutable output and produces frozen snapshots",()=>{
    const input={a:{b:1},items:[1,2]};
    const output={result:"ok",items:[1,2]};
    const stage=verifyDataStage("ingestion",input,output,[["schema",true,"schema valid"]]);
    expect(Object.isFrozen(stage)).toBe(true);
    expect(Object.isFrozen(stage.input)).toBe(true);
    expect(Object.isFrozen(stage.output)).toBe(true);
    expect(Object.isFrozen((stage.output as {items:number[]}).items)).toBe(true);
  });

  it("verifies ingestion metadata and binds the query to the tenant",()=>{
    const document={
      id:"doc-1",
      tenantId:tenant,
      sourceUri:"https://example.com/source",
      sourceVersion:"v1",
      owner:"owner-1",
      permissions:["tenant:7:read"],
      contentHash:asSha256(digest({content:"document"})),
      chunks:[{
        id:"chunk-1",
        documentId:"doc-1",
        index:0,
        contentHash:asSha256(digest({chunk:"one"})),
        embeddingDigest:asSha256(digest({embedding:[1,2,3]})),
        authorizationDigest:asSha256(digest({tenant,task,permission:"read"})),
      }],
    } as const;
    expect(verifyIngestion(document).ok).toBe(true);
    const input=buildVerifiedRagInput(document,"test query");
    expect(input.queryDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.document)).toBe(true);
  });

  it("verifies evidence provenance before retrieval can pass",()=>{
    const ev1=evidence("ev-source-1",0,"authoritative statement");
    const ev2=evidence("ev-source-2",1,"second authoritative statement");
    expect(verifyEvidenceRecord(ev1).ok).toBe(true);
    expect(verifyRetrieval({queryDigest:asSha256(digest({q:"test"})),tenantId:tenant,evidence:[ev1,ev2]}).evidence).toHaveLength(2);
    expect(()=>verifyRetrieval({queryDigest:asSha256(digest({q:"test"})),tenantId:tenant,evidence:[{...ev1,tenantId:asTenantId(8)},ev2]})).toThrow("retrieval.same-tenant");
  });

  it("requires grounded citations to belong to the verified retrieval set",()=>{
    const queryDigest=asSha256(digest({q:"test"}));
    const ev1=evidence("ev-source-1",0,"first statement");
    const ev2=evidence("ev-source-2",1,"second statement");
    const retrieval=verifyRetrieval({queryDigest,tenantId:tenant,evidence:[ev1,ev2]});
    const answer=verifyGroundedAnswer({
      tenantId:tenant,
      queryDigest,
      answer:"Grounded answer.",
      citations:[ev1.id,ev2.id],
      evidence:retrieval,
      uncertainty:"medium",
    });
    expect(answer.generationDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(answer)).toBe(true);
    expect(()=>verifyGroundedAnswer({
      tenantId:tenant,
      queryDigest,
      answer:"Unsupported answer.",
      citations:[asEvidenceId("ev-unknown")],
      evidence:retrieval,
      uncertainty:"high",
    })).toThrow("generation.citations-in-evidence");
  });

  it("detects provenance mutation after snapshot creation",()=>{
    const ev1=evidence("ev-source-1",0,"original");
    const snapshot=immutable(ev1);
    const tampered={...snapshot,quote:"tampered"};
    expect(verifyEvidenceRecord(snapshot).ok).toBe(true);
    expect(verifyEvidenceRecord(tampered).ok).toBe(false);
  });
});

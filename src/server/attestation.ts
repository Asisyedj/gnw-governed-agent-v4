import { createHash, verify as cryptoVerify, type KeyObject } from "node:crypto";

export type RuntimeAttestation={
  issuer:string;
  measurement:string;
  nonce:string;
  issuedAt:number;
  expiresAt:number;
  signature:string;
};

export type AttestationPolicy={
  issuer:string;
  publicKeyPem:string|KeyObject;
  expectedMeasurement?:string;
  maxAgeMs?:number;
};

function payload(a:RuntimeAttestation){
  return `GNW-TEE-ATTESTATION-V1|${a.issuer}|${a.measurement}|${a.nonce}|${a.issuedAt}|${a.expiresAt}`;
}

export function attestationDigest(a:RuntimeAttestation){
  return createHash("sha256").update(payload(a)).digest("hex");
}

export function verifyRuntimeAttestation(a:RuntimeAttestation,policy:AttestationPolicy,now=Date.now()):boolean{
  if(!a||a.issuer!==policy.issuer||!a.measurement||!a.nonce||!Number.isInteger(a.issuedAt)||!Number.isInteger(a.expiresAt))return false;
  if(!/^[0-9a-f]{64}$/i.test(a.measurement))return false;
  if(!/^[0-9a-f]{32,128}$/i.test(a.nonce))return false;
  if(!/^[0-9a-f]+$/i.test(a.signature))return false;
  if(a.expiresAt<=a.issuedAt||now<a.issuedAt||now>=a.expiresAt)return false;
  if(policy.maxAgeMs!==undefined&&(now-a.issuedAt)>policy.maxAgeMs)return false;
  if(policy.expectedMeasurement&&a.measurement!==policy.expectedMeasurement)return false;
  return cryptoVerify(null,Buffer.from(payload(a)),policy.publicKeyPem,Buffer.from(a.signature,"hex"));
}

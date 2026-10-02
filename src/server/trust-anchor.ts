import { verify as cryptoVerify } from "node:crypto";

export type ThresholdSignature={participantId:string;signature:string};
export type TrustAnchor={threshold:number;participants:Record<string,string>;requireTee:boolean};

function payload(actionDigest:string,measurement:string,nonce:string){
  return `GNW-TRUST-ANCHOR-V1|${actionDigest}|${measurement}|${nonce}`;
}

/**
 * Verifies an M-of-N threshold co-signature set over the exact governed action.
 * This is a trust-anchor verifier, not a claim that the repository itself performs
 * distributed MPC key generation. Production MPC/DKG remains an infrastructure control.
 */
export function verifyThresholdAttestation(
  actionDigest:string,
  measurement:string,
  nonce:string,
  signatures:readonly ThresholdSignature[],
  anchor:TrustAnchor,
):boolean{
  if(!/^[0-9a-f]{64}$/i.test(actionDigest)||!/^[0-9a-f]{64}$/i.test(measurement)||!/^[0-9a-f]{32,128}$/i.test(nonce))return false;
  if(!Number.isInteger(anchor.threshold)||anchor.threshold<1||anchor.threshold>Object.keys(anchor.participants).length)return false;
  const seen=new Set<string>();let valid=0;
  for(const entry of signatures){
    if(seen.has(entry.participantId))continue;
    const publicKeyPem=anchor.participants[entry.participantId];
    if(!publicKeyPem||!/^[0-9a-f]+$/i.test(entry.signature))continue;
    try{
      if(cryptoVerify(null,Buffer.from(payload(actionDigest,measurement,nonce)),publicKeyPem,Buffer.from(entry.signature,"hex"))){seen.add(entry.participantId);valid++;}
    }catch{/* invalid participant material is a failed vote */}
  }
  return valid>=anchor.threshold;
}

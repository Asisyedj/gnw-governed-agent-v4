# GNW Pakistan Production Compliance Release Contract

This control contract is for a GNW deployment profiled as Pakistani public-sector + SBP-regulated banking infrastructure.

## Regulatory applicability

PISF 2026 and the nCERT audit framework are treated as applicable for the public-sector profile. PPRA 2026 is treated as applicable for federal public procurement. SBP technology governance, outsourcing and cloud outsourcing controls are treated as applicable for the SBP-regulated profile.

PSS cryptographic applicability is intentionally blocked pending final legal/organizational classification. CII applicability is also blocked until the responsible authority determines the designation. No code path may silently convert those statuses into a production PASS.

## Evidence contract

Every production release must bind, by digest, to the same Git commit/tag:

- current applicability and control-matrix documents
- passing automated security and database gates
- current regulatory evidence for every applicable control
- independent audit evidence with zero blocking open findings
- production HSM/key-custody evidence
- real hardware-backed TEE attestation
- M-of-N threshold trust-anchor evidence bound to the TEE measurement
- two distinct release approvals
- Ed25519 release seal

Local simulated attestation, CI-generated keys and screenshots are not production TEE evidence.

## TEE boundary

The verifier consumes the signed evidence emitted by the actual production attestation verifier and checks issuer, expected measurement, freshness, signature and binding to the exact release SHA/tag/artifact manifest. The repository makes no claim that a simulator is equivalent to hardware-backed attestation.

## nCERT and regulatory evidence

Regulatory and audit records are represented by hashes/references rather than unauthenticated filenames alone. The pipeline verifies structure, release linkage, signatures and completeness; it does not fabricate regulator approvals or audit reports.

## Sources

- PISF 2026: https://pkcert.gov.pk/grc-policies.asp
- PISF merged version: https://pkcert.gov.pk/uploads/2026/03/PISF-Merged-Version.pdf
- nCERT audit framework: https://pkcert.gov.pk/framework-for-audit-activities.asp
- PPRA Rules 2026: https://epms.ppra.gov.pk/public/procurement-rules
- SBP technology governance: https://www.sbp.org.pk/circulars/bprd-circular-no-05-of-2017
- SBP outsourcing: https://www.sbp.org.pk/circulars/bprd-circular-no-06-of-2017
- SBP cloud outsourcing: https://archive.sbp.org.pk/bprd/2023/C1.htm
- Pakistan Security Standards: https://cabinet.gov.pk/Detail/NzdhZDdkODUtZmYzZS00OGVhLThiNmEtZmRmYWQ1NDQ4NDQy
- PSS Crypto Guide Book: https://cabinet.gov.pk/SiteImage/Downloads/Crypto-GuideBook.pdf

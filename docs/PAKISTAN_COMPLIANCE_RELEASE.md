# GNW Pakistan Production Compliance Release Contract

This document defines the release control contract for a GNW deployment profiled as a Pakistani public-sector + SBP-regulated banking workload.

## Applicability

The repository treats PISF 2026 and nCERT audit controls as applicable to the public-sector profile. PPRA 2026 controls apply to the federal procurement profile. SBP technology governance, outsourcing and cloud outsourcing controls apply to the SBP-regulated profile.

PSS cryptographic applicability is deliberately not assumed. The repository blocks production release until the final legal/organizational classification is recorded. A software system must not claim PSS conformity merely because it uses cryptography or an HSM.

CII applicability remains organization/system-specific and is not inferred by the repository.

## Release invariant

A production release is DENY/HOLD unless all of the following are bound to the same release tag and commit:

- current applicability and control-matrix digests
- passing automated security/runtime gates
- current regulatory evidence for every applicable control
- independent audit evidence with zero blocking open findings
- real hardware-backed TEE attestation
- HSM/key-custody evidence
- two independent release approvals
- Ed25519 release seal

A simulated/local attestation is not acceptable production evidence.

## TEE evidence

The release evidence contains a hardware attestation with issuer, measurement, nonce, issued time, expiry, signature and an action digest derived from the exact release SHA/tag/artifact manifest. CI verifies the signature, expected measurement, freshness and release binding.

The repository does not claim that a local simulator, software TPM, or CI-generated signature is equivalent to manufacturer/hardware-backed attestation.

## Regulatory evidence

Each control has a stable ID. External evidence is referenced by digest rather than by an unauthenticated filename alone. Examples include approved procurement records, SBP assessments/approvals, PISF control test records and nCERT audit report/closure references.

The pipeline verifies structure, digest linkage, release binding and signature/seal integrity. It does not fabricate or self-certify regulator approvals.

## Continuous evidence

The same control IDs are checked on pull requests and the default branch. Release tags add the production-only evidence gate. A failed, stale, missing or unverifiable record blocks promotion.

## Sources

- PISF 2026: https://pkcert.gov.pk/grc-policies.asp
- PISF 2026 merged text: https://pkcert.gov.pk/uploads/2026/03/PISF-Merged-Version.pdf
- nCERT audit framework: https://pkcert.gov.pk/framework-for-audit-activities.asp
- PPRA Rules 2026: https://epms.ppra.gov.pk/public/procurement-rules
- SBP technology governance: https://www.sbp.org.pk/circulars/bprd-circular-no-05-of-2017
- SBP outsourcing: https://www.sbp.org.pk/circulars/bprd-circular-no-06-of-2017
- SBP cloud outsourcing: https://archive.sbp.org.pk/bprd/2023/C1.htm
- Pakistan Security Standards: https://cabinet.gov.pk/Detail/NzdhZDdkODUtZmYzZS00OGVhLThiNmEtZmRmYWQ1NDQ4NDQy
- PSS Crypto Guide Book: https://cabinet.gov.pk/SiteImage/Downloads/Crypto-GuideBook.pdf

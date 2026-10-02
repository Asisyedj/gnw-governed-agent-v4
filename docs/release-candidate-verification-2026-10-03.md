# GNW release-candidate verification — 2026-10-03

This marker exists only to start a fresh pull-request verification event for the patched production release path.

Patched controls:
- production preflight requires TEE and threshold trust-anchor configuration;
- production preflight requires LLM configuration and explicit artifact-storage posture;
- release evidence records exact commit, tag, tool versions and SHA-256 manifest;
- tag-based container smoke supplies the mandatory TEE startup configuration.

Release remains fail-closed until all required technical and external assurance gates are independently evidenced on the same final release SHA.

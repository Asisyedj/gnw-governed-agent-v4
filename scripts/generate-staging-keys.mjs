#!/usr/bin/env node
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function generateEd25519Pair(label) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  // Verify pair using the exact preflight check logic
  const priv = createPrivateKey(privateKey);
  const pub = createPublicKey(publicKey);
  const payload = Buffer.from(`GNW-${label}-KEY-PAIR-V1`);
  const signature = sign(null, payload, priv);
  const valid = verify(null, payload, pub, signature);

  if (!valid) throw new Error(`${label} key pair self-test failed`);

  return { privateKey, publicKey };
}

const grant = generateEd25519Pair('GRANT');
const lease = generateEd25519Pair('LEASE');

const stagingEnvContent = `# GNW Staging Environment Configuration (Auto-generated)
# DO NOT COMMIT TO VERSION CONTROL

GNW_ENVIRONMENT=staging
NODE_ENV=staging

# Ed25519 Grant Keys
GNW_REQUIRE_SIGNED_GRANTS=true
GNW_GRANT_ISSUER=gnw-staging-authority
GNW_GRANT_PRIVATE_KEY_PEM="${grant.privateKey.replace(/\n/g, '\\n')}"
GNW_GRANT_PUBLIC_KEY_PEM="${grant.publicKey.replace(/\n/g, '\\n')}"

# Ed25519 Lease Keys
GNW_LEASE_PRIVATE_KEY_PEM="${lease.privateKey.replace(/\n/g, '\\n')}"
GNW_LEASE_PUBLIC_KEY_PEM="${lease.publicKey.replace(/\n/g, '\\n')}"

# Staging Database Configuration
GNW_STAGING_DATABASE_URL=postgresql://gnw_migrator:gnw_migrator_pw@localhost:5432/gnw_staging
GNW_STAGING_BACKUP_DATABASE_URL=postgresql://gnw:gnw_test_pw@localhost:5432/gnw_staging
GNW_STAGING_DATABASE_NAME=gnw_staging
GNW_STAGING_DATABASE_ALLOWLIST=localhost:5432/gnw_staging
GNW_STAGING_ROLLBACK_ENABLED=true
GNW_POSTGRES_SSL_REQUIRED=false
`;

const outputPath = resolve(process.cwd(), '.env.staging');
await writeFile(outputPath, stagingEnvContent, { mode: 0o600 });

console.log(JSON.stringify({
  status: 'PASS',
  grantKeyVerified: true,
  leaseKeyVerified: true,
  outputPath: '.env.staging',
  grantPublicKeyFingerprint: grant.publicKey.slice(0, 45) + '...',
  leasePublicKeyFingerprint: lease.publicKey.slice(0, 45) + '...',
}, null, 2));

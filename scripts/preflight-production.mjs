import { URL } from "node:url";

const required = [
  "DATABASE_URL", "COOKIE_SECRET", "SESSION_SECRET", "EXECUTOR_URL", "EXECUTOR_SECRET",
  "GNW_REQUIRE_SIGNED_GRANTS", "GNW_GRANT_ISSUER", "GNW_GRANT_PRIVATE_KEY_PEM",
  "GNW_GRANT_PUBLIC_KEY_PEM", "GNW_LEASE_PRIVATE_KEY_PEM", "GNW_EGRESS_ALLOW_LIST"
];
const failures = [];

for (const name of required) {
  if (!(process.env[name] ?? "").trim()) failures.push(name + " missing");
}

const env = process.env;
if ((env.NODE_ENV ?? "production") !== "production") failures.push("NODE_ENV must be production");
for (const name of ["COOKIE_SECRET","SESSION_SECRET","EXECUTOR_SECRET"]) {
  const value = env[name] ?? "";
  if (value && value.length < 32) failures.push(name + " must be at least 32 characters");
}
if (env.GNW_REQUIRE_SIGNED_GRANTS !== "true") failures.push("GNW_REQUIRE_SIGNED_GRANTS must be true");
if (!env.GNW_EGRESS_ALLOW_LIST?.split(",").map(x => x.trim()).filter(Boolean).length) failures.push("GNW_EGRESS_ALLOW_LIST must contain at least one host");

for (const name of ["DATABASE_URL"]) {
  const value = env[name] ?? "";
  if (value && !/^[a-z]+:\/\//i.test(value)) failures.push(name + " must be a URL");
}
for (const name of ["EXECUTOR_URL","LLM_BASE_URL","GNW_DEEP_RESEARCH_BASE_URL","CORS_ORIGIN"]) {
  const value = env[name] ?? "";
  if (!value || value === "same-origin") continue;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") failures.push(name + " must use HTTPS");
  } catch {
    failures.push(name + " must be a valid URL");
  }
}

const databaseUrl = env.DATABASE_URL ?? "";
if (databaseUrl && !/[?&]sslmode=verify-full(?:&|$)/i.test(databaseUrl)) failures.push("DATABASE_URL must use sslmode=verify-full");
if ((env.STORAGE_DRIVER ?? "local") === "local" && env.GNW_SHARED_STORAGE_CONFIRMED !== "true") failures.push("GNW_SHARED_STORAGE_CONFIRMED must be true for local shared storage");
if (env.GNW_HOST && /example\.com$/i.test(env.GNW_HOST)) failures.push("GNW_HOST is still an example domain");

if (failures.length) {
  console.error("GNW production environment preflight: DENY");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}
console.log("GNW production environment preflight: PASS");
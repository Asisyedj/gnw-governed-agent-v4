const [major, minor] = process.versions.node.split(".").map(Number);

if (major !== 22 || minor < 12) {
  console.error(`GNW requires Node.js >=22.12.0 <23.0.0; detected ${process.version}`);
  process.exit(1);
}

console.log(`GNW supported Node.js runtime confirmed: ${process.version}`);

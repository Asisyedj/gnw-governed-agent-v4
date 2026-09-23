import { runMigrations } from "./index.ts";
runMigrations().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

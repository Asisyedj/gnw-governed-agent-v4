import { buildApp } from "../src/server/app.js";

let appPromise: Promise<Awaited<ReturnType<typeof buildApp>>["app"]> | null = null;

async function getApp() {
  if (!appPromise) {
    appPromise = buildApp().then(async ({ app }) => {
      await app.ready();
      return app;
    });
  }
  return appPromise;
}

export default async function handler(req: any, res: any) {
  const app = await getApp();
  app.server.emit("request", req, res);
}
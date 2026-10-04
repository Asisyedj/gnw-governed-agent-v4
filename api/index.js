import { buildApp } from "../dist/server/app.js";

let appPromise;

export default async function handler(req, res) {
  appPromise ??= buildApp().then(async ({ app }) => {
    await app.ready();
    return app;
  });

  const app = await appPromise;

  await new Promise((resolve, reject) => {
    res.once("finish", resolve);
    res.once("close", resolve);
    try {
      app.server.emit("request", req, res);
    } catch (error) {
      reject(error);
    }
  });
}

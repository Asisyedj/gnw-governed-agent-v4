import type { Request, Response, NextFunction } from "express";
import type { Env } from "../env.js";

export function securityHeaders(env: Env) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    if (env.isProduction) {
      res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    }
    res.setHeader("Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
    next();
  };
}

export function rateLimitHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-RateLimit-Policy", "gnw-v1");
  next();
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers["x-request-id"] as string) || crypto.randomUUID();
  res.setHeader("X-Request-Id", id);
  (req as Request & { requestId: string }).requestId = id;
  next();
}

export function noCache(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
}

export function enforceContentType(contentType: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
      const ct = req.headers["content-type"] ?? "";
      if (!ct.includes(contentType)) {
        res.status(415).json({ error: "unsupported_media_type", expected: contentType });
        return;
      }
    }
    next();
  };
}

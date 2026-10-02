import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp } from "../lib/testApp.js";

let app:FastifyInstance;

beforeAll(async()=>{({app}=await createTestApp());});
afterAll(async()=>{await app.close();});

describe("browser mutation protection",()=>{
  it("rejects cross-site state-changing requests before authentication",async()=>{
    const res=await app.inject({
      method:"POST",
      url:"/api/auth/login",
      headers:{"sec-fetch-site":"cross-site","origin":"https://evil.example"},
      payload:{email:"x@example.com",password:"wrong"},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("csrf_protected");
  });

  it("does not reject a non-browser request only because Origin is absent",async()=>{
    const res=await app.inject({
      method:"POST",
      url:"/api/auth/login",
      payload:{email:"x@example.com",password:"wrong"},
    });
    expect(res.statusCode).not.toBe(403);
  });
});
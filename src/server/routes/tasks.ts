import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { resolveSession } from "./auth.js";
import { findUserById, createTask, findTaskById, listTasksByTenant, updateTaskStatus, listTaskSteps, insertAuditLog } from "../repo.js";
import type { Db } from "../db/index.js";

declare module "fastify" { interface FastifyInstance { db: Db; } }

const createSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  classification: z.enum(["standard", "sensitive", "restricted"]).optional(),
  budgetTokensAllocated: z.number().int().min(100).max(500000).optional(),
  budgetBytesAllocated: z.number().int().min(1024).max(104857600).optional(),
});

export const taskRoutes: FastifyPluginAsync = async (app) => {
  // List tasks
  app.get("/", async (req, reply) => {
    const session = await resolveSession(app.db, req.cookies as Record<string, string>);
    if (!session) return reply.status(401).send({ error: "Unauthenticated", code: "unauthenticated" });
    const tasks = await listTasksByTenant(app.db, session.tenantId);
    return reply.send(tasks);
  });

  // Get task
  app.get("/:id", async (req, reply) => {
    const session = await resolveSession(app.db, req.cookies as Record<string, string>);
    if (!session) return reply.status(401).send({ error: "Unauthenticated", code: "unauthenticated" });
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.status(400).send({ error: "Invalid task ID" });
    const task = await findTaskById(app.db, id, session.tenantId);
    if (!task) return reply.status(404).send({ error: "Task not found" });
    const steps = await listTaskSteps(app.db, id, session.tenantId);
    return reply.send({ ...task, steps });
  });

  // Create task
  app.post("/", async (req, reply) => {
    const session = await resolveSession(app.db, req.cookies as Record<string, string>);
    if (!session) return reply.status(401).send({ error: "Unauthenticated", code: "unauthenticated" });
    const user = await findUserById(app.db, session.userId, session.tenantId);
    if (!user) return reply.status(401).send({ error: "Unauthenticated" });
    if (!(["owner", "admin", "operator"] as string[]).includes(user.role)) {
      return reply.status(403).send({ error: "Insufficient role to create tasks.", code: "forbidden" });
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid input", details: parsed.error.issues });
    const task = await createTask(app.db, { tenantId: session.tenantId, createdByUserId: session.userId, ...parsed.data });
    await insertAuditLog(app.db, { eventType: "task.create", actorId: session.userId, tenantId: session.tenantId, taskId: task.id, resourceType: "task", resourceId: String(task.id), outcome: "success", ipAddress: req.ip });
    return reply.status(201).send(task);
  });

  // Cancel task
  app.post("/:id/cancel", async (req, reply) => {
    const session = await resolveSession(app.db, req.cookies as Record<string, string>);
    if (!session) return reply.status(401).send({ error: "Unauthenticated", code: "unauthenticated" });
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.status(400).send({ error: "Invalid task ID" });
    const task = await findTaskById(app.db, id, session.tenantId);
    if (!task) return reply.status(404).send({ error: "Task not found" });
    if (["done", "failed", "cancelled"].includes(task.status)) {
      return reply.status(409).send({ error: `Task is already ${task.status}.` });
    }
    await updateTaskStatus(app.db, id, session.tenantId, "cancelled");
    await insertAuditLog(app.db, { eventType: "task.cancel", actorId: session.userId, tenantId: session.tenantId, taskId: id, outcome: "success", ipAddress: req.ip });
    return reply.send({ ok: true });
  });
};

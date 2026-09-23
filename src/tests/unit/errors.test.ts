import { describe, it, expect } from "vitest";
import { AppError, NotFoundError, ForbiddenError, ConflictError, GoneError } from "../../server/lib/errors.js";

describe("AppError hierarchy", () => {
  it("AppError has correct shape", () => {
    const e = new AppError("bad", "bad_request", 400);
    expect(e.message).toBe("bad");
    expect(e.code).toBe("bad_request");
    expect(e.statusCode).toBe(400);
  });

  it("NotFoundError is 404", () => {
    const e = new NotFoundError("Task");
    expect(e.statusCode).toBe(404);
    expect(e.code).toBe("not_found");
  });

  it("ForbiddenError is 403", () => {
    expect(new ForbiddenError().statusCode).toBe(403);
  });

  it("ConflictError is 409", () => {
    expect(new ConflictError("dup").statusCode).toBe(409);
  });

  it("GoneError is 410", () => {
    expect(new GoneError("expired").statusCode).toBe(410);
  });
});

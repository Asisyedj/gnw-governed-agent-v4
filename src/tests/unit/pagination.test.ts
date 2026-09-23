import { describe, it, expect } from "vitest";
import { parsePagination } from "../../server/lib/pagination.js";

describe("parsePagination", () => {
  it("returns defaults", () => {
    expect(parsePagination({})).toEqual({ limit: 50, offset: 0 });
  });

  it("clamps limit to maxLimit", () => {
    expect(parsePagination({ limit: "9999" }, 100).limit).toBe(100);
  });

  it("clamps negative offset to 0", () => {
    expect(parsePagination({ offset: "-5" }).offset).toBe(0);
  });

  it("parses valid values", () => {
    expect(parsePagination({ limit: "20", offset: "40" })).toEqual({ limit: 20, offset: 40 });
  });
});

import { describe, it, expect } from "vitest";
import { createAuthMiddleware } from "./auth.js";
import { AuthError } from "@fieldpulse/auth";

function run(mw: ReturnType<typeof createAuthMiddleware>, path: string, authorization?: string) {
  const res: any = { statusCode: 200, body: undefined, locals: {}, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  let nextCalled = false;
  const req: any = { path, headers: authorization ? { authorization } : {} };
  return mw(req, res, () => { nextCalled = true; }).then(() => ({ res, nextCalled }));
}

const good = { sub: "u1", email: "h@fieldpulse.com" } as any;

describe("auth middleware", () => {
  it("lets /health through without a token", async () => {
    const { nextCalled } = await run(createAuthMiddleware(async () => good), "/health");
    expect(nextCalled).toBe(true);
  });

  it("rejects a missing token with 401", async () => {
    const { res, nextCalled } = await run(createAuthMiddleware(async () => good), "/runs");
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "missing_token" });
    expect(nextCalled).toBe(false);
  });

  it("maps AuthError codes to their status", async () => {
    const expired = createAuthMiddleware(async () => { throw new AuthError("expired", 401, "expired"); });
    const { res } = await run(expired, "/runs", "Bearer abc");
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "expired" });

    const forbidden = createAuthMiddleware(async () => { throw new AuthError("no grant", 403, "forbidden"); });
    expect((await run(forbidden, "/runs", "Bearer abc")).res.statusCode).toBe(403);

    const down = createAuthMiddleware(async () => { throw new AuthError("jwks", 503, "unavailable"); });
    expect((await run(down, "/runs", "Bearer abc")).res.statusCode).toBe(503);
  });

  it("treats unknown errors as an invalid token", async () => {
    const mw = createAuthMiddleware(async () => { throw new Error("boom"); });
    const { res } = await run(mw, "/runs", "Bearer abc");
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "invalid_token" });
  });

  it("passes claims through on a good token", async () => {
    const { res, nextCalled } = await run(createAuthMiddleware(async () => good), "/runs", "Bearer abc");
    expect(nextCalled).toBe(true);
    expect(res.locals.claims).toEqual(good);
  });
});

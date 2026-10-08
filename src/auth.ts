// FieldPulse sign-in for the API, via Universal Auth (@fieldpulse/auth).
//
// The SPA gates who can load the page; this gates the data. Every /api call
// (except /api/health) must carry a Bearer token issued by the central
// fieldpulse-auth project. verifyToken checks the signature against that
// project's public keys, so no shared secret is needed -- only FP_AUTH_URL.
//
// Employee mode: any signed-in @fieldpulse.com account is accepted. Per-app
// grants (requireApp(claims, "email-parser")) can be added later without
// touching the callers.
import type { Request, Response, NextFunction } from "express";
import { AuthError, verifyToken, type FpClaims } from "@fieldpulse/auth";

export type Verify = (token: string) => Promise<FpClaims>;

export function createAuthMiddleware(verify: Verify = verifyToken) {
  return async function requireFieldPulseUser(req: Request, res: Response, next: NextFunction) {
    if (req.path === "/health") return next();
    const match = (req.headers.authorization ?? "").match(/^Bearer\s+(.+)$/i);
    if (!match) {
      res.status(401).json({ error: "missing_token" });
      return;
    }
    try {
      res.locals.claims = await verify(match[1].trim());
      next();
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.status).json({ error: err.code });
        return;
      }
      res.status(401).json({ error: "invalid_token" });
    }
  };
}

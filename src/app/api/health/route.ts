import { NextResponse } from "next/server";

/**
 * Liveness check used by the production-deploy smoke test in
 * .github/workflows/deploy.yml. Keep it cheap — no DB or third-party calls.
 */
export async function GET() {
  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}

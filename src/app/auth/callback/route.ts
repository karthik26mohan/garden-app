import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Magic-link callback. Supabase appends `?code=...` to the redirect URL
 * after the user clicks the email. We exchange that code for a session
 * cookie, then send the user to `?next=...` (defaults to /app/gardens).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/app/gardens";

  if (!code) {
    return NextResponse.redirect(
      new URL(`/login?message=${encodeURIComponent("Missing or expired link.")}`, url.origin)
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?message=${encodeURIComponent(error.message)}`, url.origin)
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}

"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage(null);

    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div className="w-full rounded-lg border border-stone-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm">
          Check <span className="font-medium">{email}</span> for a sign-in link.
        </p>
        <p className="mt-2 text-xs text-stone-500">
          It should arrive in under a minute. Don&apos;t see it? Check spam.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-3">
      <label className="block">
        <span className="text-sm font-medium text-stone-700">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm shadow-sm outline-none ring-emerald-500 focus:border-emerald-500 focus:ring-1"
          placeholder="you@example.com"
        />
      </label>

      <button
        type="submit"
        disabled={status === "sending" || !email}
        className="w-full rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50"
      >
        {status === "sending" ? "Sending…" : "Send magic link"}
      </button>

      {errorMessage && (
        <p className="text-sm text-rose-700">{errorMessage}</p>
      )}
    </form>
  );
}

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">🌱 Garden</h1>
      <p className="text-stone-600">
        Track plants across your gardens, identified by AI.
      </p>

      {user ? (
        <Link
          href="/app/gardens"
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-800"
        >
          Go to your gardens
        </Link>
      ) : (
        <Link
          href="/login"
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-800"
        >
          Sign in
        </Link>
      )}
    </main>
  );
}

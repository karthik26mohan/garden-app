import { createClient } from "@/lib/supabase/server";

export default async function GardensPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Your gardens</h1>
      <p className="text-sm text-stone-600">
        Signed in as <span className="font-medium">{user?.email}</span>.
      </p>
      <div className="rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
        Day 4 will turn this into a real list. For now this page exists to prove the auth flow works end-to-end.
      </div>
    </main>
  );
}

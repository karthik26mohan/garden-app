import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function GardensPage() {
  const supabase = await createClient();

  // RLS does the filtering — this is the entire query.
  const { data: gardens, error } = await supabase
    .from("gardens")
    .select("id, name, description, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (
    <main className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Your gardens</h1>
        <Link
          href="/app/gardens/new"
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-800"
        >
          + New garden
        </Link>
      </div>

      {gardens && gardens.length > 0 ? (
        <ul className="space-y-2">
          {gardens.map((g) => (
            <li
              key={g.id}
              className="rounded-lg border border-stone-200 bg-white p-4"
            >
              <div className="font-medium text-stone-900">{g.name}</div>
              {g.description && (
                <div className="mt-1 text-sm text-stone-600">
                  {g.description}
                </div>
              )}
              <div className="mt-2 text-xs text-stone-400">
                Created {new Date(g.created_at).toLocaleDateString()}
                <span className="ml-2 italic">
                  (detail view coming in the next step)
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
          <p>No gardens yet.</p>
          <Link
            href="/app/gardens/new"
            className="mt-3 inline-block text-emerald-700 hover:underline"
          >
            Create your first garden →
          </Link>
        </div>
      )}
    </main>
  );
}

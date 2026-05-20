import Link from "next/link";
import { createGarden } from "../actions";

export default function NewGardenPage() {
  return (
    <main className="max-w-xl space-y-6">
      <div>
        <Link
          href="/app/gardens"
          className="text-sm text-stone-500 hover:underline"
        >
          ← Back to gardens
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          New garden
        </h1>
      </div>

      <form action={createGarden} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Name</span>
          <input
            type="text"
            name="name"
            required
            maxLength={120}
            autoFocus
            placeholder="Backyard herbs"
            className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-stone-700">
            Description
          </span>
          <textarea
            name="description"
            rows={3}
            placeholder="Optional — what kind of garden, where it is, anything you want to remember."
            className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Link
            href="/app/gardens"
            className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-800"
          >
            Create garden
          </button>
        </div>
      </form>
    </main>
  );
}

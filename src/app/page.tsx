export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">
        🌱 Garden
      </h1>
      <p className="text-stone-600">
        Track plants across your gardens, identified by AI.
      </p>
      <p className="text-sm text-stone-400">
        Day 1 scaffold up. Auth and Supabase wiring next.
      </p>
    </main>
  );
}

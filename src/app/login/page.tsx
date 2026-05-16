import LoginForm from "./login-form";

type SearchParams = Promise<{ next?: string; message?: string }>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { next, message } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">🌱 Garden</h1>
        <p className="mt-2 text-sm text-stone-500">
          Sign in with a magic link — no password to remember.
        </p>
      </div>

      <LoginForm next={next ?? "/app/gardens"} />

      {message && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {message}
        </p>
      )}
    </main>
  );
}

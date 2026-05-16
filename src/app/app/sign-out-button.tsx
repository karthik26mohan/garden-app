export default function SignOutButton() {
  return (
    <form action="/auth/signout" method="POST">
      <button
        type="submit"
        className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 shadow-sm transition hover:bg-stone-50"
      >
        Sign out
      </button>
    </form>
  );
}

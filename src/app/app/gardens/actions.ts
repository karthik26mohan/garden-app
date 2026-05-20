"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

/**
 * Server Action: create a garden owned by the signed-in user.
 *
 * Triggered by <form action={createGarden}> in the New Garden page.
 * Runs on the server. The browser never sees the implementation.
 */
export async function createGarden(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Defense in depth — middleware already protects /app/*, but we re-check
  // here because a Server Action can also be invoked outside of a page render.
  if (!user) {
    redirect("/login");
  }

  const name = String(formData.get("name") ?? "").trim();
  const description =
    String(formData.get("description") ?? "").trim() || null;

  if (!name) {
    // Minimal validation. Day 4.5 polish will return a typed error
    // and surface it next to the field via useActionState.
    return;
  }

  const { error } = await supabase.from("gardens").insert({
    user_id: user.id,
    name,
    description,
  });

  if (error) {
    throw new Error(error.message);
  }

  // Tell Next.js the gardens list cache is stale so the new row shows up.
  revalidatePath("/app/gardens");
  redirect("/app/gardens");
}

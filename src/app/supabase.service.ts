import { Injectable } from "@angular/core";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { environment } from "../environments/environment";

/**
 * App-wide Supabase client. Inject this service anywhere you need to read
 * or write to Supabase — auth, database queries, storage.
 *
 * Example:
 *   private supabase = inject(SupabaseService);
 *   const { data } = await this.supabase.client.from('gardens').select('*');
 */
@Injectable({ providedIn: "root" })
export class SupabaseService {
  readonly client: SupabaseClient;

  constructor() {
    this.client = createClient(
      environment.supabase.url,
      environment.supabase.anonKey
    );
  }
}

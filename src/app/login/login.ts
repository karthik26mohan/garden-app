import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { SupabaseService } from '../supabase.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private supabase = inject(SupabaseService);
  private route = inject(ActivatedRoute);

  // Form state. Signals because Angular 21 is zoneless by default and signals
  // are how change detection knows to re-render when state changes.
  email = signal('');
  status = signal<'idle' | 'sending' | 'sent' | 'error'>('idle');
  errorMessage = signal<string | null>(null);

  // Where to send the user after sign-in. Defaults to /app/gardens but
  // honors a ?next=... query param so middleware-style redirects round-trip.
  get next(): string {
    return this.route.snapshot.queryParamMap.get('next') ?? '/app/gardens';
  }

  // Error/info message passed in via ?message=... (e.g. expired magic link).
  get message(): string | null {
    return this.route.snapshot.queryParamMap.get('message');
  }

  async sendMagicLink(): Promise<void> {
    this.status.set('sending');
    this.errorMessage.set(null);

    // window.location only exists in the browser — but this handler only
    // fires on click, so we're definitely client-side here.
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
      this.next,
    )}`;

    const { error } = await this.supabase.client.auth.signInWithOtp({
      email: this.email(),
      options: { emailRedirectTo: redirectTo },
    });

    if (error) {
      this.status.set('error');
      this.errorMessage.set(error.message);
      return;
    }

    this.status.set('sent');
  }
}

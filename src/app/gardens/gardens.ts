import { Component, inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { SupabaseService } from '../supabase.service';

/**
 * Placeholder dashboard page. Confirms the auth flow worked end-to-end.
 * Full garden list + create + detail UI lands in the next chunk.
 */
@Component({
  selector: 'app-gardens',
  template: `
    <main class="container">
      <h1>Your gardens</h1>
      @if (email()) {
        <p>
          Signed in as <strong>{{ email() }}</strong>.
        </p>
      } @else if (loading()) {
        <p>Loading…</p>
      } @else {
        <p>Not signed in. <a routerLink="/login">Go to login</a>.</p>
      }
      <p><em>Full list, create, edit and delete coming next.</em></p>

      @if (email()) {
        <button type="button" class="btn btn--secondary" (click)="signOut()">
          Sign out
        </button>
      }
    </main>
  `,
})
export class Gardens implements OnInit {
  private supabase = inject(SupabaseService);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);

  email = signal<string | null>(null);
  loading = signal(true);

  async ngOnInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      this.loading.set(false);
      return;
    }

    const {
      data: { user },
    } = await this.supabase.client.auth.getUser();

    this.email.set(user?.email ?? null);
    this.loading.set(false);
  }

  async signOut(): Promise<void> {
    await this.supabase.client.auth.signOut();
    this.router.navigateByUrl('/login');
  }
}

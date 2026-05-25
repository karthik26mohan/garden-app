import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Per-route render mode for SSR / prerendering.
 *
 * - Prerender: generate static HTML at build time. Only valid for routes
 *   whose URL is fully known at build time (no unknown :params).
 * - Client: don't prerender; ship the SPA shell and hydrate in the browser.
 *   Right choice for parameterized routes whose param values are
 *   user-data UUIDs we can't enumerate at build time.
 * - Server: render fresh at request time via a Node.js process. We're not
 *   using this anywhere yet — it'd be the call if we wanted Supabase data
 *   in the prerendered HTML (better SEO / first paint), which needs a
 *   running server, not static hosting.
 *
 * Matching order is top-to-bottom, same as Angular's regular routes. The
 * specific routes have to come before the `**` catch-all or the catch-all
 * would swallow them.
 */
export const serverRoutes: ServerRoute[] = [
  // Parameterized garden routes — :id is a user-specific UUID, so there's
  // no list of values to prerender. Client mode means "skip prerender, just
  // serve the SPA shell." This matches what the components were doing
  // anyway — they short-circuit on the server via isPlatformBrowser.
  { path: 'app/gardens/:id/edit', renderMode: RenderMode.Client },
  { path: 'app/gardens/:id', renderMode: RenderMode.Client },

  // Everything else (static routes: /, /login, /auth/callback,
  // /app/gardens, /app/gardens/new) is safe to prerender.
  { path: '**', renderMode: RenderMode.Prerender },
];

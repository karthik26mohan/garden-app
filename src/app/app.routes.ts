import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: '/login',
  },
  {
    path: 'login',
    loadComponent: () => import('./login/login').then((m) => m.Login),
  },
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./auth-callback/auth-callback').then((m) => m.AuthCallback),
  },
  {
    path: 'app/gardens',
    canActivate: [authGuard],
    loadComponent: () => import('./gardens/gardens').then((m) => m.Gardens),
  },
  {
    path: 'app/gardens/new',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./gardens/new-garden/new-garden').then((m) => m.NewGarden),
  },
  {
    // More-specific path comes before the bare /:id route. They don't
    // actually collide (different segment count), but listing specific
    // before general is a habit worth keeping.
    path: 'app/gardens/:id/edit',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./gardens/edit-garden/edit-garden').then((m) => m.EditGarden),
  },
  {
    // :id is a route parameter — anything in that URL segment is captured
    // as a string and exposed via ActivatedRoute.snapshot.paramMap.
    path: 'app/gardens/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./gardens/garden-detail/garden-detail').then(
        (m) => m.GardenDetail,
      ),
  },
];

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
];

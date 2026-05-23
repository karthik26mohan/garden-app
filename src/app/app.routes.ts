import { Routes } from '@angular/router';

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
    loadComponent: () => import('./gardens/gardens').then((m) => m.Gardens),
  },
];

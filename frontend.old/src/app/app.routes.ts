import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./modules/auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'dashboards',
    loadComponent: () =>
      import('./modules/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    canActivate: [authGuard],
  },
  {
    path: 'sensors',
    loadComponent: () =>
      import('./modules/sensors/sensor-list.component').then((m) => m.SensorListComponent),
    canActivate: [authGuard],
  },
  { path: '', redirectTo: 'dashboards', pathMatch: 'full' },
  { path: '**', redirectTo: 'dashboards' },
];

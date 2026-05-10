import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const AuthGuard: CanMatchFn = async () => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  if (auth.currentUser) return true;

  const token = auth.getToken();
  if (!token) {
    router.navigate(['/login']);
    return false;
  }

  try {
    auth.currentUser = await auth.me();
    return true;
  } catch {
    auth.logout();
    return false;
  }
};

import { Injectable } from '@angular/core';
import { UserRead } from './auth.service';

/** Thin facade kept for module-boundary compatibility. Use AuthService directly. */
@Injectable({ providedIn: 'root' })
export class CurrentUserService {
  user: UserRead | null = null;
}

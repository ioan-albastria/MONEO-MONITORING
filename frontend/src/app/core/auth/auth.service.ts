import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

export interface UserRead {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  is_kiosk?: boolean;
  kiosk_dashboard_ids?: number[];
}

interface TokenResponse {
  access_token: string;
  token_type: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  static readonly TOKEN_KEY = 'auth_token';

  currentUser: UserRead | null = null;

  constructor(private http: HttpClient, private router: Router) {}

  async login(username: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<TokenResponse>('/api/auth/login', { username, password })
    );
    localStorage.setItem(AuthService.TOKEN_KEY, res.access_token);
    this.currentUser = await this.me();
  }

  async me(): Promise<UserRead> {
    return firstValueFrom(this.http.get<UserRead>('/api/auth/me'));
  }

  logout(): void {
    localStorage.removeItem(AuthService.TOKEN_KEY);
    this.currentUser = null;
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return localStorage.getItem(AuthService.TOKEN_KEY);
  }

  storeToken(token: string): void {
    localStorage.setItem(AuthService.TOKEN_KEY, token);
  }
}

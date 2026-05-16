import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface UserAdminRead {
  id: number;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface KioskTokenAdminRead {
  id: number;
  dashboard_ids: number[];
  label: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  token?: string;  // only on creation
}

export interface KioskTokenCreate {
  dashboard_ids: number[];
  label?: string;
  expires_days?: number;
}

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  constructor(private http: HttpClient) {}

  // ── Users ──────────────────────────────────────────────────────────────

  listUsers(): Promise<UserAdminRead[]> {
    return firstValueFrom(this.http.get<UserAdminRead[]>('/api/admin/users'));
  }

  changeUserRole(userId: number, role: string): Promise<UserAdminRead> {
    return firstValueFrom(
      this.http.patch<UserAdminRead>(`/api/admin/users/${userId}/role`, { role })
    );
  }

  // ── Kiosk tokens ────────────────────────────────────────────────────────

  listKioskTokens(): Promise<KioskTokenAdminRead[]> {
    return firstValueFrom(
      this.http.get<KioskTokenAdminRead[]>('/api/admin/kiosk-tokens')
    );
  }

  createKioskToken(body: KioskTokenCreate): Promise<KioskTokenAdminRead> {
    return firstValueFrom(
      this.http.post<KioskTokenAdminRead>('/api/admin/kiosk-tokens', body)
    );
  }

  revokeKioskToken(tokenId: number): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`/api/admin/kiosk-tokens/${tokenId}`)
    );
  }
}

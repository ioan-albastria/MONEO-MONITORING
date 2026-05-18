import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit,
} from '@angular/core';
import { AdminApiService, UserAdminRead } from '../../core/admin/admin-api.service';
import { AuthService } from '../../core/auth/auth.service';

interface UserRow extends UserAdminRead {
  editUsername: string;
  editEmail: string;
  editRole: string;
  editIsActive: boolean;
  editPassword: string;
  saving: boolean;
  dirty: boolean;
  saveError: string | null;
}

@Component({
  selector: 'app-admin-users',
  standalone: false,
  templateUrl: './admin-users.component.html',
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminUsersComponent implements OnInit {
  rows: UserRow[] = [];
  loading = true;
  error: string | null = null;

  showCreateForm = false;
  createUsername = '';
  createEmail = '';
  createPassword = '';
  createRole = 'viewer';
  creating = false;

  readonly roles = ['viewer', 'operator', 'admin'] as const;

  constructor(
    private readonly api: AdminApiService,
    private readonly auth: AuthService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> { await this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    this.cdr.detectChanges();
    try {
      const users = await this.api.listUsers();
      this.rows = users.map(u => ({
        ...u,
        editUsername: u.username,
        editEmail: u.email,
        editRole: u.role,
        editIsActive: u.is_active,
        editPassword: '',
        saving: false,
        dirty: false,
        saveError: null,
      }));
    } catch {
      this.error = 'Failed to load users.';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  isCurrentUser(row: UserRow): boolean {
    return this.auth.currentUser?.id === row.id;
  }

  markDirty(row: UserRow): void {
    row.dirty = row.editUsername !== row.username
      || row.editEmail !== row.email
      || row.editRole !== row.role
      || row.editIsActive !== row.is_active
      || row.editPassword !== '';
  }

  async saveRow(row: UserRow): Promise<void> {
    if (!row.dirty) return;
    row.saving = true;
    row.saveError = null;
    this.cdr.detectChanges();
    try {
      const body: any = {
        username: row.editUsername,
        email: row.editEmail,
        is_active: row.editIsActive,
      };
      if (!this.isCurrentUser(row)) {
        body['role'] = row.editRole;
      }
      if (row.editPassword) {
        body['password'] = row.editPassword;
      }
      const updated = await this.api.updateUser(row.id, body);
      row.username = updated.username;
      row.email = updated.email;
      row.role = updated.role;
      row.is_active = updated.is_active;
      row.editUsername = updated.username;
      row.editEmail = updated.email;
      row.editRole = updated.role;
      row.editIsActive = updated.is_active;
      row.editPassword = '';
      row.dirty = false;
    } catch (e: any) {
      row.saveError = e?.error?.detail ?? 'Failed to save.';
    } finally {
      row.saving = false;
      this.cdr.detectChanges();
    }
  }

  async deleteRow(row: UserRow): Promise<void> {
    if (!confirm(`Delete user "${row.username}"? This cannot be undone.`)) return;
    try {
      await this.api.deleteUser(row.id);
      await this.load();
    } catch (e: any) {
      this.error = e?.error?.detail ?? 'Delete failed.';
      this.cdr.detectChanges();
    }
  }

  async createUser(): Promise<void> {
    if (!this.createUsername.trim() || !this.createEmail.trim() || !this.createPassword) return;
    this.creating = true;
    this.cdr.detectChanges();
    try {
      await this.api.createUser({
        username: this.createUsername.trim(),
        email: this.createEmail.trim(),
        password: this.createPassword,
        role: this.createRole,
      });
      this.createUsername = '';
      this.createEmail = '';
      this.createPassword = '';
      this.createRole = 'viewer';
      this.showCreateForm = false;
      await this.load();
    } catch (e: any) {
      this.error = e?.error?.detail ?? 'Failed to create user.';
      this.cdr.detectChanges();
    } finally {
      this.creating = false;
    }
  }

  trackUser(_: number, row: UserRow): number { return row.id; }
}

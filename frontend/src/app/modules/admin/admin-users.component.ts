import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
} from '@angular/core';
import { AdminApiService, UserAdminRead } from '../../core/admin/admin-api.service';
import { AuthService } from '../../core/auth/auth.service';

interface UserRow extends UserAdminRead {
  editRole: string;   // current selection in the role dropdown
  saving: boolean;
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
  loadError: string | null = null;

  readonly roles = ['viewer', 'operator', 'admin'] as const;

  constructor(
    private readonly api: AdminApiService,
    private readonly auth: AuthService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    this.loading = true;
    this.cdr.detectChanges();
    try {
      const users = await this.api.listUsers();
      this.rows = users.map(u => ({ ...u, editRole: u.role, saving: false, saveError: null }));
    } catch {
      this.loadError = 'Failed to load users.';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  isCurrentUser(row: UserRow): boolean {
    return this.auth.currentUser?.id === row.id;
  }

  isDirty(row: UserRow): boolean {
    return row.editRole !== row.role;
  }

  async saveRole(row: UserRow): Promise<void> {
    if (!this.isDirty(row)) return;
    row.saving = true;
    row.saveError = null;
    this.cdr.detectChanges();
    try {
      const updated = await this.api.changeUserRole(row.id, row.editRole);
      row.role = updated.role;
      row.editRole = updated.role;
    } catch {
      row.saveError = 'Failed to save.';
      row.editRole = row.role;  // reset on error
    } finally {
      row.saving = false;
      this.cdr.detectChanges();
    }
  }

  trackUser(_: number, row: UserRow): number { return row.id; }
}

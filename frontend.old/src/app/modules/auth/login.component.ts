import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-wrapper">
      <div class="login-card">
        <h1>MONEO Dashboard</h1>
        <h2>Sign in</h2>

        <form (ngSubmit)="onSubmit()" #loginForm="ngForm">
          <div class="form-group">
            <label for="username">Username</label>
            <input
              id="username"
              type="text"
              name="username"
              [(ngModel)]="username"
              required
              autocomplete="username"
            />
          </div>

          <div class="form-group">
            <label for="password">Password</label>
            <input
              id="password"
              type="password"
              name="password"
              [(ngModel)]="password"
              required
              autocomplete="current-password"
            />
          </div>

          <p *ngIf="error" class="error-msg">{{ error }}</p>

          <button type="submit" [disabled]="loading">
            {{ loading ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>
      </div>
    </div>
  `,
  styles: [`
    .login-wrapper {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #f0f2f5;
    }
    .login-card {
      background: white;
      border-radius: 8px;
      padding: 2rem;
      width: 100%;
      max-width: 380px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.1);
    }
    h1 { margin: 0 0 0.25rem; font-size: 1.4rem; color: #1a73e8; }
    h2 { margin: 0 0 1.5rem; font-size: 1rem; color: #555; font-weight: 400; }
    .form-group { display: flex; flex-direction: column; margin-bottom: 1rem; }
    label { font-size: 0.85rem; margin-bottom: 4px; color: #333; }
    input {
      padding: 0.5rem 0.75rem;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 1rem;
    }
    input:focus { outline: none; border-color: #1a73e8; }
    button {
      width: 100%;
      padding: 0.6rem;
      background: #1a73e8;
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 1rem;
      cursor: pointer;
    }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .error-msg { color: #d32f2f; font-size: 0.85rem; margin-bottom: 0.75rem; }
  `],
})
export class LoginComponent {
  username = '';
  password = '';
  error = '';
  loading = false;

  constructor(private auth: AuthService, private router: Router) {}

  onSubmit(): void {
    this.error = '';
    this.loading = true;
    this.auth.login({ username: this.username, password: this.password }).subscribe({
      next: () => this.router.navigate(['/dashboards']),
      error: () => {
        this.error = 'Invalid username or password';
        this.loading = false;
      },
    });
  }
}

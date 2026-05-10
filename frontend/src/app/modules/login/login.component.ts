import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  standalone: false,
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  form: FormGroup;
  loginError: string | null = null;
  loading = false;
  showPassword = false;

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router
  ) {
    this.form = this.fb.group({
      username: ['', Validators.required],
      password: ['', Validators.required],
    });
  }

  async onSubmit(e?: Event): Promise<void> {
    e?.preventDefault();
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }

    this.loginError = null;
    this.loading = true;
    try {
      await this.auth.login(this.form.value.username, this.form.value.password);
      this.router.navigate(['/dashboard']);
    } catch (err: any) {
      this.loginError = err?.error?.detail ?? 'Invalid username or password.';
    } finally {
      this.loading = false;
    }
  }
}

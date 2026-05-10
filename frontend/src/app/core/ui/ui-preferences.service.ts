import { Injectable } from '@angular/core';

export type ThemeName = 'operational-dark' | 'operational-light';
export type DensityName = 'density-comfortable' | 'density-compact';

@Injectable({ providedIn: 'root' })
export class UiPreferencesService {
  private static readonly THEME_KEY   = 'ui.theme';
  private static readonly DENSITY_KEY = 'ui.density';

  init(): void {
    const theme   = (localStorage.getItem(UiPreferencesService.THEME_KEY)   as ThemeName)   ?? 'operational-dark';
    const density = (localStorage.getItem(UiPreferencesService.DENSITY_KEY) as DensityName) ?? 'density-comfortable';
    this.setTheme(theme, false);
    this.setDensity(density, false);
  }

  setTheme(theme: ThemeName, persist = true): void {
    const root = document.documentElement;
    root.classList.remove('theme-dark', 'theme-light');
    root.classList.add(theme === 'operational-dark' ? 'theme-dark' : 'theme-light');
    if (persist) localStorage.setItem(UiPreferencesService.THEME_KEY, theme);
  }

  toggleTheme(): void {
    this.setTheme(this.getCurrentTheme() === 'operational-dark' ? 'operational-light' : 'operational-dark');
  }

  getCurrentTheme(): ThemeName {
    return document.documentElement.classList.contains('theme-light') ? 'operational-light' : 'operational-dark';
  }

  setDensity(density: DensityName, persist = true): void {
    const root = document.documentElement;
    root.classList.remove('density-comfortable', 'density-compact');
    root.classList.add(density);
    if (persist) localStorage.setItem(UiPreferencesService.DENSITY_KEY, density);
  }

  toggleDensity(): void {
    this.setDensity(this.getCurrentDensity() === 'density-comfortable' ? 'density-compact' : 'density-comfortable');
  }

  getCurrentDensity(): DensityName {
    return document.documentElement.classList.contains('density-compact') ? 'density-compact' : 'density-comfortable';
  }
}

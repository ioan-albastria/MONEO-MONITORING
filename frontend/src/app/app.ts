import { Component, OnInit } from '@angular/core';
import { UiPreferencesService } from './core/ui/ui-preferences.service';

@Component({
  selector: 'app-root',
  template: '<router-outlet></router-outlet>',
  standalone: false,
})
export class App implements OnInit {
  constructor(private ui: UiPreferencesService) {}

  ngOnInit(): void {
    this.ui.init();
  }
}

import { Component } from '@angular/core';
import { UiPreferencesService } from '../../core/ui/ui-preferences.service';

interface NavItem {
  label: string;
  icon: string;
  route: string;
  enabled: boolean;
}

@Component({
  selector: 'app-nav-rail',
  standalone: false,
  templateUrl: './app-nav-rail.component.html',
  styleUrl: './app-nav-rail.component.css',
})
export class AppNavRailComponent {
  navOpen = false;

  readonly navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'dashboard',       route: '/dashboard', enabled: true  },
    { label: 'Live View',  icon: 'map',             route: '/live',      enabled: false },
    { label: 'Trips',      icon: 'route',           route: '/trips',     enabled: false },
    { label: 'Vehicles',   icon: 'local_shipping',  route: '/vehicles',  enabled: false },
    { label: 'Events',     icon: 'bolt',            route: '/events',    enabled: false },
    { label: 'Raw Data',   icon: 'data_object',     route: '/raw-data',  enabled: false },
    { label: 'Reports',    icon: 'analytics',       route: '/reports',   enabled: false },
    { label: 'Admin',      icon: 'settings',        route: '/admin',     enabled: false },
  ];

  constructor(readonly ui: UiPreferencesService) {}
}

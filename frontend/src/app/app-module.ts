import { NgModule, APP_INITIALIZER } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';

import { AppRoutingModule } from './app-routing.module';
import { App } from './app';
import { LayoutModule } from './modules/layout/layout.module';
import { SharedModule } from './shared/shared.module';
import { AuthInterceptor } from './core/auth/auth-interceptor.service';
import { KioskService } from './core/kiosk/kiosk.service';

export function initKioskToken(kiosk: KioskService): () => void {
  return () => kiosk.checkForKioskToken();
}

@NgModule({
  declarations: [App],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    HttpClientModule,
    AppRoutingModule,
    LayoutModule,
    SharedModule,
  ],
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
    {
      provide: APP_INITIALIZER,
      useFactory: initKioskToken,
      deps: [KioskService],
      multi: true,
    },
  ],
  bootstrap: [App],
})
export class AppModule {}

import { Routes } from '@angular/router';
import { App } from './app';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'stocks' },
  { path: 'stocks', component: App, data: { market: 'stocks' } },
  { path: 'crypto', component: App, data: { market: 'crypto' } },
  { path: '**', redirectTo: 'stocks' },
];

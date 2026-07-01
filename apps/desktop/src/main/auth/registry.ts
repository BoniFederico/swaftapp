import type { AuthService } from './AuthService';

/**
 * Process-wide handle to the single AuthService instance. Kept in its own tiny module (no Electron
 * imports) so the transport layer + handlers can reach the service without dragging Electron into
 * test bundles. The main bootstrap constructs the real (Electron-backed) service and registers it;
 * tests register an in-memory one.
 */
let instance: AuthService | null = null;

export function setAuthService(service: AuthService | null): void {
  instance = service;
}

export function getAuthService(): AuthService {
  if (!instance) throw new Error('AuthService not initialized');
  return instance;
}

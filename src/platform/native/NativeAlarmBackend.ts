/**
 * NativeAlarmBackend — OWNER: native agent. STUB: replace the body, keep the export signature.
 * Thin adapter: AlarmBackend → `Rouse` plugin (RousePlugin.ts). No business logic here; the
 * shapes are pass-through. Maps plugin listeners to BackendEvent; unwraps `{ ring }` etc.
 */
import type { AlarmBackend } from '../AlarmBackend';
import { notImplemented } from '../../core/notImplemented';

export function createNativeAlarmBackend(): AlarmBackend {
  return notImplemented('createNativeAlarmBackend');
}

/**
 * In-memory editor draft (design.md §2: "The draft lives in an in-memory store until Save").
 * Shared by the editor, mission picker, mission config, QR register and practice routes.
 */
import type { Alarm, MissionConfig } from '../core/types';

export interface EditingMission {
  /** Index in draft.missions; === missions.length when appending. */
  index: number;
  isNew: boolean;
  /** 'random' edits alarm.randomMission instead of a mission slot. */
  kind: MissionConfig['type'] | 'random';
  config: MissionConfig | null;
}

export interface DraftState {
  /** Route key: alarm id, 'new' or 'defaults'. */
  key: string;
  alarm: Alarm;
  /** JSON of the alarm when editing started (unsaved-changes check). */
  original: string;
  editing: EditingMission | null;
}

let draft: DraftState | null = null;
const listeners = new Set<() => void>();

export function getDraft(): DraftState | null {
  return draft;
}

export function startDraft(key: string, alarm: Alarm, original?: Alarm): DraftState {
  draft = { key, alarm: structuredClone(alarm), original: JSON.stringify(original ?? alarm), editing: null };
  emit();
  return draft;
}

export function updateDraftAlarm(patch: Partial<Alarm> | ((a: Alarm) => Alarm)): void {
  if (!draft) return;
  const next = typeof patch === 'function' ? patch(draft.alarm) : { ...draft.alarm, ...patch };
  draft = { ...draft, alarm: next };
  emit();
}

export function setEditing(editing: EditingMission | null): void {
  if (!draft) return;
  draft = { ...draft, editing };
  emit();
}

export function isDirty(): boolean {
  return !!draft && JSON.stringify(draft.alarm) !== draft.original;
}

export function clearDraft(): void {
  draft = null;
  emit();
}

export function subscribeDraft(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function emit() {
  for (const l of listeners) l();
}

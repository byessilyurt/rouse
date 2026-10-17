/** Settings (design.md §3.14). */
import { useRef, useState } from 'preact/hooks';
import type { FallbackMissionConfig, ImportMode, Settings } from '../../core/types';
import { BACKUP_FORMAT, BACKUP_VERSION, DEFAULT_FALLBACK_MISSION, LIMITS } from '../../core/defaults';
import { parseBackup } from '../../core/storage';
import { Button } from '../components/Button';
import { Segmented, Select, Stepper, Toggle } from '../components/controls';
import { Banner, Card, ListRow, Screen, StatusPill } from '../components/layout';
import { Dialog } from '../components/overlays';
import { toast } from '../components/feedback';
import { useApp, useService } from '../context';
import { formatDayMonth, missionName, missionSummary, resolveUse24h } from '../format';
import { summarizeHealth, useHealth } from '../health';
import { Icon } from '../icons';
import { navigate } from '../router';
import { setNotice } from '../notices';
import { ACCENTS, RING_COLORS, ringById, type RingSwatch } from '../palette';

export const SOURCE_URL = 'https://github.com/byessilyurt/rouse';

const MATH_FALLBACK: FallbackMissionConfig = { type: 'math', difficulty: 3, count: 20 };

function fallbackKey(m: FallbackMissionConfig): 'math' | 'typing' {
  return m.type === 'math' ? 'math' : 'typing';
}

interface ImportPreview {
  json: string;
  exportedAt: number | null;
  alarms: number;
  hasRecords: boolean;
}

/** Classify a file's text into a preview or one of the design's three error messages. */
export function previewBackup(text: string): { ok: true; preview: ImportPreview } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Couldn't read the file. Try exporting it again." };
  }
  const obj = raw as { format?: unknown; version?: unknown } | null;
  if (!obj || typeof obj !== 'object' || obj.format !== BACKUP_FORMAT) return { ok: false, error: "This file isn't a Rouse backup." };
  if (typeof obj.version === 'number' && obj.version > BACKUP_VERSION) {
    return { ok: false, error: 'This backup is from a newer version of Rouse. Update the app, then try again.' };
  }
  const parsed = parseBackup(text);
  if (!parsed.ok) return { ok: false, error: "This file isn't a Rouse backup." };
  return {
    ok: true,
    preview: {
      json: text,
      exportedAt: parsed.backup.exportedAt ?? null,
      alarms: parsed.backup.alarms.length,
      hasRecords: (parsed.backup.wakeRecords ?? []).length > 0,
    },
  };
}

export function SettingsScreen() {
  const { backend, repo, now, appVersion } = useApp();
  const service = useService();
  const { health } = useHealth();
  const s = service.getSettings();
  const [importError, setImportError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [, bump] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const use24h = resolveUse24h(s.clockFormat);
  const summary = summarizeHealth(health);
  const update = (patch: Partial<Settings>) => void service.updateSettings(patch);
  const d = s.alarmDefaults;
  const firstMission = d.missions[0];

  const exportBackup = () => {
    const json = service.exportBackup();
    const date = new Date(now());
    const name = `rouse-backup-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.json`;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Backup saved');
  };

  const onFile = async (file: File | undefined) => {
    setImportError(null);
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setImportError("Couldn't read the file. Try exporting it again.");
      return;
    }
    const res = previewBackup(text);
    if (!res.ok) setImportError(res.error);
    else setPreview(res.preview);
  };

  const doImport = async (mode: ImportMode) => {
    const p = preview;
    setPreview(null);
    if (!p) return;
    const res = await service.importBackup(p.json, mode);
    if (!res.ok) {
      setImportError(res.error || "This file isn't a Rouse backup.");
      return;
    }
    toast(`Backup restored · ${res.alarmsImported} ${res.alarmsImported === 1 ? 'alarm' : 'alarms'}`);
    try {
      const h = await backend.getHealth();
      if (h.platform === 'android' && summarizeHealth(h).tone !== 'ok') setNotice('restored-check-reliability');
    } catch {
      /* ignore */
    }
    navigate('/alarms');
  };

  const currentCount = service.getAlarms().length;

  return (
    <Screen title="Settings" chrome="tabs" currentTab="settings">
      <section class="section" aria-labelledby="h-appearance">
        <h2 id="h-appearance">Appearance</h2>
        <div class="field">
          <span class="field-label" id="lbl-theme">
            Theme
          </span>
          <Segmented
            labelledBy="lbl-theme"
            label="Theme"
            options={[
              { value: 'wake', label: 'Follow the day' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'System' },
            ]}
            value={s.theme}
            onChange={(theme) => update({ theme: theme as Settings['theme'] })}
          />
          <p class="muted small">Follow the day: dim and soft at night, bright and bold when it rings.</p>
        </div>
        <div class="field">
          <span class="field-label" id="lbl-accent">
            Accent colour
          </span>
          <Segmented
            labelledBy="lbl-accent"
            label="Accent colour"
            options={ACCENTS.map((a) => ({ value: a.id, label: a.name, swatch: `linear-gradient(135deg, ${a.n1[0]} 50%, ${a.d1[0]} 50%)` }))}
            value={s.accent}
            onChange={(accent) => update({ accent })}
          />
        </div>
        <div class="field">
          <span class="field-label" id="lbl-ring">
            Ring screen colour
          </span>
          <Segmented
            labelledBy="lbl-ring"
            label="Ring screen colour"
            options={RING_COLORS.map((r) => ({ value: r.id, label: r.name, swatch: r.signal }))}
            value={s.ringColor}
            onChange={(ringColor) => update({ ringColor })}
          />
          <RingPreview ring={ringById(s.ringColor)} />
        </div>
        <Toggle checked={use24h} onChange={(v) => update({ clockFormat: v ? '24h' : '12h' })} label="24-hour clock" />
        <div class="field">
          <span class="field-label" id="lbl-week">
            Week starts on
          </span>
          <Segmented
            labelledBy="lbl-week"
            label="Week starts on"
            fill
            options={[
              { value: 1, label: 'Monday' },
              { value: 0, label: 'Sunday' },
            ]}
            value={s.weekStartsOn}
            onChange={(v) => update({ weekStartsOn: v as 0 | 1 })}
          />
        </div>
      </section>

      <section class="section" aria-labelledby="h-defaults">
        <h2 id="h-defaults">New alarm defaults</h2>
        <p class="muted">Used for new alarms. Existing alarms don't change.</p>
        <ul class="list">
          <li>
            <ListRow
              title="Sound, snooze, missions and wake-up check"
              description={
                d.randomMission ? 'Random mission' : firstMission ? `${missionName(firstMission.type)} · ${missionSummary(firstMission)}` : 'No mission'
              }
              href="#/alarm/defaults"
            />
          </li>
        </ul>
      </section>

      <section class="section" aria-labelledby="h-missions">
        <h2 id="h-missions">Missions</h2>
        <Stepper
          label="Backup mission after"
          value={s.fallback.afterFailures}
          min={LIMITS.fallbackAfterFailures.min}
          max={LIMITS.fallbackAfterFailures.max}
          format={(v) => `${v} ${v === 1 ? 'try' : 'tries'}`}
          onChange={(afterFailures) => update({ fallback: { ...s.fallback, afterFailures } })}
        />
        <Select
          label="or after"
          value={s.fallback.afterMinutes}
          options={withCurrent([3, 5, 10], s.fallback.afterMinutes).map((v) => ({ value: v, label: `${v} min` }))}
          onChange={(afterMinutes) => update({ fallback: { ...s.fallback, afterMinutes } })}
        />
        <Select
          label="Backup mission"
          value={fallbackKey(s.fallback.mission)}
          options={[
            { value: 'math', label: '20 math problems (medium)' },
            { value: 'typing', label: 'Type 3 long phrases' },
          ]}
          onChange={(k) => update({ fallback: { ...s.fallback, mission: k === 'math' ? { ...MATH_FALLBACK } : { ...DEFAULT_FALLBACK_MISSION } } })}
          helper="So you're never stuck if a mission can't work. It's longer on purpose."
        />
        <Select
          label="Sound comes back after"
          value={s.silenceWhileSolvingSec}
          options={withCurrent([15, 30, 45, 60], s.silenceWhileSolvingSec).map((v) => ({ value: v, label: `${v} s without a tap` }))}
          onChange={(silenceWhileSolvingSec) => update({ silenceWhileSolvingSec })}
        />
      </section>

      <section class="section" aria-labelledby="h-bedtime">
        <h2 id="h-bedtime">Bedtime</h2>
        <Toggle
          checked={s.bedtimeReminder.enabled}
          onChange={(enabled) => update({ bedtimeReminder: { ...s.bedtimeReminder, enabled } })}
          label="Bedtime reminder"
          description="A quiet notification. It doesn't ring."
        />
        {s.bedtimeReminder.enabled && (
          <Select
            label="Remind me"
            value={s.bedtimeReminder.sleepGoalMin}
            options={withCurrent([420, 450, 480, 510, 540], s.bedtimeReminder.sleepGoalMin).map((v) => ({
              value: v,
              label: `${Math.floor(v / 60)} h${v % 60 ? ` ${v % 60}` : ''} before my next alarm`,
            }))}
            onChange={(sleepGoalMin) => update({ bedtimeReminder: { ...s.bedtimeReminder, sleepGoalMin } })}
          />
        )}
      </section>

      <section class="section" aria-labelledby="h-nap">
        <h2 id="h-nap">Quick nap</h2>
        <Select
          label="Default length"
          value={s.napMinutes}
          options={withCurrent([10, 20, 30, 45, 60], s.napMinutes).map((v) => ({ value: v, label: `${v} min` }))}
          onChange={(napMinutes) => update({ napMinutes })}
        />
      </section>

      <section class="section" aria-labelledby="h-rel">
        <h2 id="h-rel">Reliability</h2>
        <ul class="list">
          <li>
            <ListRow title="Reliability check" icon="shield-check" href="#/health" ariaLabel={summary.ariaLabel} trailing={<StatusPill tone={summary.tone} text={summary.text} />} />
          </li>
        </ul>
      </section>

      <section class="section" aria-labelledby="h-backup">
        <h2 id="h-backup">Backup</h2>
        <Button variant="secondary" block icon="download" onClick={exportBackup}>
          Export alarms & settings
        </Button>
        <Button variant="secondary" block icon="upload" onClick={() => fileRef.current?.click()}>
          Import from file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          class="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="import-file"
          onChange={(e) => {
            const input = e.currentTarget as HTMLInputElement;
            void onFile(input.files?.[0]).finally(() => {
              input.value = '';
            });
          }}
        />
        {importError && (
          <Banner tone="error" alert testId="import-error">
            {importError}
          </Banner>
        )}
        <p class="muted small">Backups include QR codes and stats. Keep the file private.</p>
      </section>

      <section class="section" aria-labelledby="h-data">
        <h2 id="h-data">Data</h2>
        <Button variant="danger-text" onClick={() => setConfirmClear(true)} style="align-self: flex-start">
          Clear statistics
        </Button>
      </section>

      <section class="section" aria-labelledby="h-about">
        <h2 id="h-about">About</h2>
        <p>Rouse {appVersion}</p>
        <Card class="row" style="align-items: flex-start">
          <Icon name="shield-check" style="color: var(--ok)" />
          <p>Rouse has no internet permission. Your alarms, codes and stats never leave this phone. No ads, no analytics, no account.</p>
        </Card>
        <ul class="list">
          <li>
            <ListRow title="Source code" href={SOURCE_URL} external />
          </li>
          <li>
            <ListRow title="Licences" href="#/settings/licences" />
          </li>
          <li>
            <ListRow
              title="Show the welcome screens again"
              onClick={async () => {
                await service.updateSettings({ onboardingDone: false });
                navigate('/onboarding/1');
              }}
            />
          </li>
        </ul>
      </section>

      <Dialog
        open={preview !== null}
        title="Restore this backup?"
        body={
          preview && (
            <p>
              From {preview.exportedAt ? formatDayMonth(preview.exportedAt) : 'an unknown date'}: {preview.alarms} {preview.alarms === 1 ? 'alarm' : 'alarms'}, your settings
              {preview.hasRecords ? ', and stats' : ''}. "Replace" replaces your {currentCount} current {currentCount === 1 ? 'alarm' : 'alarms'}; "Add to my alarms" keeps
              them and your settings.
            </p>
          )
        }
        onClose={() => setPreview(null)}
        actions={[
          { label: 'Cancel', variant: 'secondary', autofocus: true, onClick: () => setPreview(null) },
          { label: 'Add to my alarms', variant: 'secondary', onClick: () => void doImport('merge') },
          { label: 'Replace', variant: 'primary', onClick: () => void doImport('replace') },
        ]}
      />
      <Dialog
        open={confirmClear}
        destructive
        title="Clear all statistics?"
        onClose={() => setConfirmClear(false)}
        actions={[
          { label: 'Keep', variant: 'primary', autofocus: true, onClick: () => setConfirmClear(false) },
          {
            label: 'Clear',
            variant: 'danger',
            onClick: () => {
              setConfirmClear(false);
              repo.clearWakeRecords();
              bump((n) => n + 1);
              toast('Statistics cleared');
            },
          },
        ]}
      />
    </Screen>
  );
}

function withCurrent(values: number[], current: number): number[] {
  return values.includes(current) ? values : [...values, current].sort((a, b) => a - b);
}

/** What the ring screen will look like with the chosen colour (only with "Follow the day" or Light). */
function RingPreview({ ring }: { ring: RingSwatch }) {
  return (
    <div class="ring-preview" aria-hidden="true" style={{ background: ring.signal, color: ring.onSignal }}>
      <span class="ring-preview-clock">06:30</span>
      <span class="ring-preview-btn" style={{ background: ring.onSignal, color: ring.signal }}>
        Keep my word
      </span>
    </div>
  );
}

/**
 * Alarm editor as a promise (design-language.md §5.2): the alarm is a few sentences whose blanks open the
 * controls of design.md §3.3 in sheets. Also edits "New alarm defaults" when id === 'defaults'.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import type { SoundInfo } from '../../platform/AlarmBackend';
import type { Alarm, AlarmDefaults, MissionConfig, SoundRef, ValidationIssue, Weekday } from '../../core/types';
import { BUNDLED_SOUNDS, LIMITS, MAX_LABEL_LENGTH, MAX_MISSIONS, createAlarm } from '../../core/defaults';
import { nextOccurrence } from '../../core/schedule';
import { validateAlarm } from '../../core/validation';
import { Button, IconButton } from '../components/Button';
import { DayChips, Select, Stepper, TextField, TimePicker, Toggle } from '../components/controls';
import { Banner, Screen, StatusPill } from '../components/layout';
import { Dialog, Sheet } from '../components/overlays';
import { toast } from '../components/feedback';
import { useApp, useNow, useService, useUse24h } from '../context';
import { dayDiff, formatClockCountdown, formatDayShort, formatIn, formatTime, missionName, missionSummary, repeatSummary } from '../format';
import { Icon, MISSION_ICON } from '../icons';
import { usePendingTest } from '../pendingTest';
import { goBack, navigate } from '../router';
import { clearDraft, getDraft, isDirty, startDraft, subscribeDraft, updateDraftAlarm } from '../draft';
import { setNotice } from '../notices';

const RAMP_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 15, label: '15 s' },
  { value: 30, label: '30 s' },
  { value: 60, label: '1 min' },
  { value: 120, label: '2 min' },
];
const WAKE_DELAYS = [3, 5, 10, 15];
const WAKE_WINDOWS = [1, 2, 3, 5];

type Section = 'time' | 'repeat' | 'label' | 'sound' | 'snooze' | 'missions' | 'wakecheck' | 'other';

/** Sheet to reopen when the editor comes back from a mission sub-route (picker, config, QR). */
let reopenSheet: Section | null = null;
const toMissionRoute = (path: string) => {
  reopenSheet = 'missions';
  navigate(path);
};

export function sectionOf(path: string): Section {
  const head = path.split('.')[0] ?? '';
  if (head === 'hour' || head === 'minute') return 'time';
  if (head === 'days') return 'repeat';
  if (head === 'label') return 'label';
  if (head === 'sound' || head === 'volume' || head === 'volumeRampSec' || head === 'vibrate') return 'sound';
  if (head === 'snooze') return 'snooze';
  if (head === 'missions' || head === 'randomMission') return 'missions';
  if (head === 'wakeUpCheck') return 'wakecheck';
  return 'other';
}

/** QR missions without a registered code (design.md §3.3). */
export function unregisteredQrIndexes(alarm: Alarm): number[] {
  return alarm.missions.flatMap((m, i) => (m.type === 'qr' && !m.expectedCode ? [i] : []));
}

export function editorIssues(alarm: Alarm, defaultsMode: boolean): ValidationIssue[] {
  let issues: ValidationIssue[];
  try {
    issues = validateAlarm(alarm);
  } catch {
    issues = [];
  }
  const qr = unregisteredQrIndexes(alarm);
  if (defaultsMode) return issues.filter((i) => !/^missions\.\d+\.expectedCode/.test(i.path) && sectionOf(i.path) !== 'time' && sectionOf(i.path) !== 'repeat' && sectionOf(i.path) !== 'label');
  // The QR rule has one fixed message; make sure it is present even if core words it differently.
  const rest = issues.filter((i) => !/^missions\.\d+\.expectedCode/.test(i.path));
  return [...qr.map((i) => ({ path: `missions.${i}.expectedCode`, message: 'Scan a code for the QR mission, or remove it.' })), ...rest];
}

function soundName(ref: SoundRef, sounds: SoundInfo[]): string {
  if (ref.kind === 'custom') return ref.name;
  return sounds.find((s) => s.ref.kind === 'bundled' && s.ref.id === ref.id)?.name ?? BUNDLED_SOUNDS.find((s) => s.id === ref.id)?.name ?? ref.id;
}

export function AlarmEditor({ id }: { id: string }) {
  const { now, backend, ring } = useApp();
  const service = useService();
  const use24h = useUse24h();
  const [, force] = useReducer((n: number) => n + 1, 0);
  const defaultsMode = id === 'defaults';
  const isNew = id === 'new';

  // Initialise the draft for this route (kept while visiting sub-routes).
  let draft = getDraft();
  if (!draft || draft.key !== id) {
    if (isNew) draft = startDraft('new', service.newAlarmDraft());
    else if (defaultsMode) {
      const a = createAlarm({ id: 'defaults', now: now(), defaults: service.getSettings().alarmDefaults });
      draft = startDraft('defaults', a);
    } else {
      const existing = service.getAlarm(id);
      draft = existing ? startDraft(id, existing) : null;
    }
  }
  useEffect(() => subscribeDraft(() => force(0)), []);
  useEffect(() => {
    if (!draft) navigate('/alarms', { replace: true });
  }, [draft]);

  const [showErrors, setShowErrors] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [soundSheet, setSoundSheet] = useState(false);
  const [rampSheet, setRampSheet] = useState(false);
  const [sheet, setSheet] = useState<Section | 'volume' | null>(() => {
    const s = reopenSheet;
    reopenSheet = null;
    return s;
  });
  const [sounds, setSounds] = useState<SoundInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const missionRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  useEffect(() => {
    backend
      .listSounds()
      .then(setSounds)
      .catch(() => setSounds([]));
  }, [backend]);

  if (!draft) return null;
  const a = draft.alarm;
  const settings = service.getSettings();
  const issues = editorIssues(a, defaultsMode);
  const issuesIn = (s: Section) => (showErrors ? issues.filter((i) => sectionOf(i.path) === s) : []);
  const set = (patch: Partial<Alarm>) => updateDraftAlarm(patch);
  const title = defaultsMode ? 'New alarm defaults' : isNew ? 'New alarm' : 'Edit alarm';

  const leave = () => {
    clearDraft();
    goBack(defaultsMode ? '/settings' : '/alarms');
  };
  const onBack = () => {
    if (isDirty()) setConfirmDiscard(true);
    else leave();
  };

  const focusFirstError = (list: ValidationIssue[]) => {
    setTimeout(() => {
      const first = list[0];
      if (!first) return;
      const blank = document.querySelector<HTMLElement>(`.blank[data-section="${sectionOf(first.path)}"]`);
      blank?.scrollIntoView({ block: 'center' });
      blank?.focus();
    }, 0);
  };

  const save = async () => {
    if (saving) return;
    const list = editorIssues(a, defaultsMode);
    if (list.length > 0) {
      setShowErrors(true);
      focusFirstError(list);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (defaultsMode) {
        const defaults: AlarmDefaults = {
          sound: a.sound,
          volume: a.volume,
          volumeRampSec: a.volumeRampSec,
          vibrate: a.vibrate,
          snooze: a.snooze,
          missions: a.missions,
          randomMission: a.randomMission,
          wakeUpCheck: a.wakeUpCheck,
        };
        await service.updateSettings({ alarmDefaults: defaults });
        clearDraft();
        toast('Defaults saved');
        goBack('/settings');
        return;
      }
      let res;
      try {
        res = await service.saveAlarm(a);
      } catch {
        // Persisted, but the backend rejected the schedule (native sync failure).
        setNotice('sync-failed');
        clearDraft();
        navigate('/alarms', { replace: true });
        return;
      }
      if (!res.ok) {
        setShowErrors(true);
        setSaveError(res.issues[0]?.message ?? 'Check the highlighted settings.');
        focusFirstError(res.issues);
        return;
      }
      clearDraft();
      const t = now();
      const at = res.alarm.enabled ? nextOccurrence(res.alarm, t) : null;
      navigate('/alarms', { replace: true });
      toast(at ? `Alarm set for ${formatIn(at - t)}` : 'Alarm saved');
    } finally {
      setSaving(false);
    }
  };

  const testAlarm = async () => {
    ring.testReturnTo = `/alarm/${id}`;
    ring.testPendingSince = now();
    await backend.testAlarm({ ...a, enabled: true }, 1);
    navigate(`/ring?alarmId=${encodeURIComponent(a.id)}&test=1`);
  };

  const missionCount = a.missions.length;
  const qrMissing = unregisteredQrIndexes(a);

  const SectionErrors = ({ s }: { s: Section }) => {
    const list = issuesIn(s);
    if (list.length === 0) return null;
    return (
      <div role="alert" class="stack-sm">
        {list.map((i) => (
          <p class="error-text" key={i.path + i.message}>
            <Icon name="alert-triangle" size={18} />
            {i.message}
          </p>
        ))}
      </div>
    );
  };

  return (
    <Screen
      title={title}
      chrome="top"
      onBack={onBack}
      topAction={
        <Button variant="text" onClick={save}>
          Save
        </Button>
      }
      sticky={
        <Button variant="primary" block onClick={save} ariaDisabled={saving}>
          {defaultsMode ? 'Save defaults' : 'Save alarm'}
        </Button>
      }
    >
      {defaultsMode && <p class="muted">Used for new alarms. Existing alarms don't change.</p>}
      {saveError && (
        <Banner tone="error" alert>
          {saveError}
        </Banner>
      )}

      <PromiseText
        alarm={a}
        defaultsMode={defaultsMode}
        use24h={use24h}
        weekStart={settings.weekStartsOn}
        soundLabel={soundName(a.sound, sounds)}
        invalid={(sec) => issuesIn(sec).length > 0}
        open={(sec) => {
          if (sec === 'sound') setSoundSheet(true);
          else if (sec === 'ramp') setRampSheet(true);
          else setSheet(sec);
        }}
        onVibrate={() => set({ vibrate: !a.vibrate })}
      />
      {!defaultsMode && <RingsIn alarm={a} />}
      {showErrors && issues.length > 0 && (
        <div role="alert" class="stack-sm">
          {issues.map((i) => (
            <p class="error-text" key={i.path + i.message}>
              <Icon name="alert-triangle" size={18} />
              {i.message}
            </p>
          ))}
        </div>
      )}

      {!defaultsMode && (
        <EditorSection id="time" title="Time" open={sheet} onClose={() => setSheet(null)}>
          <TimePicker hour={a.hour} minute={a.minute} use24h={use24h} onChange={(hour, minute) => set({ hour, minute })} />
          <SectionErrors s="time" />
        </EditorSection>
      )}

      {!defaultsMode && (
        <EditorSection id="repeat" title="Repeat" open={sheet} onClose={() => setSheet(null)}>
          <DayChips value={a.days} weekStart={settings.weekStartsOn} onChange={(days) => set({ days })} />
          <div class="chips" role="group" aria-label="Repeat presets">
            {(
              [
                ['Once', []],
                ['Weekdays', [1, 2, 3, 4, 5]],
                ['Weekends', [0, 6]],
                ['Every day', [0, 1, 2, 3, 4, 5, 6]],
              ] as [string, Weekday[]][]
            ).map(([label, days]) => (
              <button key={label} type="button" class="chip text-chip" onClick={() => set({ days })}>
                {label}
              </button>
            ))}
          </div>
          <RepeatLine alarm={a} weekStart={settings.weekStartsOn} />
          <SectionErrors s="repeat" />
        </EditorSection>
      )}

      {!defaultsMode && (
        <EditorSection id="label" title="Reason" open={sheet} onClose={() => setSheet(null)}>
          <TextField
            label="Label"
            hideLabel
            placeholder="e.g. the 8:10 train"
            maxLength={MAX_LABEL_LENGTH}
            value={a.label}
            onValue={(label) => set({ label: label.slice(0, MAX_LABEL_LENGTH) })}
            helper={a.label.length >= MAX_LABEL_LENGTH - 10 ? `${a.label.length} of ${MAX_LABEL_LENGTH}` : undefined}
            autocomplete="off"
          />
          <SectionErrors s="label" />
        </EditorSection>
      )}

      <EditorSection id="volume" title="Volume" open={sheet} onClose={() => setSheet(null)}>
        <Stepper
          label="Volume"
          value={a.volume}
          min={LIMITS.volume.min}
          max={LIMITS.volume.max}
          step={10}
          format={(v) => `${v}%`}
          valueText={(v) => `${v} percent`}
          onChange={(volume) => set({ volume })}
        />
        <SectionErrors s="sound" />
      </EditorSection>

      <EditorSection id="snooze" title="Snooze" open={sheet} onClose={() => setSheet(null)}>
        <Toggle checked={a.snooze.enabled} onChange={(enabled) => set({ snooze: { ...a.snooze, enabled } })} label="Allow snooze" />
        {a.snooze.enabled && (
          <>
            <Stepper
              label="Snooze length"
              value={a.snooze.intervalMin}
              min={LIMITS.snoozeIntervalMin.min}
              max={LIMITS.snoozeIntervalMin.max}
              format={(v) => `${v} min`}
              valueText={(v) => `${v} ${v === 1 ? 'minute' : 'minutes'}`}
              onChange={(intervalMin) => set({ snooze: { ...a.snooze, intervalMin } })}
            />
            <Stepper
              label="Snoozes allowed"
              value={a.snooze.maxCount}
              min={LIMITS.snoozeMaxCount.min}
              max={LIMITS.snoozeMaxCount.max}
              onChange={(maxCount) => set({ snooze: { ...a.snooze, maxCount } })}
            />
            <Toggle
              checked={a.snooze.requireMission}
              onChange={(requireMission) => set({ snooze: { ...a.snooze, requireMission } })}
              label="Snoozing needs the mission too"
              description="You'll finish the mission to snooze, not just to turn off."
            />
          </>
        )}
        <SectionErrors s="snooze" />
      </EditorSection>

      <EditorSection
        id="missions"
        title="Missions"
        open={sheet}
        onClose={() => setSheet(null)}
        aside={
          <span class="muted small" aria-label={`${missionCount} of ${MAX_MISSIONS} missions`}>
            {missionCount} of {MAX_MISSIONS}
          </span>
        }
      >
        {missionCount > 0 && (
          <ol class="list" aria-label="Missions in order">
            {a.missions.map((m, i) => (
              <MissionRow
                key={i}
                mission={m}
                index={i}
                count={missionCount}
                btnRef={(el) => {
                  missionRefs.current[i] = el;
                }}
                onOpen={() => toMissionRoute(`/alarm/${id}/missions/${i}`)}
                onMove={(dir) =>
                  updateDraftAlarm((d) => {
                    const ms = [...d.missions];
                    const j = i + dir;
                    if (j < 0 || j >= ms.length) return d;
                    [ms[i], ms[j]] = [ms[j]!, ms[i]!];
                    return { ...d, missions: ms };
                  })
                }
                onRemove={() => updateDraftAlarm((d) => ({ ...d, missions: d.missions.filter((_, k) => k !== i) }))}
                qrMissing={qrMissing.includes(i)}
              />
            ))}
          </ol>
        )}
        {a.randomMission && (
          <div class="mission-row">
            <span class="mission-index" aria-hidden="true">
              <Icon name="shuffle" size={16} />
            </span>
            <button type="button" class="mission-row-main" onClick={() => toMissionRoute(`/alarm/${id}/missions/${missionCount}?type=random`)}>
              <span class="stack-sm grow" style="gap: 0">
                <span class="list-row-title">Random</span>
                <span class="list-row-desc">{missionCount > 0 ? 'Non-QR missions are swapped for random ones each time' : 'A different mission each time'}</span>
              </span>
            </button>
            <IconButton icon="x" label="Remove Random" plain onClick={() => set({ randomMission: false })} />
          </div>
        )}
        {missionCount === 0 && !a.randomMission && <p class="muted">No mission: one tap turns the alarm off. Add one to make sure you get up.</p>}
        <Button
          variant="secondary"
          block
          icon="plus"
          ariaDisabled={missionCount >= MAX_MISSIONS}
          aria-describedby={missionCount >= MAX_MISSIONS ? 'max-missions' : undefined}
          onClick={() => toMissionRoute(`/alarm/${id}/missions`)}
        >
          Add mission
        </Button>
        {missionCount >= MAX_MISSIONS && (
          <p class="muted small" id="max-missions">
            Up to 3 missions.
          </p>
        )}
        <SectionErrors s="missions" />
      </EditorSection>

      <EditorSection id="wakecheck" title="Wake-up check" open={sheet} onClose={() => setSheet(null)}>
        <Toggle
          checked={a.wakeUpCheck.enabled}
          onChange={(enabled) => set({ wakeUpCheck: { ...a.wakeUpCheck, enabled } })}
          label="Wake-up check"
          description="A few minutes after you turn the alarm off, Rouse asks if you're still up. No answer means it rings again."
        />
        {a.wakeUpCheck.enabled && (
          <>
            <Select
              label="Ask after"
              value={a.wakeUpCheck.delayMin}
              options={withCurrent(WAKE_DELAYS, a.wakeUpCheck.delayMin).map((v) => ({ value: v, label: `${v} min` }))}
              onChange={(delayMin) => set({ wakeUpCheck: { ...a.wakeUpCheck, delayMin } })}
            />
            <Select
              label="Time to answer"
              value={a.wakeUpCheck.windowMin}
              options={withCurrent(WAKE_WINDOWS, a.wakeUpCheck.windowMin).map((v) => ({ value: v, label: `${v} min` }))}
              onChange={(windowMin) => set({ wakeUpCheck: { ...a.wakeUpCheck, windowMin } })}
            />
          </>
        )}
        <SectionErrors s="wakecheck" />
      </EditorSection>

      {showErrors && issuesIn('other').length > 0 && (
        <Banner tone="error">
          {issuesIn('other')
            .map((i) => i.message)
            .join(' ')}
        </Banner>
      )}

      {!defaultsMode && (
        <section class="section" aria-labelledby="h-test">
          <h2 id="h-test">Test</h2>
          <TestSection onTest={testAlarm} />
        </section>
      )}

      {!defaultsMode && !isNew && (
        <Button variant="danger-outline" block icon="trash" onClick={() => setConfirmDelete(true)}>
          Delete alarm
        </Button>
      )}

      <SoundSheet
        open={soundSheet}
        onClose={() => setSoundSheet(false)}
        sounds={sounds}
        value={a.sound}
        volume={a.volume}
        onChange={(sound) => set({ sound })}
        onAdded={(s) => setSounds((list) => [...list, s])}
      />
      <Sheet open={rampSheet} title="Volume ramp" onClose={() => setRampSheet(false)}>
        <p class="muted">Starts quiet and gets louder.</p>
        <RadioList
          name="ramp"
          label="Volume ramp"
          options={withCurrent(
            RAMP_OPTIONS.map((o) => o.value),
            a.volumeRampSec,
          ).map((v) => ({ value: v, label: RAMP_OPTIONS.find((o) => o.value === v)?.label ?? `${v} s` }))}
          value={a.volumeRampSec}
          onChange={(volumeRampSec) => {
            set({ volumeRampSec });
            setRampSheet(false);
          }}
        />
      </Sheet>
      <Dialog
        open={confirmDiscard}
        title="Discard changes?"
        onClose={() => setConfirmDiscard(false)}
        actions={[
          { label: 'Keep editing', variant: 'primary', autofocus: true, onClick: () => setConfirmDiscard(false) },
          {
            label: 'Discard',
            variant: 'danger-text',
            onClick: () => {
              setConfirmDiscard(false);
              leave();
            },
          },
        ]}
      />
      <Dialog
        open={confirmDelete}
        destructive
        title="Delete this alarm?"
        body={`${formatTime(a.hour, a.minute, use24h)} · ${a.label || 'Alarm'}`}
        onClose={() => setConfirmDelete(false)}
        actions={[
          { label: 'Keep', variant: 'primary', autofocus: true, onClick: () => setConfirmDelete(false) },
          {
            label: 'Delete',
            variant: 'danger',
            onClick: async () => {
              setConfirmDelete(false);
              await service.deleteAlarm(a.id);
              clearDraft();
              navigate('/alarms', { replace: true });
              toast('Alarm deleted');
            },
          },
        ]}
      />
    </Screen>
  );
}

function withCurrent(values: number[], current: number): number[] {
  return values.includes(current) ? values : [...values, current].sort((x, y) => x - y);
}

/** A blank's controls, shown in a sheet while `open` names this section. */
function EditorSection({
  id,
  title,
  children,
  aside,
  open,
  onClose,
}: {
  id: Section | 'volume';
  title: string;
  children: ComponentChildren;
  aside?: ComponentChildren;
  open: Section | 'volume' | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={open === id} title={title} onClose={onClose} footer={<Button variant="primary" block onClick={onClose}>Done</Button>}>
      <div class="stack" id={`sec-${id}`}>
        {aside}
        {children}
      </div>
    </Sheet>
  );
}

type BlankTarget = Section | 'volume' | 'ramp';

/** The alarm as sentences; every bracketed value is a blank (design-language.md §5.2). */
function PromiseText({
  alarm: a,
  defaultsMode,
  use24h,
  weekStart,
  soundLabel,
  invalid,
  open,
  onVibrate,
}: {
  alarm: Alarm;
  defaultsMode: boolean;
  use24h: boolean;
  weekStart: 0 | 1;
  soundLabel: string;
  invalid: (s: Section) => boolean;
  open: (s: BlankTarget) => void;
  onVibrate: () => void;
}) {
  const blank = (target: BlankTarget, text: string, name: string, opts: { empty?: boolean; section?: Section } = {}) => {
    const section = opts.section ?? (target === 'volume' || target === 'ramp' ? 'sound' : target);
    return (
      <button
        type="button"
        class={`blank${opts.empty ? ' empty' : ''}`}
        data-section={section}
        aria-invalid={invalid(section) ? 'true' : undefined}
        aria-label={`${name}: ${text}. Change`}
        onClick={() => open(target)}
      >
        {text}
      </button>
    );
  };
  const ramp = a.volumeRampSec === 0 ? 'at full volume' : `rising over ${RAMP_OPTIONS.find((o) => o.value === a.volumeRampSec)?.label ?? `${a.volumeRampSec} s`}`;
  return (
    <div class="promise-block" data-testid="promise">
      {!defaultsMode && (
        <p class="promise">
          Wake me at {blank('time', formatTime(a.hour, a.minute, use24h), 'Time')} {blank('repeat', repeatPhrase(a.days, weekStart), 'Repeat')}.
        </p>
      )}
      {!defaultsMode && (
        <p class="promise">
          {a.label ? <>It's for {blank('label', a.label, 'Reason')}.</> : blank('label', 'Add a reason', 'Reason', { empty: true })}
        </p>
      )}
      <p class="promise">
        {a.missions.length === 0 && !a.randomMission ? (
          <>I won't have to prove I'm up. {blank('missions', 'Add a mission', 'Missions', { empty: true })}</>
        ) : (
          <>I'll prove I'm up with {blank('missions', missionPhrase(a), 'Missions')}.</>
        )}
      </p>
      <p class="promise">
        Ring {blank('sound', soundLabel, 'Sound', { section: 'sound' })} at {blank('volume', `${a.volume} %`, 'Volume')}, {blank('ramp', ramp, 'Volume ramp')},{' '}
        <button type="button" class="blank" aria-pressed={a.vibrate} aria-label={`Vibration: ${a.vibrate ? 'on' : 'off'}. Change`} onClick={onVibrate}>
          {a.vibrate ? 'with vibration' : 'without vibration'}
        </button>
        .
      </p>
      <p class="promise">
        {a.snooze.enabled ? (
          <>
            Let me snooze {blank('snooze', a.snooze.maxCount === 1 ? 'once' : `${a.snooze.maxCount} times`, 'Snoozes allowed')} for{' '}
            {blank('snooze', `${a.snooze.intervalMin} min`, 'Snooze length')}
            {a.snooze.requireMission ? <>, {blank('snooze', 'after the mission', 'Snoozing needs the mission')}</> : null}.
          </>
        ) : (
          <>{blank('snooze', 'No snoozing', 'Snooze')}.</>
        )}
      </p>
      <p class="promise">
        {a.wakeUpCheck.enabled ? (
          <>
            Then check I'm up {blank('wakecheck', `${a.wakeUpCheck.delayMin} min`, 'Ask after')} later, and give me{' '}
            {blank('wakecheck', `${a.wakeUpCheck.windowMin} min`, 'Time to answer')} to answer.
          </>
        ) : (
          <>{blank('wakecheck', "Don't check on me", 'Wake-up check')} afterwards.</>
        )}
      </p>
    </div>
  );
}

function missionPhrase(a: Alarm): string {
  const names = a.missions.map((m) => missionName(m.type).toLowerCase());
  if (a.randomMission) return names.length > 0 ? `random missions (QR kept)` : 'a random mission';
  return names.length <= 1 ? (names[0] ?? 'a mission') : `${names.slice(0, -1).join(', ')}, then ${names[names.length - 1]}`;
}

function repeatPhrase(days: readonly Weekday[], weekStart: 0 | 1): string {
  const set = new Set(days);
  if (set.size === 0) return 'once';
  if (set.size === 7) return 'every day';
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d as Weekday))) return 'on weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'on weekends';
  return `on ${repeatSummary(days, weekStart, null, 0)}`;
}

function RingsIn({ alarm }: { alarm: Alarm }) {
  const { now } = useApp();
  const compute = () => {
    const at = nextOccurrence(alarm, now());
    return at ? `Rings ${formatIn(at - now())}` : '';
  };
  const [text, setText] = useState(compute);
  useEffect(() => {
    const t = setTimeout(() => setText(compute()), 600);
    return () => clearTimeout(t);
  }, [alarm.hour, alarm.minute, alarm.days.join(','), alarm.skipUntil]);
  return (
    <p class="center muted" aria-live="polite" data-testid="rings-in">
      {text}
    </p>
  );
}

/** "Test this alarm", or, while a test is pending (also one started from Reliability), its countdown and a Cancel button. */
function TestSection({ onTest }: { onTest: () => Promise<void> }) {
  const t = useNow(1000);
  const pending = usePendingTest(t);
  if (pending.fireAt == null) {
    return (
      <Button variant="secondary" block icon="play" onClick={onTest}>
        Test this alarm
      </Button>
    );
  }
  return (
    <>
      <Button variant="secondary" block icon="play" ariaDisabled>
        Test alarm in {formatClockCountdown(pending.fireAt - t)}
      </Button>
      <Button
        variant="secondary"
        block
        icon="x"
        onClick={async () => {
          await pending.cancel();
          toast('Test cancelled');
        }}
      >
        Cancel test
      </Button>
    </>
  );
}

function RepeatLine({ alarm, weekStart }: { alarm: Alarm; weekStart: 0 | 1 }) {
  const { now } = useApp();
  const t = now();
  const next = nextOccurrence(alarm, t);
  let text = repeatSummary(alarm.days, weekStart, next, t);
  if (alarm.days.length === 0 && next != null && dayDiff(next, t) <= 1) text = `${text}, ${formatDayShort(next)}`;
  return <p class="muted">{text}</p>;
}

interface MissionRowProps {
  mission: MissionConfig;
  index: number;
  count: number;
  onOpen: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  qrMissing: boolean;
  btnRef: (el: HTMLButtonElement | null) => void;
}

function MissionRow({ mission, index, count, onOpen, onMove, onRemove, qrMissing, btnRef }: MissionRowProps) {
  const name = missionName(mission.type);
  return (
    <li class="mission-row" data-testid="mission-row">
      <span class="mission-index" aria-hidden="true">
        {index + 1}
      </span>
      <button type="button" class="mission-row-main" ref={btnRef} onClick={onOpen} aria-label={`${index + 1}: ${name}, ${missionSummary(mission)}. Edit`}>
        <Icon name={MISSION_ICON[mission.type]} />
        <span class="stack-sm grow" style="gap: 0">
          <span class="list-row-title">{name}</span>
          <span class="list-row-desc">{mission.type === 'qr' ? mission.label || (mission.expectedCode ? 'Code saved' : '') : missionSummary(mission)}</span>
        </span>
        {qrMissing && <StatusPill tone="warn" text="Code not set" />}
      </button>
      {count >= 2 && (
        <>
          <IconButton icon="arrow-up" plain label={`Move ${name} up`} ariaDisabled={index === 0} onClick={() => onMove(-1)} />
          <IconButton icon="arrow-down" plain label={`Move ${name} down`} ariaDisabled={index === count - 1} onClick={() => onMove(1)} />
        </>
      )}
      <IconButton icon="x" plain label={`Remove ${name}`} onClick={onRemove} />
    </li>
  );
}

export function RadioList<T extends string | number>({
  name,
  label,
  options,
  value,
  onChange,
  trailing,
}: {
  name: string;
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  trailing?: (v: T) => ComponentChildren;
}) {
  return (
    <div role="radiogroup" aria-label={label} class="list">
      {options.map((o) => (
        <div class="list-row" key={String(o.value)}>
          <label class="row grow" style="min-height: 48px; cursor: pointer">
            <input type="radio" name={name} checked={o.value === value} onChange={() => onChange(o.value)} style="width: 22px; height: 22px; accent-color: var(--accent)" />
            <span>{o.label}</span>
          </label>
          {trailing?.(o.value)}
        </div>
      ))}
    </div>
  );
}

function SoundSheet({
  open,
  onClose,
  sounds,
  value,
  volume,
  onChange,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  sounds: SoundInfo[];
  value: SoundRef;
  volume: number;
  onChange: (s: SoundRef) => void;
  onAdded: (s: SoundInfo) => void;
}) {
  const { backend } = useApp();
  const [playing, setPlaying] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyOf = (r: SoundRef) => `${r.kind}:${r.id}`;
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPlaying(null);
    void backend.stopPreview().catch(() => undefined);
  };
  useEffect(() => {
    if (!open && playing) stop();
  }, [open]);
  useEffect(() => () => stop(), []);
  const list: SoundInfo[] = sounds.length ? sounds : BUNDLED_SOUNDS.map((s) => ({ ref: { kind: 'bundled' as const, id: s.id }, name: s.name, durationMs: null }));
  const close = () => {
    stop();
    onClose();
  };
  return (
    <Sheet
      open={open}
      title="Sound"
      onClose={close}
      footer={
        <>
          <p class="muted small">If a sound can't play, Rouse uses its built-in backup tone.</p>
          <Button variant="primary" block onClick={close}>
            Done
          </Button>
        </>
      }
    >
      <RadioList
        name="sound"
        label="Alarm sound"
        options={list.map((s) => ({ value: keyOf(s.ref), label: s.name }))}
        value={keyOf(value)}
        onChange={(k) => {
          const s = list.find((x) => keyOf(x.ref) === k);
          if (s) onChange(s.ref);
        }}
        trailing={(k) => {
          const s = list.find((x) => keyOf(x.ref) === k)!;
          const isPlaying = playing === k;
          return (
            <IconButton
              icon={isPlaying ? 'square' : 'play'}
              label={isPlaying ? `Stop ${s.name}` : `Preview ${s.name}`}
              onClick={async () => {
                if (isPlaying) {
                  stop();
                  return;
                }
                stop();
                setPlaying(k);
                await backend.previewSound(s.ref, volume).catch(() => undefined);
                timer.current = setTimeout(stop, 10_000);
              }}
            />
          );
        }}
      />
      {backend.capabilities.canPickCustomSound && (
        <Button
          variant="secondary"
          block
          onClick={async () => {
            const picked = await backend.pickCustomSound().catch(() => null);
            if (picked) {
              onAdded(picked);
              onChange(picked.ref);
            }
          }}
        >
          Choose from phone…
        </Button>
      )}
    </Sheet>
  );
}

/** Mission config (design.md §3.5). Edits draft.editing; "Done" writes it into the draft alarm. */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useReducer } from 'preact/hooks';
import type { MissionConfig, MissionType } from '../../core/types';
import { LIMITS, MAX_CUSTOM_PHRASE_LENGTH, MAX_MISSIONS, MISSION_META, defaultMissionConfig } from '../../core/defaults';
import { generateMathProblems } from '../../missions/math';
import { pickPhrases } from '../../missions/typing';
import { randomRng } from '../../missions/rng';
import { Button } from '../components/Button';
import { Segmented, Stepper, TextField, Toggle } from '../components/controls';
import { Banner, Screen } from '../components/layout';
import { useCaps } from '../context';
import { Icon } from '../icons';
import { goBack, navigate } from '../router';
import { getDraft, setEditing, subscribeDraft, updateDraftAlarm, type EditingMission } from '../draft';
import { mathDifficultyName, missionName } from '../format';

const MISSION_TYPES = new Set<string>(['math', 'memory', 'typing', 'shake', 'qr', 'tap', 'steps', 'squat']);

/** Resolve (and store) what this route is editing. */
function ensureEditing(index: number, type: string | null): EditingMission | null {
  const draft = getDraft();
  if (!draft) return null;
  const ed = draft.editing;
  if (ed && ed.index === index && (!type || ed.kind === type)) return ed;
  const missions = draft.alarm.missions;
  let next: EditingMission | null = null;
  if (type === 'random') {
    next = { index, isNew: !draft.alarm.randomMission, kind: 'random', config: null };
  } else if (index < missions.length && (!type || missions[index]!.type === type)) {
    const m = missions[index]!;
    next = { index, isNew: false, kind: m.type, config: structuredClone(m) };
  } else if (type && MISSION_TYPES.has(type) && missions.length < MAX_MISSIONS) {
    next = { index: missions.length, isNew: true, kind: type as MissionType, config: defaultMissionConfig(type as MissionType) };
  }
  setEditing(next);
  return next;
}

export function MissionConfigScreen({ id, index, type }: { id: string; index: number; type: string | null }) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeDraft(() => force(0)), []);
  const draft = getDraft();
  const ed = draft && draft.key === id ? ensureEditing(index, type) : null;
  useEffect(() => {
    if (!ed) navigate(`/alarm/${id}`, { replace: true });
  }, [ed, id]);
  if (!draft || !ed) return null;

  const title = ed.kind === 'qr' ? MISSION_META.qr.name : missionName(ed.kind);
  const setConfig = (patch: Partial<MissionConfig>) => setEditing({ ...ed, config: { ...(ed.config as MissionConfig), ...patch } as MissionConfig });

  const done = () => {
    if (ed.kind === 'random') {
      updateDraftAlarm({ randomMission: true });
    } else if (ed.config) {
      const cfg = ed.config;
      updateDraftAlarm((a) => {
        const ms = [...a.missions];
        if (ed.isNew) {
          if (ms.length < MAX_MISSIONS) ms.push(cfg);
        } else ms[ed.index] = cfg;
        return { ...a, missions: ms };
      });
    }
    setEditing(null);
    goBack(`/alarm/${id}`);
  };
  const remove = () => {
    if (ed.kind === 'random') updateDraftAlarm({ randomMission: false });
    else updateDraftAlarm((a) => ({ ...a, missions: a.missions.filter((_, i) => i !== ed.index) }));
    setEditing(null);
    goBack(`/alarm/${id}`);
  };
  const customInvalid = ed.config?.type === 'typing' && ed.config.phraseMode === 'custom' && ed.config.customPhrase.trim().length === 0;

  return (
    <Screen
      title={title}
      chrome="top"
      onBack={() => {
        setEditing(null);
        goBack(`/alarm/${id}`);
      }}
      sticky={
        <div class="stack-sm">
          {ed.kind !== 'random' && ed.kind !== 'qr' && (
            <Button variant="secondary" block icon="play" onClick={() => navigate(`/alarm/${id}/missions/${ed.index}/try`)}>
              Try it now
            </Button>
          )}
          <Button variant="primary" block onClick={done} ariaDisabled={customInvalid}>
            Done
          </Button>
        </div>
      }
    >
      {ed.kind === 'random' ? <RandomConfig /> : ed.config && <ConfigFields id={id} index={ed.index} config={ed.config} set={setConfig} />}
      {!ed.isNew && (
        <Button variant="danger-text" onClick={remove}>
          Remove mission
        </Button>
      )}
      <div style="height: 64px" aria-hidden="true" />
    </Screen>
  );
}

function RandomConfig() {
  return (
    <div class="stack">
      <p>
        Each time the alarm rings, Rouse picks a different mission for every slot that isn't a QR code: Math, Memory, Typing, Tap, Shake, Steps or Squats. With no
        missions added, one random mission is used.
      </p>
      <p class="muted">If a picked mission needs a sensor this phone doesn't have, the backup mission is used instead, so a random pick is never impossible.</p>
    </div>
  );
}

function Example({ children }: { children: ComponentChildren }) {
  return (
    <p class="example">
      <span class="muted small">Example: </span>
      {children}
    </p>
  );
}

function ConfigFields({ id, index, config, set }: { id: string; index: number; config: MissionConfig; set: (p: Partial<MissionConfig>) => void }) {
  const caps = useCaps();
  const motionMissing = caps.motionProbed && !caps.get().motion;
  switch (config.type) {
    case 'math':
      return (
        <>
          <div class="field">
            <span class="field-label" id="lbl-difficulty">
              Difficulty
            </span>
            <Segmented
              labelledBy="lbl-difficulty"
              label="Difficulty"
              options={[1, 2, 3, 4, 5].map((d) => ({ value: d, label: mathDifficultyName(d) }))}
              value={config.difficulty}
              onChange={(difficulty) => set({ difficulty: difficulty as 1 | 2 | 3 | 4 | 5 })}
            />
          </div>
          <Stepper
            label="Problems"
            value={config.count}
            min={LIMITS.math.count.min}
            max={LIMITS.math.count.max}
            onChange={(count) => set({ count })}
          />
          <MathExample difficulty={config.difficulty} />
        </>
      );
    case 'memory':
      return (
        <>
          <div class="field">
            <span class="field-label" id="lbl-grid">
              Grid
            </span>
            <Segmented
              labelledBy="lbl-grid"
              label="Grid"
              options={[3, 4, 5].map((g) => ({ value: g, label: `${g}×${g}` }))}
              value={config.gridSize}
              onChange={(g) => set({ gridSize: g as 3 | 4 | 5 })}
            />
          </div>
          <Stepper label="Rounds" value={config.rounds} min={LIMITS.memory.rounds.min} max={LIMITS.memory.rounds.max} onChange={(rounds) => set({ rounds })} />
          <Example>
            Round 1 lights up {config.gridSize} tiles on a {config.gridSize}×{config.gridSize} grid; each round adds one more.
          </Example>
        </>
      );
    case 'typing':
      return (
        <>
          <div class="field">
            <span class="field-label" id="lbl-phrase">
              Phrase
            </span>
            <Segmented
              labelledBy="lbl-phrase"
              label="Phrase"
              options={[
                { value: 'random', label: 'Built-in' },
                { value: 'custom', label: 'My own' },
              ]}
              value={config.phraseMode}
              onChange={(phraseMode) => set({ phraseMode: phraseMode as 'random' | 'custom' })}
            />
          </div>
          {config.phraseMode === 'custom' ? (
            <CustomPhrase value={config.customPhrase} onValue={(customPhrase) => set({ customPhrase })} />
          ) : (
            <Stepper
              label="Phrases"
              value={config.phrases}
              min={LIMITS.typing.phrases.min}
              max={LIMITS.typing.phrases.max}
              onChange={(phrases) => set({ phrases })}
            />
          )}
          <Toggle checked={!config.strictCase} onChange={(v) => set({ strictCase: !v })} label="Ignore capitals and extra spaces" />
          {config.phraseMode === 'random' && <TypingExample />}
        </>
      );
    case 'shake':
      return (
        <>
          {motionMissing && <MotionBanner />}
          <Stepper label="Shakes" value={config.count} min={LIMITS.shake.count.min} max={LIMITS.shake.count.max} step={10} onChange={(count) => set({ count })} />
          <div class="field">
            <span class="field-label" id="lbl-strength">
              Strength needed
            </span>
            <Segmented
              labelledBy="lbl-strength"
              label="Strength needed"
              options={[
                { value: 'low', label: 'Light' },
                { value: 'medium', label: 'Normal' },
                { value: 'high', label: 'Hard' },
              ]}
              value={config.sensitivity}
              onChange={(sensitivity) => set({ sensitivity: sensitivity as 'low' | 'medium' | 'high' })}
            />
          </div>
          <Example>Shake the phone {config.count} times.</Example>
        </>
      );
    case 'tap':
      return (
        <>
          <Stepper label="Targets" value={config.targets} min={LIMITS.tap.targets.min} max={LIMITS.tap.targets.max} step={5} onChange={(targets) => set({ targets })} />
          <Example>Tap {config.targets} targets as they pop up. A missed target just moves.</Example>
        </>
      );
    case 'steps':
      return (
        <>
          {motionMissing && <MotionBanner />}
          <Stepper label="Steps" value={config.count} min={LIMITS.steps.count.min} max={LIMITS.steps.count.max} step={10} onChange={(count) => set({ count })} />
          <p class="muted">Counted from the motion sensor, so no extra permission is needed.</p>
          <Example>Walk {config.count} steps with the phone in your hand.</Example>
        </>
      );
    case 'squat':
      return (
        <>
          <Banner tone="info">
            Squats are detected from phone motion, so they can be faked by moving the phone up and down. Add a second mission if that worries you.
          </Banner>
          {motionMissing && <MotionBanner />}
          <Stepper label="Squats" value={config.count} min={LIMITS.squat.count.min} max={LIMITS.squat.count.max} onChange={(count) => set({ count })} />
          <Example>Do {config.count} squats holding the phone to your chest.</Example>
        </>
      );
    case 'qr':
      return <QrConfig id={id} index={index} expectedCode={config.expectedCode} label={config.label} set={set} />;
  }
}

function MotionBanner() {
  return <Banner tone="warn">Rouse can't read a motion sensor here, so the backup mission is used when the alarm rings.</Banner>;
}

function MathExample({ difficulty }: { difficulty: number }) {
  const text = useMemo(() => {
    try {
      return generateMathProblems({ type: 'math', difficulty: difficulty as 1 | 2 | 3 | 4 | 5, count: 1 }, randomRng())[0]?.prompt ?? '';
    } catch {
      return ['3 + 4', '12 + 25', '34 × 3 + 18', '47 × 26', '28 × 7 + 34 × 12'][difficulty - 1] ?? '';
    }
  }, [difficulty]);
  return <Example>{text}</Example>;
}

function TypingExample() {
  const text = useMemo(() => {
    try {
      return pickPhrases({ type: 'typing', phraseMode: 'random', customPhrase: '', strictCase: false, phrases: 1 }, randomRng())[0] ?? '';
    } catch {
      return '';
    }
  }, []);
  return text ? <Example>{text}</Example> : null;
}

function CustomPhrase({ value, onValue }: { value: string; onValue: (v: string) => void }) {
  const empty = value.trim().length === 0;
  return (
    <div class="field">
      <label for="custom-phrase">Your phrase</label>
      <textarea
        id="custom-phrase"
        class="textarea"
        maxLength={MAX_CUSTOM_PHRASE_LENGTH}
        placeholder="Today I'm getting up because…"
        value={value}
        aria-invalid={empty ? 'true' : undefined}
        aria-describedby="custom-phrase-help"
        onInput={(e) => onValue((e.currentTarget as HTMLTextAreaElement).value.slice(0, MAX_CUSTOM_PHRASE_LENGTH))}
      />
      <p class="muted small" id="custom-phrase-help">
        {empty ? "Write the phrase you'll type to turn the alarm off." : `${value.length} of ${MAX_CUSTOM_PHRASE_LENGTH} characters`}
      </p>
    </div>
  );
}

function QrConfig({ id, index, expectedCode, label, set }: { id: string; index: number; expectedCode: string; label: string; set: (p: Partial<MissionConfig>) => void }) {
  const saved = expectedCode.length > 0;
  return (
    <>
      <TextField label="Where is it?" placeholder="Bathroom sink" value={label} maxLength={40} onValue={(v) => set({ label: v })} />
      <p class={`row ${saved ? 'ok-text' : 'warn-text'}`} data-testid="qr-status">
        <Icon name={saved ? 'check-circle' : 'alert-triangle'} />
        {saved ? (
          <span>
            Code saved <span class="muted">(…{expectedCode.slice(-4)})</span>
          </span>
        ) : (
          <span>No code yet</span>
        )}
      </p>
      <Button variant="primary" block icon="camera" onClick={() => navigate(`/alarm/${id}/missions/${index}/qr`)}>
        {saved ? 'Scan a different code' : 'Scan a code'}
      </Button>
      {saved && (
        <Button variant="secondary" block onClick={() => navigate(`/alarm/${id}/missions/${index}/qr?test=1`)}>
          Test scan now
        </Button>
      )}
      <p class="muted">Print a QR code or use a product barcode, and keep it outside your bedroom.</p>
    </>
  );
}

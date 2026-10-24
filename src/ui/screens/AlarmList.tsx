/** Home: the timeline (design-language.md §5.1). Height on the rail is real time; same data as design.md §3.2. */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Alarm } from '../../core/types';
import { isSkipping, napTime, nextOccurrence } from '../../core/schedule';
import { Button, IconButton } from '../components/Button';
import { Segmented, Toggle } from '../components/controls';
import { Banner, Screen, StatusPill } from '../components/layout';
import { Dialog, Sheet } from '../components/overlays';
import { toast } from '../components/feedback';
import { useApp, useNow, useService, useUse24h } from '../context';
import {
  formatDayTime,
  formatDayTimeSpoken,
  formatIn,
  formatInSpoken,
  formatTime,
  repeatSummary,
  timeParts,
  weekdayName,
} from '../format';
import { summarizeHealth, useHealth } from '../health';
import { Icon } from '../icons';
import { navigate } from '../router';
import { clearDraft } from '../draft';
import { takeNotice, type Notice } from '../notices';
import { MissionIcons, WebDemoBanner } from './shared';

const NAP_OPTIONS = [10, 20, 30, 45, 60] as const;

export function AlarmList() {
  const { now, repo } = useApp();
  const service = useService();
  const [loadWarning, setLoadWarning] = useState<string | null>(() => {
    try {
      return repo.getLoadWarning();
    } catch {
      return null;
    }
  });
  const use24h = useUse24h();
  const t = useNow(30_000);
  const { health } = useHealth();
  const [notice, setNoticeState] = useState<Notice | null>(() => takeNotice());
  const [napOpen, setNapOpen] = useState(false);
  const alarms = service.getAlarms();
  const settings = service.getSettings();
  const summary = summarizeHealth(health, safeLen(() => service.getSchedulerMismatches()));
  const next = service.nextFire();
  const nextAlarm = next ? service.getAlarm(next.alarmId) : undefined;

  const skipping = alarms
    .filter((a) => a.enabled && isSkipping(a, t) && a.skipUntil != null)
    .sort((a, b) => (a.skipUntil ?? 0) - (b.skipUntil ?? 0))[0];

  const nowParts = timeParts(new Date(t).getHours(), new Date(t).getMinutes(), use24h);
  const placed = alarms.map((a) => ({ alarm: a, at: a.enabled ? nextOccurrence(a, t) : null }));
  const onRail = placed.filter((p) => p.at !== null && p.at - t <= DAY_MS).sort((x, y) => x.at! - y.at!) as Placed[];
  const later = placed.filter((p) => p.at !== null && p.at - t > DAY_MS).sort((x, y) => x.at! - y.at!);
  const off = alarms.filter((a) => !a.enabled || nextOccurrence(a, t) === null);

  const newAlarm = () => {
    clearDraft();
    navigate('/alarm/new');
  };

  return (
    <Screen title="Alarms" chrome="tabs" currentTab="alarms" customHeading>
      <div class="home-head-row">
        <h1 tabIndex={-1} class="rule-label">Alarms</h1>
        <StatusPill tone={summary.tone} text={summary.text} href="#/health" ariaLabel={summary.ariaLabel} />
      </div>
      <WebDemoBanner collapsible />
      {loadWarning && (
        <Banner
          tone="warn"
          action={
            <Button variant="secondary" onClick={() => setLoadWarning(null)}>
              Got it
            </Button>
          }
        >
          Rouse couldn't read its saved data, so it started fresh. A copy of the old data was kept on this device.
        </Banner>
      )}
      {notice === 'sync-failed' && (
        <Banner
          tone="error"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setNoticeState(null);
                navigate('/health');
              }}
            >
              Open Reliability
            </Button>
          }
        >
          Saved, but Android didn't accept the schedule. Open Reliability to fix it.
        </Banner>
      )}
      {notice === 'restored-check-reliability' && (
        <Banner
          tone="warn"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setNoticeState(null);
                navigate('/health');
              }}
            >
              Open Reliability
            </Button>
          }
        >
          Alarms restored. Check Reliability so they ring on this phone.
        </Banner>
      )}

      {alarms.length === 0 ? (
        <div class="stack center" style="align-items: center; padding-top: var(--sp-6)">
          <Icon name="sun" size={64} style="color: var(--accent)" />
          <h2>No alarms yet</h2>
          <p class="muted">Set one up and choose how you'll prove you're awake.</p>
          <Button variant="primary" icon="plus" onClick={newAlarm}>
            Create your first alarm
          </Button>
        </div>
      ) : (
        <>
          <div
            class="home-head"
            data-testid="next-alarm"
            aria-label={
              next
                ? `Next alarm ${formatInSpoken(next.fireAt - t)}, ${formatDayTimeSpoken(next.fireAt, use24h)}, ${nextAlarm?.label || 'Alarm'}`
                : undefined
            }
          >
            <p class="home-clock clock-face" aria-hidden="true">
              {nowParts.time}
              {nowParts.suffix && <small class="small"> {nowParts.suffix}</small>}
            </p>
            {next ? (
              <p class="home-next" aria-hidden="true">
                Next {formatIn(next.fireAt - t)} · <span class="tabular">{formatDayTime(next.fireAt, t, use24h)} · {nextAlarm?.label || 'Alarm'}</span>
              </p>
            ) : (
              <>
                <p class="home-next">No alarms on</p>
                <p class="muted">Turn one on below or create a new one.</p>
              </>
            )}
            {skipping && skipping.skipUntil != null && (
              <p class="row muted small">
                <Icon name="skip-forward" size={18} />
                Skipping {formatDayTime(skipping.skipUntil, t, use24h)}
              </p>
            )}
          </div>
          <Timeline alarms={onRail} now={t} use24h={use24h} weekStart={settings.weekStartsOn} />
          {later.length > 0 && (
            <section class="section" aria-labelledby="h-later">
              <h2 id="h-later">Later</h2>
              <ul class="alarm-cards" aria-label="Later alarms">
                {later.map(({ alarm: a }) => (
                  <AlarmCard key={a.id} alarm={a} now={t} use24h={use24h} weekStart={settings.weekStartsOn} />
                ))}
              </ul>
            </section>
          )}
          {off.length > 0 && (
            <section class="section" aria-labelledby="h-off">
              <h2 id="h-off">Off</h2>
              <ul class="alarm-cards" aria-label="Alarms that are off">
                {off.map((a) => (
                  <AlarmCard key={a.id} alarm={a} now={t} use24h={use24h} weekStart={settings.weekStartsOn} />
                ))}
              </ul>
            </section>
          )}
          <Button variant="secondary" block icon="moon" onClick={() => setNapOpen(true)}>
            Quick nap
          </Button>
          <Button variant="primary" icon="plus" class="fab" onClick={newAlarm}>
            New alarm
          </Button>
        </>
      )}
      <QuickNapSheet open={napOpen} onClose={() => setNapOpen(false)} defaultMinutes={settings.napMinutes} use24h={use24h} now={now} />
    </Screen>
  );
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/**
 * Rail scale: 24 h = 24 × HOUR_PX. A mark sits at its time unless the card above would overlap it;
 * then it is pushed below that card (measured height + MARK_SPACE_PX, D-083). The printed time stays exact.
 */
const HOUR_PX = 30;
const MIN_GAP_PX = 84;
const MARK_SPACE_PX = 12;

/** Rail offsets for marks, given each card's rendered height (0 = not measured yet). */
export function markOffsets(times: readonly number[], heights: readonly number[]): number[] {
  const ys: number[] = [];
  times.forEach((y, i) => {
    const prev = i > 0 ? ys[i - 1]! + Math.max(MIN_GAP_PX, (heights[i - 1] ?? 0) + MARK_SPACE_PX) : 0;
    ys.push(Math.max(y, MIN_GAP_PX * 0.5, prev));
  });
  return ys;
}

interface Placed {
  alarm: Alarm;
  at: number;
}

function Timeline({ alarms, now, use24h, weekStart }: { alarms: Placed[]; now: number; use24h: boolean; weekStart: 0 | 1 }) {
  const yOf = (at: number) => ((at - now) / HOUR_MS) * HOUR_PX;
  const listRef = useRef<HTMLUListElement>(null);
  const [heights, setHeights] = useState<number[]>([]);
  const ids = alarms.map((p) => p.alarm.id).join(' ');
  useLayoutEffect(() => {
    const ul = listRef.current;
    if (!ul) return;
    const items = [...ul.children] as HTMLElement[];
    const measure = () => {
      const hs = items.map((li) => li.offsetHeight);
      setHeights((prev) => (prev.length === hs.length && prev.every((h, i) => h === hs[i]) ? prev : hs));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    for (const li of items) ro.observe(li);
    return () => ro.disconnect();
  }, [ids]);
  const ys = markOffsets(
    alarms.map((p) => yOf(p.at)),
    heights,
  );
  const last = ys.length - 1;
  const height = Math.max(24 * HOUR_PX, last >= 0 ? ys[last]! + Math.max(MIN_GAP_PX, heights[last] ?? 0) : 0);
  const firstHour = Math.ceil(now / HOUR_MS) * HOUR_MS;
  const hours: { y: number; label: string | null }[] = [];
  for (let h = firstHour; h <= now + DAY_MS; h += HOUR_MS) {
    const hr = new Date(h).getHours();
    const label = hr % 3 === 0 ? (use24h ? String(hr).padStart(2, '0') : `${hr % 12 || 12}${hr < 12 ? 'a' : 'p'}`) : null;
    hours.push({ y: yOf(h), label });
  }
  const sleepEnd = alarms.length > 0 ? yOf(alarms[0]!.at) : 0;
  return (
    <div class="rail" style={`height: ${height}px`} data-testid="timeline">
      <div aria-hidden="true">
        {sleepEnd > 0 && <span class="rail-sleep" style={`top: 0; height: ${sleepEnd}px`} />}
        {sleepEnd > 120 && (
          <span class="rail-sleep-label" style={`top: ${sleepEnd / 2 - 10}px`}>
            {formatIn(alarms[0]!.at - now).replace(/^in /, '')} until it rings
          </span>
        )}
        {hours.map((h) => (
          <span key={h.y}>
            <span class={`rail-tick${h.label ? ' major' : ''}`} style={`top: ${h.y}px`} />
            {h.label && h.y > 18 && (
              <span class="rail-hour" style={`top: ${h.y}px`}>
                {h.label}
              </span>
            )}
          </span>
        ))}
        <span class="rail-now" />
        <span class="rail-now-label">Now</span>
        <span class="rail-end">+24 h</span>
      </div>
      {alarms.length > 0 && (
        <ul class="marks" ref={listRef} aria-label="Alarms in the next 24 hours">
          {alarms.map((p, i) => (
            <AlarmCard key={p.alarm.id} alarm={p.alarm} now={now} use24h={use24h} weekStart={weekStart} liClass="mark" liStyle={`top: ${ys[i]}px`} />
          ))}
        </ul>
      )}
      {alarms.length === 0 && (
        <p class="rail-sleep-label" style="top: 48px">
          Nothing rings in the next 24 hours.
        </p>
      )}
    </div>
  );
}

function safeLen(fn: () => readonly unknown[]): number {
  try {
    return fn().length;
  } catch {
    return 0;
  }
}

function AlarmCard({
  alarm: a,
  now,
  use24h,
  weekStart,
  liClass,
  liStyle,
}: {
  alarm: Alarm;
  now: number;
  use24h: boolean;
  weekStart: 0 | 1;
  liClass?: string;
  liStyle?: string;
}) {
  const service = useService();
  const { newId, now: clock } = useApp();
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const tp = timeParts(a.hour, a.minute, use24h);
  const timeText = formatTime(a.hour, a.minute, use24h);
  const nextAt = nextOccurrence(a, now);
  const repeat = repeatSummary(a.days, weekStart, nextAt, now);
  const label = a.label || 'Alarm';
  const skipping = a.enabled && isSkipping(a, now) && a.skipUntil != null;
  const unskipped = nextOccurrence({ ...a, skipUntil: null }, now);

  const toggle = async (on: boolean) => {
    await service.setEnabled(a.id, on);
    if (on) {
      const at = nextOccurrence(a, clock());
      toast(at ? `Alarm set for ${formatIn(at - clock())}` : 'Alarm on');
    } else {
      toast('Alarm off');
    }
  };

  return (
    <li class={liClass} style={liStyle}>
      <div class={`alarm-card${a.enabled ? '' : ' off'}`} data-testid="alarm-card" data-alarm-id={a.id}>
        <a class="alarm-card-main" href={`#/alarm/${a.id}`}>
          <span class="alarm-time clock-face">
            <time>{tp.time}</time>
            {tp.suffix && <small>{tp.suffix}</small>}
          </span>
          <span class="alarm-label">{label}</span>
          <span class="muted small">{repeat}</span>
          <MissionIcons alarm={a} />
          {skipping && (
            <span>
              <StatusPill tone="info" icon="skip-forward" text={`Skipping ${weekdayName(new Date(a.skipUntil!).getDay() as 0, 'short')}`} />
            </span>
          )}
        </a>
        <div class="alarm-card-side">
          <Toggle compact checked={a.enabled} onChange={toggle} label={`Alarm ${timeText}, ${label}, ${repeat}`} visibleLabel={null} />
          <IconButton icon="more-vertical" plain label={`More options for ${timeText} alarm`} onClick={() => setMenu(true)} />
        </div>
      </div>
      <Sheet open={menu} title={`${timeText} · ${label}`} onClose={() => setMenu(false)}>
        <div class="stack-sm">
          {a.enabled &&
            (skipping ? (
              <Button
                variant="secondary"
                block
                icon="skip-forward"
                onClick={async () => {
                  setMenu(false);
                  await service.unskip(a.id);
                  toast('Skip cancelled');
                }}
              >
                Don't skip
              </Button>
            ) : (
              unskipped != null && (
                <Button
                  variant="secondary"
                  block
                  icon="skip-forward"
                  onClick={async () => {
                    setMenu(false);
                    await service.skipNext(a.id);
                    toast(`Skipping ${formatDayTime(unskipped, clock(), use24h)}`);
                  }}
                >
                  Skip next ({formatDayTime(unskipped, now, use24h)})
                </Button>
              )
            ))}
          <Button
            variant="secondary"
            block
            onClick={async () => {
              setMenu(false);
              const t = clock();
              const copy: Alarm = { ...structuredClone(a), id: newId(), createdAt: t, updatedAt: t, skipUntil: null };
              const res = await service.saveAlarm(copy);
              toast(res.ok ? 'Alarm duplicated' : "Couldn't duplicate this alarm");
            }}
          >
            Duplicate
          </Button>
          <Button
            variant="danger-outline"
            block
            icon="trash"
            onClick={() => {
              setMenu(false);
              setConfirmDelete(true);
            }}
          >
            Delete
          </Button>
        </div>
      </Sheet>
      <Dialog
        open={confirmDelete}
        destructive
        title="Delete this alarm?"
        body={`${timeText} · ${label}`}
        onClose={() => setConfirmDelete(false)}
        actions={[
          { label: 'Keep', variant: 'primary', autofocus: true, onClick: () => setConfirmDelete(false) },
          {
            label: 'Delete',
            variant: 'danger',
            onClick: async () => {
              setConfirmDelete(false);
              await service.deleteAlarm(a.id);
              toast('Alarm deleted');
            },
          },
        ]}
      />
    </li>
  );
}

function QuickNapSheet({ open, onClose, defaultMinutes, use24h, now }: { open: boolean; onClose: () => void; defaultMinutes: number; use24h: boolean; now: () => number }) {
  const service = useService();
  const initial = (NAP_OPTIONS as readonly number[]).includes(defaultMinutes) ? defaultMinutes : 20;
  const [minutes, setMinutes] = useState<number>(initial);
  const [requireMission, setRequireMission] = useState(false);
  const [busy, setBusy] = useState(false);
  const at = napTime(now(), minutes);
  return (
    <Sheet open={open} title="Quick nap" onClose={onClose}>
      <Segmented label="Nap length" options={NAP_OPTIONS.map((m) => ({ value: m, label: `${m} min` }))} value={minutes} onChange={setMinutes} />
      <Toggle checked={requireMission} onChange={setRequireMission} label="Require mission" description="Uses your default mission." />
      <Button
        variant="primary"
        block
        icon="moon"
        ariaDisabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            let nap = await service.quickNap(minutes);
            if (!requireMission && (nap.missions.length > 0 || nap.randomMission)) {
              const res = await service.saveAlarm({ ...nap, missions: [], randomMission: false });
              if (res.ok) nap = res.alarm;
            }
            const fireAt = nextOccurrence(nap, now());
            toast(fireAt ? `Nap set. Rings ${formatIn(fireAt - now())}` : 'Nap set');
            onClose();
          } finally {
            setBusy(false);
          }
        }}
      >
        Start nap · rings at {formatTime(at.hour, at.minute, use24h)}
      </Button>
    </Sheet>
  );
}


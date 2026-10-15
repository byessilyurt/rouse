/** Small pieces shared by several screens. */
import type { Alarm } from '../../core/types';
import { Banner } from '../components/layout';
import { useApp } from '../context';
import { Icon, MISSION_ICON } from '../icons';
import { missionProseName } from '../format';

export const WEB_DEMO_TEXT = "Demo only. This web version can't wake a locked phone or ring when the tab is closed. Use the Android app for real alarms.";

export function WebDemoBanner({ collapsible }: { collapsible?: boolean }) {
  const { backend } = useApp();
  if (backend.kind !== 'web') return null;
  return (
    <Banner
      tone="warn"
      testId="web-demo-banner"
      collapsible={collapsible ? { collapsedText: "Demo mode · can't wake a locked phone", storageKey: 'rouse.ui.demoBannerCollapsed' } : undefined}
    >
      {WEB_DEMO_TEXT}
    </Banner>
  );
}

/** "Missions: QR code, then Math" + icon row (max 3, "+n" for random). */
export function missionsAria(alarm: Alarm): string {
  if (alarm.randomMission) {
    const fixed = alarm.missions.filter((m) => m.type === 'qr').map((m) => missionProseName(m.type));
    return fixed.length ? `Missions: random, plus ${fixed.join(', then ')}` : 'Missions: random';
  }
  if (alarm.missions.length === 0) return 'No mission';
  return `Missions: ${alarm.missions.map((m) => missionProseName(m.type)).join(', then ')}`;
}

export function MissionIcons({ alarm }: { alarm: Alarm }) {
  if (!alarm.randomMission && alarm.missions.length === 0) {
    return <span class="mission-icons">No mission</span>;
  }
  const shown = alarm.randomMission ? alarm.missions.filter((m) => m.type === 'qr').slice(0, 2) : alarm.missions.slice(0, 3);
  const randomSlots = alarm.randomMission ? Math.max(1, alarm.missions.filter((m) => m.type !== 'qr').length) : 0;
  return (
    <span class="mission-icons" role="img" aria-label={missionsAria(alarm)}>
      {alarm.randomMission && <Icon name="shuffle" size={20} />}
      {shown.map((m, i) => (
        <Icon key={i} name={MISSION_ICON[m.type]} size={20} />
      ))}
      {randomSlots > 0 && <span aria-hidden="true">+{randomSlots}</span>}
    </span>
  );
}

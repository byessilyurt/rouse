/** Mission picker (design.md §3.4). */
import { useEffect } from 'preact/hooks';
import type { MissionType } from '../../core/types';
import { MAX_MISSIONS, MISSION_META } from '../../core/defaults';
import { Screen } from '../components/layout';
import { useCaps } from '../context';
import { Icon, MISSION_ICON } from '../icons';
import { goBack, navigate } from '../router';
import { getDraft, setEditing } from '../draft';
import { missionName } from '../format';

export const PICKER_TILES: { type: MissionType | 'random'; description: string; badge?: string }[] = [
  { type: 'math', description: 'Solve a few sums' },
  { type: 'memory', description: 'Repeat a pattern of tiles' },
  { type: 'typing', description: 'Type a phrase exactly' },
  { type: 'shake', description: 'Shake your phone', badge: 'Easy to do in bed' },
  { type: 'qr', description: 'Scan a code in another room', badge: 'Gets you up' },
  { type: 'tap', description: 'Hit moving targets' },
  { type: 'steps', description: 'Walk around', badge: 'Gets you up' },
  { type: 'squat', description: 'Do squats holding the phone', badge: 'Can be faked' },
  { type: 'random', description: 'A different mission each time' },
];

export function MissionPicker({ id }: { id: string }) {
  const caps = useCaps();
  const draft = getDraft();
  useEffect(() => {
    if (!draft || draft.key !== id) navigate(`/alarm/${id}`, { replace: true });
  }, [draft, id]);
  if (!draft) return null;
  const c = caps.get();
  const count = draft.alarm.missions.length;
  const defaultsMode = id === 'defaults';

  const unavailableReason = (t: MissionType | 'random'): string | null => {
    if (t === 'random') return draft.alarm.randomMission ? 'Already on for this alarm' : null;
    if (count >= MAX_MISSIONS) return 'Up to 3 missions.';
    if (t === 'qr' && defaultsMode) return 'Set up QR codes on each alarm';
    const req = MISSION_META[t].requires;
    if (req.includes('camera') && !c.camera) return 'Not available on this phone';
    if (req.includes('motion') && caps.motionProbed && !c.motion) return 'Not available on this phone';
    return null;
  };

  return (
    <Screen title="Add a mission" chrome="top" onBack={() => goBack(`/alarm/${id}`)}>
      <div class="mission-grid">
        {PICKER_TILES.map((tile) => {
          const reason = unavailableReason(tile.type);
          const name = tile.type === 'qr' ? MISSION_META.qr.name : missionName(tile.type);
          return (
            <button
              key={tile.type}
              type="button"
              class="mission-tile"
              data-testid={`tile-${tile.type}`}
              aria-disabled={reason ? 'true' : undefined}
              aria-describedby={`tile-desc-${tile.type}`}
              onClick={() => {
                if (reason) return;
                const index = tile.type === 'random' ? count : count;
                setEditing(null);
                navigate(`/alarm/${id}/missions/${index}?type=${tile.type}`, { replace: true });
              }}
            >
              <Icon name={MISSION_ICON[tile.type]} size={28} />
              <span class="tile-name">{name}</span>
              <span class="tile-desc" id={`tile-desc-${tile.type}`}>
                {tile.description}
                {reason && (
                  <>
                    <br />
                    <span class="row" style="gap: 4px">
                      <Icon name="info" size={16} />
                      {reason}
                    </span>
                  </>
                )}
              </span>
              {tile.badge && <span class="badge">{tile.badge}</span>}
            </button>
          );
        })}
      </div>
    </Screen>
  );
}

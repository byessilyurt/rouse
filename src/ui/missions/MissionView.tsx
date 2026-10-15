/** Renders the mission component for a MissionConfig. */
import type { MissionConfig } from '../../core/types';
import type { MissionProps } from './common';
import { MathMission } from './MathMission';
import { MemoryMission } from './MemoryMission';
import { TypingMission } from './TypingMission';
import { TapMission } from './TapMission';
import { MotionMission } from './MotionMission';
import { QrMission } from './QrMission';

export function MissionView(props: MissionProps<MissionConfig> & { onUseBackup: () => void }) {
  const { config } = props;
  switch (config.type) {
    case 'math':
      return <MathMission {...props} config={config} />;
    case 'memory':
      return <MemoryMission {...props} config={config} />;
    case 'typing':
      return <TypingMission {...props} config={config} />;
    case 'tap':
      return <TapMission {...props} config={config} />;
    case 'shake':
    case 'steps':
    case 'squat':
      return <MotionMission {...props} config={config} />;
    case 'qr':
      return <QrMission {...props} config={config} />;
  }
}

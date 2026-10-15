import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.rouse.alarm',
  appName: 'Rouse',
  webDir: 'dist',
  android: { allowMixedContent: false },
};

export default config;

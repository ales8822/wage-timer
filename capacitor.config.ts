import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.wagewise.app', // You can change this to your desired app ID
  appName: 'Wage Wise',    // You can change this to your desired app name
  webDir: 'out',          // Points to the Next.js static export directory
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https', // Usually 'https' for Android
  }
};

export default config;

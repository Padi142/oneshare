import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.oneshare.app",
  appName: "OneShare",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;

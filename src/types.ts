// Type definitions for the screen time tracker

export interface AppUsage {
  id: string;
  name: string;
  bundleId?: string;
  iconDataURL?: string;
  appPath?: string;
  totalMs: number;
  sessions: SessionData[];
  currentWindow?: string;
  isActive: boolean;
  lastActive: number;
}

export interface SessionData {
  start: number;
  end: number;
  duration: number;
  title: string;
  endReason?: 'idle' | 'focus-change' | 'quit';
}

export interface SystemInfo {
  isIdle: boolean;
  idleTime: number;
  uptime: number;
  platform: string;
  trackingStarted: number;
}

export interface ActiveWindowInfo {
  owner: {
    name: string;
    bundleId?: string;
    icon?: Buffer;
  };
  title: string;
}

export interface ScreenTimeAPI {
  getUsage: () => Promise<AppUsage[]>;
  exportData: () => Promise<string>;
  getSystemInfo: () => Promise<SystemInfo>;
  clearData: () => Promise<boolean>;
  onUsageUpdate: (callback: (data: AppUsage[]) => void) => void;
  toggleTheme: () => Promise<void>;
  getTheme: () => Promise<'light' | 'dark'>;
}

declare global {
  interface Window {
    screenTimeAPI: ScreenTimeAPI;
  }
}

export type Theme = 'light' | 'dark';

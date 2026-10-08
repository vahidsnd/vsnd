export interface PlatformDef {
  x1: number; x2: number; y: number;
  // optional motion: offset = (ax, ay) * sin(2π (frame + phase) / period)
  ax?: number; ay?: number; period?: number; phase?: number;
}

export interface StageDef {
  id: string;
  name: string;
  nameFa: string;
  main: { x1: number; x2: number; y: number; depth: number };
  platforms: PlatformDef[];
  blast: { left: number; right: number; top: number; bottom: number };
  spawns: [number, number][];
  theme: { sky: [string, string]; ground: string; edge: string; accent: string; props: string };
  unlock?: number; // player level needed
}

// World units are pixels; y grows downward. Ground of the main stage is at y = 0.
export const STAGES: StageDef[] = [
  {
    id: 'rooftop', name: 'Neon Rooftop', nameFa: 'پشت‌بام نئونی',
    main: { x1: -420, x2: 420, y: 0, depth: 120 },
    platforms: [
      { x1: -300, x2: -130, y: -150 },
      { x1: 130, x2: 300, y: -150 },
      { x1: -85, x2: 85, y: -290 },
    ],
    blast: { left: -1050, right: 1050, top: -900, bottom: 520 },
    spawns: [[-250, -10], [250, -10], [-110, -10], [110, -10]],
    theme: { sky: ['#1a0b3d', '#ff4f8b'], ground: '#25163f', edge: '#ff4fd8', accent: '#38f2ff', props: 'city' },
  },
  {
    id: 'dojo', name: 'Moon Dojo', nameFa: 'دوجوی ماه',
    main: { x1: -480, x2: 480, y: 0, depth: 140 },
    platforms: [],
    blast: { left: -1080, right: 1080, top: -900, bottom: 520 },
    spawns: [[-280, -10], [280, -10], [-120, -10], [120, -10]],
    theme: { sky: ['#06121f', '#2a5f8f'], ground: '#1d2b3a', edge: '#ffd166', accent: '#f6f1e0', props: 'moon' },
  },
  {
    id: 'bazaar', name: 'Floating Bazaar', nameFa: 'بازار شناور',
    main: { x1: -380, x2: 380, y: 0, depth: 110 },
    platforms: [
      { x1: -260, x2: -100, y: -160, ay: 50, period: 360 },
      { x1: 100, x2: 260, y: -160, ay: 50, period: 360, phase: 180 },
    ],
    blast: { left: -1000, right: 1000, top: -880, bottom: 520 },
    spawns: [[-230, -10], [230, -10], [-80, -10], [80, -10]],
    theme: { sky: ['#2b0f0a', '#ff9e3d'], ground: '#3d2215', edge: '#ffcf5c', accent: '#2ee6a6', props: 'lanterns' },
  },
  {
    id: 'reactor', name: 'Core Reactor', nameFa: 'راکتور',
    main: { x1: -360, x2: 360, y: 0, depth: 100 },
    platforms: [
      { x1: -90, x2: 90, y: -170, ax: 230, period: 480 },
    ],
    blast: { left: -980, right: 980, top: -860, bottom: 500 },
    spawns: [[-220, -10], [220, -10], [-90, -10], [90, -10]],
    theme: { sky: ['#03140f', '#11d18a'], ground: '#0f2a22', edge: '#8cff5a', accent: '#ff5ae0', props: 'pipes' },
    unlock: 3,
  },
  {
    id: 'skyruins', name: 'Sky Ruins', nameFa: 'ویرانه‌های آسمان',
    main: { x1: -440, x2: 440, y: 0, depth: 130 },
    platforms: [
      { x1: -380, x2: -230, y: -120 },
      { x1: 230, x2: 380, y: -120 },
      { x1: -150, x2: 150, y: -230 },
    ],
    blast: { left: -1080, right: 1080, top: -920, bottom: 540 },
    spawns: [[-300, -10], [300, -10], [-120, -10], [120, -10]],
    theme: { sky: ['#8fd3ff', '#fff3c4'], ground: '#5a6b7d', edge: '#ffffff', accent: '#ff7a59', props: 'clouds' },
    unlock: 6,
  },
];

export function getStage(id: string): StageDef {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}

export function platformPos(p: PlatformDef, frame: number): { x1: number; x2: number; y: number } {
  if (!p.period) return p;
  const t = Math.sin((2 * Math.PI * (frame + (p.phase ?? 0))) / p.period);
  const dx = (p.ax ?? 0) * t;
  const dy = (p.ay ?? 0) * t;
  return { x1: p.x1 + dx, x2: p.x2 + dx, y: p.y + dy };
}

export interface PlatformDef {
  x1: number; x2: number; y: number;
  // optional motion: offset = (ax, ay) * sin(2π (frame + phase) / period)
  ax?: number; ay?: number; period?: number; phase?: number;
}

/** Ambient per-frame particles drawn by the client renderer (purely cosmetic). */
export type StageAmbient =
  | 'rain' | 'snow' | 'embers' | 'petals' | 'bubbles' | 'dust' | 'fireflies'
  | 'spores' | 'pixels' | 'ash' | 'sparks' | 'streaks' | 'debris';

/** Surface treatment of the main stage / platforms (client art only). */
export type StageMaterial =
  | 'concrete' | 'stone' | 'wood' | 'tile' | 'metal' | 'marble' | 'sand' | 'rock'
  | 'ice' | 'basalt' | 'asphalt' | 'crystal' | 'brass' | 'neon' | 'moss';

export interface StageTheme {
  /** sky gradient top → bottom (also used for menu stage cards) */
  sky: [string, string];
  ground: string; edge: string; accent: string;
  /** background prop set (see client renderer bgLayers) */
  props: string;
  /** optional middle stop of the sky gradient */
  skyMid?: string;
  /** atmospheric haze / fog colour baked into parallax layers */
  haze?: string;
  /** celestial body baked into the sky, in screen fractions (r relative to screen height) */
  orb?: { x: number; y: number; r: number; color: string; kind: 'moon' | 'sun' | 'planet' };
  /** number of baked stars (default 70, 0 = none) */
  stars?: number;
  ambient?: StageAmbient;
  ambientColor?: string;
  material?: StageMaterial;
}

export interface StageDef {
  id: string;
  name: string;
  nameFa: string;
  main: { x1: number; x2: number; y: number; depth: number };
  platforms: PlatformDef[];
  blast: { left: number; right: number; top: number; bottom: number };
  spawns: [number, number][];
  theme: StageTheme;
  unlock?: number; // player level needed (progression is handled by the world map; unused)
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
    theme: {
      sky: ['#05041a', '#4a1748'], skyMid: '#170b34', haze: '#7a2d78', ground: '#221838', edge: '#ff4fd8', accent: '#38f2ff', props: 'city',
      orb: { x: 0.74, y: 0.2, r: 0.11, color: '#ffd7f0', kind: 'moon' }, stars: 50, ambient: 'rain', ambientColor: '#9fb8ff', material: 'concrete',
    },
  },
  {
    id: 'dojo', name: 'Moon Dojo', nameFa: 'دوجوی ماه',
    main: { x1: -480, x2: 480, y: 0, depth: 140 },
    platforms: [],
    blast: { left: -1080, right: 1080, top: -900, bottom: 520 },
    spawns: [[-280, -10], [280, -10], [-120, -10], [120, -10]],
    theme: {
      sky: ['#030912', '#22476a'], skyMid: '#0a1a2e', haze: '#3a6488', ground: '#2a2420', edge: '#ffd166', accent: '#f6f1e0', props: 'moon',
      orb: { x: 0.66, y: 0.26, r: 0.22, color: '#f6efd8', kind: 'moon' }, stars: 90, ambient: 'dust', ambientColor: '#fff2c8', material: 'wood',
    },
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
    theme: {
      sky: ['#10061a', '#b8502c'], skyMid: '#4a1830', haze: '#a8563a', ground: '#3d2418', edge: '#ffcf5c', accent: '#2ee6a6', props: 'lanterns',
      orb: { x: 0.3, y: 0.62, r: 0.2, color: '#ffc270', kind: 'sun' }, stars: 30, ambient: 'fireflies', ambientColor: '#ffc55a', material: 'wood',
    },
  },
  {
    id: 'reactor', name: 'Core Reactor', nameFa: 'راکتور',
    main: { x1: -360, x2: 360, y: 0, depth: 100 },
    platforms: [
      { x1: -90, x2: 90, y: -170, ax: 230, period: 480 },
    ],
    blast: { left: -980, right: 980, top: -860, bottom: 500 },
    spawns: [[-220, -10], [220, -10], [-90, -10], [90, -10]],
    theme: {
      sky: ['#010806', '#0c3b2c'], skyMid: '#03140e', haze: '#16a070', ground: '#14262a', edge: '#8cff5a', accent: '#ff5ae0', props: 'pipes',
      stars: 0, ambient: 'sparks', ambientColor: '#a8ff7a', material: 'metal',
    },
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
    theme: {
      sky: ['#151e44', '#e49a76'], skyMid: '#5a4a7a', haze: '#f0b494', ground: '#4c5266', edge: '#fff4e0', accent: '#ff7a59', props: 'clouds',
      orb: { x: 0.24, y: 0.58, r: 0.16, color: '#ffe2b8', kind: 'sun' }, stars: 25, ambient: 'dust', ambientColor: '#fff0dc', material: 'marble',
    },
  },
  {
    id: 'garden', name: 'Persian Night Garden', nameFa: 'باغ ایرانی در شب',
    main: { x1: -440, x2: 440, y: 0, depth: 125 },
    platforms: [
      { x1: -290, x2: -130, y: -140 },
      { x1: 130, x2: 290, y: -140 },
      { x1: -80, x2: 80, y: -270 },
    ],
    blast: { left: -1060, right: 1060, top: -900, bottom: 520 },
    spawns: [[-260, -10], [260, -10], [-110, -10], [110, -10]],
    theme: {
      sky: ['#02061a', '#163852'], skyMid: '#081632', haze: '#2e6488', ground: '#1e2a40', edge: '#5fe0d0', accent: '#ffcf6b', props: 'garden',
      orb: { x: 0.78, y: 0.18, r: 0.1, color: '#e8f2ff', kind: 'moon' }, stars: 110, ambient: 'fireflies', ambientColor: '#ffe08a', material: 'tile',
    },
  },
  {
    id: 'canyon', name: 'Dusk Canyon', nameFa: 'دره‌ی غروب',
    main: { x1: -470, x2: 470, y: 0, depth: 130 },
    platforms: [
      { x1: -330, x2: -160, y: -130 },
      { x1: 160, x2: 330, y: -130 },
    ],
    blast: { left: -1100, right: 1100, top: -900, bottom: 530 },
    spawns: [[-280, -10], [280, -10], [-110, -10], [110, -10]],
    theme: {
      sky: ['#120820', '#de6a36'], skyMid: '#5a1e3c', haze: '#f08048', ground: '#4a2a22', edge: '#ffb36b', accent: '#7fd8ff', props: 'canyon',
      orb: { x: 0.62, y: 0.66, r: 0.24, color: '#ff9a50', kind: 'sun' }, stars: 30, ambient: 'dust', ambientColor: '#ffd0a0', material: 'rock',
    },
  },
  {
    id: 'glacier', name: 'Aurora Glacier', nameFa: 'یخچال شفق',
    main: { x1: -400, x2: 400, y: 0, depth: 120 },
    platforms: [
      { x1: -120, x2: 120, y: -180 },
    ],
    blast: { left: -1020, right: 1020, top: -880, bottom: 520 },
    spawns: [[-240, -10], [240, -10], [-100, -10], [100, -10]],
    theme: {
      sky: ['#010612', '#0f3a4c'], skyMid: '#041a2c', haze: '#5ab8d0', ground: '#2c4a66', edge: '#bff4ff', accent: '#7dffb2', props: 'glacier',
      stars: 150, ambient: 'snow', ambientColor: '#e8f6ff', material: 'ice',
    },
  },
  {
    id: 'forge', name: 'Volcanic Forge', nameFa: 'کوره‌ی آتشفشان',
    main: { x1: -390, x2: 390, y: 0, depth: 115 },
    platforms: [
      { x1: -260, x2: -110, y: -150, ay: 60, period: 300 },
      { x1: 110, x2: 260, y: -150, ay: 60, period: 300, phase: 150 },
    ],
    blast: { left: -1000, right: 1000, top: -880, bottom: 510 },
    spawns: [[-230, -10], [230, -10], [-90, -10], [90, -10]],
    theme: {
      sky: ['#080203', '#5a1608'], skyMid: '#260806', haze: '#a8361a', ground: '#2a1c1a', edge: '#ff7a2a', accent: '#ffd04a', props: 'forge',
      stars: 0, ambient: 'embers', ambientColor: '#ff9a3a', material: 'basalt',
    },
  },
  {
    id: 'temple', name: 'Sunken Temple', nameFa: 'معبد غرق‌شده',
    main: { x1: -420, x2: 420, y: 0, depth: 125 },
    platforms: [
      { x1: -330, x2: -180, y: -110 },
      { x1: 180, x2: 330, y: -110 },
      { x1: -90, x2: 90, y: -240, ay: 22, period: 420 },
    ],
    blast: { left: -1050, right: 1050, top: -900, bottom: 520 },
    spawns: [[-260, -10], [260, -10], [-100, -10], [100, -10]],
    theme: {
      sky: ['#0c5262', '#020812'], skyMid: '#06283a', haze: '#1a8a98', ground: '#25404a', edge: '#6ff0d8', accent: '#ffd27a', props: 'temple',
      stars: 0, ambient: 'bubbles', ambientColor: '#bff8ff', material: 'stone',
    },
  },
  {
    id: 'highway', name: 'Neon Highway', nameFa: 'بزرگراه نئون',
    main: { x1: -440, x2: 440, y: 0, depth: 110 },
    platforms: [
      { x1: -220, x2: -80, y: -150, ax: 70, period: 420 },
      { x1: 80, x2: 220, y: -150, ax: 70, period: 420, phase: 210 },
    ],
    blast: { left: -1060, right: 1060, top: -880, bottom: 520 },
    spawns: [[-260, -10], [260, -10], [-110, -10], [110, -10]],
    theme: {
      sky: ['#04030e', '#2e0a3c'], skyMid: '#120626', haze: '#8a2a6e', ground: '#1a1a28', edge: '#ff3a6a', accent: '#3af2ff', props: 'highway',
      stars: 20, ambient: 'streaks', ambientColor: '#ff5a8a', material: 'asphalt',
    },
  },
  {
    id: 'shrine', name: 'Blossom Shrine', nameFa: 'معبد شکوفه',
    main: { x1: -420, x2: 420, y: 0, depth: 125 },
    platforms: [
      { x1: -300, x2: -170, y: -140 },
      { x1: -65, x2: 65, y: -140 },
      { x1: 170, x2: 300, y: -140 },
    ],
    blast: { left: -1050, right: 1050, top: -900, bottom: 520 },
    spawns: [[-250, -10], [250, -10], [-110, -10], [110, -10]],
    theme: {
      sky: ['#08050f', '#3e1a3c'], skyMid: '#1c0c24', haze: '#b86a8c', ground: '#2c1c24', edge: '#ff8fb0', accent: '#ffd6e0', props: 'shrine',
      orb: { x: 0.28, y: 0.3, r: 0.2, color: '#ffdce4', kind: 'moon' }, stars: 60, ambient: 'petals', ambientColor: '#ffb0c8', material: 'wood',
    },
  },
  {
    id: 'cathedral', name: 'Hollow Cathedral', nameFa: 'کلیسای متروک',
    main: { x1: -400, x2: 400, y: 0, depth: 130 },
    platforms: [
      { x1: -280, x2: -130, y: -160 },
      { x1: 130, x2: 280, y: -160 },
      { x1: -60, x2: 60, y: -300 },
    ],
    blast: { left: -1040, right: 1040, top: -920, bottom: 520 },
    spawns: [[-250, -10], [250, -10], [-100, -10], [100, -10]],
    theme: {
      sky: ['#030306', '#1c1628'], skyMid: '#0c0a16', haze: '#5c4c80', ground: '#24222c', edge: '#c8a8ff', accent: '#ff4a5a', props: 'cathedral',
      orb: { x: 0.18, y: 0.18, r: 0.07, color: '#d8d0ff', kind: 'moon' }, stars: 40, ambient: 'ash', ambientColor: '#b8b0c8', material: 'stone',
    },
  },
  {
    id: 'orbit', name: 'Orbital Station', nameFa: 'ایستگاه مداری',
    main: { x1: -360, x2: 360, y: 0, depth: 105 },
    platforms: [
      { x1: -95, x2: 95, y: -160, ay: 70, period: 400 },
    ],
    blast: { left: -1000, right: 1000, top: -940, bottom: 520 },
    spawns: [[-220, -10], [220, -10], [-90, -10], [90, -10]],
    theme: {
      sky: ['#000004', '#081030'], skyMid: '#02040e', haze: '#2a50c8', ground: '#2a3040', edge: '#7ab8ff', accent: '#ffb03a', props: 'orbit',
      orb: { x: 0.82, y: 1.05, r: 0.62, color: '#3a8ad8', kind: 'planet' }, stars: 200, ambient: 'debris', ambientColor: '#9ab8ff', material: 'metal',
    },
  },
  {
    id: 'jungle', name: 'Jungle Ziggurat', nameFa: 'زیگورات جنگل',
    main: { x1: -470, x2: 470, y: 0, depth: 130 },
    platforms: [
      { x1: -360, x2: -220, y: -130 },
      { x1: 220, x2: 360, y: -130 },
      { x1: -70, x2: 70, y: -240, ax: 140, period: 600 },
    ],
    blast: { left: -1100, right: 1100, top: -910, bottom: 530 },
    spawns: [[-290, -10], [290, -10], [-110, -10], [110, -10]],
    theme: {
      sky: ['#020905', '#173a22'], skyMid: '#061a0e', haze: '#3e9a5e', ground: '#2a3624', edge: '#9aff6a', accent: '#ffcf4a', props: 'jungle',
      orb: { x: 0.7, y: 0.22, r: 0.08, color: '#e8ffd8', kind: 'moon' }, stars: 50, ambient: 'fireflies', ambientColor: '#c8ff6a', material: 'moss',
    },
  },
  {
    id: 'stormdeck', name: 'Storm Deck', nameFa: 'عرشه‌ی توفان',
    main: { x1: -420, x2: 420, y: 0, depth: 115 },
    platforms: [
      { x1: -110, x2: 110, y: -170, ay: 26, period: 240 },
    ],
    blast: { left: -1040, right: 1040, top: -890, bottom: 520 },
    spawns: [[-250, -10], [250, -10], [-100, -10], [100, -10]],
    theme: {
      sky: ['#03050a', '#1e2c38'], skyMid: '#0c1420', haze: '#557888', ground: '#3a2a1e', edge: '#ffcf7a', accent: '#9fd8ff', props: 'storm',
      stars: 0, ambient: 'rain', ambientColor: '#b8d8f0', material: 'wood',
    },
  },
  {
    id: 'crystal', name: 'Crystal Cavern', nameFa: 'غار بلور',
    main: { x1: -340, x2: 340, y: 0, depth: 110 },
    platforms: [
      { x1: -230, x2: -90, y: -140 },
      { x1: 90, x2: 230, y: -140 },
    ],
    blast: { left: -960, right: 960, top: -860, bottom: 500 },
    spawns: [[-210, -10], [210, -10], [-80, -10], [80, -10]],
    theme: {
      sky: ['#04020a', '#1c0a32'], skyMid: '#0c0620', haze: '#8a44e0', ground: '#261c38', edge: '#e08aff', accent: '#5affe0', props: 'crystal',
      stars: 0, ambient: 'spores', ambientColor: '#7affe8', material: 'crystal',
    },
  },
  {
    id: 'clocktower', name: 'Clockwork Tower', nameFa: 'برج ساعت',
    main: { x1: -400, x2: 400, y: 0, depth: 120 },
    platforms: [
      { x1: -270, x2: -130, y: -130, ax: 70, period: 360 },
      { x1: 130, x2: 270, y: -130, ax: 70, period: 360, phase: 180 },
      { x1: -70, x2: 70, y: -270 },
    ],
    blast: { left: -1040, right: 1040, top: -900, bottom: 520 },
    spawns: [[-240, -10], [240, -10], [-100, -10], [100, -10]],
    theme: {
      sky: ['#080604', '#3a2814'], skyMid: '#1c120a', haze: '#b8843e', ground: '#3a2a1a', edge: '#ffcf6a', accent: '#ff8a3a', props: 'clock',
      stars: 30, ambient: 'dust', ambientColor: '#ffd890', material: 'brass',
    },
  },
  {
    id: 'arcade', name: 'Neon Arcade', nameFa: 'آرکید نئون',
    main: { x1: -370, x2: 370, y: 0, depth: 110 },
    platforms: [],
    blast: { left: -980, right: 980, top: -860, bottom: 510 },
    spawns: [[-230, -10], [230, -10], [-90, -10], [90, -10]],
    theme: {
      sky: ['#03020a', '#22083a'], skyMid: '#0e041c', haze: '#c02ad0', ground: '#140c26', edge: '#2af2ff', accent: '#ff2adf', props: 'arcade',
      stars: 40, ambient: 'pixels', ambientColor: '#ff6af0', material: 'neon',
    },
  },
  {
    id: 'persepolis', name: 'Persepolis Sunset', nameFa: 'غروب تخت جمشید',
    main: { x1: -500, x2: 500, y: 0, depth: 135 },
    platforms: [
      { x1: -240, x2: -90, y: -115 },
      { x1: 90, x2: 240, y: -115 },
    ],
    blast: { left: -1120, right: 1120, top: -900, bottom: 540 },
    spawns: [[-300, -10], [300, -10], [-120, -10], [120, -10]],
    theme: {
      sky: ['#180a20', '#ec8446'], skyMid: '#62283a', haze: '#f09a5a', ground: '#54382a', edge: '#ffd28a', accent: '#4ad8c8', props: 'persepolis',
      orb: { x: 0.56, y: 0.5, r: 0.17, color: '#ffb060', kind: 'sun' }, stars: 25, ambient: 'dust', ambientColor: '#ffd8a8', material: 'sand',
    },
  },
];

const BY_ID = new Map(STAGES.map((s) => [s.id, s]));
export function getStage(id: string): StageDef {
  return BY_ID.get(id) ?? STAGES[0];
}

export function platformPos(p: PlatformDef, frame: number): { x1: number; x2: number; y: number } {
  if (!p.period) return p;
  const t = Math.sin((2 * Math.PI * (frame + (p.phase ?? 0))) / p.period);
  const dx = (p.ax ?? 0) * t;
  const dy = (p.ay ?? 0) * t;
  return { x1: p.x1 + dx, x2: p.x2 + dx, y: p.y + dy };
}

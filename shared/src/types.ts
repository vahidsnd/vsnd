export type ActionId =
  | 'idle' | 'walk' | 'run' | 'crouch' | 'jumpsquat' | 'air' | 'land'
  | 'attack' | 'shield' | 'shieldbreak' | 'roll' | 'spotdodge' | 'airdodge'
  | 'hitstun' | 'helpless' | 'ledge' | 'ledgeclimb' | 'grabbing' | 'grabbed'
  | 'dead' | 'spawn';

export type MoveId =
  | 'jab' | 'ftilt' | 'utilt' | 'dtilt' | 'dash'
  | 'fsmash' | 'usmash' | 'dsmash'
  | 'nair' | 'fair' | 'bair' | 'uair' | 'dair'
  | 'grab' | 'fthrow' | 'bthrow' | 'uthrow' | 'dthrow'
  | 'nspecial' | 'sspecial' | 'uspecial' | 'dspecial' | 'ledgeattack';

export interface Hitbox {
  s: number; e: number;        // active frames (inclusive)
  x: number; y: number;        // offset from feet; x is mirrored by facing, y negative = up
  r: number;                   // radius
  dmg: number;
  ang: number;                 // degrees, 0 = forward, 90 = up, 270 = spike
  bkb: number; kbg: number;    // base knockback / knockback growth
  grab?: boolean;
  wind?: boolean;              // pushes without damage/hitstun
  multi?: number;              // rehit every N frames (multi-hit moves)
  spell?: boolean;             // from a spell: doesn't refill the attacker's magic meter
}

export interface ProjectileDef {
  kind: string;                // visual key
  vx: number; vy: number;      // vx mirrored by facing
  gravity?: number;
  life: number;
  r: number;
  dmg: number; ang: number; bkb: number; kbg: number;
  pierce?: boolean;
  bounce?: boolean;
  mine?: boolean;              // stops on ground and waits
  explode?: number;            // explosion radius on hit/expire
  wind?: boolean;
  ox?: number; oy?: number;    // spawn offset
}

export interface MoveDef {
  total: number;
  hitboxes: Hitbox[];
  landLag?: number;
  charge?: { frame: number; max: number };
  vel?: { s: number; e: number; vx?: number; vy?: number; add?: boolean }[];
  proj?: { frame: number; def: ProjectileDef; max?: number };
  armor?: [number, number];
  counter?: [number, number];
  invuln?: [number, number];
  helpless?: boolean;          // enter special-fall after (air)
  teleport?: { frame: number; dist: number };
  groundPound?: boolean;       // falls fast until landing, then shockwave
  throwHit?: Hitbox;           // used by throws
  noGravity?: [number, number];
  airOnce?: boolean;           // usable once per airtime (recoveries)
  cancel?: number;             // can restart same move after this frame (jab)
}

export interface FighterStats {
  weight: number;
  walk: number; run: number;
  airSpeed: number; airAccel: number;
  gravity: number; fall: number; fastFall: number;
  jump: number; shortHop: number; airJump: number; airJumps: number;
  traction: number;
  w: number; h: number;
}

export interface FighterState {
  slot: number;
  charId: string;
  skin: number;
  team: number;
  name: string;
  x: number; y: number;
  vx: number; vy: number;      // self velocity
  kx: number; ky: number;      // launch velocity
  facing: 1 | -1;
  grounded: boolean;
  platform: number;            // -1 none, 0 main, n platform index+1
  jumps: number;
  damage: number;
  stocks: number;
  action: ActionId;
  af: number;                  // action frame
  move: MoveId | null;
  charge: number;
  hitIds: number[];            // victims hit by current move instance
  multiTick: number;
  hitlag: number;
  hitstun: number;
  shield: number;
  shieldStun: number;
  invuln: number;
  intang: boolean;
  fastFall: boolean;
  dropThrough: number;
  airdodged: boolean;
  usedRecovery: boolean;
  ledgeRegrab: number;
  ledgeSide: -1 | 0 | 1;
  grabPartner: number;         // slot or -1
  respawn: number;
  inp: number;                 // current input bits
  prev: number;                // previous frame input bits
  tapX: number; tapY: number; tapT: number; // recent direction tap
  lastHitBy: number;
  lastHitMove: MoveId | null;
  combo: number;
  lag: number;                 // landing / generic recovery countdown
  grabT: number;               // grab hold timer (victim)
  ledgeGrabs: number;
  usedSide: boolean;
  stats: { kos: number; falls: number; dmgDealt: number; smashKOs: number; maxCombo: number };
  mana: number;                // 0..100 magic meter (only fills when a spell is equipped)
}

export interface ProjectileState {
  id: number;
  owner: number;
  team: number;
  kind: string;
  x: number; y: number; vx: number; vy: number;
  life: number;
  def: ProjectileDef;
  hit: number[];
  facing: 1 | -1;
}

export type GameEvent =
  | { t: 'hit'; x: number; y: number; dmg: number; kb: number; attacker: number; victim: number }
  | { t: 'shieldhit'; x: number; y: number; victim: number }
  | { t: 'ko'; slot: number; x: number; y: number; by: number }
  | { t: 'jump'; slot: number; x: number; y: number }
  | { t: 'land'; slot: number; x: number; y: number }
  | { t: 'swing'; slot: number; move: MoveId }
  | { t: 'proj'; slot: number; kind: string }
  | { t: 'explode'; x: number; y: number; r: number }
  | { t: 'shieldbreak'; slot: number }
  | { t: 'counter'; slot: number }
  | { t: 'spawn'; slot: number }
  | { t: 'spell'; slot: number; id: string; x: number; y: number }
  | { t: 'end'; winnerTeam: number };

export interface MatchConfig {
  stageId: string;
  stocks: number;
  timeLimit: number;           // seconds, 0 = none
  teams: boolean;
  players: { charId: string; skin: number; team: number; name: string; bot?: boolean; mods?: FighterMods }[];
}

/** Per-player modifiers from card upgrades and the equipped spell. 1 = neutral. */
export interface FighterMods {
  atk: number;      // damage dealt multiplier (>= 1)
  def: number;      // damage taken multiplier (<= 1)
  hp: number;       // weight multiplier (knockback resistance, >= 1)
  spell?: string;
  spellLv?: number;
}

export interface GameState {
  frame: number;
  cfg: MatchConfig;
  fighters: FighterState[];
  projectiles: ProjectileState[];
  nextId: number;
  timer: number;               // frames remaining (0 = infinite)
  over: boolean;
  winnerTeam: number;          // -1 = draw / none
  endFrame: number;
  events: GameEvent[];         // transient: cleared each step
}

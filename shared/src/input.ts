// Digital input bitmask shared by keyboard, gamepad, touch, AI and the network.
export const Btn = {
  LEFT: 1,
  RIGHT: 2,
  UP: 4,
  DOWN: 8,
  JUMP: 16,
  ATTACK: 32,
  SPECIAL: 64,
  SHIELD: 128,
  GRAB: 256,
  STRONG: 512, // "smash" modifier (mobile button / C-stick substitute)
} as const;

export type InputBits = number;

export function dirX(bits: InputBits): number {
  return (bits & Btn.RIGHT ? 1 : 0) - (bits & Btn.LEFT ? 1 : 0);
}
export function dirY(bits: InputBits): number {
  // screen space: up is negative
  return (bits & Btn.DOWN ? 1 : 0) - (bits & Btn.UP ? 1 : 0);
}

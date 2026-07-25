const LOW_ALTITUDE_TYPES = new Set([
  "cas_plane", "dive_bomber", "fighter", "naval_bomber",
]);
const LOW_ALTITUDE_MULT  = 1.5;
const HIGH_ALTITUDE_MULT = 1.0;

let AA_DAMAGE_COEFFICIENT = 0.05;

export function setAaDamageCoefficientForTesting(v: number): void {
  AA_DAMAGE_COEFFICIENT = v;
}

export class ProvinceAaSystem {
  private _strengths = new Map<string, number>();

  setProvinceAaStrength(provinceId: string, strength: number): void {
    this._strengths.set(provinceId, strength);
  }

  computeAaDamage(provinceId: string, aircraftType: string, wingCount: number): number {
    const strength = this._strengths.get(provinceId) ?? 0;
    if (strength <= 0) return 0;
    const mult = LOW_ALTITUDE_TYPES.has(aircraftType)
      ? LOW_ALTITUDE_MULT
      : HIGH_ALTITUDE_MULT;
    return Math.floor(strength * wingCount * mult * AA_DAMAGE_COEFFICIENT);
  }
}

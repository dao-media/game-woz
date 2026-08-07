export type DamageSource = {
  kind: string;
  id?: string;
};

export type DamageModifier = (amount: number, source: DamageSource) => number;

type HealthHooks = {
  onDamage?: (amount: number, source: DamageSource, remaining: number) => void;
  onHeal?: (amount: number, remaining: number) => void;
  onDeath?: (source: DamageSource) => void;
};

/**
 * Reusable HP component with an ordered damageModifiers pipeline.
 * Characters/enemies register modifiers (e.g. Silver Slippers) before HP drops.
 * Bar model is intentionally a single current/max pair — swappable later.
 */
export class Health {
  maxHP: number;
  currentHP: number;
  /** Applied in order before HP is reduced. */
  readonly damageModifiers: DamageModifier[] = [];

  private readonly hooks: HealthHooks;
  private dead = false;

  constructor(maxHP: number, hooks: HealthHooks = {}) {
    this.maxHP = maxHP;
    this.currentHP = maxHP;
    this.hooks = hooks;
  }

  get isDead(): boolean {
    return this.dead || this.currentHP <= 0;
  }

  get ratio(): number {
    return this.maxHP <= 0 ? 0 : this.currentHP / this.maxHP;
  }

  addModifier(mod: DamageModifier): void {
    this.damageModifiers.push(mod);
  }

  applyDamage(amount: number, source: DamageSource): number {
    if (this.isDead || amount <= 0) return 0;

    let dmg = amount;
    for (const mod of this.damageModifiers) {
      dmg = mod(dmg, source);
    }
    dmg = Math.max(0, dmg);
    if (dmg <= 0) return 0;

    this.currentHP = Math.max(0, this.currentHP - dmg);
    this.hooks.onDamage?.(dmg, source, this.currentHP);

    if (this.currentHP <= 0 && !this.dead) {
      this.dead = true;
      this.hooks.onDeath?.(source);
    }
    return dmg;
  }

  heal(amount: number): number {
    if (this.isDead || amount <= 0) return 0;
    const before = this.currentHP;
    this.currentHP = Math.min(this.maxHP, this.currentHP + amount);
    const gained = this.currentHP - before;
    if (gained > 0) this.hooks.onHeal?.(gained, this.currentHP);
    return gained;
  }

  reset(full = true): void {
    this.dead = false;
    this.currentHP = full ? this.maxHP : this.currentHP;
  }
}

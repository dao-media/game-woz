export type StateHandler = {
  enter?: () => void;
  exit?: () => void;
  update?: (dt: number) => void;
};

/** Reusable finite-state machine — one per entity. */
export class StateMachine {
  private readonly states = new Map<string, StateHandler>();
  private currentName: string | null = null;

  add(name: string, handler: StateHandler): this {
    this.states.set(name, handler);
    return this;
  }

  get current(): string | null {
    return this.currentName;
  }

  set(name: string): void {
    if (this.currentName === name) return;
    const next = this.states.get(name);
    if (!next) {
      throw new Error(`StateMachine: unknown state "${name}"`);
    }
    const prev = this.currentName ? this.states.get(this.currentName) : undefined;
    prev?.exit?.();
    this.currentName = name;
    next.enter?.();
  }

  update(dt: number): void {
    if (!this.currentName) return;
    this.states.get(this.currentName)?.update?.(dt);
  }
}

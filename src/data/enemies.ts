import { tuning } from '../config/tuning';

export type EnemyId = 'winged-monkey' | 'wheeler';

export type EnemyDef = {
  id: EnemyId;
  label: string;
  maxHP: number;
  contactDamage: number;
  moveSpeed: number;
  bodyWidth: number;
  bodyHeight: number;
  color: number;
  /** Preferred cruise height (monkeys > 0). */
  hoverZ: number;
  /** Ground enemies stay at 0. */
  grounded: boolean;
};

export const enemyDefs: Record<EnemyId, EnemyDef> = {
  'winged-monkey': {
    id: 'winged-monkey',
    label: 'Winged Monkey',
    maxHP: tuning.monkeyMaxHP,
    contactDamage: tuning.monkeyContactDamage,
    moveSpeed: tuning.monkeyMoveSpeed,
    bodyWidth: tuning.monkeyBodyWidth,
    bodyHeight: tuning.monkeyBodyHeight,
    color: tuning.monkeyColor,
    hoverZ: tuning.monkeyHoverZ,
    grounded: false,
  },
  wheeler: {
    id: 'wheeler',
    label: 'Wheeler',
    maxHP: tuning.wheelerMaxHP,
    contactDamage: tuning.wheelerContactDamage,
    moveSpeed: tuning.wheelerMoveSpeed,
    bodyWidth: tuning.wheelerBodyWidth,
    bodyHeight: tuning.wheelerBodyHeight,
    color: tuning.wheelerColor,
    hoverZ: 0,
    grounded: true,
  },
};

export function getEnemyDef(id: string): EnemyDef | undefined {
  return enemyDefs[id as EnemyId];
}

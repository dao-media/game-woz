import type { Perception } from './Perception';

export type ActionId =
  | 'maintain-standoff'
  | 'dive-attack'
  | 'retreat'
  | 'reposition'
  | 'bait'
  | 'charge'
  | 'attack-lunge'
  | 'recover'
  | 'circle';

export type ScoredAction = {
  id: ActionId;
  score: number;
};

export type ActionScorer = (p: Perception) => number;

export type UtilityBrain = {
  candidates: ReadonlyArray<{ id: ActionId; score: ActionScorer }>;
};

export type UtilityDecision = {
  chosen: ActionId;
  scores: ScoredAction[];
};

/** Pick highest-scoring candidate. Ties → first in list. */
export function decideUtility(brain: UtilityBrain, p: Perception): UtilityDecision {
  const scores: ScoredAction[] = brain.candidates.map((c) => ({
    id: c.id,
    score: c.score(p),
  }));
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  return {
    chosen: top?.id ?? 'circle',
    scores,
  };
}

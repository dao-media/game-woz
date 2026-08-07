/**
 * Playable class placeholders. Real stats/art plug in later via createPlayer.
 */
export type CharacterId = 'dorothy' | 'tin-man' | 'lion' | 'scarecrow';

export type CharacterDef = {
  id: CharacterId;
  label: string;
};

export const characters: CharacterDef[] = [
  { id: 'dorothy', label: 'Dorothy' },
  { id: 'tin-man', label: 'Tin-Man' },
  { id: 'lion', label: 'Cowardly Lion' },
  { id: 'scarecrow', label: 'Scarecrow' },
];

export function getCharacterById(id: string): CharacterDef | undefined {
  return characters.find((c) => c.id === id);
}

export const DEFAULT_CHARACTER_ID: CharacterId = 'dorothy';

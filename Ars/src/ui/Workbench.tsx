import type { Character } from "../model/character";
import type { RuleSet } from "../data/ruleset";
import type { Validation } from "../engine/validate";
import { Identity } from "./panels/Identity";
import { Characteristics } from "./panels/Characteristics";
import { VirtuesFlaws } from "./panels/VirtuesFlaws";
import { Abilities } from "./panels/Abilities";
import { Personality } from "./panels/Personality";
import { Equipment } from "./panels/Equipment";
import { Findings } from "./Findings";

export interface PanelProps {
  character: Character;
  campaignYear: number;
  rules: RuleSet;
  validation: Validation;
  onChange: (c: Character) => void;
}

/**
 * The workbench is a list of panels. Each panel owns one slice of the
 * character and reads the same validation. Adding a panel (Arts, Spells,
 * Equipment) means writing it and listing it here.
 */
export function Workbench(props: PanelProps) {
  return (
    <>
      <Identity {...props} />
      <Characteristics {...props} />
      <VirtuesFlaws {...props} />
      <Abilities {...props} />
      <Equipment {...props} />
      <Personality {...props} />
      <Findings {...props} />
    </>
  );
}

/** Findings that point at a given path prefix, for inline highlighting. */
export function findingsAt(validation: Validation, path: string) {
  return validation.states.filter(
    (s) => s.kind !== "stale" && (s.finding.path === path || s.finding.path.startsWith(path + ".")),
  );
}

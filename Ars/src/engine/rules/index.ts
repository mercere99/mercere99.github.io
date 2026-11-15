/**
 * The rule registry. Order is display order.
 * To add a rule: write it in this directory and list it here.
 */
import { characteristicsRule } from "./characteristics";
import { virtuesFlawsRule } from "./virtues-flaws";
import { abilitiesRule } from "./abilities";
import { calendarRule } from "./calendar";
import type { Rule } from "./types";

export const RULES: readonly Rule[] = [
  calendarRule,
  characteristicsRule,
  virtuesFlawsRule,
  abilitiesRule,
];

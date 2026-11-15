import type { Rule } from "./types";

export const calendarRule: Rule = {
  id: "calendar",
  check({ character, resolved }) {
    if (resolved.age < 0 || resolved.creationAge < 5) return [{
      id: "calendar:birth-year", rule: this.id, severity: "error",
      message: "Birth year must not be after the campaign year, and creation age must be at least 5.",
      path: "birthYear",
    }];
    return [];
  },
};

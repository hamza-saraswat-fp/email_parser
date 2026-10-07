// The deterministic minimum: a fixed list of dotted paths that must be present
// before a record is "ready". "a|b" means either path satisfies the requirement.

function valueAt(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

export function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return !Number.isNaN(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

// Returns the requirements that are NOT satisfied, in the order given.
export function checkRequired(record: unknown, requiredFields: string[]): string[] {
  const missing: string[] = [];
  for (const requirement of requiredFields) {
    const alternatives = requirement.split("|").map((p) => p.trim()).filter(Boolean);
    const satisfied = alternatives.some((path) => isPresent(valueAt(record, path)));
    if (!satisfied) missing.push(requirement);
  }
  return missing;
}

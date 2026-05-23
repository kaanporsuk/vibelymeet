export function postgrestQuotedInList(values: string[]): string {
  return `(${values.map((value) => `"${value.replace(/["\\]/g, "\\$&")}"`).join(",")})`;
}

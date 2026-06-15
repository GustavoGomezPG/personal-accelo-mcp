export function buildSubject(projectLabel: string, topic: string, description: string): string {
  const parts = [projectLabel, topic, description].map((p) => (p ?? "").trim());
  if (parts.some((p) => p.length === 0)) throw new Error("projectLabel, topic, and description are all required.");
  return parts.join(" :: ");
}

import type { ResearchSpecialistResult } from "@secretary/core-runtime";

function cleanText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function shouldUseResearchSpecialist(text: string) {
  return /\b(research|compare|comparison|look up|investigate|options|tradeoffs|pros and cons)\b/i.test(
    text,
  );
}

function extractComparisonSubjects(text: string) {
  const match = text.match(/compare\s+(.+?)\s+(?:and|vs\.?|versus)\s+(.+)/i);

  if (!match) {
    return [];
  }

  return [match[1], match[2]]
    .map((value) => cleanText(value).replace(/[?.!,]+$/g, ""))
    .filter(Boolean);
}

export function runResearchSpecialist(text: string): ResearchSpecialistResult {
  const normalized = cleanText(text);
  const comparisonSubjects = extractComparisonSubjects(normalized);

  if (comparisonSubjects.length === 2) {
    return {
      specialist: "research",
      mode: "comparison",
      summary: `I prepared a comparison frame for ${comparisonSubjects[0]} versus ${comparisonSubjects[1]}`,
      focusAreas: [
        "decision criteria",
        "tradeoffs and constraints",
        "migration or switching cost",
      ],
      suggestedNextStep:
        "Choose the most important decision criterion and gather evidence against it first",
    };
  }

  return {
    specialist: "research",
    mode: "research_brief",
    summary: "I prepared a structured research brief for this request",
    focusAreas: [
      "clarify the exact objective",
      "collect relevant facts and constraints",
      "compare the strongest options or interpretations",
    ],
    suggestedNextStep:
      "Decide whether you want a broad brief, a narrowed comparison, or an action recommendation",
  };
}

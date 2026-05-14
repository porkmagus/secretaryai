import { generateText } from "ai";
import { type InferenceRuntimeConfig, resolveInferenceLanguageModel } from "../ai-sdk-registry.js";
import type { MemoryCandidate } from "./extractors.js";
import {
  extractExplicitMemory,
  extractLifeEventMemory,
  extractLocationMemory,
  extractOperationalMemory,
  extractPersonalFactMemory,
  extractPreferenceMemory,
  extractProjectMemory,
  extractRelationshipMemory,
  extractScheduleMemory,
  extractToolSoftwareMemory,
} from "./extractors.js";

export async function extractAIAugmentedMemories(params: {
  text: string;
  inference: InferenceRuntimeConfig;
}): Promise<MemoryCandidate[]> {
  try {
    const modelResult = resolveInferenceLanguageModel(params.inference);
    if (!modelResult) {
      return [];
    }

    const { text: jsonResponse } = await generateText({
      model: modelResult.model,

      system: `You are an expert memory extraction engine for a private secretary AI. 
Extract any meaningful facts, preferences, or contextual nuances from the user message that regex-based extraction might miss.
Focus on:
- Emotional states or moods ("I'm feeling burnt out").
- Informal preferences ("I hate long meetings").
- Social context ("My boss is Sarah").
- Implicit schedules or events ("I'll be out next Tuesday").

Return ONLY a JSON array of objects with this schema:
{
  "memoryType": "episodic" | "semantic" | "operational",
  "title": string (short, descriptive),
  "summary": string (1 sentence),
  "tags": string[],
  "importanceScore": number (1-100),
  "confidenceScore": number (1-100)
}
If nothing meaningful is found, return [].`,
      prompt: params.text,
    });

    const cleaned = jsonResponse
      .trim()
      .replace(/^```json/, "")
      .replace(/```$/, "");
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((item) => ({
      ...item,
      contentText: params.text,
      canonicalKey: `${item.memoryType}:ai:${item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    }));
  } catch (_err) {
    return [];
  }
}

export async function extractMemoryCandidates(params: {
  text: string;
  inference?: InferenceRuntimeConfig;
}) {
  const specificCandidates = [
    ...extractExplicitMemory(params.text),
    ...extractRelationshipMemory(params.text),
    ...extractPersonalFactMemory(params.text),
    ...extractLifeEventMemory(params.text),
    ...extractPreferenceMemory(params.text),
    ...extractProjectMemory(params.text),
    ...extractScheduleMemory(params.text),
    ...extractLocationMemory(params.text),
    ...extractToolSoftwareMemory(params.text),
    ...extractOperationalMemory(params.text),
  ];

  if (params.inference) {
    const aiCandidates = await extractAIAugmentedMemories({
      text: params.text,
      inference: params.inference,
    });
    specificCandidates.push(...aiCandidates);
  }

  // Deduplicate by canonicalKey, keeping highest importanceScore per key
  const byKey = new Map<string, MemoryCandidate>();
  for (const candidate of specificCandidates) {
    const existing = byKey.get(candidate.canonicalKey);
    if (!existing || candidate.importanceScore > existing.importanceScore) {
      byKey.set(candidate.canonicalKey, candidate);
    }
  }

  return [...byKey.values()];
}

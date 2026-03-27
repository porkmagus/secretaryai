export type ConversationDecision = "approve" | "deny" | "help" | null;

const affirmativePatterns = [
  /^(?:yes|yep|yeah|sure|okay|ok|absolutely|definitely|please do|go ahead|go for it|do it|sounds good|works for me|that works|continue|proceed|start it|run it|allow it)\b/i,
  /\b(?:go ahead with it|go ahead with that|go for it|sounds good to me|works for me|please continue|please proceed|yes, use|use this folder|use that folder)\b/i,
];

const negativePatterns = [
  /^(?:no|nope|not now|don't|do not|stop|cancel|never mind|keep it here|leave it|hold off|not yet|block it)\b/i,
  /\b(?:keep this in chat|keep it in chat|leave it blocked|don't start that|do not start that|not this time)\b/i,
];

export function detectConversationDecision(
  text: string,
  helpPattern?: RegExp,
): ConversationDecision {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  if (affirmativePatterns.some((pattern) => pattern.test(trimmed))) {
    return "approve";
  }

  if (negativePatterns.some((pattern) => pattern.test(trimmed))) {
    return "deny";
  }

  if (helpPattern?.test(trimmed)) {
    return "help";
  }

  return null;
}

export function extractWorkspacePathHint(text: string) {
  const candidates = [
    ...text.matchAll(/`([^`]+)`/g),
    ...text.matchAll(/"([^"]+)"/g),
    ...text.matchAll(/'([^']+)'/g),
  ]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (
      /^[a-zA-Z]:[\\/]/.test(candidate) ||
      /^\/mnt\/[a-z]\//i.test(candidate) ||
      /^\.{0,2}[\\/]/.test(candidate)
    ) {
      return candidate;
    }
  }

  const plainMatch =
    text.match(/\b([a-zA-Z]:\\[^\s,;]+)\b/) ??
    text.match(/\b(\/mnt\/[a-z]\/[^\s,;]+)\b/i) ??
    text.match(/\b(\.\/[^\s,;]+)\b/) ??
    text.match(/\b(\.\.[\\/][^\s,;]+)\b/);

  return plainMatch?.[1]?.trim() ?? null;
}

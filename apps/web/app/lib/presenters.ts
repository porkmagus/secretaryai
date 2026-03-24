export function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "n/a";
  }

  return new Date(value).toLocaleString();
}

export function formatTracePayload(payload: Record<string, unknown>) {
  const entries = Object.entries(payload);

  if (entries.length === 0) {
    return "no payload";
  }

  return entries
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}: ${value.join(", ")}`;
      }

      if (typeof value === "object" && value !== null) {
        return `${key}: ${JSON.stringify(value)}`;
      }

      return `${key}: ${String(value)}`;
    })
    .join(" | ");
}

export function snippet(text: string | null | undefined, max = 96) {
  if (!text) {
    return "No preview yet.";
  }

  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
}

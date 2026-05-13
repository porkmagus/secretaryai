/**
 * Normalize text for consistent processing across the codebase.
 * - Collapses multiple whitespaces
 * - Trims leading/trailing whitespace
 * - Lowercases
 */
export function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Clean text while preserving case (for display purposes).
 */
export function cleanTextPreserveCase(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

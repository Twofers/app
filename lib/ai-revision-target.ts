export type AiRevisionTarget = "copy" | "image" | "both";

export function copyOnlyRevisionTargetForFeedback(
  selectedTarget: AiRevisionTarget,
  feedback: string,
): AiRevisionTarget {
  if (selectedTarget !== "both") return selectedTarget;
  const normalized = feedback.trim().toLowerCase();
  if (!normalized) return selectedTarget;
  const mentionsImage = /\b(?:image|photo|picture|pic|background|crop|lighting|angle|composition|visual|brighter|darker)\b/.test(normalized);
  const mentionsCopy = /\b(?:copy|wording|words?|text|headline|title|top|line|shorter|clearer|tone|warmer|premium|direct)\b/.test(normalized);
  return mentionsCopy && !mentionsImage ? "copy" : selectedTarget;
}

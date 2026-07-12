export type AiRevisionTarget = "copy" | "image" | "both";

export function copyOnlyRevisionTargetForFeedback(
  selectedTarget: AiRevisionTarget,
  feedback: string,
): AiRevisionTarget {
  if (selectedTarget !== "both") return selectedTarget;
  const normalized = feedback.trim().toLowerCase();
  if (!normalized) return selectedTarget;
  const mentionsImage = /\b(?:image|photo|picture|pic|background|crop|lighting|angle|composition|visual|brighter|darker)\b/.test(normalized);
  const mentionsCopy = /\b(?:ad|caption|copy|generic|headline|heading|hero|inviting|line|main message|make sense|phrase|read right|reads weird|real ad|shorter|tagline|text|title|tone|top|warmer|wording|words?)\b/.test(normalized);
  return mentionsCopy && !mentionsImage ? "copy" : selectedTarget;
}

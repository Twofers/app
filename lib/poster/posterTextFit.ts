export type PosterTextFitInput = {
  value: string;
  boxWidth: number;
  baseFontSize: number;
  baseLineHeight: number;
  maxLines?: number;
  letterSpacing?: number;
};

export type PosterTextFitResult = {
  text: string;
  fontSize: number;
  lineHeight: number;
  lineCount: number;
};

// Leave a little room for platform font-metric and pixel-rounding differences. The
// React Native renderer still uses adjustsFontSizeToFit as a final safety net, but
// this deterministic pass means Android no longer has to discover the correct size
// from an oversized line after it has already been constrained by numberOfLines.
const POSTER_TEXT_WIDTH_SAFETY = 0.9;

function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function glyphWidthEm(character: string): number {
  if (/\s/u.test(character)) return 0.32;
  if (/\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character)) {
    return 1;
  }
  if (/[MW@%&]/u.test(character)) return 0.96;
  if (/[Iil1|!.,:'’`]/u.test(character)) return 0.34;
  if (/[A-Z0-9]/u.test(character)) return 0.7;
  if (/[a-z]/u.test(character)) return 0.58;
  return 0.72;
}

function estimatedLineWidth(
  value: string,
  fontSize: number,
  letterSpacing: number,
): number {
  const characters = Array.from(value);
  const glyphWidth = characters.reduce((total, character) => total + glyphWidthEm(character), 0);
  return glyphWidth * fontSize + Math.max(0, characters.length - 1) * letterSpacing;
}

function linePartitions(words: string[], lineCount: number): string[][] {
  if (lineCount <= 1 || words.length <= 1) return [[words.join(" ")]];
  const partitions: string[][] = [];

  const visit = (start: number, remainingLines: number, lines: string[]) => {
    if (remainingLines === 1) {
      partitions.push([...lines, words.slice(start).join(" ")]);
      return;
    }
    const latestEnd = words.length - remainingLines + 1;
    for (let end = start + 1; end <= latestEnd; end += 1) {
      visit(end, remainingLines - 1, [...lines, words.slice(start, end).join(" ")]);
    }
  };

  visit(0, lineCount, []);
  return partitions;
}

function fontSizeForLines(params: {
  lines: string[];
  availableWidth: number;
  baseFontSize: number;
  letterSpacing: number;
}): number {
  let fitted = params.baseFontSize;
  for (const line of params.lines) {
    const widthAtBase = estimatedLineWidth(line, params.baseFontSize, params.letterSpacing);
    if (widthAtBase <= params.availableWidth || widthAtBase <= 0) continue;
    fitted = Math.min(fitted, params.baseFontSize * (params.availableWidth / widthAtBase));
  }
  return fitted;
}

/**
 * Fits complete poster text into a fixed-width slot without deleting characters.
 * Words are balanced across the allowed lines first; font size is then reduced
 * deterministically until the widest line fits.
 */
export function fitPosterTextToBox(input: PosterTextFitInput): PosterTextFitResult {
  const value = cleanText(input.value);
  const maxLines = Math.max(1, Math.floor(input.maxLines ?? 1));
  const letterSpacing = Number.isFinite(input.letterSpacing) ? Math.max(0, input.letterSpacing ?? 0) : 0;
  const baseFontSize = Math.max(1, input.baseFontSize);
  const baseLineHeight = Math.max(baseFontSize, input.baseLineHeight);
  const availableWidth = Math.max(1, input.boxWidth * POSTER_TEXT_WIDTH_SAFETY);

  if (!value) {
    return { text: "", fontSize: baseFontSize, lineHeight: baseLineHeight, lineCount: 1 };
  }

  const oneLineSize = fontSizeForLines({
    lines: [value],
    availableWidth,
    baseFontSize,
    letterSpacing,
  });
  if (oneLineSize >= baseFontSize || maxLines === 1) {
    const fontSize = Math.max(1, Math.floor(oneLineSize * 100) / 100);
    return {
      text: value,
      fontSize,
      lineHeight: Math.max(fontSize, Math.floor(baseLineHeight * (fontSize / baseFontSize) * 100) / 100),
      lineCount: 1,
    };
  }

  const words = value.split(" ");
  let bestLines = [value];
  let bestFontSize = oneLineSize;
  const lineLimit = Math.min(maxLines, words.length);
  for (let lineCount = 2; lineCount <= lineLimit; lineCount += 1) {
    for (const lines of linePartitions(words, lineCount)) {
      const candidateSize = fontSizeForLines({
        lines,
        availableWidth,
        baseFontSize,
        letterSpacing,
      });
      if (candidateSize > bestFontSize) {
        bestFontSize = candidateSize;
        bestLines = lines;
      }
    }
  }

  const fontSize = Math.max(1, Math.floor(Math.min(baseFontSize, bestFontSize) * 100) / 100);
  return {
    text: bestLines.join("\n"),
    fontSize,
    lineHeight: Math.max(fontSize, Math.floor(baseLineHeight * (fontSize / baseFontSize) * 100) / 100),
    lineCount: bestLines.length,
  };
}

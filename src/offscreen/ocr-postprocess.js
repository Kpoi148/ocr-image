(() => {
  if (globalThis.OcrPostprocess) {
    return;
  }

  const MIN_WORD_CONFIDENCE = 40;
  const MIN_SHORT_WORD_CONFIDENCE = 50;
  const MIN_SYMBOL_WORD_CONFIDENCE = 80;
  const LOW_CONFIDENCE_WORD_THRESHOLD = 65;
  const MIN_FALLBACK_LINE_CONFIDENCE = 55;
  const MIN_FILTERED_TEXT_LENGTH = 15;
  const MIN_OVERLAP_WORDS = 3;
  const MAX_OVERLAP_WORDS = 8;
  const MIN_SUBSEQUENCE_WORDS = 4;
  const DUPLICATE_JACCARD_THRESHOLD = 0.6;
  const SPATIAL_DUPLICATE_OVERLAP_THRESHOLD = 0.65;
  const SPATIAL_DUPLICATE_TOKEN_THRESHOLD = 0.75;
  const SCORE_WORD_BONUS_LIMIT = 120;
  const SCORE_LINE_BONUS_LIMIT = 12;

  function normalizeText(text) {
    if (typeof text !== 'string') {
      return '';
    }

    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function normalizeToken(token) {
    return token.toLowerCase().replace(/^[^a-z0-9\u00C0-\u1EF9]+|[^a-z0-9\u00C0-\u1EF9]+$/gi, '');
  }

  function tokenizeText(text) {
    const normalized = normalizeText(text);
    return normalized
      ? normalized.split(' ').map(normalizeToken).filter(Boolean)
      : [];
  }

  function normalizeBox(box) {
    if (!box || typeof box !== 'object') {
      return null;
    }

    const x0 = Number.isFinite(box.x0) ? box.x0 : box.left;
    const y0 = Number.isFinite(box.y0) ? box.y0 : box.top;
    const x1 = Number.isFinite(box.x1) ? box.x1 : box.right;
    const y1 = Number.isFinite(box.y1) ? box.y1 : box.bottom;

    if (![x0, y0, x1, y1].every(Number.isFinite)) {
      return null;
    }

    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const right = Math.max(x0, x1);
    const bottom = Math.max(y0, y1);

    if (right <= left || bottom <= top) {
      return null;
    }

    return { x0: left, y0: top, x1: right, y1: bottom };
  }

  function mergeBoxes(boxes) {
    let mergedBox = null;

    for (const box of boxes) {
      if (!box) {
        continue;
      }

      if (!mergedBox) {
        mergedBox = { ...box };
        continue;
      }

      mergedBox.x0 = Math.min(mergedBox.x0, box.x0);
      mergedBox.y0 = Math.min(mergedBox.y0, box.y0);
      mergedBox.x1 = Math.max(mergedBox.x1, box.x1);
      mergedBox.y1 = Math.max(mergedBox.y1, box.y1);
    }

    return mergedBox;
  }

  function getBoxArea(box) {
    return box ? Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0) : 0;
  }

  function getBoxOverlapRatio(leftBox, rightBox) {
    if (!leftBox || !rightBox) {
      return 0;
    }

    const left = Math.max(leftBox.x0, rightBox.x0);
    const top = Math.max(leftBox.y0, rightBox.y0);
    const right = Math.min(leftBox.x1, rightBox.x1);
    const bottom = Math.min(leftBox.y1, rightBox.y1);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const smallerArea = Math.min(getBoxArea(leftBox), getBoxArea(rightBox));

    return smallerArea ? intersection / smallerArea : 0;
  }

  function getTokenContainmentRatio(leftTokens, rightTokens) {
    if (!leftTokens.length || !rightTokens.length) {
      return 0;
    }

    const leftSet = new Set(leftTokens);
    const rightSet = new Set(rightTokens);
    let intersectionCount = 0;

    for (const token of rightSet) {
      if (leftSet.has(token)) {
        intersectionCount += 1;
      }
    }

    return intersectionCount / Math.min(leftSet.size, rightSet.size);
  }

  function cleanOutputLine(text) {
    return text
      .replace(/\t+/g, ' ')
      .replace(/[ ]{3,}/g, '  ')
      .replace(/\s+([,.;:!?%])/g, '$1')
      .replace(/([([{])\s+/g, '$1')
      .replace(/\s+([)\]}])/g, '$1')
      .trim();
  }

  function cleanFinalText(text) {
    if (typeof text !== 'string') {
      return '';
    }

    const cleanedLines = text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(cleanOutputLine);
    const mergedLines = [];

    for (const line of cleanedLines) {
      if (!line) {
        if (mergedLines.length && mergedLines[mergedLines.length - 1]) {
          mergedLines.push('');
        }
        continue;
      }

      const previousLine = mergedLines[mergedLines.length - 1];
      if (
        previousLine
        && /[A-Za-z\u00C0-\u1EF9]-$/.test(previousLine)
        && /^[A-Za-z\u00C0-\u1EF9]/.test(line)
      ) {
        mergedLines[mergedLines.length - 1] = previousLine.slice(0, -1) + line;
        continue;
      }

      mergedLines.push(line);
    }

    return mergedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function getOcrLines(data) {
    const lines = Array.isArray(data?.lines) ? data.lines : [];
    return lines.map(line => ({
      text: typeof line?.text === 'string' ? line.text : '',
      confidence: typeof line?.confidence === 'number' ? line.confidence : 0,
      words: Array.isArray(line?.words) ? line.words : [],
      bbox: normalizeBox(line?.bbox)
    }));
  }

  function buildLineFromWords(words, fallbackBox = null) {
    const text = words.map(word => word.text).join(' ').trim();
    const tokens = tokenizeText(text);
    const confidenceSum = words.reduce((sum, word) => sum + word.confidence, 0);
    const lowConfidenceCount = words.reduce(
      (sum, word) => sum + (word.confidence < LOW_CONFIDENCE_WORD_THRESHOLD ? 1 : 0),
      0
    );
    const wordBox = mergeBoxes(words.map(word => word.bbox));

    return {
      text,
      normalized: normalizeText(text),
      tokens,
      words,
      bbox: wordBox || fallbackBox,
      wordCount: words.length,
      confidenceSum,
      lowConfidenceCount,
      averageConfidence: words.length ? (confidenceSum / words.length) : 0
    };
  }

  function buildFallbackLine(text, confidence, bbox = null) {
    const tokens = tokenizeText(text);
    if (!tokens.length) {
      return null;
    }

    const words = tokens.map(token => ({
      text: token,
      confidence,
      bbox: null
    }));

    return buildLineFromWords(words, bbox);
  }

  function filterLine(line) {
    const validWords = [];

    for (const word of line.words) {
      const text = typeof word?.text === 'string' ? word.text.trim() : '';
      const confidence = typeof word?.confidence === 'number' ? word.confidence : 0;

      if (!text) {
        continue;
      }
      if (confidence < MIN_WORD_CONFIDENCE) {
        continue;
      }
      if (text.length <= 2 && confidence < MIN_SHORT_WORD_CONFIDENCE) {
        continue;
      }
      if (text.length === 1 && /[^a-zA-Z0-9\u00C0-\u1EF9&]/.test(text) && confidence < MIN_SYMBOL_WORD_CONFIDENCE) {
        continue;
      }

      validWords.push({ text, confidence, bbox: normalizeBox(word?.bbox) });
    }

    if (validWords.length > 0) {
      return buildLineFromWords(validWords, line.bbox);
    }

    const fallbackText = typeof line.text === 'string' ? line.text.trim() : '';
    if (!fallbackText || line.confidence < MIN_FALLBACK_LINE_CONFIDENCE) {
      return null;
    }

    return buildFallbackLine(fallbackText, line.confidence, line.bbox);
  }

  function getOverlapWordCount(previousTokens, currentTokens, minWords = MIN_OVERLAP_WORDS) {
    const maxOverlap = Math.min(previousTokens.length, currentTokens.length, MAX_OVERLAP_WORDS);

    for (let size = maxOverlap; size >= minWords; size -= 1) {
      const previousSlice = previousTokens.slice(previousTokens.length - size).join(' ');
      const currentSlice = currentTokens.slice(0, size).join(' ');
      if (previousSlice === currentSlice) {
        return size;
      }
    }

    return 0;
  }

  function pickPreferredLine(previousLine, currentLine) {
    if (currentLine.averageConfidence !== previousLine.averageConfidence) {
      return currentLine.averageConfidence > previousLine.averageConfidence ? currentLine : previousLine;
    }

    if (currentLine.wordCount !== previousLine.wordCount) {
      return currentLine.wordCount > previousLine.wordCount ? currentLine : previousLine;
    }

    return currentLine.text.length > previousLine.text.length ? currentLine : previousLine;
  }

  function trimLeadingOverlap(previousLine, currentLine) {
    const overlapWords = getOverlapWordCount(previousLine.tokens, currentLine.tokens);
    if (!overlapWords) {
      return currentLine;
    }

    const trimmedWords = currentLine.words.slice(overlapWords);
    if (!trimmedWords.length) {
      return null;
    }

    return buildLineFromWords(trimmedWords);
  }

  function isSubsequenceDuplicate(previousLine, currentLine) {
    if (
      Math.min(previousLine.wordCount, currentLine.wordCount) < MIN_SUBSEQUENCE_WORDS
    ) {
      return false;
    }

    return previousLine.normalized.includes(currentLine.normalized)
      || currentLine.normalized.includes(previousLine.normalized);
  }

  function areNearDuplicates(previousLine, currentLine) {
    if (previousLine.wordCount < MIN_SUBSEQUENCE_WORDS || currentLine.wordCount < MIN_SUBSEQUENCE_WORDS) {
      return false;
    }

    const boundaryOverlap = getOverlapWordCount(previousLine.tokens, currentLine.tokens, 1);
    if (!boundaryOverlap) {
      return false;
    }

    const previousSet = new Set(previousLine.tokens);
    const currentSet = new Set(currentLine.tokens);
    let intersectionCount = 0;

    for (const token of currentSet) {
      if (previousSet.has(token)) {
        intersectionCount += 1;
      }
    }

    const unionCount = new Set([...previousSet, ...currentSet]).size;
    if (!unionCount) {
      return false;
    }

    return (intersectionCount / unionCount) >= DUPLICATE_JACCARD_THRESHOLD;
  }

  function areSpatialDuplicates(previousLine, currentLine) {
    const boxOverlap = getBoxOverlapRatio(previousLine.bbox, currentLine.bbox);
    if (boxOverlap < SPATIAL_DUPLICATE_OVERLAP_THRESHOLD) {
      return false;
    }

    if (previousLine.normalized === currentLine.normalized) {
      return true;
    }

    if (isSubsequenceDuplicate(previousLine, currentLine)) {
      return true;
    }

    return getTokenContainmentRatio(previousLine.tokens, currentLine.tokens) >= SPATIAL_DUPLICATE_TOKEN_THRESHOLD;
  }

  function haveSeparatedBoxes(previousLine, currentLine) {
    return Boolean(
      previousLine.bbox
      && currentLine.bbox
      && getBoxOverlapRatio(previousLine.bbox, currentLine.bbox) < SPATIAL_DUPLICATE_OVERLAP_THRESHOLD
    );
  }

  function findSpatialDuplicateIndex(lines, currentLine) {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (areSpatialDuplicates(lines[i], currentLine)) {
        return i;
      }
    }

    return -1;
  }

  function compactFilteredLines(lines) {
    const compacted = [];

    for (const line of lines) {
      if (!line || !line.normalized) {
        continue;
      }

      const spatialDuplicateIndex = findSpatialDuplicateIndex(compacted, line);
      if (spatialDuplicateIndex !== -1) {
        compacted[spatialDuplicateIndex] = pickPreferredLine(compacted[spatialDuplicateIndex], line);
        continue;
      }

      const previousLine = compacted[compacted.length - 1];
      if (!previousLine) {
        compacted.push(line);
        continue;
      }

      if (line.normalized === previousLine.normalized && !haveSeparatedBoxes(previousLine, line)) {
        compacted[compacted.length - 1] = pickPreferredLine(previousLine, line);
        continue;
      }

      if (isSubsequenceDuplicate(previousLine, line) && !haveSeparatedBoxes(previousLine, line)) {
        compacted[compacted.length - 1] = pickPreferredLine(previousLine, line);
        continue;
      }

      const trimmedLine = haveSeparatedBoxes(previousLine, line)
        ? line
        : trimLeadingOverlap(previousLine, line);
      if (!trimmedLine) {
        continue;
      }

      if (areNearDuplicates(previousLine, trimmedLine) && !haveSeparatedBoxes(previousLine, trimmedLine)) {
        compacted[compacted.length - 1] = pickPreferredLine(previousLine, trimmedLine);
        continue;
      }

      compacted.push(trimmedLine);
    }

    return compacted;
  }

  function measureAdjacentOverlapPenalty(lines) {
    let penalty = 0;

    for (let i = 1; i < lines.length; i += 1) {
      penalty += getOverlapWordCount(lines[i - 1].tokens, lines[i].tokens, 1) * 7;
    }

    return penalty;
  }

  function measureRepeatedPhrasePenalty(text) {
    const tokens = tokenizeText(text);
    if (tokens.length < 8) {
      return 0;
    }

    let penalty = 0;

    for (let windowSize = 4; windowSize <= 6; windowSize += 1) {
      if (tokens.length < windowSize * 2) {
        continue;
      }

      const phraseCounts = new Map();
      for (let i = 0; i <= tokens.length - windowSize; i += 1) {
        const phrase = tokens.slice(i, i + windowSize).join(' ');
        phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
      }

      for (const count of phraseCounts.values()) {
        if (count > 1) {
          penalty += (count - 1) * windowSize * 2.5;
        }
      }
    }

    return penalty;
  }

  function measureGarbagePenalty(text) {
    const rawTokens = normalizeText(text).split(' ').filter(Boolean);
    if (!rawTokens.length) {
      return 0;
    }

    let penalty = 0;
    let singleCharacterCount = 0;
    let symbolHeavyCount = 0;

    for (const rawToken of rawTokens) {
      const token = normalizeToken(rawToken);
      if (!token) {
        penalty += 3;
        continue;
      }

      if (token.length === 1) {
        singleCharacterCount += 1;
      }

      const visibleLength = rawToken.replace(/\s/g, '').length;
      const textLength = (rawToken.match(/[a-z0-9\u00C0-\u1EF9]/gi) || []).length;
      if (visibleLength && textLength / visibleLength < 0.5) {
        symbolHeavyCount += 1;
      }

      if (/[|_~`]{2,}/.test(rawToken)) {
        penalty += 2;
      }
    }

    if (rawTokens.length >= 8) {
      penalty += Math.max(0, singleCharacterCount - Math.ceil(rawTokens.length * 0.2)) * 1.5;
    }

    penalty += symbolHeavyCount * 2;
    penalty += (text.match(/\uFFFD/g) || []).length * 4;

    return penalty;
  }

  function summarizeLines(lines) {
    return lines.reduce((summary, line) => ({
      totalWordCount: summary.totalWordCount + line.wordCount,
      totalConfidenceSum: summary.totalConfidenceSum + line.confidenceSum,
      lowConfidenceCount: summary.lowConfidenceCount + line.lowConfidenceCount
    }), {
      totalWordCount: 0,
      totalConfidenceSum: 0,
      lowConfidenceCount: 0
    });
  }

  function buildCandidate(data, profile) {
    const filteredLines = getOcrLines(data)
      .map(filterLine)
      .filter(Boolean);

    const compactedLines = compactFilteredLines(filteredLines);
    const filteredText = cleanFinalText(compactedLines.map(line => line.text).join('\n'));
    const rawText = cleanFinalText(typeof data?.text === 'string' ? data.text : '');
    const text = filteredText.length > MIN_FILTERED_TEXT_LENGTH ? filteredText : rawText;
    const summary = summarizeLines(compactedLines);
    const averageConfidence = summary.totalWordCount
      ? (summary.totalConfidenceSum / summary.totalWordCount)
      : 0;
    const lowConfidenceRatio = summary.totalWordCount
      ? (summary.lowConfidenceCount / summary.totalWordCount)
      : 1;
    const overlapPenalty = measureAdjacentOverlapPenalty(compactedLines);
    const repeatPenalty = measureRepeatedPhrasePenalty(text);
    const garbagePenalty = measureGarbagePenalty(text);
    const score = averageConfidence
      - overlapPenalty
      - repeatPenalty
      - garbagePenalty
      - (lowConfidenceRatio * 25)
      + Math.min(summary.totalWordCount, SCORE_WORD_BONUS_LIMIT) * 0.05
      + Math.min(compactedLines.length, SCORE_LINE_BONUS_LIMIT) * 0.5
      + (filteredText.length > MIN_FILTERED_TEXT_LENGTH ? 3 : 0);

    return {
      profileId: profile.id,
      profileLabel: profile.label,
      text,
      rawText,
      score,
      averageConfidence,
      lowConfidenceRatio,
      overlapPenalty,
      repeatPenalty,
      garbagePenalty,
      totalWordCount: summary.totalWordCount,
      lineCount: compactedLines.length
    };
  }

  function chooseBestCandidate(candidates) {
    return candidates.reduce((bestCandidate, candidate) => {
      if (!bestCandidate) {
        return candidate;
      }
      if (candidate.score !== bestCandidate.score) {
        return candidate.score > bestCandidate.score ? candidate : bestCandidate;
      }
      if (candidate.repeatPenalty !== bestCandidate.repeatPenalty) {
        return candidate.repeatPenalty < bestCandidate.repeatPenalty ? candidate : bestCandidate;
      }
      if (candidate.averageConfidence !== bestCandidate.averageConfidence) {
        return candidate.averageConfidence > bestCandidate.averageConfidence ? candidate : bestCandidate;
      }
      if (candidate.totalWordCount !== bestCandidate.totalWordCount) {
        return candidate.totalWordCount > bestCandidate.totalWordCount ? candidate : bestCandidate;
      }
      return bestCandidate;
    }, null);
  }

  globalThis.OcrPostprocess = Object.freeze({
    buildCandidate,
    chooseBestCandidate,
    cleanFinalText
  });
})();

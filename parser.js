(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.KaojjParser = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function parseQuestionNote(markdown) {
    const source = String(markdown || "")
      .replace(/^\uFEFF/, "")
      .replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "");
    const questions = [];
    splitIntoChunks(source).forEach((chunk) => {
      const question = parseChunk(chunk);
      if (question) questions.push(question);
    });
    return questions.map((question, index) => ({ ...question, index, id: questionId(question) }));
  }

  function splitIntoChunks(source) {
    const chunks = [];
    let current = [];
    const flush = () => {
      const value = current.join("\n").trim();
      if (value) chunks.push(value);
      current = [];
    };

    source.split(/\r?\n/).forEach((rawLine) => {
      const line = rawLine.trim();
      const heading = line.match(/^#{1,6}\s+(.+)$/);
      if (heading || /^-{3,}\s*$/.test(line)) {
        flush();
        if (heading) current.push(heading[1].trim());
        return;
      }
      if (isQuestionStart(line, current)) flush();
      current.push(rawLine);
    });
    flush();
    return chunks;
  }

  function isQuestionStart(line, currentLines) {
    if (!line) return false;
    if (/^(?:题目|问题|Question|Q(?:uestion)?\s*\d+)\s*(?:[:：#.、)）-])?\s*\S+/i.test(line)) {
      return currentLines.some((value) => value.trim());
    }
    if (/^第\s*\d+\s*题\s*[:：.、)）-]?\s*\S+/.test(line)) {
      return currentLines.some((value) => value.trim());
    }
    if (/^\d+\s*[、)]\s*\S+/.test(line)) return currentLines.some((value) => value.trim());
    return /^\d+\s*[.]\s*\S+/.test(line) && currentLines.some(isAnswerLine);
  }

  function parseChunk(chunk) {
    const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return null;

    const options = [];
    const stemLines = [];
    const explanationLines = [];
    let answerText = "";
    let inExplanation = false;
    let sawOption = false;

    lines.forEach((line, lineIndex) => {
      const answer = line.match(/^(?:答案|正确答案|正确选项|Answer|Correct\s+answer)\s*[:：-]\s*(.+)$/i);
      if (answer) {
        answerText = answer[1].trim();
        inExplanation = false;
        return;
      }
      const explanation = line.match(/^(?:解析|说明|Explanation|Rationale)\s*[:：-]?\s*(.*)$/i);
      if (explanation) {
        inExplanation = true;
        if (explanation[1]) explanationLines.push(explanation[1].trim());
        return;
      }
      if (inExplanation) {
        explanationLines.push(line);
        return;
      }

      const option = parseOptionLine(line);
      const isNumberedStem =
        lineIndex === 0 &&
        (/^\d+\s*[、)]\s*\S+/.test(line) ||
          (/^\d+\s*[.]\s*\S+/.test(line) &&
            lines.slice(1).some((value) => /^[A-Ha-h]\s*[.)、：:]\s*\S+/.test(value))));
      if (option && !isNumberedStem) {
        options.push(option);
        sawOption = true;
        return;
      }
      if (/^(?:标签|Tag|来源|Source)\s*[:：]/i.test(line)) return;
      if (!sawOption || stemLines.length === 0) stemLines.push(stripQuestionPrefix(line));
    });

    if (options.length < 2 || !stemLines.length) return null;
    const markedCorrect = options.filter((option) => option.markedCorrect).map((option) => option.label);
    const correctAnswers = unique([...parseAnswerLabels(answerText, options), ...markedCorrect]);
    if (!correctAnswers.length) return null;

    return {
      stem: stemLines.join("\n").trim(),
      options: options.map(({ label, text }) => ({ label, text })),
      correctAnswers,
      explanation: explanationLines.join("\n").trim(),
    };
  }

  function parseOptionLine(line) {
    const clean = line.replace(/^[-*]\s+/, "").replace(/^\*\*(.*)\*\*$/, "$1").trim();
    const markedCorrect = /^(?:✅|☑|✔|✓|\[x\])\s*/i.test(clean) || /\s*(?:✅|☑|✔|✓)\s*$/.test(clean);
    const withoutMarker = clean
      .replace(/^(?:✅|☑|✔|✓|\[x\])\s*/i, "")
      .replace(/\s*(?:✅|☑|✔|✓)\s*$/, "")
      .replace(/^\*\*(.*)\*\*$/, "$1")
      .trim();
    const match = withoutMarker.match(/^([A-Ha-h]|[1-9])\s*[.．、)）:：-]\s*(.+)$/);
    if (!match) return null;
    return { label: normalizeOptionLabel(match[1]), text: match[2].trim(), markedCorrect };
  }

  function parseAnswerLabels(answerText, options) {
    if (!answerText) return [];
    const labels = [];
    const tokens = answerText.toUpperCase().match(/[A-H]|\b[1-9]\b/g) || [];
    tokens.forEach((token) => {
      const label = normalizeOptionLabel(token);
      if (options.some((option) => option.label === label)) labels.push(label);
    });
    if (labels.length) return unique(labels);
    const normalized = normalizeText(answerText);
    return options
      .filter((option) => {
        const optionText = normalizeText(option.text);
        return optionText.length > 1 && normalized.includes(optionText);
      })
      .map((option) => option.label);
  }

  function normalizeOptionLabel(label) {
    const value = String(label || "").trim().toUpperCase();
    if (/^[1-9]$/.test(value)) return String.fromCharCode("A".charCodeAt(0) + Number(value) - 1);
    return value;
  }

  function stripQuestionPrefix(line) {
    return line
      .replace(/^(?:题目|问题|Question|Q(?:uestion)?\s*\d+|第\s*\d+\s*题)\s*(?:[:：#.、)）-])\s*/i, "")
      .replace(/^\d+\s*[、.)]\s*/, "")
      .trim();
  }

  function isAnswerLine(line) {
    return /^(?:答案|正确答案|正确选项|Answer|Correct\s+answer)\s*[:：-]/i.test(line);
  }

  function questionId(question) {
    const canonical = [
      normalizeText(question.stem),
      ...question.options.map((option) => `${option.label}:${normalizeText(option.text)}`),
    ].join("|");
    return `q-${fnv1a(canonical)}`;
  }

  function fnv1a(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[\s\u3000]+/g, "")
      .replace(/[，。！？、；：()（）[\]{}「」“”‘’]/g, "");
  }

  function unique(values) {
    return [...new Set(values)];
  }

  return { parseQuestionNote };
});

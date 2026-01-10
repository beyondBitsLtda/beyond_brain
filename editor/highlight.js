const LANGUAGE_KEYWORDS = {
  javascript: [
    "const",
    "let",
    "var",
    "function",
    "return",
    "if",
    "else",
    "for",
    "while",
    "class",
    "new",
    "async",
    "await",
    "try",
    "catch",
  ],
  typescript: [
    "const",
    "let",
    "var",
    "function",
    "return",
    "if",
    "else",
    "for",
    "while",
    "class",
    "new",
    "async",
    "await",
    "try",
    "catch",
  ],
  python: [
    "def",
    "return",
    "if",
    "elif",
    "else",
    "for",
    "while",
    "class",
    "import",
    "from",
    "as",
    "try",
    "except",
  ],
  sql: [
    "select",
    "from",
    "where",
    "join",
    "left",
    "right",
    "inner",
    "group",
    "by",
    "order",
    "insert",
    "update",
    "delete",
  ],
};

const LANGUAGE_ALIASES = new Map([
  ["js", "javascript"],
  ["javascript", "javascript"],
  ["ts", "typescript"],
  ["typescript", "typescript"],
  ["py", "python"],
  ["python", "python"],
  ["sql", "sql"],
]);

const TOKEN_PRIORITY = {
  comment: 0,
  string: 1,
  keyword: 2,
  number: 3,
  function: 4,
};

function normalizeLanguage(language) {
  if (!language) return "";
  const normalized = language.trim().toLowerCase();
  return LANGUAGE_ALIASES.get(normalized) ?? normalized;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPatterns(language) {
  const patterns = [];

  if (language === "javascript" || language === "typescript") {
    patterns.push({ type: "comment", regex: /\/\/[^\n]*/g });
    patterns.push({ type: "comment", regex: /\/\*[\s\S]*?\*\//g });
    patterns.push({ type: "string", regex: /`(?:\\.|[^`\\])*`/g });
    patterns.push({ type: "string", regex: /"(?:\\.|[^"\\])*"/g });
    patterns.push({ type: "string", regex: /'(?:\\.|[^'\\])*'/g });
  } else if (language === "python") {
    patterns.push({ type: "comment", regex: /#[^\n]*/g });
    patterns.push({ type: "string", regex: /"(?:\\.|[^"\\])*"/g });
    patterns.push({ type: "string", regex: /'(?:\\.|[^'\\])*'/g });
  } else if (language === "sql") {
    patterns.push({ type: "comment", regex: /--[^\n]*/g });
    patterns.push({ type: "string", regex: /"(?:\\.|[^"\\])*"/g });
    patterns.push({ type: "string", regex: /'(?:\\.|[^'\\])*'/g });
  } else {
    patterns.push({ type: "string", regex: /"(?:\\.|[^"\\])*"/g });
    patterns.push({ type: "string", regex: /'(?:\\.|[^'\\])*'/g });
  }

  patterns.push({ type: "number", regex: /\b\d+(?:\.\d+)?\b/g });
  patterns.push({ type: "function", regex: /\b[a-zA-Z_][\w]*\s*(?=\()/g });

  const keywords = LANGUAGE_KEYWORDS[language];
  if (keywords && keywords.length > 0) {
    const flags = language === "sql" ? "gi" : "g";
    const keywordPattern = new RegExp(`\\b(${keywords.join("|")})\\b`, flags);
    patterns.push({ type: "keyword", regex: keywordPattern });
  }

  return patterns;
}

export function highlight(code, language) {
  const normalizedLanguage = normalizeLanguage(language);
  const patterns = buildPatterns(normalizedLanguage);
  const matches = [];

  patterns.forEach(({ type, regex }) => {
    for (const match of code.matchAll(regex)) {
      if (typeof match.index !== "number") continue;
      matches.push({
        type,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  });

  matches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return b.end - a.end;
    return TOKEN_PRIORITY[a.type] - TOKEN_PRIORITY[b.type];
  });

  let cursor = 0;
  const output = [];

  for (const match of matches) {
    if (match.start < cursor) {
      continue;
    }
    if (match.start > cursor) {
      output.push(escapeHtml(code.slice(cursor, match.start)));
    }
    const snippet = code.slice(match.start, match.end);
    output.push(`<span class="token ${match.type}">${escapeHtml(snippet)}</span>`);
    cursor = match.end;
  }

  if (cursor < code.length) {
    output.push(escapeHtml(code.slice(cursor)));
  }

  return output.join("");
}

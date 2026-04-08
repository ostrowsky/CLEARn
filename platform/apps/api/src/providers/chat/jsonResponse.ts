function stripWrappers(content: string) {
  return String(content || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/```json/gi, '```')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, ''))
    .trim();
}

function tryParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function findBalancedJsonCandidate(source: string) {
  const start = source.search(/[\[{]/);
  if (start < 0) {
    return '';
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      depth += 1;
    } else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return '';
}

export function parseModelJsonContent<T>(rawContent: string): T {
  const candidates: string[] = [];
  const raw = String(rawContent || '').trim();
  const stripped = stripWrappers(raw);
  if (raw) {
    candidates.push(raw);
  }
  if (stripped && stripped !== raw) {
    candidates.push(stripped);
  }

  for (const candidate of candidates) {
    const direct = tryParseJson<T>(candidate);
    if (direct) {
      return direct;
    }

    const balanced = findBalancedJsonCandidate(candidate);
    if (balanced) {
      const parsed = tryParseJson<T>(balanced);
      if (parsed) {
        return parsed;
      }
    }
  }

  throw new Error('Model response was not valid JSON.');
}

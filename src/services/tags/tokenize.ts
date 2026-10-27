interface AssistantToken {
  type: 'text' | 'tag';
  value: string;
}

/** Linear scan: nested/unknown tags stay opaque; an unclosed tag hides the tail. */
export function* tokenizeAssistantText(text: string): Generator<AssistantToken> {
  let start = 0;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '<') {
      if (depth === 0) {
        if (i > start) yield { type: 'text', value: text.slice(start, i) };
        start = i + 1;
      }
      depth++;
    } else if (char === '>' && depth > 0) {
      depth--;
      if (depth === 0) {
        yield { type: 'tag', value: text.slice(start, i) };
        start = i + 1;
      }
    }
  }
  if (depth === 0 && start < text.length) yield { type: 'text', value: text.slice(start) };
}

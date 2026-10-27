/* Presentation-only safety net + sequential delivery. Tag actions live on the server. */

/** Also used for old cached replies. Never strip tags from user-authored text. */
export function hideAssistantTags(text) {
  if (typeof text !== 'string') return '';
  const parts = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '<') {
      if (depth === 0) {
        parts.push(text.slice(start, i));
        start = i;
      }
      depth++;
    } else if (text[i] === '>' && depth > 0) {
      depth--;
      if (depth === 0) start = i + 1;
    }
  }
  if (depth === 0) parts.push(text.slice(start));
  return parts.join('');
}

const sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

/** Keep the caller busy until ALL messages arrive. Injectable wait enables fast tests. */
export async function deliverAssistantReply(data, onMessage, wait = sleep) {
  const source = Array.isArray(data.messages) ? data.messages : [{ text: data.reply, delayMs: 0 }];
  const messages = source
    .map((message) => ({
      text: hideAssistantTags(message?.text).trim(),
      delayMs: Number.isFinite(message?.delayMs) ? Math.max(0, message.delayMs) : 0,
    }))
    .filter((message) => message.text);
  if (!messages.length) throw new Error('Получен пустой ответ. Попробуйте ещё раз.');
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (i > 0 && message.delayMs > 0) await wait(message.delayMs);
    onMessage(message.text);
  }
}

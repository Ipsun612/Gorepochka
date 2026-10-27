import { config, getRefererHeaders } from '../config/config.js';
import { log } from '../utils/logger.js';

// Rich content parts (OpenAI-compatible multimodal format, which OpenRouter
// proxies for vision models). Plain text messages keep using the string form.
export interface ChatTextPart {
  type: 'text';
  text: string;
}

export interface ChatImagePart {
  type: 'image_url';
  image_url: { url: string };
}

export interface ChatVideoPart {
  type: 'video_url';
  video_url: { url: string };
}

// Private history stores a bounded disk reference, not megabytes of base64.
export interface ChatVideoReference {
  type: 'video_ref';
  videoId: string;
}

export interface ChatAudioPart {
  type: 'input_audio';
  input_audio: { data: string; format: 'mp3' };
}

export interface ChatAudioReference {
  type: 'audio_ref';
  audioId: string;
}

export type ChatContentPart =
  ChatTextPart | ChatImagePart | ChatVideoPart | ChatVideoReference | ChatAudioPart | ChatAudioReference;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  /** Plain text, or an array of parts (text + images) for multimodal turns. */
  content: string | ChatContentPart[];
}

/**
 * Errors that are safe to show verbatim to end users. Thrown only with fixed,
 * developer-authored strings — never with raw provider/network details.
 */
export class UserFacingError extends Error {
  readonly userMessage: string;
  constructor(userMessage: string) {
    super(userMessage);
    this.name = 'UserFacingError';
    this.userMessage = userMessage;
  }
}

interface OpenRouterSuccess {
  choices: Array<{ message?: { content?: string } }>;
}

function redactUrl(url: string): string {
  return url.replace(/key=[^&]+/gi, 'key=[REDACTED]');
}

export async function completeChat(
  messages: ChatMessage[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, options.timeoutMs ?? config.OPENROUTER_TIMEOUT_MS);

  try {
    const res = await fetch(`${config.OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        ...getRefererHeaders(),
      },
      body: JSON.stringify({
        model: config.OPENROUTER_MODEL,
        messages,
        temperature: config.OPENROUTER_TEMPERATURE,
        max_tokens: config.OPENROUTER_MAX_TOKENS,
      }),
    });

    if (!res.ok) {
      // Provider errors can echo prompt/profile data. Do not log their bodies.
      await res.body?.cancel();
      log.error({ status: res.status }, 'OpenRouter request failed');
      if (res.status === 401 || res.status === 403) {
        throw new UserFacingError('AI provider authentication failed.');
      }
      if (res.status === 429) {
        throw new UserFacingError('AI provider is rate-limited. Please try again shortly.');
      }
      throw new UserFacingError('AI provider returned an error.');
    }

    const data = (await res.json()) as OpenRouterSuccess;
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new UserFacingError('AI provider returned an empty response.');
    }
    return content;
  } catch (err) {
    if (err instanceof UserFacingError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new UserFacingError('AI request timed out. Try a shorter message.');
    }
    log.error({ err }, 'Unknown OpenRouter error');
    throw new UserFacingError('AI request failed.');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

// Used only for logging without leaking query params.
export function safeLogUrl(url: string): string {
  try {
    return redactUrl(url);
  } catch {
    return '[unparseable-url]';
  }
}

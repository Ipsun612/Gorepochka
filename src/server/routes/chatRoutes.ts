import type express from 'express';
import { config } from '../../config/config.js';
import { completeChat, UserFacingError } from '../../services/openrouter.js';
import { log } from '../../utils/logger.js';
import { sanitizeInput, toUserError } from '../../utils/security.js';
import {
  appendHistory,
  buildMessages,
  chatGeneration,
  clearHistory,
  getHistory,
  isRateLimited,
} from '../../services/session.js';
import { processAssistantReply } from '../../services/tags/index.js';
import { resolveIdentity } from '../requestIdentity.js';
import { getProfileContext } from '../../services/profile/context.js';
import { getCharacterInstructions } from '../../services/character/index.js';
import { getLorebookContext } from '../../services/lorebook/index.js';
import { getVideo, pinVideo, resolveVideoMessages } from '../../services/videos.js';
import {
  cancelChatJobs,
  describeJob,
  findChatJob,
  lockChat,
  startChatJob,
  unlockChat,
} from '../../services/chatJobs.js';
import { getAudio, pinAudio, resolveAudioMessages } from '../../services/audio.js';
import { MINIAPP_CHAT_SLOTS, miniAppChatKey, resolveChatSlot } from '../chatSlots.js';
import {
  clearAllMediaForUser,
  clearMediaForSlot,
  persistAudioUpload,
  persistVideoUpload,
  pruneMediaForSlot,
} from '../../services/media/index.js';
import { deleteAudio } from '../../services/audio.js';
import { deleteVideo } from '../../services/videos.js';
import {
  appendFileBlock,
  buildChatContent,
  decodeFileAttachment,
  decodeImageAttachment,
} from '../chat/chatAttachments.js';

export function registerChatRoutes(app: express.Express): void {
  app.post('/api/new', (req, res) => {
    const identity = resolveIdentity(req, true, res);
    if (!identity) return;

    const rawSlot = req.body?.chatId;
    if (rawSlot === undefined) {
      // No slot given: sweep every Mini App slot to a truly fresh state.
      for (let i = 1; i <= MINIAPP_CHAT_SLOTS; i++) {
        const key = miniAppChatKey(identity.historyKey, i);
        cancelChatJobs(key);
        clearHistory(key);
      }
      clearAllMediaForUser(identity);
      log.info({ userId: identity.userId, verified: identity.verified }, 'Mini App history cleared (all chats)');
    } else {
      const slot = resolveChatSlot(rawSlot);
      if (slot === null) {
        res.status(400).json({ ok: false, error: `"chatId" must be an integer 1..${MINIAPP_CHAT_SLOTS}.` });
        return;
      }
      const key = miniAppChatKey(identity.historyKey, slot);
      cancelChatJobs(key);
      clearHistory(key);
      clearMediaForSlot(identity, slot);
      log.info({ userId: identity.userId, chatId: slot, verified: identity.verified }, 'Mini App chat cleared');
    }
    res.json({ ok: true });
  });

  app.post('/api/chat', async (req, res) => {
    // Optional multi-chat slot selector (Mini App supports up to 5 chats).
    const rawSlot = req.body?.chatId;
    const rawMessage = req.body?.message;
    const rawImage = req.body?.image;
    const rawFile = req.body?.file;
    const rawFileName = req.body?.fileName;
    const rawVideoId = req.body?.videoId;
    const rawAudioId = req.body?.audioId;

    const slot = resolveChatSlot(rawSlot);
    if (slot === null) {
      res.status(400).json({ ok: false, error: `"chatId" must be an integer 1..${MINIAPP_CHAT_SLOTS}.` });
      return;
    }

    // "message" may be omitted/empty when an attachment is present (captionless upload).
    if (rawMessage !== undefined && typeof rawMessage !== 'string') {
      res.status(400).json({ ok: false, error: 'Send a "message" string.' });
      return;
    }
    if (rawFile !== undefined && typeof rawFile !== 'string') {
      res.status(400).json({ ok: false, error: 'Send a "file" string.' });
      return;
    }

    const identity = resolveIdentity(req, true, res);
    if (!identity) return;

    const chatKey = miniAppChatKey(identity.historyKey, slot);
    const requestId = req.body?.requestId;
    if (
      rawAudioId !== undefined &&
      (typeof rawAudioId !== 'string' || typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(requestId))
    ) {
      res.status(400).json({ ok: false, error: 'Send an audioId and a valid requestId.' });
      return;
    }
    if (
      rawVideoId !== undefined &&
      (typeof rawVideoId !== 'string' || typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(requestId))
    ) {
      res.status(400).json({ ok: false, error: 'Send a videoId and a valid requestId.' });
      return;
    }
    if (typeof requestId === 'string') {
      const previous = findChatJob(identity.historyKey, requestId);
      if (previous) {
        if (previous.chatKey !== chatKey) {
          res.status(409).json({ ok: false, error: 'Request belongs to another chat.' });
          return;
        }
        res.status(202).json({ ok: true, ...describeJob(previous) });
        return;
      }
    }

    if (isRateLimited(String(identity.userId))) {
      res.status(429).json({ ok: false, error: 'Too many requests. Please wait a few seconds.' });
      return;
    }

    const input = sanitizeInput(typeof rawMessage === 'string' ? rawMessage : '');
    const hasImage = typeof rawImage === 'string' && rawImage !== '';
    const hasFile = typeof rawFile === 'string' && rawFile !== '';
    const audio = typeof rawAudioId === 'string' ? getAudio(rawAudioId, identity.historyKey, chatKey) : undefined;
    if (rawAudioId !== undefined && (!audio || audio.state !== 'ready')) {
      res.status(400).json({
        ok: false,
        code: 'AUDIO_UNAVAILABLE',
        error: 'Запись недоступна или не готова. Запишите сообщение заново.',
      });
      return;
    }
    if (audio && (hasImage || hasFile || rawVideoId !== undefined)) {
      res.status(400).json({ ok: false, error: 'Отправляйте голосовое сообщение отдельно от других вложений.' });
      return;
    }
    const video = typeof rawVideoId === 'string' ? getVideo(rawVideoId, identity.historyKey, chatKey) : undefined;
    if (rawVideoId !== undefined && (!video || video.state !== 'ready')) {
      res.status(400).json({
        ok: false,
        code: 'VIDEO_UNAVAILABLE',
        error: 'Video expired or is not ready. Please attach it again.',
      });
      return;
    }
    if (!input && !hasImage && !hasFile && !video && !audio) {
      res
        .status(400)
        .json({ ok: false, error: 'Please send a message or attach an image, video, audio, or text file.' });
      return;
    }
    const truncated = typeof rawMessage === 'string' && rawMessage.length > config.MAX_MESSAGE_LENGTH;

    let imageDataUrl: string | null = null;
    if (hasImage) {
      try {
        const converted = await decodeImageAttachment(rawImage);
        imageDataUrl = converted.dataUrl;
        log.info(
          {
            userId: identity.userId,
            chatId: slot,
            sourceBytes: converted.sourceBytes,
            jpegBytes: converted.bytes,
            width: converted.width,
            height: converted.height,
          },
          'Image attachment converted to JPEG',
        );
      } catch (err) {
        res.status(400).json({ ok: false, error: toUserError(err).replace(/^⚠️\s*/, '') });
        return;
      }
    }

    let fileAttachment: ReturnType<typeof decodeFileAttachment> | null = null;
    if (hasFile) {
      try {
        fileAttachment = decodeFileAttachment(rawFile, rawFileName);
        log.info(
          {
            userId: identity.userId,
            chatId: slot,
            fileName: fileAttachment.name,
            sourceBytes: fileAttachment.file.sourceBytes,
            chars: fileAttachment.file.chars,
            truncated: fileAttachment.file.truncated,
          },
          'Text file attachment decoded',
        );
      } catch (err) {
        res.status(400).json({ ok: false, error: toUserError(err).replace(/^⚠️\s*/, '') });
        return;
      }
    }

    // Text for this turn: the message plus any attached file block, so the
    // model sees both the instruction and the file contents.
    const textContent = appendFileBlock(input, fileAttachment);

    // Multimodal turn: text (+ image) parts, plain string when neither.
    const content = buildChatContent(textContent, imageDataUrl, video, audio);

    // Freeze profiles and selected lore before generation, including asynchronous media jobs.
    // Storage failure must not silently send empty biography/default personality.
    let profileContext;
    let characterContext: string;
    let lorebookContext;
    try {
      profileContext = getProfileContext(identity);
      characterContext = getCharacterInstructions(identity);
      lorebookContext = getLorebookContext(identity, getHistory(chatKey), textContent);
    } catch {
      res.status(503).json({ ok: false, error: 'Не удалось прочитать профиль или лорбук. Попробуйте ещё раз.' });
      return;
    }
    // Each Mini App chat slot has its own private dialog history, isolated
    // from the other slots (slot keys "<historyKey>#c<slot>").
    if (!lockChat(chatKey)) {
      if (typeof requestId === 'string') {
        const existing = findChatJob(identity.historyKey, requestId);
        if (existing && existing.chatKey === chatKey) {
          res.status(202).json({ ok: true, ...describeJob(existing) });
          return;
        }
      }
      res.status(409).json({ ok: false, error: 'A reply is already being generated in this chat.' });
      return;
    }
    const generation = chatGeneration(chatKey);
    const releaseVideo = video ? pinVideo(video) : () => {};
    const releaseAudio = audio ? pinAudio(audio) : () => {};
    const work = async (signal?: AbortSignal) => {
      const messagesForModel = await resolveAudioMessages(
        await resolveVideoMessages(
          buildMessages(chatKey, profileContext, characterContext, lorebookContext, content),
          identity.historyKey,
        ),
        identity.historyKey,
      );
      const containsVideo = messagesForModel.some(
        (message) => typeof message.content !== 'string' && message.content.some((part) => part.type === 'video_url'),
      );
      const rawReply = await completeChat(messagesForModel, {
        signal,
        timeoutMs: containsVideo
          ? config.VIDEO_ANALYSIS_TIMEOUT_MS
          : messagesForModel.some(
                (message) =>
                  typeof message.content !== 'string' && message.content.some((part) => part.type === 'input_audio'),
              )
            ? config.AUDIO_ANALYSIS_TIMEOUT_MS
            : config.OPENROUTER_TIMEOUT_MS,
      });
      const { reply, messages, userReaction } = processAssistantReply(rawReply);
      if (messages.length === 0) {
        throw new UserFacingError('AI provider returned an empty response. Please try again.');
      }
      if (signal?.aborted) throw new UserFacingError('Обработка сообщения отменена.');
      if (generation !== chatGeneration(chatKey)) throw new UserFacingError('Обработка сообщения отменена.');
      if (video) video.committed = true;
      if (audio) audio.committed = true;
      // Commit both turns only after successful generation; retries never leave
      // a duplicate or half-written user turn in model history.
      // botReaction stores Горепочка's auto reaction (display-only, never model context).
      const userStored = appendHistory(chatKey, { role: 'user', content }, { botReaction: userReaction });
      const assistantStored = appendHistory(chatKey, { role: 'assistant', content: reply });
      // Durable cross-device media: copy committed uploads to MEDIA_DIR + chat_media
      // so a second device can play them after restart. Best-effort; history stays truth.
      // Verified turns free their tmpdir copy once durable; anon/dev keeps the
      // process-local upload so follow-ups can still reattach it.
      if (video) {
        if (identity.verified) {
          try {
            const saved = await persistVideoUpload(identity, slot, video);
            if (saved) void deleteVideo(video).catch(() => {});
          } catch (error) {
            log.warn({ userId: identity.userId, chatId: slot }, 'Durable video persist failed');
          }
        }
      }
      if (audio) {
        if (identity.verified) {
          try {
            const saved = await persistAudioUpload(identity, slot, audio);
            if (saved) void deleteAudio(audio).catch(() => {});
          } catch (error) {
            log.warn({ userId: identity.userId, chatId: slot }, 'Durable audio persist failed');
          }
        }
      }
      if (!video && !audio) pruneMediaForSlot(identity, slot);
      log.info({ userId: identity.userId, chatId: slot, verified: identity.verified }, 'Mini App chat completed');
      return {
        ok: true,
        chatId: slot,
        reply,
        messages,
        userReaction,
        userMessageId: userStored?.id ?? null,
        assistantMessageId: assistantStored?.id ?? null,
        model: config.OPENROUTER_MODEL,
        truncated,
        hasImage: Boolean(imageDataUrl),
        hasFile: Boolean(fileAttachment),
        hasVideo: Boolean(video),
        hasAudio: Boolean(audio),
      };
    };
    const release = () => {
      releaseVideo();
      releaseAudio();
      unlockChat(chatKey);
    };
    const hasMediaHistory = buildMessages(chatKey).some(
      (entry) =>
        typeof entry.content !== 'string' &&
        entry.content.some((part) => part.type === 'video_ref' || part.type === 'audio_ref'),
    );
    if (video || audio || hasMediaHistory) {
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(requestId)) {
        release();
        res.status(400).json({ ok: false, error: 'Send a valid requestId for media conversations.' });
        return;
      }
      const duplicate = findChatJob(identity.historyKey, requestId);
      if (duplicate) {
        release();
        if (duplicate.chatKey !== chatKey) {
          res.status(409).json({ ok: false, error: 'Request belongs to another chat.' });
          return;
        }
        res.status(202).json({ ok: true, ...describeJob(duplicate) });
        return;
      }
      try {
        const job = startChatJob(identity.historyKey, chatKey, requestId, work, release);
        res.status(202).json({ ok: true, ...describeJob(job) });
      } catch (err) {
        release();
        res.status(503).json({ ok: false, error: toUserError(err).replace(/^⚠️\s*/, '') });
      }
      return;
    }
    try {
      res.json(await work());
    } catch (err) {
      log.error({ userId: identity.userId, chatId: slot }, 'Mini App chat failed');
      res.status(502).json({ ok: false, error: toUserError(err).replace(/^⚠️\s*/, '') });
    } finally {
      release();
    }
  });
}

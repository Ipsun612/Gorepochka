import crypto from 'node:crypto';
import { config } from '../config/config.js';
import { toUserError } from '../utils/security.js';
import { UserFacingError } from './openrouter.js';

export interface ChatJob {
  id: string;
  owner: string;
  chatKey: string;
  requestId: string;
  state: 'analyzing' | 'complete' | 'failed' | 'cancelled';
  result?: unknown;
  error?: string;
  controller: AbortController;
  expiresAt: number;
}

const jobs = new Map<string, ChatJob>();
const locks = new Set<string>();
const cancelledRequests = new Map<string, number>();
export function cancelRequest(owner: string, requestId: string): void {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(requestId)) return;
  cancelledRequests.set(`${owner}:${requestId}`, Date.now() + 5 * 60 * 1000);
  while (cancelledRequests.size > 2000) cancelledRequests.delete(cancelledRequests.keys().next().value!);
  const job = findChatJob(owner, requestId);
  if (job) cancelJob(job);
}
export function lockChat(key: string): boolean {
  if (locks.has(key)) return false;
  locks.add(key);
  return true;
}
export function unlockChat(key: string): void {
  locks.delete(key);
}
export function findChatJob(owner: string, requestId: string): ChatJob | undefined {
  return [...jobs.values()].find((job) => job.owner === owner && job.requestId === requestId);
}
export function getChatJob(id: string, owner: string): ChatJob | undefined {
  const job = jobs.get(id);
  return job?.owner === owner ? job : undefined;
}
export function describeJob(job: ChatJob) {
  return { jobId: job.id, state: job.state, result: job.result, error: job.error };
}
export function startChatJob(
  owner: string,
  chatKey: string,
  requestId: string,
  work: (signal: AbortSignal) => Promise<unknown>,
  release: () => void,
): ChatJob {
  if (jobs.size >= 2000) throw new UserFacingError('Обработка сообщений занята. Попробуйте позже.');
  if ((cancelledRequests.get(`${owner}:${requestId}`) ?? 0) > Date.now()) {
    throw new UserFacingError('Обработка отменена. Повторите отправку новым запросом.');
  }
  const job: ChatJob = {
    id: crypto.randomUUID(),
    owner,
    chatKey,
    requestId,
    state: 'analyzing',
    controller: new AbortController(),
    expiresAt: Date.now() + Math.max(config.VIDEO_TTL_MS, config.AUDIO_TTL_MS),
  };
  jobs.set(job.id, job);
  void (async () => {
    try {
      job.result = await work(job.controller.signal);
      if (!job.controller.signal.aborted) job.state = 'complete';
    } catch (err) {
      if (!job.controller.signal.aborted) {
        job.state = 'failed';
        job.error = toUserError(err).replace(/^⚠️\s*/, '');
      }
    } finally {
      job.expiresAt = Date.now() + Math.max(config.VIDEO_TTL_MS, config.AUDIO_TTL_MS);
      release();
    }
  })();
  return job;
}
export function cancelJob(job: ChatJob): void {
  if (job.state !== 'analyzing') return;
  job.state = 'cancelled';
  job.controller.abort();
}
export function cancelChatJobs(chatKey: string): void {
  for (const job of jobs.values()) if (job.chatKey === chatKey) cancelJob(job);
}
setInterval(() => {
  for (const job of jobs.values()) if (job.state !== 'analyzing' && job.expiresAt <= Date.now()) jobs.delete(job.id);
  for (const [key, expiresAt] of cancelledRequests) if (expiresAt <= Date.now()) cancelledRequests.delete(key);
}, 30000).unref();

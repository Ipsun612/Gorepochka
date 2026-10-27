/* Tag parsing, Unicode-aware timing, and sequential delivery (no real delays/keys).
   Run: npm run build && node scripts/smoke-tags.mjs */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { hideAssistantTags, deliverAssistantReply } from '../webapp/app/core/assistantReply.js';

process.env.TELEGRAM_BOT_TOKEN = 'x'.repeat(40);
process.env.OPENROUTER_API_KEY = 'y'.repeat(40);
process.env.AI_TYPING_CHARS_PER_SECOND = '20';
process.env.AI_TYPING_MIN_DELAY_MS = '800';
process.env.AI_TYPING_MAX_DELAY_MS = '8000';
process.env.PROMPT_MAX_TOTAL_CHARS = '32000';

const require = createRequire(import.meta.url);
const { processAssistantReply, ASSISTANT_TAGS } = require('../dist/services/tags/index.js');
const { getTypingDelayMs } = require('../dist/services/typingDelay.js');
const { loadSystemPrompt } = require('../dist/services/prompts.js');
assert.ok(
  loadSystemPrompt().includes('<Поставить реакцию:'),
  'reaction instructions fit the default whole-chunk prompt budget',
);
const split = '<Разделить сообщение>';
assert.deepEqual(
  ASSISTANT_TAGS.map((tag) => tag.name),
  ['Разделить сообщение', 'Поставить реакцию'],
);

const cases = [
  ['', []],
  ['  привет\n\nкак дела  ', ['привет\n\nкак дела']],
  [`привет${split}как дела${split}пока`, ['привет', 'как дела', 'пока']],
  [`${split} привет ${split} ${split} пока ${split}`, ['привет', 'пока']],
  [`${split}${split}<Неизвестный тег> <>`, []],
  ['а<Скрытый тег>б<>в', ['абв']],
  ['а<разделить сообщение>б<Split message>в<Разделить  сообщение>г', ['абвг']],
  ['а<Разделить сообщение >б< Разделить сообщение>в', ['абв']],
  ['а<Многострочный\nтег>б', ['аб']],
  [`а<Внешний ${split} тег>б`, ['аб']],
  ['видно <Незакрытый тег и его содержимое', ['видно']],
  ['до<Внешний <Внутренний> остаток', ['до']],
  ['<Незакрытый тег', []],
  ['```<Неизвестный>```', ['``````']],
  ['2 > 1', ['2 > 1']],
];
for (const [raw, expected] of cases) {
  const result = processAssistantReply(raw);
  assert.deepEqual(
    result.messages.map((m) => m.text),
    expected,
    raw,
  );
  assert.equal(result.reply, expected.join('\n\n'), raw);
  assert.ok(result.messages.every((m, i) => m.delayMs === (i === 0 ? 0 : getTypingDelayMs(m.text))));
  // Frontend hides the same opaque ranges but does not execute/split tags.
  assert.equal(hideAssistantTags(raw).replace(/\s/g, ''), expected.join('').replace(/\s/g, ''), raw);
  assert.ok(!result.reply.includes('<'));
}
assert.equal(hideAssistantTags(`а${split}б<Скрыть>в`), 'абв');
assert.equal(hideAssistantTags(null), '');

const { normalizeReaction } = require('../dist/services/tags/reaction.js');
const { normalizeReaction: normalizeCachedReaction } = await import('../webapp/app/core/reactionValue.js');
for (const emoji of ['❤️', '👍', '👎', '🔥', '😂', '🥺', '😮', '😢', '👏', '🙏', '👍🏽', '👩‍💻', '🇦🇲', '1️⃣']) {
  assert.equal(normalizeReaction(emoji), emoji);
  assert.equal(normalizeCachedReaction(emoji), emoji);
  for (const value of [emoji, `[${emoji}]`]) {
    const result = processAssistantReply(`молодец <Поставить реакцию: ${value}>${split}ура`);
    assert.equal(result.userReaction, emoji);
    assert.deepEqual(
      result.messages.map((m) => m.text),
      ['молодец', 'ура'],
    );
    assert.equal(result.messages[1].delayMs, 800);
  }
}
for (const value of ['', 'text', '❤️👍', '❤️ text', '<img>', '1', '#', '😀a', '[❤️]', null]) {
  assert.equal(normalizeReaction(value), null, String(value));
  assert.equal(normalizeCachedReaction(value), null, String(value));
}
for (const tag of [
  '<Поставить реакцию: >',
  '<Поставить реакцию: text>',
  '<Поставить реакцию: ❤️👍>',
  '<поставить реакцию: ❤️>',
  '< Поставить реакцию: ❤️>',
  '<Поставить реакцию:❤️>',
  '<Внешний <Поставить реакцию: ❤️>>',
  '<Поставить реакцию: ❤️',
]) {
  const result = processAssistantReply(`видно ${tag}`);
  assert.equal(result.userReaction, null, tag);
  assert.equal(result.reply, 'видно');
}
assert.equal(
  processAssistantReply('да <Поставить реакцию: ❤️><Поставить реакцию: 🔥><Поставить реакцию: bad>').userReaction,
  '🔥',
);
assert.deepEqual(
  processAssistantReply('<Поставить реакцию: ❤️>').messages,
  [],
  'no empty bubble for a reaction-only reply',
);

assert.equal(getTypingDelayMs('я'), 800, 'minimum pause');
assert.equal(getTypingDelayMs('я'.repeat(40)), 2000, 'Russian letters are characters, not UTF-8 bytes');
assert.equal(getTypingDelayMs('😀'.repeat(40)), 2000, 'astral Unicode counts once');
assert.equal(getTypingDelayMs('я'.repeat(1000)), 8000, 'maximum pause');
assert.ok(getTypingDelayMs('я'.repeat(100)) > getTypingDelayMs('я'.repeat(40)));
assert.equal(getTypingDelayMs('я'.repeat(40), { charactersPerSecond: 10, minDelayMs: 1, maxDelayMs: 9000 }), 4000);
const timedReply = processAssistantReply(`первая${split}${'я'.repeat(40)}<${'Скрыто'.repeat(1000)}>`);
assert.equal(timedReply.messages[1].delayMs, 2000, 'hidden tag characters never inflate the pause');

const events = [];
let resume;
const delivery = deliverAssistantReply(
  {
    messages: [
      { text: 'первое', delayMs: 0 },
      { text: 'второе<Скрыто>', delayMs: 1200 },
      { text: 'третье', delayMs: 2400 },
    ],
  },
  (text) => events.push(text),
  (ms) => {
    events.push(ms);
    return new Promise((resolve) => {
      resume = resolve;
    });
  },
);
assert.deepEqual(events, ['первое', 1200], 'first message is immediate, second waits');
resume();
await Promise.resolve();
assert.deepEqual(events, ['первое', 1200, 'второе', 2400], 'delays are sequential, not concurrent');
resume();
await delivery;
assert.deepEqual(events, ['первое', 1200, 'второе', 2400, 'третье']);

const legacy = [];
await deliverAssistantReply({ reply: 'старый <Скрыто>ответ' }, (text) => legacy.push(text));
assert.deepEqual(legacy, ['старый ответ'], 'old reply-only API remains supported');
await assert.rejects(
  deliverAssistantReply({ messages: [{ text: '<Скрыто>' }] }, () => assert.fail()),
  /пустой ответ/,
);

// Invalid tuning fails fast without printing secrets.
for (const overrides of [
  { AI_TYPING_CHARS_PER_SECOND: '0' },
  { AI_TYPING_MIN_DELAY_MS: '9000' },
  { AI_TYPING_MAX_DELAY_MS: '2147483648' },
]) {
  const child = spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(require.resolve('../dist/config/config.js'))})`],
    {
      env: { ...process.env, ...overrides },
      encoding: 'utf8',
    },
  );
  assert.equal(child.status, 1);
  assert.match(child.stderr, /AI_TYPING_/);
  assert.ok(!child.stderr.includes(process.env.OPENROUTER_API_KEY));
}

console.log('SMOKE OK — Russian tags, hidden unknown/malformed tags, Unicode timing + ordered delivery.');

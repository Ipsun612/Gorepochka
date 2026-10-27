import type { AssistantTagDefinition } from './types.js';

export const splitMessageTag: AssistantTagDefinition = {
  name: 'Разделить сообщение',
  handle(context) {
    context.splitMessage();
  },
};

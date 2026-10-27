/** Capabilities available to tag handlers. Extend this as new actions are added. */
export interface AssistantTagContext {
  splitMessage(): void;
  setUserReaction(emoji: string): void;
}

export interface AssistantTagDefinition {
  /** Exact, case-sensitive Russian phrase, without angle brackets. */
  readonly name: string;
  /** Parameterized tags use the exact form <name: value>. */
  readonly parameterized?: boolean;
  handle(context: AssistantTagContext, argument?: string): void;
}

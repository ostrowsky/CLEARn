import type { ProviderKind } from '@softskills/domain';
import { env } from '../config/env';
import { huggingFaceChatProvider } from './chat/huggingface';
import { openAiChatProvider } from './chat/openai';
import { selfHostedChatProvider } from './chat/selfHosted';
import { huggingFaceSpeechProvider } from './speech/huggingfaceSpeech';
import { openAiSpeechProvider } from './speech/openaiSpeech';
import { selfHostedSpeechProvider } from './speech/selfHostedSpeech';
import type { ChatProvider, SpeechProvider } from './types';

const chatProviders: Record<ProviderKind, ChatProvider> = {
  huggingface: huggingFaceChatProvider,
  openai: openAiChatProvider,
  selfhosted: selfHostedChatProvider,
};

const speechProviders: Record<ProviderKind, SpeechProvider> = {
  huggingface: huggingFaceSpeechProvider,
  openai: openAiSpeechProvider,
  selfhosted: selfHostedSpeechProvider,
};

function fallbackChain(): ProviderKind[] {
  return env.LLM_FALLBACK_CHAIN.split(',').map((value) => value.trim() as ProviderKind);
}

function formatProviderError(kind: ProviderKind, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return `${kind}: ${message}`;
}

function buildProviderError(scope: 'chat' | 'speech', failures: string[], lastError: unknown): never {
  if (!failures.length) {
    throw lastError ?? new Error(`No ${scope} provider available.`);
  }

  throw new Error(`All ${scope} providers failed. ${failures.join(' | ')}`);
}

export async function withChatProvider<T>(preferred: ProviderKind, action: (provider: ChatProvider) => Promise<T>): Promise<T> {
  const order = [preferred, ...fallbackChain().filter((item) => item !== preferred)];
  let lastError: unknown;
  const failures: string[] = [];

  for (const kind of order) {
    try {
      return await action(chatProviders[kind]);
    } catch (error) {
      lastError = error;
      failures.push(formatProviderError(kind, error));
    }
  }

  return buildProviderError('chat', failures, lastError);
}

export async function withSpeechProvider<T>(preferred: ProviderKind, action: (provider: SpeechProvider) => Promise<T>): Promise<T> {
  const order = [preferred, ...fallbackChain().filter((item) => item !== preferred)];
  let lastError: unknown;
  const failures: string[] = [];

  for (const kind of order) {
    try {
      return await action(speechProviders[kind]);
    } catch (error) {
      lastError = error;
      failures.push(formatProviderError(kind, error));
    }
  }

  return buildProviderError('speech', failures, lastError);
}

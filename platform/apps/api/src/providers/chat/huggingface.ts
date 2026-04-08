import type { AskAfterBrief, ClarifyExercise, CoachChatTurn } from '@softskills/domain';
import { env } from '../../config/env';
import { parseModelJsonContent } from './jsonResponse';
import type { AnsweringEvaluationDraft, AnsweringQuestionDraft, ChatGenerationInput, ChatProvider } from '../types';

const endpoint = 'https://router.huggingface.co/v1/chat/completions';

function resolveHuggingFaceChatModel(model: string) {
  const compatibleDefault = String(env.HF_CHAT_MODEL || 'Qwen/Qwen3-8B').trim();
  const normalized = String(model || '').trim().toLowerCase();
  if (!normalized) {
    return compatibleDefault;
  }

  if (normalized === 'gemma3:12b' || normalized === 'gemma3' || normalized === 'qwen3:8b' || normalized === 'qwen3') {
    return compatibleDefault;
  }

  return String(model).trim();
}

async function readErrorDetails(response: Response) {
  const text = (await response.text()).trim();
  return text ? ` - ${text.slice(0, 240)}` : '';
}

async function callHf<T>(input: ChatGenerationInput): Promise<T> {
  if (!env.HF_TOKEN) {
    throw new Error('HF_TOKEN is not configured.');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.HF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: resolveHuggingFaceChatModel(env.LLM_CHAT_MODEL),
      messages: [
        { role: 'system', content: `${input.systemPrompt}\nRespond with valid JSON only.` },
        { role: 'user', content: input.prompt },
      ],
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    throw new Error(`Hugging Face chat error: ${response.status}${await readErrorDetails(response)}`);
  }

  const json = await response.json();
  const content = String(json.choices?.[0]?.message?.content ?? '{}');
  return parseModelJsonContent<T>(content);
}

export const huggingFaceChatProvider: ChatProvider = {
  kind: 'huggingface',
  generateClarify(input): Promise<ClarifyExercise> {
    return callHf<ClarifyExercise>(input);
  },
  generateAskAfter(input): Promise<AskAfterBrief> {
    return callHf<AskAfterBrief>(input);
  },
  generateAnsweringQuestion(input): Promise<AnsweringQuestionDraft> {
    return callHf<AnsweringQuestionDraft>(input);
  },
  generateAnsweringEvaluation(input): Promise<AnsweringEvaluationDraft> {
    return callHf<AnsweringEvaluationDraft>(input);
  },
  generateCoachTurn(input): Promise<CoachChatTurn> {
    return callHf<CoachChatTurn>(input);
  },
};

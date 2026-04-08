import type { AskAfterBrief, ClarifyExercise, CoachChatTurn } from '@softskills/domain';
import { env } from '../../config/env';
import type { AnsweringEvaluationDraft, AnsweringQuestionDraft, ChatGenerationInput, ChatProvider } from '../types';

async function callOpenAi<T>(input: ChatGenerationInput): Promise<T> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const response = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.LLM_CHAT_MODEL,
      messages: [
        { role: 'system', content: `${input.systemPrompt}\nRespond with valid JSON only.` },
        { role: 'user', content: input.prompt },
      ],
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI chat error: ${response.status}`);
  }

  const json = await response.json();
  const content = json.choices?.[0]?.message?.content ?? '{}';
  return JSON.parse(content) as T;
}

export const openAiChatProvider: ChatProvider = {
  kind: 'openai',
  generateClarify(input): Promise<ClarifyExercise> {
    return callOpenAi<ClarifyExercise>(input);
  },
  generateAskAfter(input): Promise<AskAfterBrief> {
    return callOpenAi<AskAfterBrief>(input);
  },
  generateAnsweringQuestion(input): Promise<AnsweringQuestionDraft> {
    return callOpenAi<AnsweringQuestionDraft>(input);
  },
  generateAnsweringEvaluation(input): Promise<AnsweringEvaluationDraft> {
    return callOpenAi<AnsweringEvaluationDraft>(input);
  },
  generateCoachTurn(input): Promise<CoachChatTurn> {
    return callOpenAi<CoachChatTurn>(input);
  },
};

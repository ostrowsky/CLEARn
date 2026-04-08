import type { AskAfterBrief, ClarifyExercise, CoachChatTurn } from '@softskills/domain';
import { env } from '../../config/env';
import { parseModelJsonContent } from './jsonResponse';
import type { AnsweringEvaluationDraft, AnsweringQuestionDraft, ChatGenerationInput, ChatProvider } from '../types';

async function readSelfHostedErrorDetails(response: Response) {
  const text = (await response.text()).trim();
  return text ? ` - ${text.slice(0, 240)}` : '';
}

async function callSelfHosted<T>(input: ChatGenerationInput): Promise<T> {
  const response = await fetch(`${env.SELF_HOSTED_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.LLM_CHAT_MODEL,
      messages: [
        { role: 'system', content: `${input.systemPrompt}\nRespond with valid JSON only.` },
        { role: 'user', content: input.prompt },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    throw new Error(`Self-hosted chat error: ${response.status}${await readSelfHostedErrorDetails(response)}`);
  }

  const json = await response.json();
  const content = String(json.choices?.[0]?.message?.content ?? '{}');
  return parseModelJsonContent<T>(content);
}

export const selfHostedChatProvider: ChatProvider = {
  kind: 'selfhosted',
  generateClarify(input): Promise<ClarifyExercise> {
    return callSelfHosted<ClarifyExercise>(input);
  },
  generateAskAfter(input): Promise<AskAfterBrief> {
    return callSelfHosted<AskAfterBrief>(input);
  },
  generateAnsweringQuestion(input): Promise<AnsweringQuestionDraft> {
    return callSelfHosted<AnsweringQuestionDraft>(input);
  },
  generateAnsweringEvaluation(input): Promise<AnsweringEvaluationDraft> {
    return callSelfHosted<AnsweringEvaluationDraft>(input);
  },
  generateCoachTurn(input): Promise<CoachChatTurn> {
    return callSelfHosted<CoachChatTurn>(input);
  },
};
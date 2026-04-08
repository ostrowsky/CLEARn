import type {
  AskAfterBrief,
  ClarifyExercise,
  CoachChatTurn,
  ProviderKind,
  SpeechToTextResult,
  TextToSpeechResult,
} from '@softskills/domain';

export type ChatGenerationInput = {
  prompt: string;
  systemPrompt: string;
  responseShape: 'clarify' | 'ask-after' | 'answering-question' | 'answering-evaluation' | 'freeform';
};

export type AnsweringQuestionDraft = {
  questionText: string;
};

export type AnsweringEvaluationDraft = {
  politenessScore: number;
  grammarScore: number;
  briefFeedback: string;
  improvedAnswer: string;
  grammarFixes: string[];
  toneFixes: string[];
};

export type ChatProvider = {
  kind: ProviderKind;
  generateClarify(input: ChatGenerationInput): Promise<ClarifyExercise>;
  generateAskAfter(input: ChatGenerationInput): Promise<AskAfterBrief>;
  generateAnsweringQuestion(input: ChatGenerationInput): Promise<AnsweringQuestionDraft>;
  generateAnsweringEvaluation(input: ChatGenerationInput): Promise<AnsweringEvaluationDraft>;
  generateCoachTurn(input: ChatGenerationInput): Promise<CoachChatTurn>;
};

export type SpeechProvider = {
  kind: ProviderKind;
  speechToText(input: { audioBase64: string; mimeType: string; language?: string }): Promise<SpeechToTextResult>;
  textToSpeech(input: { text: string; voice?: string; language?: string }): Promise<TextToSpeechResult>;
};

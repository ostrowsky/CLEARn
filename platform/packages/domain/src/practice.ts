export type ClarifyExercise = {
  prompt: string;
  expectedQuestion: string;
  target: string;
  focus: string;
  coachingTip: string;
  generatorMode: string;
  providerError?: string;
};

export type AskAfterSpeechLine = string | {
  speaker?: string;
  text?: string;
};

export type AskAfterBrief = {
  speechLines: AskAfterSpeechLine[];
  sampleQuestion: string;
  suggestedFocus?: string;
  coachingTip: string;
  generatorMode: string;
  providerError?: string;
};

export type QuestionFormationBlank = {
  id: string;
  index: number;
  answer: string;
  whWord: string;
  expectedQuestion: string;
  acceptedQuestions?: string[];
};

export type QuestionFormationExercise = {
  sentence: string;
  blanks: QuestionFormationBlank[];
  coachingTip: string;
  generatorMode: string;
  providerError?: string;
};

export type AnsweringMode = 'good' | 'difficult' | 'unnecessary' | 'irrelevant';
export type AnsweringSessionMode = AnsweringMode | 'mixed';

export type ChatMessage = {
  id: string;
  role: 'system' | 'assistant' | 'user';
  text: string;
  createdAt: string;
};

export type AnsweringReactionOption = {
  id: string;
  text: string;
  categoryType?: AnsweringMode;
};

export type AnsweringReactionCategory = {
  type: AnsweringMode;
  label: string;
  options: AnsweringReactionOption[];
};

export type AnsweringQuestionTurn = {
  turnId: string;
  index: number;
  questionType: AnsweringMode;
  questionTypeLabel: string;
  questionText: string;
  reactionOptions: AnsweringReactionOption[];
  reactionCategories: AnsweringReactionCategory[];
  preferredReactionIds: string[];
  preferredReactionText: string;
  chosenReactionId?: string;
  chosenReactionText?: string;
  answerText?: string;
  transcriptSource?: 'text' | 'speech';
  evaluation?: AnsweringTurnEvaluation;
  providerError?: string;
};

export type AnsweringTurnEvaluation = {
  reactionAccepted: boolean;
  politenessScore: number;
  grammarScore: number;
  briefFeedback: string;
  improvedAnswer: string;
  grammarFixes: string[];
  toneFixes: string[];
  providerError?: string;
};

export type AnsweringSessionSummary = {
  averagePolitenessScore: number;
  averageGrammarScore: number;
  strongestQuestionType: string;
  focusQuestionType: string;
  improvementTips: string[];
};

export type AnsweringSession = {
  sessionId: string;
  mode: AnsweringSessionMode;
  context: string;
  totalQuestions: number;
  completed: boolean;
  currentTurn: AnsweringQuestionTurn | null;
  turns: AnsweringQuestionTurn[];
  summary?: AnsweringSessionSummary;
};

export type CoachChatCapabilities = {
  text: boolean;
  speechToText: boolean;
  textToSpeech: boolean;
};

export type CoachChatTurn = {
  reply: string;
  feedback: string;
  suggestions: string[];
  providerError?: string;
};

export type CoachChatSession = {
  sessionId: string;
  context: string;
  goal: string;
  scenario: string;
  completed: boolean;
  messages: ChatMessage[];
  feedback: string;
  suggestions: string[];
  capabilities: CoachChatCapabilities;
  messageLimit: number;
  transcriptMode: 'text';
  providerError?: string;
};


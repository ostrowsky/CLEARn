import type {
  AnsweringSession,
  AnsweringSessionMode,
  AppContent,
  AskAfterBrief,
  ClarifyExercise,
  CoachChatSession,
  QuestionFormationExercise,
  SpeechToTextResult,
  TextToSpeechResult,
} from '@softskills/domain';

export type SaveContentRequest = {
  content: AppContent;
};

export type GenerateClarifyRequest = {
  context: string;
  offset?: number;
};

export type CheckClarifyRequest = {
  userQuestion: string;
  expectedQuestion: string;
  target?: string;
  focus?: string;
  acceptedAnswers?: string[];
};

export type AskAfterRequest = {
  context: string;
  offset?: number;
};

export type CheckAskAfterRequest = {
  question: string;
};

export type QuestionFormationRequest = {
  context?: string;
  offset?: number;
};

export type CheckQuestionFormationRequest = {
  userQuestion: string;
  sentence: string;
  answer: string;
  whWord: string;
  expectedQuestion: string;
  acceptedQuestions?: string[];
};

export type StartAnsweringSessionRequest = {
  context: string;
  mode: AnsweringSessionMode;
};

export type ContinueAnsweringSessionRequest = {
  sessionId: string;
  reactionOptionId?: string;
  userReply: string;
  transcriptSource?: 'text' | 'speech';
};

export type StartCoachChatSessionRequest = {
  context: string;
  goal: string;
  scenario?: string;
};

export type ContinueCoachChatSessionRequest = {
  sessionId: string;
  userReply: string;
};

export type UploadMediaRequest = {
  fileName: string;
  base64: string;
};

export type DeleteMediaRequest = {
  url: string;
};

export type SpeechToTextRequest = {
  audioBase64: string;
  mimeType: string;
  language?: string;
};

export type TextToSpeechRequest = {
  text: string;
  voice?: string;
  language?: string;
};

export type ApiContract = {
  getContent(): Promise<AppContent>;
  saveContent(input: SaveContentRequest): Promise<AppContent>;
  generateClarify(input: GenerateClarifyRequest): Promise<ClarifyExercise>;
  checkClarify(input: CheckClarifyRequest): Promise<{ accepted: boolean; feedback: string }>;
  askAfter(input: AskAfterRequest): Promise<AskAfterBrief>;
  checkAskAfter(input: CheckAskAfterRequest): Promise<{ accepted: boolean; feedback: string }>;
  generateQuestionFormation(input: QuestionFormationRequest): Promise<QuestionFormationExercise>;
  checkQuestionFormation(input: CheckQuestionFormationRequest): Promise<{ accepted: boolean; feedback: string }>;
  startAnswering(input: StartAnsweringSessionRequest): Promise<AnsweringSession>;
  continueAnswering(input: ContinueAnsweringSessionRequest): Promise<AnsweringSession>;
  startCoachChat(input: StartCoachChatSessionRequest): Promise<CoachChatSession>;
  continueCoachChat(input: ContinueCoachChatSessionRequest): Promise<CoachChatSession>;
  uploadMedia(input: UploadMediaRequest): Promise<{ url: string; fileName: string; size: number }>;
  deleteMedia(input: DeleteMediaRequest): Promise<{ deleted: boolean; url: string }>;
  speechToText(input: SpeechToTextRequest): Promise<SpeechToTextResult>;
  textToSpeech(input: TextToSpeechRequest): Promise<TextToSpeechResult>;
};

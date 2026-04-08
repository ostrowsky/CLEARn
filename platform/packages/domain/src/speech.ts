export type SpeechToTextResult = {
  text: string;
  provider: string;
  model: string;
};

export type TextToSpeechResult = {
  audioUrl: string;
  provider: string;
  model: string;
};

export type ProviderKind = 'huggingface' | 'openai' | 'selfhosted';

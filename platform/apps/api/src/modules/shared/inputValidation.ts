// Compatibility entry point; browser and API share these pure validators.
export {
  normalizeWhitespace,
  normalizeLooseText,
  tokenizeLooseText,
  getTokenOverlapRatio,
  looksMeaningfulUserInput,
  startsWithWhWord,
  containsAnswerLeak,
  toQuestionFormationVerbBase,
  hasQuestionFormationGrammar,
  hasQuestionFormationPronounReference,
  hasQuestionFormationDidVerbReference,
  hasQuestionFormationVisibleContextAlignment,
} from '@clearn/domain';

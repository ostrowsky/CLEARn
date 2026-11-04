// Native/server-safe no-op. Metro selects analytics.web.ts for web.
export type ExerciseType = 'clarification' | 'ask_after_talk' | 'question_formation';
export type ExerciseEvent = 'exercise_start' | 'answer_check' | 'hint_view';
export type AnalyticsConsent = 'granted' | 'denied' | null;
export const MEASUREMENT_ID = 'G-5EJ2691BS9';
export const CONSENT_KEY = 'clearn.analytics.consent.v1';
export function analyticsAvailable() { return false; }
export function getAnalyticsConsent(): AnalyticsConsent { return null; }
export function setAnalyticsConsent(_consent: Exclude<AnalyticsConsent, null>) {}
export function setAnalyticsPage(_pathname: string) {}
export function trackExerciseEvent(_event: ExerciseEvent, _type: ExerciseType, _correct?: boolean) {}
export function restoreAnalyticsConsent(): AnalyticsConsent { return null; }

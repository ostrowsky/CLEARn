import { isAppContent } from './staticContent';
type Value = Record<string, any>;
const record = (v: unknown): v is Value => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string');
const fields = (v: Value, keys: string[]) => keys.every(k => typeof v[k] === 'string');
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
function turn(v: unknown): boolean {
 return record(v) && fields(v,['turnId','questionType','questionTypeLabel','questionText','preferredReactionText']) && number(v.index) && strings(v.preferredReactionIds) &&
 Array.isArray(v.reactionOptions) && v.reactionOptions.every((x: unknown) => record(x) && fields(x,['id','text'])) &&
 Array.isArray(v.reactionCategories) && v.reactionCategories.every((x: unknown) => record(x) && fields(x,['type','label']) && Array.isArray(x.options) && x.options.every((y: unknown) => record(y) && fields(y,['id','text']))) &&
 (!v.evaluation || (record(v.evaluation) && fields(v.evaluation,['briefFeedback','improvedAnswer']) && strings(v.evaluation.grammarFixes) && strings(v.evaluation.toneFixes)));
}
export function validApiResponse(path: string, v: unknown): boolean {
 if (!record(v)) return false;
 path=path.split('?')[0];
 if (path==='/api/content'||path==='/api/admin/content') return isAppContent(v) && v.sections.every(s=>record(s)&&typeof s.id==='string'&&Array.isArray(s.blocks));
 if (path==='/api/debug/logs') return Array.isArray(v.entries);
 if (path==='/api/admin/auth/logout') return v.loggedOut===true;
 if (path.startsWith('/api/admin/auth/')) return typeof v.configured==='boolean'&&typeof v.authenticated==='boolean'&&(path.endsWith('/status')||(v.configured===true&&v.authenticated===true));
 if (path==='/api/admin/media/upload') return fields(v,['url','fileName'])&&number(v.size);
 if (path==='/api/admin/media/delete') return typeof v.deleted==='boolean'&&typeof v.url==='string';
 if (/^\/api\/admin\/backup\/(?:media\/)?import$/.test(path)) return v.restored===true&&typeof v.restartRequired==='boolean'&&typeof v.restoredAt==='string'&&number(v.fileCount);
 if (path==='/api/media/youtube-transcript-segment') return typeof v.available==='boolean'&&fields(v,['source','text'])&&number(v.start)&&number(v.end);
 if (path==='/api/practice/clarify') return fields(v,['prompt','expectedQuestion','target','focus','coachingTip','generatorMode']);
 if (path==='/api/practice/after-talk') return fields(v,['sampleQuestion','coachingTip','generatorMode'])&&Array.isArray(v.speechLines)&&v.speechLines.length>0&&v.speechLines.every((x: unknown)=>typeof x==='string'||(record(x)&&typeof x.text==='string'));
 if (path==='/api/practice/question-formation') return fields(v,['sentence','coachingTip','generatorMode'])&&Array.isArray(v.blanks)&&v.blanks.length===3&&v.blanks.every((x: unknown)=>record(x)&&fields(x,['id','answer','whWord','expectedQuestion'])&&number(x.index));
 if (path.startsWith('/api/answering/session/')) return fields(v,['sessionId','mode','context'])&&number(v.totalQuestions)&&typeof v.completed==='boolean'&&Array.isArray(v.turns)&&v.turns.every(turn)&&(v.currentTurn===null?v.completed:turn(v.currentTurn))&&(!v.summary||(record(v.summary)&&strings(v.summary.improvementTips)));
 if (path.startsWith('/api/coach/session/')) return fields(v,['sessionId','context','goal','scenario','feedback'])&&typeof v.completed==='boolean'&&number(v.messageLimit)&&strings(v.suggestions)&&record(v.capabilities)&&['text','speechToText','textToSpeech'].every(k=>typeof v.capabilities[k]==='boolean')&&Array.isArray(v.messages)&&v.messages.every((x: unknown)=>record(x)&&fields(x,['id','role','text','createdAt']));
 if (path==='/api/speech/stt') return fields(v,['text','provider','model']);
 if (path==='/api/speech/tts') return fields(v,['audioUrl','provider','model'])&&/^(data:audio\/|https?:\/\/)/.test(v.audioUrl);
 return false;
}

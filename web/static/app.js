const app = document.getElementById('app');

const state = {
  content: null,
  loading: true,
  error: '',
  clarify: {
    context: '',
    offset: 0,
    exercise: null,
    feedback: null,
    reveal: false,
    loading: false,
    error: '',
  },
  askAfter: {
    context: '',
    offset: 0,
    brief: null,
    feedback: null,
    opener: '',
    followUp: '',
    tail: '',
    loading: false,
    error: '',
  },
  withoutContext: {
    offset: 0,
    exercise: null,
    feedback: null,
    reveal: false,
    loading: false,
    error: '',
  },
  answering: {
    good: { context: '', session: null, loading: false, error: '' },
    difficult: { context: '', session: null, loading: false, error: '' },
    unnecessary: { context: '', session: null, loading: false, error: '' },
    irrelevant: { context: '', session: null, loading: false, error: '' },
  },
  ui: {
    accordions: {},
  },
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function asRecord(value) {
  return value && typeof value === 'object' ? value : {};
}

function getUi() {
  return asRecord(asRecord(state.content).meta).ui || {};
}

function getPractice() {
  return asRecord(asRecord(state.content).meta).practice || {};
}

function getRuntime() {
  return asRecord(asRecord(state.content).meta).runtime || {};
}

function getRuntimeDefaults() {
  return asRecord(getRuntime().defaults);
}

function getRuntimeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function getRuntimeNumber(value, fallback) {
  return typeof value === 'number' ? value : fallback;
}

function getSectionViewConfig(section) {
  const defaults = getRuntimeDefaults();
  const sectionViews = asRecord(getRuntime().sectionViews);
  const config = asRecord(sectionViews[section?.type]);

  return {
    view: typeof config.view === 'string' ? config.view : (typeof defaults.sectionView === 'string' ? defaults.sectionView : 'practice'),
    cardLayout: typeof config.cardLayout === 'string' ? config.cardLayout : (typeof defaults.cardLayout === 'string' ? defaults.cardLayout : 'route-grid'),
    primaryCardStrategy: typeof config.primaryCardStrategy === 'string' ? config.primaryCardStrategy : (typeof defaults.primaryCardStrategy === 'string' ? defaults.primaryCardStrategy : 'none'),
    collapsible: getRuntimeBoolean(config.collapsible, getRuntimeBoolean(defaults.collapsible, true)),
    featuredBlockCount: getRuntimeNumber(config.featuredBlockCount, getRuntimeNumber(defaults.featuredBlockCount, 0)),
  };
}

function getBlockRenderer(kind) {
  const runtime = getRuntime();
  const defaults = getRuntimeDefaults();
  const mapped = asRecord(runtime.blockRenderers)[kind];
  if (typeof mapped === 'string' && mapped) {
    return mapped;
  }
  return typeof defaults.blockRenderer === 'string' ? defaults.blockRenderer : 'generic';
}

function getBlocksByRenderer(section, renderer) {
  return (section?.blocks || []).filter((block) => getBlockRenderer(block.kind) === renderer);
}

function getFirstBlockByRenderer(section, renderer) {
  return getBlocksByRenderer(section, renderer)[0] || null;
}

function getPracticeScreenConfig(key) {
  return asRecord(asRecord(getRuntime().practiceScreens)[key]);
}

function getBlockGroupConfig(key) {
  return asRecord(asRecord(getRuntime().blockGroups)[key]);
}

function getNestedString(source, path, fallback = '') {
  let current = source;
  for (const segment of path) {
    current = asRecord(current)[segment];
  }

  return typeof current === 'string' ? current : fallback;
}

function formatTemplate(template, values = {}) {
  return String(template || '').replace(/\{([^}]+)\}/g, (_match, key) => values[key] ?? '');
}

function getRoute() {
  const raw = window.location.hash.replace(/^#/, '').trim();
  return raw || '/';
}

function getSections() {
  return state.content?.sections || [];
}

function findSectionByRoute(route) {
  return getSections().find((section) => section.route === route) || null;
}

function getParentSection(section) {
  if (!section || !section.route || section.route === '/') {
    return null;
  }

  const parts = section.route.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return findSectionByRoute('/');
  }

  return findSectionByRoute(`/${parts.slice(0, -1).join('/')}`);
}

function getBlocksByKind(section, kind) {
  return (section?.blocks || []).filter((block) => block.kind === kind);
}

function getFirstBlockByKind(section, kind) {
  return (section?.blocks || []).find((block) => block.kind === kind) || null;
}

function getMaterialBodies(block) {
  return (block?.materials || []).map((material) => material.body).filter(Boolean);
}

function syncDocumentTitle(section) {
  document.title = section?.title || asRecord(state.content).meta?.appTitle || '';
}

function ensureAskAfterDefaults() {
  const group = getBlockGroupConfig('askAfter');
  const section = findSectionByRoute(typeof group.sectionRoute === 'string' ? group.sectionRoute : '');
  const contextBlocks = getBlocksByRenderer(section, typeof group.contextRenderer === 'string' ? group.contextRenderer : 'generic');
  const followUpBlocks = getBlocksByRenderer(section, typeof group.followUpRenderer === 'string' ? group.followUpRenderer : 'generic');
  const contextIndex = getRuntimeNumber(group.contextIndex, 0);
  const followUpIndex = getRuntimeNumber(group.followUpIndex, 1);
  const contextPhrases = getMaterialBodies(contextBlocks[contextIndex]);
  const followUpPhrases = getMaterialBodies(followUpBlocks[followUpIndex]);

  if (!state.askAfter.opener) {
    state.askAfter.opener = contextPhrases[0] || '';
  }
  if (!state.askAfter.followUp) {
    state.askAfter.followUp = followUpPhrases[0] || '';
  }
}

async function loadContent() {
  state.loading = true;
  state.error = '';
  render();

  try {
    const response = await fetch('/api/content');
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || String(response.status));
    }

    state.content = data;
    ensureAskAfterDefaults();
    syncDocumentTitle(findSectionByRoute(getRoute()));
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function apiPost(path, payload = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || String(response.status));
  }

  return data;
}

function appChrome(content) {
  const ui = getUi();
  return `
    <main class="app-shell">
      <div class="brand-row">
        <a class="brand-mark" href="#/">
          <span class="brand-dot"></span>
          <span>${escapeHtml(asRecord(state.content).meta?.appTitle || '')}</span>
        </a>
        <span class="back-link">${escapeHtml(getNestedString(ui, ['brandTagline']))}</span>
      </div>
      ${content}
      <div class="footer-note">${escapeHtml(getNestedString(ui, ['footerNote']))}</div>
    </main>
  `;
}

function backLink(route, label) {
  if (!route || !label) {
    return '';
  }

  return `<a class="back-link" href="#${route}">${escapeHtml(label)}</a>`;
}

function renderStatusBox(feedback, accepted = false) {
  if (!feedback) {
    return '';
  }

  return `
    <div class="status-box ${accepted ? 'status-box--success' : 'status-box--warning'}">
      ${escapeHtml(feedback)}
    </div>
  `;
}

function renderLoading() {
  app.innerHTML = appChrome('');
}

function renderError() {
  app.innerHTML = appChrome(`<section class="hero-card">${renderStatusBox(state.error, false)}</section>`);
}

function renderTextMaterials(block) {
  const textMaterials = (block.materials || []).filter((material) => material.type === 'text');
  if (!textMaterials.length) {
    return '';
  }

  return `
    <ul class="helper-list">
      ${textMaterials
        .map((material) => `<li>${material.title ? `<strong>${escapeHtml(material.title)}:</strong> ` : ''}${escapeHtml(material.body)}</li>`)
        .join('')}
    </ul>
  `;
}

function renderMediaMaterial(material) {
  const ui = getUi();
  const placeholderText = material.body || getNestedString(ui, ['feedback', 'noFileUploaded']) || getNestedString(ui, ['placeholders', 'videoPlaceholder']);

  if (material.type === 'image' && material.url) {
    return `<div class="preview-box"><img class="media-preview" src="${escapeHtml(material.url)}" alt="${escapeHtml(material.alt || material.title || '')}"></div>`;
  }

  if (material.type === 'video' && material.url) {
    return `<div class="preview-box"><video class="media-preview" src="${escapeHtml(material.url)}" controls></video></div>`;
  }

  if (material.type === 'audio' && material.url) {
    return `<div class="preview-box"><audio class="media-preview" src="${escapeHtml(material.url)}" controls></audio></div>`;
  }

  return `
    <div class="video-placeholder">
      <div>
        <strong>${escapeHtml(material.title || '')}</strong>
        <div>${escapeHtml(placeholderText)}</div>
      </div>
    </div>
  `;
}

function renderGenericBlockContent(block) {
  const mediaMaterials = (block.materials || []).filter((material) => material.type !== 'text');
  return `
    ${renderTextMaterials(block)}
    ${mediaMaterials.map((material) => renderMediaMaterial(material)).join('')}
  `;
}

function isAccordionOpen(id) {
  return Boolean(state.ui.accordions[id]);
}

function renderAccordionPanel({ id, title, description, body }) {
  const open = isAccordionOpen(id);

  return `
    <section class="panel accordion ${open ? 'accordion--open' : ''}">
      <button class="accordion-toggle" type="button" data-action="accordion-toggle" data-accordion-id="${escapeHtml(id)}" aria-expanded="${open}">
        <div class="accordion-copy">
          <h2>${escapeHtml(title)}</h2>
          ${description ? `<p>${escapeHtml(description)}</p>` : ''}
        </div>
        <span class="accordion-icon" aria-hidden="true">${open ? '-' : '+'}</span>
      </button>
      <div class="accordion-body" ${open ? '' : 'hidden'}>
        ${body}
      </div>
    </section>
  `;
}

function composeAskAfterQuestion() {
  const focus = (state.askAfter.tail || '').trim();
  const left = (state.askAfter.opener || '').replace('...', focus);
  const right = (state.askAfter.followUp || '').replace('...', focus);
  return `${left} ${right}`.replace(/\s+/g, ' ').trim();
}

function renderClarifyExercise() {
  const ui = getUi();
  const labels = asRecord(ui.labels);
  const buttons = asRecord(ui.buttons);
  const placeholders = asRecord(ui.placeholders);
  const model = state.clarify.exercise;

  if (!model) {
    return `<div class="empty-state">${escapeHtml(getNestedString(ui, ['feedback', 'clarifyEmpty']))}</div>`;
  }

  return `
    <div class="exercise-box">
      <div class="chip-row">
        <span class="chip">${escapeHtml(labels.generator || '')}: ${escapeHtml(model.generatorMode)}</span>
        <span class="chip">${escapeHtml(labels.targetDetail || '')}: ${escapeHtml(model.target)}</span>
      </div>
      <p class="exercise-prompt">${escapeHtml(model.prompt)}</p>
      <p>${escapeHtml(model.coachingTip)}</p>
      <form id="clarify-answer-form" class="form-stack">
        <div>
          <label class="field-label" for="clarify-answer">${escapeHtml(labels.yourClarifyingQuestion || '')}</label>
          <input id="clarify-answer" class="text-input" name="userQuestion" placeholder="${escapeHtml(placeholders.clarifyAnswer || '')}" />
        </div>
        <div class="inline-actions">
          <button class="primary-button" type="submit">${escapeHtml(buttons.checkQuestion || '')}</button>
          <button class="ghost-button" type="button" data-action="clarify-reveal">${escapeHtml(buttons.showExpectedAnswer || '')}</button>
          <button class="secondary-button" type="button" data-action="clarify-next">${escapeHtml(buttons.tryAnotherPrompt || '')}</button>
        </div>
      </form>
      ${state.clarify.reveal ? `<div class="preview-box"><strong>${escapeHtml(labels.expectedAnswer || '')}:</strong> ${escapeHtml(model.expectedQuestion)}</div>` : ''}
      ${renderStatusBox(state.clarify.feedback && state.clarify.feedback.feedback, state.clarify.feedback && state.clarify.feedback.accepted)}
    </div>
  `;
}

function renderAskAfterPractice(block, section) {
  const ui = getUi();
  const labels = asRecord(ui.labels);
  const buttons = asRecord(ui.buttons);
  const placeholders = asRecord(ui.placeholders);
  const feedback = asRecord(ui.feedback);
  const contextBlocks = getBlocksByKind(section, 'panel');
  const contextOptions = getMaterialBodies(contextBlocks[0]);
  const followUpOptions = getMaterialBodies(contextBlocks[1]);
  const questionPreview = composeAskAfterQuestion();

  if (!state.askAfter.brief) {
    return `
      <form id="ask-after-form" class="form-stack">
        <div>
          <label class="field-label" for="ask-after-context">${escapeHtml(labels.yourWorkContext || '')}</label>
          <textarea id="ask-after-context" class="text-area" name="context" placeholder="${escapeHtml(placeholders.askAfterContext || '')}">${escapeHtml(state.askAfter.context)}</textarea>
        </div>
        <div class="inline-actions">
          <button class="primary-button" type="submit">${escapeHtml(state.askAfter.loading ? buttons.generating || '' : buttons.generateShortTalk || '')}</button>
        </div>
      </form>
      ${state.askAfter.error ? renderStatusBox(state.askAfter.error, false) : ''}
      <div class="empty-state">${escapeHtml(feedback.askAfterEmpty || '')}</div>
    `;
  }

  return `
    <form id="ask-after-form" class="form-stack">
      <div>
        <label class="field-label" for="ask-after-context">${escapeHtml(labels.yourWorkContext || '')}</label>
        <textarea id="ask-after-context" class="text-area" name="context" placeholder="${escapeHtml(placeholders.askAfterContext || '')}">${escapeHtml(state.askAfter.context)}</textarea>
      </div>
      <div class="inline-actions">
        <button class="primary-button" type="submit">${escapeHtml(state.askAfter.loading ? buttons.generating || '' : buttons.generateShortTalk || '')}</button>
      </div>
    </form>
    ${state.askAfter.error ? renderStatusBox(state.askAfter.error, false) : ''}
    <div class="split-grid">
      <section class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">${escapeHtml(feedback.generatedTalkEyebrow || '')}</p>
            <h2>${escapeHtml(feedback.generatedTalkTitle || '')}</h2>
          </div>
          <span class="chip">${escapeHtml(state.askAfter.brief.generatorMode)}</span>
        </div>
        <ul class="speech-list">
          ${state.askAfter.brief.speechLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
        </ul>
        <div class="hint-box">
          <strong>${escapeHtml(labels.coachingTip || '')}:</strong> ${escapeHtml(state.askAfter.brief.coachingTip)}
        </div>
      </section>
      <section class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">${escapeHtml(feedback.questionBuilderEyebrow || '')}</p>
            <h2>${escapeHtml(feedback.questionBuilderTitle || '')}</h2>
          </div>
        </div>
        <div class="builder-grid" id="ask-after-builder">
          <div>
            <label class="field-label" for="ask-after-opener">${escapeHtml(labels.contextLeadIn || '')}</label>
            <select id="ask-after-opener" class="select-input" name="opener">
              ${contextOptions.map((item) => `<option value="${escapeHtml(item)}" ${item === state.askAfter.opener ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="field-label" for="ask-after-follow-up">${escapeHtml(labels.followUpRequest || '')}</label>
            <select id="ask-after-follow-up" class="select-input" name="followUp">
              ${followUpOptions.map((item) => `<option value="${escapeHtml(item)}" ${item === state.askAfter.followUp ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="field-label" for="ask-after-tail">${escapeHtml(labels.topicToFocusOn || '')}</label>
            <input id="ask-after-tail" class="text-input" name="tail" value="${escapeHtml(state.askAfter.tail)}" placeholder="${escapeHtml(placeholders.askAfterTail || '')}" />
          </div>
        </div>
        <div class="preview-box">
          <div class="mini-label">${escapeHtml(feedback.questionPreviewLabel || '')}</div>
          <div id="ask-after-preview">${escapeHtml(questionPreview)}</div>
        </div>
        <form id="ask-after-review-form" class="form-stack">
          <div class="inline-actions">
            <button class="primary-button" type="submit">${escapeHtml(buttons.reviewQuestion || '')}</button>
            <button class="secondary-button" type="button" data-action="ask-after-refresh">${escapeHtml(buttons.generateAnotherTalk || '')}</button>
          </div>
        </form>
        ${renderStatusBox(state.askAfter.feedback && state.askAfter.feedback.feedback, state.askAfter.feedback && state.askAfter.feedback.accepted)}
      </section>
    </div>
  `;
}

function renderWithoutContextPractice(block) {
  const ui = getUi();
  const labels = asRecord(ui.labels);
  const buttons = asRecord(ui.buttons);
  const placeholders = asRecord(ui.placeholders);
  const feedback = asRecord(ui.feedback);
  const exercise = state.withoutContext.exercise;

  return `
    <div class="inline-actions">
      <button class="primary-button" type="button" data-action="without-context-generate">${escapeHtml(
        state.withoutContext.loading
          ? buttons.generating || ''
          : exercise
            ? buttons.nextStandalonePrompt || ''
            : buttons.generateStandalonePrompt || ''
      )}</button>
    </div>
    ${state.withoutContext.error ? renderStatusBox(state.withoutContext.error, false) : ''}
    ${exercise ? `
      <div class="exercise-box">
        <div class="chip-row">
          <span class="chip">${escapeHtml(labels.targetDetail || '')}: ${escapeHtml(exercise.target)}</span>
          <span class="chip">${escapeHtml(exercise.generatorMode)}</span>
        </div>
        <p class="exercise-prompt">${escapeHtml(exercise.prompt)}</p>
        <p>${escapeHtml(exercise.coachingTip)}</p>
        <form id="without-context-form" class="form-stack">
          <div>
            <label class="field-label" for="without-context-answer">${escapeHtml(labels.yourQuestion || '')}</label>
            <input id="without-context-answer" class="text-input" name="userQuestion" placeholder="${escapeHtml(placeholders.withoutContextAnswer || '')}" />
          </div>
          <div class="inline-actions">
            <button class="primary-button" type="submit">${escapeHtml(buttons.checkQuestion || '')}</button>
            <button class="ghost-button" type="button" data-action="without-context-reveal">${escapeHtml(buttons.showExpectedAnswer || '')}</button>
          </div>
        </form>
        ${state.withoutContext.reveal ? `<div class="preview-box"><strong>${escapeHtml(labels.expectedAnswer || '')}:</strong> ${escapeHtml(exercise.expectedQuestion)}</div>` : ''}
        ${renderStatusBox(state.withoutContext.feedback && state.withoutContext.feedback.feedback, state.withoutContext.feedback && state.withoutContext.feedback.accepted)}
      </div>
    ` : `<div class="empty-state">${escapeHtml(feedback.withoutContextEmpty || '')}</div>`}
  `;
}

function renderAnsweringChat(mode) {
  const ui = getUi();
  const labels = asRecord(ui.labels);
  const buttons = asRecord(ui.buttons);
  const feedback = asRecord(ui.feedback);
  const model = state.answering[mode];
  const session = model.session;

  if (!session) {
    return `
      <form id="answering-start-form" class="form-stack" data-mode="${escapeHtml(mode)}">
        <div>
          <label class="field-label" for="answering-context-${escapeHtml(mode)}">${escapeHtml(labels.describeYourRole || '')}</label>
          <textarea id="answering-context-${escapeHtml(mode)}" class="text-area" name="context" placeholder="${escapeHtml(getNestedString(ui, ['placeholders', 'answeringContext']))}">${escapeHtml(model.context)}</textarea>
        </div>
        <div class="inline-actions">
          <button class="primary-button" type="submit">${escapeHtml(model.loading ? buttons.generating || '' : buttons.startDialogue || '')}</button>
        </div>
      </form>
      ${model.error ? renderStatusBox(model.error, false) : ''}
    `;
  }

  return `
    <div class="mode-box">
      <div class="chip-row">
        <span class="chip">${escapeHtml(labels.conversationLines || '')}: ${escapeHtml(`${session.messages.length}/${session.messageLimit || 5}`)}</span>
        <span class="chip">${escapeHtml(labels.maxFiveLines || '')}</span>
      </div>
      <ul class="chat-list">
        ${session.messages.map((message) => `<li class="chat-bubble chat-bubble--${escapeHtml(message.role)}">${escapeHtml(message.text)}</li>`).join('')}
      </ul>
      <div class="hint-box">
        <strong>${escapeHtml(labels.coachingTip || '')}:</strong> ${escapeHtml(session.coachingTip || '')}
      </div>
      ${session.completed ? `
        <div class="status-box status-box--success">
          ${escapeHtml(feedback.practiceComplete || '')}
        </div>
        <div class="inline-actions">
          <button class="secondary-button" type="button" data-action="answering-reset" data-mode="${escapeHtml(mode)}">${escapeHtml(buttons.startOver || '')}</button>
        </div>
      ` : `
        <form id="answering-reply-form" class="form-stack" data-mode="${escapeHtml(mode)}">
          <div>
            <label class="field-label" for="answering-reply-${escapeHtml(mode)}">${escapeHtml(labels.yourAnswer || '')}</label>
            <textarea id="answering-reply-${escapeHtml(mode)}" class="text-area" name="userReply" placeholder="${escapeHtml(getNestedString(ui, ['placeholders', 'answeringReply']))}"></textarea>
          </div>
          <div class="inline-actions">
            <button class="primary-button" type="submit">${escapeHtml(buttons.sendAnswer || '')}</button>
          </div>
        </form>
      `}
      ${model.error ? renderStatusBox(model.error, false) : ''}
    </div>
  `;
}

function renderPracticeSection(section) {
  const parent = getParentSection(section);
  const practiceMode = section.route.split('/').filter(Boolean).pop();
  const blocks = section.blocks || [];

  const blockMarkup = blocks
    .map((block) => {
      const renderer = getBlockRenderer(block.kind);
      let body = '';
      if (renderer === 'practice-clarify') {
        body = `
          <form id="clarify-context-form" class="form-stack">
            <div>
              <label class="field-label" for="clarify-context">${escapeHtml(getNestedString(getUi(), ["labels", "yourWorkContext"]))}</label>
              <textarea id="clarify-context" class="text-area" name="context" placeholder="${escapeHtml(getNestedString(getUi(), ["placeholders", "clarifyContext"]))}">${escapeHtml(state.clarify.context)}</textarea>
            </div>
            <div class="inline-actions">
              <button class="primary-button" type="submit">${escapeHtml(state.clarify.loading ? getNestedString(getUi(), ["buttons", "generating"]) : getNestedString(getUi(), ["buttons", "generatePracticePrompt"]))}</button>
            </div>
          </form>
          ${state.clarify.error ? renderStatusBox(state.clarify.error, false) : ""}
          ${renderClarifyExercise()}
        `;
      } else if (renderer === 'practice-ask-after') {
        body = renderAskAfterPractice(block, section);
      } else if (renderer === 'practice-without-context') {
        body = renderWithoutContextPractice(block);
      } else if (renderer === 'practice-answering') {
        body = renderAnsweringChat(practiceMode);
      } else {
        body = renderGenericBlockContent(block);
      }

      return renderAccordionPanel({
        id: block.id,
        title: block.title,
        description: block.description,
        body,
      });
    })
    .join('');

  return appChrome(`
    ${backLink(parent?.route || '/', parent?.title || getNestedString(getUi(), ['navigation', 'backToHome']))}
    <section class="hero-card">
      ${section.eyebrow ? `<p class="eyebrow">${escapeHtml(section.eyebrow)}</p>` : ""}
      <h1>${escapeHtml(section.title)}</h1>
      ${section.summary ? `<p class="lede">${escapeHtml(section.summary)}</p>` : ""}
    </section>
    <section class="form-stack">${blockMarkup}</section>
  `);
}

function renderHubSection(section) {
  const parent = getParentSection(section);
  const viewConfig = getSectionViewConfig(section);
  const cardClass = viewConfig.cardLayout === 'hero-actions' ? 'hero-actions' : 'route-grid';
  const primaryCardStrategy = viewConfig.primaryCardStrategy;

  return appChrome(`
    ${parent ? backLink(parent.route, parent.title || '') : ''}
    <section class="hero-card">
      ${section.eyebrow ? `<p class="eyebrow">${escapeHtml(section.eyebrow)}</p>` : ""}
      <h1>${escapeHtml(section.title)}</h1>
      ${section.summary ? `<p class="lede">${escapeHtml(section.summary)}</p>` : ""}
    </section>
    <section class="${cardClass}">
      ${(section.blocks || []).map((block, index) => `
        <a class="route-card ${primaryCardStrategy === "first" && index === 0 ? "route-card--primary" : ""}" href="#${escapeHtml(block.route || "")}">
          <strong>${escapeHtml(block.title)}</strong>
          <span>${escapeHtml(block.description)}</span>
        </a>
      `).join('')}
    </section>
  `);
}

function renderSection(section) {
  if (!section) {
    app.innerHTML = appChrome(renderStatusBox(state.error, false));
    return;
  }

  syncDocumentTitle(section);

  if (getSectionViewConfig(section).view === 'hub') {
    app.innerHTML = renderHubSection(section);
    return;
  }

  app.innerHTML = renderPracticeSection(section);
}

async function generateClarify(offset = state.clarify.offset) {
  state.clarify.loading = true;
  state.clarify.error = '';
  state.clarify.feedback = null;
  render();

  try {
    state.clarify.exercise = await apiPost('/api/asking/clarify', {
      context: state.clarify.context,
      offset,
    });
    state.clarify.offset = offset;
    state.clarify.reveal = false;
  } catch (error) {
    state.clarify.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.clarify.loading = false;
    render();
  }
}

async function generateAskAfter(offset = state.askAfter.offset) {
  state.askAfter.loading = true;
  state.askAfter.error = '';
  state.askAfter.feedback = null;
  render();

  try {
    state.askAfter.brief = await apiPost('/api/asking/after-talk', {
      context: state.askAfter.context,
      offset,
    });
    state.askAfter.offset = offset;
  } catch (error) {
    state.askAfter.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.askAfter.loading = false;
    render();
  }
}

async function generateWithoutContext(offset = state.withoutContext.offset) {
  state.withoutContext.loading = true;
  state.withoutContext.error = '';
  state.withoutContext.feedback = null;
  render();

  try {
    state.withoutContext.exercise = await apiPost('/api/asking/without-context', { offset });
    state.withoutContext.offset = offset;
    state.withoutContext.reveal = false;
  } catch (error) {
    state.withoutContext.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.withoutContext.loading = false;
    render();
  }
}

async function startAnswering(mode) {
  const model = state.answering[mode];
  model.loading = true;
  model.error = '';
  render();

  try {
    model.session = await apiPost('/api/answering/session/start', {
      mode,
      context: model.context,
    });
  } catch (error) {
    model.error = error instanceof Error ? error.message : String(error);
  } finally {
    model.loading = false;
    render();
  }
}

async function sendAnsweringReply(mode, userReply) {
  const model = state.answering[mode];
  model.error = '';

  try {
    model.session = await apiPost('/api/answering/session/respond', {
      sessionId: model.session.sessionId,
      userReply,
    });
  } catch (error) {
    model.error = error instanceof Error ? error.message : String(error);
  } finally {
    render();
  }
}

function render() {
  if (state.loading) {
    renderLoading();
    return;
  }

  if (state.error && !state.content) {
    renderError();
    return;
  }

  const route = getRoute();
  const section = findSectionByRoute(route) || findSectionByRoute('/');
  renderSection(section);
}

document.addEventListener('submit', async (event) => {
  const form = event.target;
  event.preventDefault();

  if (form.id === 'clarify-context-form') {
    state.clarify.context = form.context.value.trim();
    const clarifyConfig = getPracticeScreenConfig('clarify');
    const clarifySection = findSectionByRoute(typeof clarifyConfig.sectionRoute === 'string' ? clarifyConfig.sectionRoute : '');
    const clarifyBlock = getFirstBlockByRenderer(clarifySection, typeof clarifyConfig.blockRenderer === 'string' ? clarifyConfig.blockRenderer : '');
    if (clarifyBlock) { state.ui.accordions[clarifyBlock.id] = true; }
    await generateClarify(0);
    return;
  }

  if (form.id === 'clarify-answer-form' && state.clarify.exercise) {
    state.clarify.feedback = await apiPost('/api/asking/clarify/check', {
      userQuestion: form.userQuestion.value.trim(),
      expectedQuestion: state.clarify.exercise.expectedQuestion,
      target: state.clarify.exercise.target,
      focus: state.clarify.exercise.focus,
    });
    render();
    return;
  }

  if (form.id === 'ask-after-form') {
    state.askAfter.context = form.context.value.trim();
    await generateAskAfter(0);
    return;
  }

  if (form.id === 'ask-after-review-form') {
    state.askAfter.feedback = await apiPost('/api/asking/after-talk/check', {
      question: composeAskAfterQuestion(),
    });
    render();
    return;
  }

  if (form.id === 'without-context-form' && state.withoutContext.exercise) {
    state.withoutContext.feedback = await apiPost('/api/asking/clarify/check', {
      userQuestion: form.userQuestion.value.trim(),
      expectedQuestion: state.withoutContext.exercise.expectedQuestion,
      target: state.withoutContext.exercise.target,
      focus: state.withoutContext.exercise.focus,
    });
    render();
    return;
  }

  if (form.id === 'answering-start-form') {
    const mode = form.dataset.mode;
    state.answering[mode].context = form.context.value.trim();
    await startAnswering(mode);
    return;
  }

  if (form.id === 'answering-reply-form') {
    const mode = form.dataset.mode;
    const userReply = form.userReply.value.trim();
    if (userReply) {
      await sendAnsweringReply(mode, userReply);
    }
  }
});

document.addEventListener('click', async (event) => {
  const actionTarget = event.target.closest('[data-action]');
  if (!actionTarget) {
    return;
  }

  const action = actionTarget.dataset.action;

  if (action === 'accordion-toggle') {
    const accordionId = actionTarget.dataset.accordionId;
    state.ui.accordions[accordionId] = !state.ui.accordions[accordionId];
    render();
    return;
  }

  if (action === 'clarify-reveal') {
    state.clarify.reveal = !state.clarify.reveal;
    render();
    return;
  }

  if (action === 'clarify-next') {
    await generateClarify(state.clarify.offset + 1);
    return;
  }

  if (action === 'ask-after-refresh') {
    await generateAskAfter(state.askAfter.offset + 1);
    return;
  }

  if (action === 'without-context-generate') {
    await generateWithoutContext(state.withoutContext.exercise ? state.withoutContext.offset + 1 : 0);
    return;
  }

  if (action === 'without-context-reveal') {
    state.withoutContext.reveal = !state.withoutContext.reveal;
    render();
    return;
  }

  if (action === 'answering-reset') {
    const mode = actionTarget.dataset.mode;
    state.answering[mode].session = null;
    state.answering[mode].error = '';
    render();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.name === 'opener') {
    state.askAfter.opener = event.target.value;
  }

  if (event.target.name === 'followUp') {
    state.askAfter.followUp = event.target.value;
  }

  if (event.target.name === 'tail') {
    state.askAfter.tail = event.target.value;
  }

  if (event.target.closest('#ask-after-builder')) {
    const preview = document.getElementById('ask-after-preview');
    if (preview) {
      preview.textContent = composeAskAfterQuestion();
    }
  }
});

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', loadContent);





const app = document.getElementById('admin-app');

const state = {
  loading: true,
  error: '',
  message: '',
  messageTone: 'success',
  content: null,
  metaDraft: '',
  schemaDrafts: {
    taxonomies: '',
    defaults: '',
    sectionViews: '',
    blockRenderers: '',
    practiceScreens: '',
    blockGroups: '',
  },
  selectedSectionId: '',
  busy: false,
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toAsciiJson(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function asRecord(value) {
  return value && typeof value === 'object' ? value : {};
}

function getAdminConfig() {
  return asRecord(asRecord(asRecord(state.content).meta).ui).admin || {};
}

function getFeedbackConfig() {
  return asRecord(asRecord(asRecord(state.content).meta).ui).feedback || {};
}

function getRuntimeConfig() {
  return asRecord(asRecord(state.content).meta).runtime || {};
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

async function api(method, path, payload) {
  const options = { method, headers: {} };
  if (payload !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = toAsciiJson(payload);
  }

  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }

  return data;
}

function getSections() {
  return state.content?.sections || [];
}

function getSection() {
  return getSections().find((section) => section.id === state.selectedSectionId) || null;
}

function setMessage(text, tone = 'success') {
  state.message = text;
  state.messageTone = tone;
}

function getAdminText(path, fallback = '') {
  return getNestedString(getAdminConfig(), path, fallback);
}

function getTaxonomyLabels(groupName) {
  return asRecord(asRecord(getAdminConfig()).taxonomies)[groupName] || {};
}

function getTaxonomyValues(groupName) {
  return Object.keys(getTaxonomyLabels(groupName));
}

function getTaxonomyOptions(groupName, currentValue = '', fallbackValue = '') {
  const values = [];
  for (const value of [...getTaxonomyValues(groupName), currentValue, fallbackValue]) {
    if (value && !values.includes(value)) {
      values.push(value);
    }
  }
  return values;
}

function getTaxonomyDefault(groupName, fallbackValue = '') {
  return getTaxonomyOptions(groupName, '', fallbackValue)[0] || fallbackValue;
}

function ensureMetaStructures() {
  if (!state.content) {
    return;
  }

  if (!state.content.meta || typeof state.content.meta !== 'object') {
    state.content.meta = {};
  }

  if (!state.content.meta.ui || typeof state.content.meta.ui !== 'object') {
    state.content.meta.ui = {};
  }

  if (!state.content.meta.ui.admin || typeof state.content.meta.ui.admin !== 'object') {
    state.content.meta.ui.admin = {};
  }

  const admin = state.content.meta.ui.admin;
  admin.taxonomies = asRecord(admin.taxonomies);
  admin.fieldLabels = asRecord(admin.fieldLabels);
  admin.actions = asRecord(admin.actions);
  admin.messages = asRecord(admin.messages);

  if (!state.content.meta.runtime || typeof state.content.meta.runtime !== 'object') {
    state.content.meta.runtime = {};
  }

  const runtime = state.content.meta.runtime;
  runtime.defaults = asRecord(runtime.defaults);
  runtime.sectionViews = asRecord(runtime.sectionViews);
  runtime.blockRenderers = asRecord(runtime.blockRenderers);
  runtime.practiceScreens = asRecord(runtime.practiceScreens);
  runtime.blockGroups = asRecord(runtime.blockGroups);
}

function syncSchemaDraftsFromContent() {
  ensureMetaStructures();
  const runtime = getRuntimeConfig();
  state.metaDraft = JSON.stringify(state.content.meta || {}, null, 2);
  state.schemaDrafts.taxonomies = JSON.stringify(getAdminConfig().taxonomies || {}, null, 2);
  state.schemaDrafts.defaults = JSON.stringify(runtime.defaults || {}, null, 2);
  state.schemaDrafts.sectionViews = JSON.stringify(runtime.sectionViews || {}, null, 2);
  state.schemaDrafts.blockRenderers = JSON.stringify(runtime.blockRenderers || {}, null, 2);
  state.schemaDrafts.practiceScreens = JSON.stringify(runtime.practiceScreens || {}, null, 2);
  state.schemaDrafts.blockGroups = JSON.stringify(runtime.blockGroups || {}, null, 2);
}

function parseJsonDraft(text, label) {
  try {
    return JSON.parse(text || '{}');
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function applySchemaDrafts() {
  ensureMetaStructures();
  const admin = getAdminConfig();
  const runtime = getRuntimeConfig();
  admin.taxonomies = parseJsonDraft(state.schemaDrafts.taxonomies, getAdminText(['taxonomiesTitle'], 'Supported types'));
  runtime.defaults = parseJsonDraft(state.schemaDrafts.defaults, getAdminText(['defaultsTitle'], 'Runtime defaults'));
  runtime.sectionViews = parseJsonDraft(state.schemaDrafts.sectionViews, getAdminText(['sectionViewsTitle'], 'Section views'));
  runtime.blockRenderers = parseJsonDraft(state.schemaDrafts.blockRenderers, getAdminText(['blockRenderersTitle'], 'Block renderers'));
  runtime.practiceScreens = parseJsonDraft(state.schemaDrafts.practiceScreens, getAdminText(['practiceScreensTitle'], 'Practice screens'));
  runtime.blockGroups = parseJsonDraft(state.schemaDrafts.blockGroups, getAdminText(['blockGroupsTitle'], 'Block groups'));
}

function ensureSelection() {
  const sections = getSections();
  if (!sections.length) {
    state.selectedSectionId = '';
    return;
  }

  if (!sections.some((section) => section.id === state.selectedSectionId)) {
    state.selectedSectionId = sections[0].id;
  }
}

function syncDocumentTitle() {
  if (!state.content) {
    return;
  }

  const title = getAdminText(['title'], state.content.meta?.appTitle || '');
  document.title = title;
}

async function loadContent() {
  state.loading = true;
  state.error = '';
  render();

  try {
    state.content = clone(await api('GET', '/api/admin/content'));
    ensureMetaStructures();
    syncSchemaDraftsFromContent();
    ensureSelection();
    syncDocumentTitle();
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

async function saveContent() {
  state.busy = true;
  setMessage(getAdminText(['messages', 'savingContent']), 'success');
  render();

  try {
    state.content.meta = JSON.parse(state.metaDraft || '{}');
    ensureMetaStructures();
    applySchemaDrafts();
  } catch (error) {
    setMessage(
      formatTemplate(getAdminText(['messages', 'invalidMetaJsonPattern']), {
        reason: error instanceof Error ? error.message : String(error),
      }),
      'error',
    );
    state.busy = false;
    render();
    return;
  }

  try {
    state.content = clone(await api('POST', '/api/admin/content', state.content));
    ensureMetaStructures();
    syncSchemaDraftsFromContent();
    ensureSelection();
    syncDocumentTitle();
    setMessage(getAdminText(['messages', 'contentSaved']));
  } catch (error) {
    setMessage(error.message, 'error');
  } finally {
    state.busy = false;
    render();
  }
}

function materialTemplate(type = getTaxonomyDefault('materialTypes', 'text')) {
  return { id: uid('material'), type, title: '', body: '', url: '', alt: '' };
}

function blockTemplate(kind = getTaxonomyDefault('blockKinds', 'panel')) {
  return { id: uid('block'), kind, title: '', description: '', route: '', materials: [] };
}

function sectionTemplate() {
  return {
    id: uid('section'),
    route: `/new-${Date.now()}`,
    type: getTaxonomyDefault('sectionTypes', 'custom'),
    eyebrow: '',
    title: '',
    summary: '',
    blocks: [],
  };
}

function removeUploadedAsset(url) {
  if (!url || !String(url).startsWith('/uploads/')) {
    return Promise.resolve();
  }

  return api('POST', '/api/admin/media/delete', { url }).catch(() => undefined);
}

function optionList(values, currentValue, labels) {
  return values
    .map((value) => {
      const label = labels[value] || value;
      return `<option value="${escapeHtml(value)}" ${value === currentValue ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    })
    .join('');
}

function renderStatus() {
  if (!state.message) {
    return '';
  }

  return `<div class="status-box ${state.messageTone}">${escapeHtml(state.message)}</div>`;
}

function renderMediaPreview(material) {
  if (!material.url) {
    return material.type === 'text' ? '' : `<div class="preview-box">${escapeHtml(getNestedString(getFeedbackConfig(), ['noFileUploaded']))}</div>`;
  }

  if (material.type === 'image') {
    return `<img class="media-preview" src="${escapeHtml(material.url)}" alt="${escapeHtml(material.alt || material.title || '')}">`;
  }

  if (material.type === 'video') {
    return `<video class="media-preview" src="${escapeHtml(material.url)}" controls></video>`;
  }

  if (material.type === 'audio') {
    return `<audio class="media-preview" src="${escapeHtml(material.url)}" controls></audio>`;
  }

  return '';
}

function renderMaterial(material, sectionId, blockId) {
  const fieldLabels = asRecord(getAdminConfig().fieldLabels);
  const materialTypeLabels = getTaxonomyLabels('materialTypes');
  const actions = asRecord(getAdminConfig().actions);

  return `
    <article class="material-card">
      <div class="row">
        <label>${escapeHtml(fieldLabels.materialTitle || '')}<input data-level="material" data-section-id="${escapeHtml(sectionId)}" data-block-id="${escapeHtml(blockId)}" data-material-id="${escapeHtml(material.id)}" data-field="title" value="${escapeHtml(material.title)}"></label>
        <label>${escapeHtml(fieldLabels.materialType || '')}<select data-level="material" data-section-id="${escapeHtml(sectionId)}" data-block-id="${escapeHtml(blockId)}" data-material-id="${escapeHtml(material.id)}" data-field="type">${optionList(getTaxonomyOptions('materialTypes', material.type, 'text'), material.type, materialTypeLabels)}</select></label>
      </div>
      <label>${escapeHtml(fieldLabels.body || '')}<textarea data-level="material" data-section-id="${escapeHtml(sectionId)}" data-block-id="${escapeHtml(blockId)}" data-material-id="${escapeHtml(material.id)}" data-field="body">${escapeHtml(material.body)}</textarea></label>
      <label>${escapeHtml(fieldLabels.url || '')}<input data-level="material" data-section-id="${escapeHtml(sectionId)}" data-block-id="${escapeHtml(blockId)}" data-material-id="${escapeHtml(material.id)}" data-field="url" value="${escapeHtml(material.url)}"></label>
      <label>${escapeHtml(fieldLabels.altText || '')}<input data-level="material" data-section-id="${escapeHtml(sectionId)}" data-block-id="${escapeHtml(blockId)}" data-material-id="${escapeHtml(material.id)}" data-field="alt" value="${escapeHtml(material.alt)}"></label>
      ${renderMediaPreview(material)}
      <div class="material-actions">
        <input type="file" data-action="upload-media" data-section-id="${escapeHtml(sectionId)}" data-block-id="${escapeHtml(blockId)}" data-material-id="${escapeHtml(material.id)}">
        <button class="quiet" data-action="delete-media" data-section-id="${escapeHtml(sectionId)}" data-block-id="${escapeHtml(blockId)}" data-material-id="${escapeHtml(material.id)}" data-url="${escapeHtml(material.url)}" type="button">${escapeHtml(actions.deleteUploadedFile || '')}</button>
        <button class="danger" data-action="delete-material" data-section-id="${escapeHtml(sectionId)}" data-block-id="${escapeHtml(blockId)}" data-material-id="${escapeHtml(material.id)}" type="button">${escapeHtml(actions.deleteMaterial || '')}</button>
      </div>
    </article>
  `;
}

function renderBlock(block, sectionId) {
  const fieldLabels = asRecord(getAdminConfig().fieldLabels);
  const blockKindLabels = getTaxonomyLabels('blockKinds');
  const actions = asRecord(getAdminConfig().actions);

  return `
    <article class="block-card">
      <div class="row">
        <label>${escapeHtml(fieldLabels.blockTitle || '')}<input data-level="block" data-section-id="${escapeHtml(sectionId)}" data-block-id="${escapeHtml(block.id)}" data-field="title" value="${escapeHtml(block.title)}"></label>
        <label>${escapeHtml(fieldLabels.blockKind || '')}<select data-level="block" data-section-id="${escapeHtml(sectionId)}" data-block-id="${escapeHtml(block.id)}" data-field="kind">${optionList(getTaxonomyOptions('blockKinds', block.kind, 'panel'), block.kind, blockKindLabels)}</select></label>
      </div>
      <label>${escapeHtml(fieldLabels.description || '')}<textarea data-level="block" data-section-id="${escapeHtml(sectionId)}" data-block-id="${escapeHtml(block.id)}" data-field="description">${escapeHtml(block.description)}</textarea></label>
      <label>${escapeHtml(fieldLabels.route || '')}<input data-level="block" data-section-id="${escapeHtml(sectionId)}" data-block-id="${escapeHtml(block.id)}" data-field="route" value="${escapeHtml(block.route || '')}"></label>
      <div class="admin-actions">
        <button class="secondary" data-action="add-material" data-section-id="${escapeHtml(sectionId)}" data-block-id="${escapeHtml(block.id)}" type="button">${escapeHtml(actions.addMaterial || '')}</button>
        <button class="danger" data-action="delete-block" data-section-id="${escapeHtml(sectionId)}" data-block-id="${escapeHtml(block.id)}" type="button">${escapeHtml(actions.deleteBlock || '')}</button>
      </div>
      ${(block.materials || []).map((material) => renderMaterial(material, sectionId, block.id)).join('')}
    </article>
  `;
}

function renderSidebar() {
  const actions = asRecord(getAdminConfig().actions);
  return `
    <aside class="admin-sidebar">
      <button class="primary" data-action="add-section" type="button">${escapeHtml(actions.addSection || '')}</button>
      ${getSections()
        .map((section) => `<button class="${section.id === state.selectedSectionId ? 'active' : ''}" data-action="select-section" data-section-id="${escapeHtml(section.id)}" type="button"><strong>${escapeHtml(section.title || section.route)}</strong><div class="muted">${escapeHtml(section.route)}</div></button>`)
        .join('')}
    </aside>
  `;
}

function renderSchemaCard(title, hint, field) {
  return `
    <article class="schema-card">
      <label>${escapeHtml(title)}</label>
      <p class="hint">${escapeHtml(hint)}</p>
      <textarea class="meta-editor" data-level="schema" data-field="${escapeHtml(field)}">${escapeHtml(state.schemaDrafts[field] || "")}</textarea>
    </article>
  `;
}

function renderSchemaEditor() {
  return `
    <section class="admin-card">
      <label>${escapeHtml(getAdminText(["schemaTitle"]))}</label>
      <p class="hint">${escapeHtml(getAdminText(["schemaHint"]))}</p>
      <div class="schema-grid">
        ${renderSchemaCard(getAdminText(["taxonomiesTitle"]), getAdminText(["taxonomiesHint"]), "taxonomies")}
        ${renderSchemaCard(getAdminText(["defaultsTitle"]), getAdminText(["defaultsHint"]), "defaults")}
        ${renderSchemaCard(getAdminText(["sectionViewsTitle"]), getAdminText(["sectionViewsHint"]), "sectionViews")}
        ${renderSchemaCard(getAdminText(["blockRenderersTitle"]), getAdminText(["blockRenderersHint"]), "blockRenderers")}
        ${renderSchemaCard(getAdminText(["practiceScreensTitle"]), getAdminText(["practiceScreensHint"]), "practiceScreens")}
        ${renderSchemaCard(getAdminText(["blockGroupsTitle"]), getAdminText(["blockGroupsHint"]), "blockGroups")}
      </div>
    </section>
  `;
}

function renderMetaEditor() {
  return `
    <section class="admin-card">
      <label>${escapeHtml(getAdminText(["metaTitle"]))}</label>
      <p class="hint">${escapeHtml(getAdminText(["metaHint"]))}</p>
      <textarea class="meta-editor" data-level="meta" data-field="draft">${escapeHtml(state.metaDraft)}</textarea>
    </section>
  `;
}

function renderEditor() {
  const section = getSection();
  const fieldLabels = asRecord(getAdminConfig().fieldLabels);
  const actions = asRecord(getAdminConfig().actions);
  const sectionTypeLabels = getTaxonomyLabels('sectionTypes');
  if (!section) {
    return `<section class="admin-card"><div class="admin-empty">${escapeHtml(getAdminText(['emptySection']))}</div></section>`;
  }

  return `
    <section class="admin-card">
      <div class="admin-actions">
        <label>${escapeHtml(fieldLabels.sectionRoute || '')}<input data-level="section" data-field="route" value="${escapeHtml(section.route)}"></label>
        <label>${escapeHtml(fieldLabels.sectionType || '')}<select data-level="section" data-field="type">${optionList(getTaxonomyOptions('sectionTypes', section.type, 'custom'), section.type, sectionTypeLabels)}</select></label>
        <label>${escapeHtml(fieldLabels.eyebrow || '')}<input data-level="section" data-field="eyebrow" value="${escapeHtml(section.eyebrow || '')}"></label>
        <label>${escapeHtml(fieldLabels.sectionTitle || '')}<input data-level="section" data-field="title" value="${escapeHtml(section.title || '')}"></label>
        <label>${escapeHtml(fieldLabels.summary || '')}<textarea data-level="section" data-field="summary">${escapeHtml(section.summary || '')}</textarea></label>
        <div class="admin-actions">
          <button class="secondary" data-action="add-block" data-section-id="${escapeHtml(section.id)}" type="button">${escapeHtml(actions.addBlock || '')}</button>
          <button class="danger" data-action="delete-section" data-section-id="${escapeHtml(section.id)}" type="button">${escapeHtml(actions.deleteSection || '')}</button>
        </div>
      </div>
      ${(section.blocks || []).map((block) => renderBlock(block, section.id)).join('')}
    </section>
  `;
}

function render() {
  if (state.loading) {
    app.innerHTML = `<main class="admin-shell"><section class="admin-hero"><p class="muted">${escapeHtml(getAdminText(['loading']))}</p></section></main>`;
    return;
  }

  if (state.error) {
    app.innerHTML = `<main class="admin-shell"><section class="admin-hero"><div class="status-box error">${escapeHtml(state.error)}</div>${getAdminText(['retry']) ? `<button class="primary" data-action="reload" type="button">${escapeHtml(getAdminText(['retry']))}</button>` : ''}</section></main>`;
    return;
  }

  syncDocumentTitle();

  app.innerHTML = `
    <main class="admin-shell">
      <section class="admin-hero">
        <div class="chip-row">
          <a href="/">${escapeHtml(getAdminText(['openLearnerApp']))}</a>
          <a href="/admin.html">${escapeHtml(getAdminText(['refreshAdmin']))}</a>
        </div>
        <h1>${escapeHtml(getAdminText(['title']))}</h1>
        <p class="hint">${escapeHtml(getAdminText(['hint']))}</p>
        <div class="admin-actions">
          <button class="primary" data-action="save-content" type="button" ${state.busy ? 'disabled' : ''}>${escapeHtml(getAdminText(['saveContent']))}</button>
          <button class="secondary" data-action="reload" type="button" ${state.busy ? 'disabled' : ''}>${escapeHtml(getAdminText(['reloadFromDisk']))}</button>
        </div>
        ${renderStatus()}
      </section>
      ${renderSchemaEditor()}
      ${renderMetaEditor()}
      <section class="admin-layout">
        ${renderSidebar()}
        ${renderEditor()}
      </section>
    </main>
  `;
}

function withSection(sectionId, fn) {
  const section = getSections().find((item) => item.id === sectionId);
  if (section) {
    fn(section);
  }
}

function withBlock(sectionId, blockId, fn) {
  withSection(sectionId, (section) => {
    const block = (section.blocks || []).find((item) => item.id === blockId);
    if (block) {
      fn(block, section);
    }
  });
}

function withMaterial(sectionId, blockId, materialId, fn) {
  withBlock(sectionId, blockId, (block) => {
    const material = (block.materials || []).find((item) => item.id === materialId);
    if (material) {
      fn(material, block);
    }
  });
}

function handleFieldInput(target) {
  const { level, field, sectionId, blockId, materialId } = target.dataset;
  if (level === 'meta') {
    state.metaDraft = target.value;
  }
  if (level === 'schema') {
    state.schemaDrafts[field] = target.value;
  }
  if (level === 'section') {
    const section = getSection();
    if (section) {
      section[field] = target.value;
    }
  }
  if (level === 'block') {
    withBlock(sectionId, blockId, (block) => {
      block[field] = target.value;
    });
  }
  if (level === 'material') {
    withMaterial(sectionId, blockId, materialId, (material) => {
      material[field] = target.value;
    });
  }
}

async function uploadMedia(input) {
  const file = input.files && input.files[0];
  if (!file) {
    return;
  }
  const { sectionId, blockId, materialId } = input.dataset;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      let previousUrl = '';
      withMaterial(sectionId, blockId, materialId, (material) => {
        previousUrl = material.url || '';
      });
      const uploaded = await api('POST', '/api/admin/media/upload', { fileName: file.name, base64: reader.result });
      await removeUploadedAsset(previousUrl);
      withMaterial(sectionId, blockId, materialId, (material) => {
        material.url = uploaded.url;
        material.alt = material.alt || file.name;
      });
      setMessage(formatTemplate(getAdminText(['messages', 'uploadedPattern']), { fileName: file.name }));
    } catch (error) {
      setMessage(error.message, 'error');
    }
    render();
  };
  reader.readAsDataURL(file);
}

app.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  if (target.dataset.level) {
    handleFieldInput(target);
  }
});

app.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  if (target.dataset.level) {
    handleFieldInput(target);
  }
  if (target.dataset.action === 'upload-media') {
    uploadMedia(target);
  }
});

app.addEventListener('click', async (event) => {
  const trigger = event.target.closest('[data-action]');
  if (!trigger) {
    return;
  }
  const { action, sectionId, blockId, materialId, url } = trigger.dataset;
  const messages = asRecord(getAdminConfig().messages);

  if (action === 'reload') { loadContent(); return; }
  if (action === 'save-content') { saveContent(); return; }
  if (action === 'select-section') { state.selectedSectionId = sectionId; render(); return; }
  if (action === 'add-section') {
    const section = sectionTemplate();
    state.content.sections.push(section);
    state.selectedSectionId = section.id;
    setMessage(messages.sectionAdded || '');
    render();
    return;
  }
  if (action === 'delete-section') {
    const section = getSections().find((item) => item.id === sectionId);
    for (const block of section.blocks || []) {
      for (const material of block.materials || []) {
        await removeUploadedAsset(material.url);
      }
    }
    state.content.sections = state.content.sections.filter((item) => item.id !== sectionId);
    ensureSelection();
    setMessage(messages.sectionDeleted || '');
    render();
    return;
  }
  if (action === 'add-block') {
    withSection(sectionId, (section) => {
      section.blocks = section.blocks || [];
      section.blocks.push(blockTemplate());
    });
    setMessage(messages.blockAdded || '');
    render();
    return;
  }
  if (action === 'delete-block') {
    const block = (getSections().find((item) => item.id === sectionId)?.blocks || []).find((item) => item.id === blockId);
    for (const material of block?.materials || []) {
      await removeUploadedAsset(material.url);
    }
    withSection(sectionId, (section) => {
      section.blocks = (section.blocks || []).filter((item) => item.id !== blockId);
    });
    setMessage(messages.blockDeleted || '');
    render();
    return;
  }
  if (action === 'add-material') {
    withBlock(sectionId, blockId, (block) => {
      block.materials = block.materials || [];
      block.materials.push(materialTemplate());
    });
    setMessage(messages.materialAdded || '');
    render();
    return;
  }
  if (action === 'delete-material') {
    let mediaUrl = '';
    withMaterial(sectionId, blockId, materialId, (material) => {
      mediaUrl = material.url || '';
    });
    await removeUploadedAsset(mediaUrl);
    withBlock(sectionId, blockId, (block) => {
      block.materials = (block.materials || []).filter((item) => item.id !== materialId);
    });
    setMessage(messages.materialDeleted || '');
    render();
    return;
  }
  if (action === 'delete-media') {
    await removeUploadedAsset(url);
    if (sectionId && blockId && materialId) {
      withMaterial(sectionId, blockId, materialId, (material) => {
        material.url = '';
      });
    }
    setMessage(messages.uploadedDeleted || '');
    render();
  }
});

loadContent();


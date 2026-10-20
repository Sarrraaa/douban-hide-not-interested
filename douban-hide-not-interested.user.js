// ==UserScript==
// @name         豆瓣 · 不想看隐藏
// @namespace    local.douban-hide-not-interested
// @version      1.1.1
// @description  本地标记不想看、隐藏卡片，并添加个人标签；无自动采集、网络请求或 IMDb 同步。
// @downloadURL  https://raw.githubusercontent.com/Sarrraaa/douban-hide-not-interested/main/douban-hide-not-interested.user.js
// @updateURL    https://raw.githubusercontent.com/Sarrraaa/douban-hide-not-interested/main/douban-hide-not-interested.user.js
// @match        https://movie.douban.com/*
// @match        https://www.douban.com/doulist/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @run-at       document-idle
// @noframes
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  // This script is intentionally independent of other Douban userscripts.
  // Keep this script's storage entirely separate from the full-featured plugin.
  // Only movie/TV subject IDs and user-entered tags are persisted locally.
  const STORAGE_KEY = 'hidden-subject-ids:v1';
  const TAGS_KEY = 'subject-tags:v1';
  const PRESET_TAGS = ['想看', 'DBW', 'WBW', 'WLW'];
  const MAX_TAG_LENGTH = 50;
  const MAX_TAGS_PER_WORK = 30;
  const normalizeTags = values => {
    const found = new Set();
    if (!Array.isArray(values)) return [];
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const tag = value.trim().replace(/\s+/g, ' ');
      if (tag && tag.length <= MAX_TAG_LENGTH) found.add(tag);
      if (found.size >= MAX_TAGS_PER_WORK) break;
    }
    return [...found];
  };
  function readTags(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const result = {};
    for (const [id, values] of Object.entries(raw)) {
      if (!/^\d+$/.test(id)) continue;
      const tags = normalizeTags(values);
      if (tags.length) result[id] = tags;
    }
    return result;
  }
  let tagsById = readTags(GM_getValue(TAGS_KEY, {}));
  const toSet = value => new Set(Array.isArray(value)
    ? value.filter(id => typeof id === 'string' && /^\d+$/.test(id)) : []);
  let hiddenIds = toSet(GM_getValue(STORAGE_KEY, []));
  let showHidden = false;
  let dirty = false;
  let scanTimer = null;
  let cards = new Map();

  const selector = [
    '.grid_view > li',
    '.subject-list-list > li',
    '.subject-item',
    '.doulist-item',
    '.movie-list-panel > .movie-list-item',
    '.movie-list-item',
    '#content .movie-list > li',
    '#content .article li',
    '#content .item',
    '#content .subject',
  ].join(',');

  function subjectId(href) {
    try {
      const u = new URL(href, location.href);
      if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
      if (u.hostname === 'movie.douban.com') {
        const direct = u.pathname.match(/^\/subject\/(\d+)\/?$/);
        if (direct) return direct[1];
      }
      if (['www.douban.com', 'm.douban.com', 'movie.douban.com'].includes(u.hostname)) {
        // 选电影 /explore uses www.douban.com/doubanapp/dispatch?uri=/movie/ID
        // Parse locally: do not follow or request any redirect destination.
        if (u.pathname === '/doubanapp/dispatch') {
          const uri = u.searchParams.get('uri') || '';
          const match = uri.match(/^\/?(?:movie|tv)\/(\d+)\/?$/);
          if (match) return match[1];
        }
        const mobile = u.pathname.match(/^\/(?:movie|tv)\/subject\/(\d+)\/?$/);
        if (mobile) return mobile[1];
      }
    } catch { /* Invalid or unsupported link. */ }
    return null;
  }

  function singleSubjectId(card) {
    const ids = new Set();
    for (const link of card.querySelectorAll('a[href]')) {
      if (link.closest('[data-dnh-owned]')) continue;
      const id = subjectId(link.getAttribute('href'));
      if (id) ids.add(id);
      if (ids.size > 1) return null; // Never hide a container holding multiple works.
    }
    return ids.size === 1 ? ids.values().next().value : null;
  }

  function setClass(node, className, enabled) {
    if (node.classList.contains(className) !== enabled) node.classList.toggle(className, enabled);
  }
  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }

  const style = document.createElement('style');
  style.dataset.dnhOwned = 'true';
  style.textContent = `
    .dnh-hidden { display:none !important; }
    .dnh-card { height:auto !important; max-height:none !important; }
    .dnh-controls { clear:both; position:relative; z-index:2; display:flex;
      align-items:center; flex-wrap:wrap; gap:6px; padding:5px 0;
      font:12px/1.5 system-ui,sans-serif; line-height:1.5; }
    .dnh-controls button, .dnh-detail button, #dnh-reveal {
      font:12px/1.5 system-ui,sans-serif; border:1px solid #b5c5bb;
      background:#fff; color:#176a4d; padding:4px 8px; border-radius:6px;
      cursor:pointer; }
    .dnh-controls button:hover, .dnh-detail button:hover, #dnh-reveal:hover {
      background:#eaf4ed; }
    .dnh-revealed { outline:1px dashed #b7bfbb; outline-offset:-1px; }
    .dnh-revealed img { filter:grayscale(1); opacity:.55; }
    .dnh-revealed > .dnh-controls button:first-child { color:#755247; }
    .dnh-controls .dnh-tag-action, .dnh-detail .dnh-tag-action {
      color:#385c78; overflow-wrap:anywhere; white-space:normal; max-width:100%; text-align:left; }
    .dnh-dialog { color:#243c32; box-sizing:border-box;
      width:min(510px, calc(100vw - 32px)); max-height:85vh;
      border:1px solid #bdd0c3; border-radius:12px; padding:20px;
      background:#fff; box-shadow:0 16px 60px #0003;
      font:14px/1.5 system-ui,sans-serif; }
    .dnh-dialog::backdrop { background:#14221a80; }
    .dnh-dialog h2 { font-size:18px; margin:0 0 8px; }
    .dnh-dialog p { margin:8px 0 12px; color:#5b6a61; }
    .dnh-dialog .dnh-options { display:flex; flex-wrap:wrap; gap:7px; margin:12px 0 18px; }
    .dnh-dialog button { cursor:pointer; border:1px solid #b5c5bb; background:#fff;
      border-radius:6px; color:#275942; font:inherit; padding:6px 10px; }
    .dnh-dialog .dnh-options button[aria-pressed="true"] { background:#176a4d; color:#fff; }
    .dnh-dialog .dnh-custom { display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; }
    .dnh-dialog .dnh-custom input { min-width:140px; flex:1 1 180px; padding:7px;
      border:1px solid #b5c5bb; border-radius:6px; font:inherit; }
    .dnh-dialog .dnh-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:20px; }
    .dnh-dialog .dnh-actions button[type="submit"] { background:#176a4d; color:#fff; }
    .dnh-dialog .dnh-error { color:#ab3838; min-height:1.5em; font-size:12px; }
    .dnh-detail { display:flex; align-items:center; gap:8px; margin:8px 0 12px;
      font:12px/1.5 system-ui,sans-serif; }
    #dnh-reveal { position:fixed; right:20px; bottom:20px; z-index:2147483646;
      box-shadow:0 2px 12px #0002; background:#eff8f0; }
    #dnh-reveal[hidden] { display:none !important; }
    /* The native typerank picture-text mode uses absolutely positioned contents. */
    .movie-list-panel.pictext > .dnh-card > .movie-content {
      position:relative; top:auto; margin-top:30px; margin-bottom:12px; }
    .movie-list-panel.list > .dnh-card > .movie-content-hover {
      top:auto; bottom:100%; }
  `;
  (document.head || document.documentElement).append(style);

  const reveal = document.createElement('button');
  reveal.type = 'button';
  reveal.id = 'dnh-reveal';
  reveal.dataset.dnhOwned = 'true';
  reveal.hidden = true;
  reveal.addEventListener('click', () => { showHidden = !showHidden; render(); });
  document.body.append(reveal);

  // Local tag editor. It never fetches site data or writes to Douban accounts.
  const tagDialog = document.createElement('dialog');
  tagDialog.className = 'dnh-dialog';
  tagDialog.dataset.dnhOwned = 'true';
  tagDialog.innerHTML = `
    <form method="dialog" id="dnh-tag-form">
      <h2>本地标签</h2>
      <p>只保存在这个用户脚本的本地存储中，不会同步到豆瓣或 IMDb。</p>
      <div class="dnh-options" role="group" aria-label="选择标签"></div>
      <label for="dnh-new-tag">添加自定义标签（可用逗号分隔）</label>
      <div class="dnh-custom"><input id="dnh-new-tag" autocomplete="off" maxlength="1000" placeholder="输入新标签">
      <button type="button" data-action="add">添加</button></div>
      <p class="dnh-error" role="alert"></p>
      <div class="dnh-actions"><button type="button" data-action="cancel">取消</button>
      <button type="submit">保存</button></div>
    </form>`;
  document.body.append(tagDialog);
  const tagForm = tagDialog.querySelector('form');
  const tagOptions = tagDialog.querySelector('.dnh-options');
  const newTagInput = tagDialog.querySelector('input');
  const tagError = tagDialog.querySelector('.dnh-error');
  let tagEditor = null;

  function availableTags() {
    const tags = new Set(PRESET_TAGS);
    for (const values of Object.values(tagsById)) for (const tag of values) tags.add(tag);
    if (tagEditor) for (const tag of tagEditor.selected) tags.add(tag);
    return [...PRESET_TAGS, ...[...tags].filter(tag => !PRESET_TAGS.includes(tag)).sort((a, b) => a.localeCompare(b, 'zh-CN'))];
  }
  function displayTagChoices() {
    tagOptions.replaceChildren();
    if (!tagEditor) return;
    for (const tag of availableTags()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = tag;
      button.dataset.tag = tag;
      button.setAttribute('aria-pressed', String(tagEditor.selected.has(tag)));
      tagOptions.append(button);
    }
  }
  tagOptions.addEventListener('click', event => {
    const button = event.target.closest('button[data-tag]');
    if (!button || !tagEditor) return;
    const tag = button.dataset.tag;
    if (tagEditor.selected.has(tag)) tagEditor.selected.delete(tag);
    else if (tagEditor.selected.size < MAX_TAGS_PER_WORK) tagEditor.selected.add(tag);
    else { tagError.textContent = `每部作品最多 ${MAX_TAGS_PER_WORK} 个标签`; return; }
    tagError.textContent = '';
    button.setAttribute('aria-pressed', String(tagEditor.selected.has(tag)));
  });
  function addCustomTag() {
    if (!tagEditor) return;
    const parts = newTagInput.value.split(/[,，、]+/).map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
    if (!parts.length) { tagError.textContent = '请输入标签'; return; }
    if (parts.some(tag => tag.length > MAX_TAG_LENGTH)) {
      tagError.textContent = `每个标签最多 ${MAX_TAG_LENGTH} 个字符`; return;
    }
    const merged = new Set([...tagEditor.selected, ...parts]);
    if (merged.size > MAX_TAGS_PER_WORK) {
      tagError.textContent = `每部作品最多 ${MAX_TAGS_PER_WORK} 个标签`; return;
    }
    tagEditor.selected = merged;
    newTagInput.value = '';
    tagError.textContent = '';
    displayTagChoices();
  }
  tagDialog.querySelector('[data-action="add"]').addEventListener('click', addCustomTag);
  newTagInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); addCustomTag(); }
  });
  tagDialog.querySelector('[data-action="cancel"]').addEventListener('click', () => tagDialog.close());
  tagDialog.addEventListener('close', () => { tagEditor = null; });
  tagForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!tagEditor) return;
    if (newTagInput.value.trim()) {
      addCustomTag();
      if (tagError.textContent) return;
    }
    setTags(tagEditor.id, [...tagEditor.selected]);
    tagDialog.close();
  });
  function openTagEditor(id) {
    tagEditor = {id, selected: new Set(tagsById[id] || [])};
    newTagInput.value = '';
    tagError.textContent = '';
    displayTagChoices();
    if (!tagDialog.open) tagDialog.showModal();
  }
  function setTags(id, tags) {
    const next = normalizeTags(tags);
    if (JSON.stringify(tagsById[id] || []) === JSON.stringify(next)) return;
    if (next.length) tagsById[id] = next;
    else delete tagsById[id];
    GM_setValue(TAGS_KEY, {...tagsById});
    render();
  }
  function tagLabel(id) {
    const tags = tagsById[id] || [];
    return tags.length ? `标签：${tags.join(' · ')}` : '加标签';
  }

  function toggle(id) {
    if (hiddenIds.has(id)) hiddenIds.delete(id);
    else hiddenIds.add(id);
    GM_setValue(STORAGE_KEY, [...hiddenIds].sort((a, b) => a.localeCompare(b)));
    render();
  }

  function ensureControls(card, id) {
    let controls = [...card.children].find(el => el.hasAttribute('data-dnh-owned') && el.classList.contains('dnh-controls'));
    if (controls?.dataset.subjectId !== id) { controls?.remove(); controls = null; }
    if (!controls) {
      controls = document.createElement('div');
      controls.dataset.dnhOwned = 'true';
      controls.dataset.subjectId = id;
      controls.className = 'dnh-controls';
      const button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); toggle(id); });
      button.dataset.action = 'hide';
      const tagButton = document.createElement('button');
      tagButton.type = 'button';
      tagButton.className = 'dnh-tag-action';
      tagButton.dataset.action = 'tags';
      tagButton.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openTagEditor(id); });
      controls.append(button, tagButton);
      card.append(controls);
    }
    return {
      hide: controls.querySelector('[data-action="hide"]'),
      tags: controls.querySelector('[data-action="tags"]'),
    };
  }

  function detail() {
    if (location.hostname !== 'movie.douban.com') return;
    const id = location.pathname.match(/^\/subject\/(\d+)\/?$/)?.[1];
    if (!id) return;
    const heading = document.querySelector('#content h1, h1');
    if (!heading) return;
    let box = document.querySelector('[data-dnh-detail]');
    if (!box) {
      box = document.createElement('div');
      box.className = 'dnh-detail';
      box.dataset.dnhOwned = 'true';
      box.dataset.dnhDetail = 'true';
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = 'hide';
      button.addEventListener('click', () => toggle(box.dataset.subjectId));
      const tagButton = document.createElement('button');
      tagButton.type = 'button';
      tagButton.className = 'dnh-tag-action';
      tagButton.dataset.action = 'tags';
      tagButton.addEventListener('click', () => openTagEditor(box.dataset.subjectId));
      box.append(button, tagButton);
      heading.insertAdjacentElement('afterend', box);
    }
    box.dataset.subjectId = id;
    setText(box.querySelector('[data-action="hide"]'), hiddenIds.has(id) ? '取消不想看' : '不想看');
    setText(box.querySelector('[data-action="tags"]'), tagLabel(id));
  }

  function panelVisible(card, cache) {
    const panel = card.closest('.movie-list-panel');
    if (!panel) return true;
    if (!cache.has(panel)) cache.set(panel, getComputedStyle(panel).display !== 'none');
    return cache.get(panel);
  }

  function render() {
    if (document.hidden) { dirty = true; return; }
    const panels = new Map();
    let count = 0;
    for (const [card, id] of cards) {
      if (!card.isConnected) continue;
      const excluded = hiddenIds.has(id);
      if (excluded && panelVisible(card, panels)) count++;
      setClass(card, 'dnh-hidden', excluded && !showHidden);
      setClass(card, 'dnh-revealed', excluded && showHidden);
      const buttons = ensureControls(card, id);
      setText(buttons.hide, excluded ? '取消不想看' : '不想看');
      setText(buttons.tags, tagLabel(id));
    }
    // Reset reveal mode when there are no excluded cards on this page.
    if (count === 0) showHidden = false;
    reveal.hidden = count === 0;
    setText(reveal, `${showHidden ? '收起已隐藏' : '显示已隐藏'} (${count})`);
    detail();
    dirty = false;
  }

  function scan() {
    if (document.hidden) { dirty = true; return; }
    dirty = false;
    // This script never fetches data. It inspects only cards already on the page.
    const valid = new Map();
    for (const card of document.querySelectorAll(selector)) {
      if (card.closest('nav, #db-global-nav, #db-nav-movie, #db-nav-book, #comments, #reviews')) continue;
      const id = singleSubjectId(card);
      if (id) valid.set(card, id);
    }
    // Prefer the complete outer card over nested item/rating wrappers.
    const next = new Map();
    for (const [card, id] of valid) {
      let nested = false;
      for (let parent = card.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (valid.get(parent) === id) { nested = true; break; }
      }
      if (!nested) next.set(card, id);
    }
    for (const card of cards.keys()) if (!next.has(card)) {
      card.classList.remove('dnh-hidden', 'dnh-revealed', 'dnh-card');
      for (const control of card.querySelectorAll('.dnh-controls[data-dnh-owned]')) control.remove();
    }
    cards = next;
    for (const card of cards.keys()) setClass(card, 'dnh-card', true);
    render();
  }

  function ownMutation(mutation) {
    const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
    if (target?.closest('[data-dnh-owned]')) return true;
    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
      const native = value => (value || '').split(/\s+/).filter(x => x && !x.startsWith('dnh-')).sort().join(' ');
      if (native(mutation.oldValue) === native(target?.getAttribute('class'))) return true;
    }
    return mutation.type === 'childList' && [...mutation.addedNodes, ...mutation.removedNodes]
      .every(node => node.nodeType === 1 && node.matches('[data-dnh-owned]'));
  }

  function scheduleScan() {
    dirty = true;
    if (document.hidden) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 200);
  }
  const observer = new MutationObserver(mutations => {
    if (mutations.some(m => !ownMutation(m) &&
      (m.type !== 'attributes' || m.attributeName !== 'style' || m.target.matches('.movie-list-panel')))) scheduleScan();
  });
  observer.observe(document.body, {childList:true, subtree:true, attributes:true,
    attributeOldValue:true, attributeFilter:['class', 'href', 'style']});

  GM_addValueChangeListener(STORAGE_KEY, (_key, _old, next, remote) => {
    if (!remote) return;
    hiddenIds = toSet(next);
    if (document.hidden) dirty = true;
    else render();
  });
  GM_addValueChangeListener(TAGS_KEY, (_key, _old, next, remote) => {
    if (!remote) return;
    tagsById = readTags(next);
    if (document.hidden) dirty = true;
    else render();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(scanTimer); return; }
    if (dirty) scan(); else render();
  });
  addEventListener('pagehide', () => { clearTimeout(scanTimer); observer.disconnect(); }, {once:true});
  scan();
})();
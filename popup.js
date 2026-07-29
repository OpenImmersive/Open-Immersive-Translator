'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

const btnTranslate = document.getElementById('btnTranslate');
const selLang = document.getElementById('selLang');
const swHover = document.getElementById('swHover');
const swAutoSite = document.getElementById('swAutoSite');
const swFloatBall = document.getElementById('swFloatBall');
const swAutoLang = document.getElementById('swAutoLang');
const autoLangName = document.getElementById('autoLangName');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

let currentTab = null;
let currentHost = '';
let currentPageLang = '';
const LANG_LABELS = { zh: '中文', ja: '日语', ko: '韩语', en: '英语', ru: '俄语', ar: '阿拉伯语', he: '希伯来语', el: '希腊语', th: '泰语', hi: '印地语', fr: '法语', de: '德语', es: '西班牙语', pt: '葡萄牙语', it: '意大利语' };
let engine = 'google'; // 引擎收进「更多设置」，popup 只读取、不展示

// ===== 初始化 =====

async function init() {
  const data = await getStorage(['targetLang', 'engine', 'hoverTranslate', 'autoTranslateSites', 'floatBall', 'autoTranslateLangs']);
  selLang.value = data.targetLang || 'zh-CN';
  engine = data.engine || 'google';
  swHover.checked = data.hoverTranslate !== false; // 默认开
  swFloatBall.checked = data.floatBall !== false; // 默认开

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  try { currentHost = tab && tab.url ? new URL(tab.url).hostname : ''; } catch { currentHost = ''; }
  const sites = Array.isArray(data.autoTranslateSites) ? data.autoTranslateSites : [];
  swAutoSite.checked = !!currentHost && sites.includes(currentHost);
  swAutoSite.disabled = !currentHost;

  // 「总是翻译该语言」认的是当前页的语种，先问 content script 拿判定结果
  const langs = Array.isArray(data.autoTranslateLangs) ? data.autoTranslateLangs : [];
  try {
    const r = await api.tabs.sendMessage(tab.id, { type: 'getPageLang' });
    currentPageLang = (r && r.lang) || '';
  } catch { currentPageLang = ''; }
  autoLangName.textContent = currentPageLang ? (LANG_LABELS[currentPageLang] || currentPageLang) : '该语言';
  swAutoLang.checked = !!currentPageLang && langs.includes(currentPageLang);
  swAutoLang.disabled = !currentPageLang;

  try {
    const resp = await api.tabs.sendMessage(tab.id, { type: 'getStatus' });
    updateUI(resp);
  } catch {
    setStatus('dot-off', '此页面不支持翻译');
    btnTranslate.disabled = true;
  }
}

// ===== 翻译按钮 =====

btnTranslate.addEventListener('click', async () => {
  if (!currentTab) return;
  const targetLang = selLang.value;
  await setStorage({ targetLang });

  btnTranslate.disabled = true;
  setStatus('dot-loading', '翻译中，请稍候…');
  try {
    const resp = await api.tabs.sendMessage(currentTab.id, { type: 'translatePage', targetLang, engine });
    updateUI(resp);
  } catch (err) {
    setStatus('dot-off', '翻译失败: ' + err.message);
  } finally {
    btnTranslate.disabled = false;
  }
});

// ===== 设置变更自动保存 =====

selLang.addEventListener('change', () => setStorage({ targetLang: selLang.value }));
swHover.addEventListener('change', () => setStorage({ hoverTranslate: swHover.checked }));
swFloatBall.addEventListener('change', () => setStorage({ floatBall: swFloatBall.checked }));

// 总是翻译此网站：增删当前 host；勾选后立即翻译当前页
swAutoSite.addEventListener('change', async () => {
  if (!currentHost) return;
  const { autoTranslateSites } = await getStorage(['autoTranslateSites']);
  const sites = new Set(Array.isArray(autoTranslateSites) ? autoTranslateSites : []);
  if (swAutoSite.checked) {
    sites.add(currentHost);
    if (currentTab) api.tabs.sendMessage(currentTab.id, { type: 'translatePage', targetLang: selLang.value, engine }).catch(() => {});
  } else {
    sites.delete(currentHost);
  }
  await setStorage({ autoTranslateSites: [...sites] });
});

// 总是翻译该语言：按当前页语种增删名单；勾选后立即翻译当前页
swAutoLang.addEventListener('change', async () => {
  if (!currentPageLang) return;
  const { autoTranslateLangs } = await getStorage(['autoTranslateLangs']);
  const langs = new Set(Array.isArray(autoTranslateLangs) ? autoTranslateLangs : []);
  if (swAutoLang.checked) {
    langs.add(currentPageLang);
    if (currentTab) api.tabs.sendMessage(currentTab.id, { type: 'translatePage', targetLang: selLang.value, engine }).catch(() => {});
  } else {
    langs.delete(currentPageLang);
  }
  await setStorage({ autoTranslateLangs: [...langs] });
});

// ===== 更多设置 =====

document.getElementById('btnOptions').addEventListener('click', (e) => {
  e.preventDefault();
  api.runtime.openOptionsPage();
  window.close();
});

// ===== PDF 翻译：跳网站（保留排版 / 学术论文模式）=====

document.getElementById('btnPdf').addEventListener('click', (e) => {
  e.preventDefault();
  api.tabs.create({ url: 'https://pdf.openimmersive.ai/' });
  window.close();
});

// ===== UI 更新 =====

function updateUI(resp) {
  if (!resp) { setStatus('dot-off', '无法连接到页面'); return; }

  if (resp.isTranslating) {
    setStatus('dot-loading', `翻译中… ${resp.translatedCount || 0}/${resp.totalCount || 0}`);
    btnTranslate.disabled = true;
    return;
  }
  if (resp.isTranslated || resp.status === 'done') {
    const count = resp.count || resp.translatedCount || 0;
    setStatus('dot-on', `已翻译 ${count} 个段落`);
    btnTranslate.textContent = '恢复原文';
    btnTranslate.classList.add('active');
    return;
  }
  if (resp.status === 'removed') {
    setStatus('dot-off', '已恢复原文');
    btnTranslate.textContent = '翻译此页';
    btnTranslate.classList.remove('active');
    return;
  }
  setStatus('dot-off', '准备就绪');
  btnTranslate.textContent = '翻译此页';
  btnTranslate.classList.remove('active');
}

function setStatus(dotClass, text) {
  statusDot.className = 'status-dot';
  if (dotClass === 'dot-on') statusDot.classList.add('on');
  if (dotClass === 'dot-loading') statusDot.classList.add('loading');
  statusText.textContent = text;
}

// ===== Storage 工具 =====

function getStorage(keys) {
  if (typeof browser !== 'undefined') return browser.storage.local.get(keys);
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}
function setStorage(items) {
  if (typeof browser !== 'undefined') return browser.storage.local.set(items);
  return new Promise(resolve => chrome.storage.local.set(items, resolve));
}

// ===== 启动 =====
init().catch(console.error);

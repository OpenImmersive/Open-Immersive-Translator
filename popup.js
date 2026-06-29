'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

const btnTranslate = document.getElementById('btnTranslate');
const selLang = document.getElementById('selLang');
const selEngine = document.getElementById('selEngine');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

let currentTab = null;

// ===== 初始化 =====

async function init() {
  // 加载保存的设置
  const { targetLang = 'zh-CN', engine = 'google' } = await getStorage(['targetLang', 'engine']);
  selLang.value = targetLang;
  selEngine.value = engine;

  // 获取当前标签页
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  // 查询内容脚本状态
  try {
    const resp = await api.tabs.sendMessage(tab.id, { type: 'getStatus' });
    updateUI(resp);
  } catch {
    // 内容脚本尚未注入（如 about:, chrome: 等特殊页面）
    setStatus('dot-off', '此页面不支持翻译');
    btnTranslate.disabled = true;
  }
}

// ===== 翻译按钮 =====

btnTranslate.addEventListener('click', async () => {
  if (!currentTab) return;

  const targetLang = selLang.value;
  const engine = selEngine.value;

  // 保存设置
  await setStorage({ targetLang, engine });

  btnTranslate.disabled = true;
  setStatus('dot-loading', '翻译中，请稍候…');

  try {
    const resp = await api.tabs.sendMessage(currentTab.id, {
      type: 'translatePage',
      targetLang,
      engine
    });

    updateUI(resp);
  } catch (err) {
    setStatus('dot-off', '翻译失败: ' + err.message);
  } finally {
    btnTranslate.disabled = false;
  }
});

// ===== 引擎/语言变更时自动保存 =====

selLang.addEventListener('change', () => setStorage({ targetLang: selLang.value }));
selEngine.addEventListener('change', () => setStorage({ engine: selEngine.value }));

// ===== 设置页 =====

document.getElementById('btnOptions').addEventListener('click', (e) => {
  e.preventDefault();
  api.runtime.openOptionsPage();
  window.close();
});

// ===== UI 更新 =====

function updateUI(resp) {
  if (!resp) {
    setStatus('dot-off', '无法连接到页面');
    return;
  }

  if (resp.isTranslating) {
    setStatus('dot-loading', `翻译中… ${resp.translatedCount || 0}/${resp.totalCount || 0}`);
    btnTranslate.disabled = true;
    return;
  }

  if (resp.isTranslated || resp.status === 'done') {
    const count = resp.count || resp.translatedCount || 0;
    setStatus('dot-on', `已翻译 ${count} 个段落`);
    btnTranslate.textContent = '取消翻译';
    btnTranslate.classList.add('active');
    return;
  }

  if (resp.status === 'removed') {
    setStatus('dot-off', '已恢复原文');
    btnTranslate.textContent = '翻译当前页面';
    btnTranslate.classList.remove('active');
    return;
  }

  // 未翻译状态
  setStatus('dot-off', '准备就绪 · Alt+T 快捷键');
  btnTranslate.textContent = '翻译当前页面';
  btnTranslate.classList.remove('active');
}

function setStatus(dotClass, text) {
  statusDot.className = 'status-dot';
  if (dotClass === 'dot-on') statusDot.classList.add('on');
  if (dotClass === 'dot-loading') statusDot.classList.add('loading');
  // DOM API 构建（不用 innerHTML）：把 Alt+T 包成 <kbd>，其余走文本节点。
  statusText.textContent = '';
  text.split('Alt+T').forEach((p, i) => {
    if (i > 0) {
      const kbd = document.createElement('kbd');
      kbd.textContent = 'Alt+T';
      statusText.appendChild(kbd);
    }
    if (p) statusText.appendChild(document.createTextNode(p));
  });
}

// ===== Storage 工具（Firefox用Promise，Chrome用callback包装）=====

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

'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

// ===== 加载设置 =====

async function loadSettings() {
  const data = await getStorage(['targetLang', 'engine', 'apiKeys', 'sensitiveMask']);

  document.getElementById('defLang').value = data.targetLang || 'zh-CN';
  document.getElementById('defEngine').value = data.engine || 'google';
  document.getElementById('maskSensitive').checked = !!data.sensitiveMask;

  const keys = data.apiKeys || {};
  document.getElementById('keyDeepL').value = keys.deepl || '';
  document.getElementById('keyDeepSeek').value = keys.deepseek || '';
  document.getElementById('keyOpenAI').value = keys.openai || '';
  document.getElementById('libreUrl').value = keys.libretranslate_url || '';
}

// ===== 保存设置 =====

document.getElementById('btnSave').addEventListener('click', async () => {
  const settings = {
    targetLang: document.getElementById('defLang').value,
    engine: document.getElementById('defEngine').value,
    sensitiveMask: document.getElementById('maskSensitive').checked,
    apiKeys: {
      deepl: document.getElementById('keyDeepL').value.trim(),
      deepseek: document.getElementById('keyDeepSeek').value.trim(),
      openai: document.getElementById('keyOpenAI').value.trim(),
      libretranslate_url: document.getElementById('libreUrl').value.trim()
    }
  };

  await setStorage(settings);

  const msg = document.getElementById('saveMsg');
  msg.style.display = 'inline';
  setTimeout(() => { msg.style.display = 'none'; }, 2500);
});

// ===== 显示/隐藏 API Key =====

document.querySelectorAll('.btn-show').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '隐藏';
    } else {
      input.type = 'password';
      btn.textContent = '显示';
    }
  });
});

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
loadSettings().catch(console.error);

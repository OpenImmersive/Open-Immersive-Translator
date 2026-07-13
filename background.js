'use strict';

// 语灵灵 Background Script - 翻译引擎路由
// 所有API请求直接从浏览器发出，无中间服务器

const api = typeof browser !== 'undefined' ? browser : chrome;

// 敏感信息脱敏模块（可选功能，默认关闭）。Chrome MV3 service worker 用
// importScripts 加载；Firefox 事件页由 manifest background.scripts 先行加载
// （见 build-store.mjs）。加载失败只是功能不可用，不影响翻译。
if (typeof YLSensitive === 'undefined' && typeof importScripts === 'function') {
  try { importScripts('sensitive-mask.js'); } catch (e) { console.warn('sensitive-mask.js 加载失败', e); }
}

// Storage 兼容层（Firefox用Promise，Chrome用callback包装）
function storageGet(keys) {
  if (typeof browser !== 'undefined') return browser.storage.local.get(keys);
  return new Promise(r => chrome.storage.local.get(keys, r));
}

// 键盘快捷键 Alt+T -> 向当前标签页发消息
api.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-translation') {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      api.tabs.sendMessage(tab.id, { type: 'toggleTranslation' }).catch(() => {});
    }
  }
});

// 首次安装 → 打开新手引导页
if (api.runtime.onInstalled) {
  api.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      api.tabs.create({ url: api.runtime.getURL('welcome.html') }).catch(() => {});
    }
  });
}

// ===== 消息监听 =====

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'translate') {
    translate(message)
      .then(result => sendResponse({ success: true, translation: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 保持异步通道
  }

  if (message.type === 'detectLang') {
    detectLanguage(message.text)
      .then(lang => sendResponse({ success: true, lang }))
      .catch(() => sendResponse({ success: true, lang: 'unknown' }));
    return true;
  }
});

// ===== 翻译入口 =====

async function translate({ text, engine, targetLang, sourceLang = 'auto' }) {
  if (!text || !text.trim()) return '';

  const { apiKeys = {}, sensitiveMask = false } = await storageGet(['apiKeys', 'sensitiveMask']);

  // 脱敏：发送前在本地把敏感信息换成占位符，翻译返回后还原
  let masked = null;
  if (sensitiveMask && typeof YLSensitive !== 'undefined') {
    masked = YLSensitive.maskSensitive(text);
    text = masked.masked;
  }

  let result;
  switch (engine) {
    case 'google':     result = await translateGoogle(text, targetLang, sourceLang); break;
    case 'mymemory':  result = await translateMyMemory(text, targetLang, sourceLang); break;
    case 'deepl':     result = await translateDeepL(text, targetLang, sourceLang, apiKeys.deepl); break;
    case 'openai':    result = await translateOpenAI(text, targetLang, sourceLang, apiKeys.openai); break;
    case 'deepseek':  result = await translateDeepSeek(text, targetLang, sourceLang, apiKeys.deepseek); break;
    case 'libretranslate': result = await translateLibre(text, targetLang, sourceLang, apiKeys.libretranslate_url); break;
    default:          result = await translateGoogle(text, targetLang, sourceLang);
  }

  if (masked && masked.entities.length) {
    result = YLSensitive.restoreSensitive(result, masked.entities);
  }
  return result;
}

// ===== Google Translate（非官方免费接口，无需Key）=====

async function translateGoogle(text, targetLang, sourceLang = 'auto') {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', sourceLang);
  url.searchParams.set('tl', targetLang);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text);

  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`Google: HTTP ${resp.status}`);

  const data = await resp.json();
  // data[0] = [[translated, original], ...]
  return data[0]
    .filter(item => item && item[0])
    .map(item => item[0])
    .join('');
}

// ===== MyMemory（免费，500词/次，无需Key）=====

async function translateMyMemory(text, targetLang, sourceLang = 'auto') {
  const sl = sourceLang === 'auto' ? 'en' : sourceLang;
  const chunk = text.substring(0, 500);

  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', chunk);
  url.searchParams.set('langpair', `${sl}|${targetLang}`);

  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`MyMemory: HTTP ${resp.status}`);

  const data = await resp.json();
  if (data.responseStatus !== 200) {
    throw new Error(data.responseMessage || 'MyMemory error');
  }
  return data.responseData.translatedText;
}

// ===== DeepL（免费API Key，deepl.com注册即得500K字/月）=====

async function translateDeepL(text, targetLang, sourceLang, apiKey) {
  if (!apiKey) throw new Error('请在设置页配置 DeepL API Key（免费版每月50万字）');

  const body = {
    text: [text],
    target_lang: toDeepLLang(targetLang)
  };
  if (sourceLang && sourceLang !== 'auto') {
    body.source_lang = toDeepLLang(sourceLang).split('-')[0];
  }

  const resp = await fetch('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`DeepL: HTTP ${resp.status} ${errText}`);
  }

  const data = await resp.json();
  return data.translations[0].text;
}

function toDeepLLang(lang) {
  const map = {
    'zh-CN': 'ZH', 'zh-TW': 'ZH',
    'en': 'EN-US', 'en-US': 'EN-US', 'en-GB': 'EN-GB',
    'ja': 'JA', 'ko': 'KO', 'fr': 'FR', 'de': 'DE',
    'es': 'ES', 'ru': 'RU', 'pt': 'PT-PT', 'it': 'IT',
    'nl': 'NL', 'pl': 'PL', 'ar': 'AR'
  };
  return map[lang] || lang.toUpperCase().split('-')[0];
}

// ===== OpenAI（BYOK，gpt-4o-mini成本极低）=====

async function translateOpenAI(text, targetLang, sourceLang, apiKey) {
  if (!apiKey) throw new Error('请在设置页配置 OpenAI API Key');
  return callOpenAICompat(
    'https://api.openai.com/v1/chat/completions',
    'gpt-4o-mini',
    apiKey,
    text,
    targetLang
  );
}

// ===== DeepSeek（BYOK，比OpenAI便宜90%）=====

async function translateDeepSeek(text, targetLang, sourceLang, apiKey) {
  if (!apiKey) throw new Error('请在设置页配置 DeepSeek API Key');
  return callOpenAICompat(
    'https://api.deepseek.com/v1/chat/completions',
    'deepseek-chat',
    apiKey,
    text,
    targetLang
  );
}

// OpenAI兼容接口通用实现
async function callOpenAICompat(endpoint, model, apiKey, text, targetLang) {
  const langName = LANG_NAMES[targetLang] || targetLang;
  // 脱敏占位符必须原样穿过 LLM，否则无法还原
  const piiNote = text.includes('__PII_')
    ? ' The text contains placeholders like __PII_EMAIL_1__; keep them EXACTLY unchanged in the output.'
    : '';

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: `You are a professional translator. Translate the following text to ${langName}. Output only the translation, no explanations, no quotes.${piiNote}`
        },
        { role: 'user', content: text }
      ],
      temperature: 0.1,
      max_tokens: 2048
    })
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`API error ${resp.status}: ${errText.substring(0, 100)}`);
  }

  const data = await resp.json();
  return data.choices[0].message.content.trim();
}

// ===== LibreTranslate（可自托管，隐私最优）=====

async function translateLibre(text, targetLang, sourceLang, instanceUrl) {
  const base = instanceUrl || 'https://libretranslate.com';
  const sl = sourceLang === 'auto' ? 'auto' : sourceLang.split('-')[0];
  const tl = targetLang.split('-')[0];

  const resp = await fetch(`${base}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: sl, target: tl, format: 'text' })
  });

  if (!resp.ok) throw new Error(`LibreTranslate: HTTP ${resp.status}`);
  const data = await resp.json();
  return data.translatedText;
}

// ===== 语言检测（用Google的auto检测结果）=====

async function detectLanguage(text) {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'auto');
  url.searchParams.set('tl', 'en');
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text.substring(0, 50));

  const resp = await fetch(url.toString());
  const data = await resp.json();
  return data[2] || 'unknown';
}

// ===== 常量 =====

const LANG_NAMES = {
  'zh-CN': 'Simplified Chinese（简体中文）',
  'zh-TW': 'Traditional Chinese（繁体中文）',
  'en': 'English',
  'ja': 'Japanese（日本語）',
  'ko': 'Korean（한국어）',
  'fr': 'French（Français）',
  'de': 'German（Deutsch）',
  'es': 'Spanish（Español）',
  'ru': 'Russian（Русский）',
  'ar': 'Arabic（العربية）',
  'pt': 'Portuguese（Português）',
  'it': 'Italian（Italiano）',
  'nl': 'Dutch（Nederlands）',
  'pl': 'Polish（Polski）'
};

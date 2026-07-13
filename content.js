'use strict';

// 语灵灵 Content Script - 页面翻译与划词翻译
// 隐私保证：所有API调用通过background.js直接发往翻译服务商

(function () {
  if (window.__yllLoaded) return;
  window.__yllLoaded = true;

  const api = typeof browser !== 'undefined' ? browser : chrome;

  // Storage 兼容层
  function storageGet(keys) {
    if (typeof browser !== 'undefined') return browser.storage.local.get(keys);
    return new Promise(r => chrome.storage.local.get(keys, r));
  }

  // ===== 状态 =====
  const state = {
    isTranslated: false,
    isTranslating: false,
    engine: 'google',
    targetLang: 'zh-CN',
    translatedCount: 0,
    totalCount: 0,
    pageKey: location.href
  };

  // ===== 需要跳过翻译的标签 =====
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT',
    'IFRAME', 'SVG', 'MATH', 'BUTTON', 'INPUT',
    'TEXTAREA', 'SELECT', 'OPTION', 'CANVAS'
  ]);

  const SKIP_ROLES = new Set([
    'navigation', 'menubar', 'menu', 'toolbar', 'search', 'banner'
  ]);

  // ===== 消息监听（来自popup）=====
  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'getStatus') {
      sendResponse({
        isTranslated: state.isTranslated,
        isTranslating: state.isTranslating,
        translatedCount: state.translatedCount,
        totalCount: state.totalCount
      });
      return false;
    }

    if (msg.type === 'translatePage') {
      state.engine = msg.engine || state.engine;
      state.targetLang = msg.targetLang || state.targetLang;

      if (state.isTranslated) {
        removeTranslations();
        sendResponse({ status: 'removed' });
      } else {
        translatePage().then(() => {
          sendResponse({
            status: 'done',
            count: state.translatedCount,
            total: state.totalCount
          });
        }).catch(err => sendResponse({ status: 'error', message: err.message }));
        return true;
      }
      return false;
    }

    if (msg.type === 'removeTranslations') {
      removeTranslations();
      sendResponse({ status: 'removed' });
      return false;
    }

    if (msg.type === 'toggleTranslation') {
      if (state.isTranslated) {
        removeTranslations();
      } else {
        translatePage();
      }
      return false;
    }
  });

  // ===== 快捷键 Alt+T =====
  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      if (state.isTranslated) {
        removeTranslations();
      } else {
        translatePage();
      }
    }
  });

  // ===== 划词翻译 =====
  let selPopup = null;
  let selTimer = null;

  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('touchend', onMouseUp);

  async function onMouseUp(e) {
    if (!selectionEnabled) return;
    // 点击了自己的popup则忽略
    if (selPopup && selPopup.contains(e.target)) return;

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      hidePopup();
      return;
    }

    const text = sel.toString().trim();
    if (text.length < 2 || text.length > 1000) {
      hidePopup();
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    showPopup(rect, '翻译中…', true);

    try {
      const { engine = 'google', targetLang = 'zh-CN' } = await getSettings();
      const resp = await api.runtime.sendMessage({
        type: 'translate',
        text,
        engine,
        targetLang,
        sourceLang: 'auto'
      });

      if (resp && resp.success) {
        showPopup(rect, resp.translation, false);
      } else {
        showPopup(rect, `翻译失败: ${resp ? resp.error : '通信错误'}`, false);
      }
    } catch (err) {
      showPopup(rect, `翻译失败: ${err.message}`, false);
    }
  }

  function showPopup(rect, text, loading) {
    if (!selPopup) {
      selPopup = document.createElement('div');
      selPopup.id = 'yll-sel-popup';
      selPopup.setAttribute('data-yll-ui', 'true');
      document.body.appendChild(selPopup);
    }

    // DOM API 构建（不用 innerHTML）：内容全部经 textContent 注入，AMO 审核友好。
    selPopup.textContent = '';
    if (loading) {
      const spin = document.createElement('span');
      spin.className = 'yll-spin';
      spin.textContent = '⟳';
      selPopup.append(spin, ' 翻译中…');
      selPopup.className = 'yll-popup-loading';
    } else {
      const textDiv = document.createElement('div');
      textDiv.className = 'yll-popup-text';
      textDiv.textContent = text;
      const copy = document.createElement('a');
      copy.href = '#';
      copy.className = 'yll-copy';
      copy.textContent = '复制';
      copy.addEventListener('click', (e) => {
        e.preventDefault();
        navigator.clipboard.writeText(text).catch(() => {});
      });
      const footer = document.createElement('div');
      footer.className = 'yll-popup-footer';
      footer.append('OpenImmersive · ', copy);
      selPopup.append(textDiv, footer);
      selPopup.className = 'yll-popup-done';
    }

    // 定位
    const vw = window.innerWidth;
    const sx = window.scrollX;
    const sy = window.scrollY;
    let x = sx + rect.left;
    let y = sy + rect.bottom + 8;

    selPopup.style.display = 'block';
    selPopup.style.visibility = 'hidden';

    requestAnimationFrame(() => {
      const pw = selPopup.offsetWidth || 300;
      if (x + pw > sx + vw - 10) x = sx + vw - pw - 10;
      if (x < sx + 10) x = sx + 10;
      selPopup.style.left = x + 'px';
      selPopup.style.top = y + 'px';
      selPopup.style.visibility = 'visible';
    });

    clearTimeout(selTimer);
    if (!loading) {
      selTimer = setTimeout(hidePopup, 10000);
    }
  }

  function hidePopup() {
    if (selPopup) selPopup.style.display = 'none';
  }

  document.addEventListener('mousedown', (e) => {
    if (selPopup && !selPopup.contains(e.target)) hidePopup();
  });

  // ===== 悬停翻译（按住触发键 + 鼠标扫过段落 → 就地翻译该段）=====
  // 沉浸式翻译的「第二心智入口」：无需选中，按住 Alt 划过正文即逐段翻译。
  // 默认开启、默认 Alt；复用页面翻译的 translateBlock/injectTranslation。
  let hoverEnabled = true;
  let hoverKey = 'Alt'; // 'Alt' | 'Control' | 'Shift' | 'off'
  let lastHoverEl = null;

  const HOVER_KEY_PROP = { Alt: 'altKey', Control: 'ctrlKey', Shift: 'shiftKey' };
  const HOVER_BLOCK_TAGS = new Set([
    'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'BLOCKQUOTE', 'FIGCAPTION', 'DT', 'DD', 'TD', 'TH', 'SUMMARY'
  ]);

  // 划词翻译开关（默认开）
  let selectionEnabled = true;
  // 输入框翻译（可编辑区按 Alt+Enter 就地译成 inputTargetLang，默认英文）
  let inputEnabled = true;
  let inputTargetLang = 'en';

  // 状态与设置同步：hover/输入框走 state.engine/targetLang，先从存储初始化，再随改动更新。
  // 注意：必须显式列出所有键——getSettings() 只取 targetLang/engine，读不到行为开关。
  storageGet(['targetLang', 'engine', 'hoverTranslate', 'hoverKey',
    'selectionTranslate', 'inputTranslate', 'inputTargetLang']).then(s => {
    if (s.engine) state.engine = s.engine;
    if (s.targetLang) state.targetLang = s.targetLang;
    if (s.hoverTranslate === false) hoverEnabled = false;
    if (typeof s.hoverKey === 'string') hoverKey = s.hoverKey;
    if (s.selectionTranslate === false) selectionEnabled = false;
    if (s.inputTranslate === false) inputEnabled = false;
    if (typeof s.inputTargetLang === 'string') inputTargetLang = s.inputTargetLang;
  });
  if (api.storage && api.storage.onChanged) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.engine) state.engine = changes.engine.newValue || state.engine;
      if (changes.targetLang) state.targetLang = changes.targetLang.newValue || state.targetLang;
      if (changes.hoverTranslate) hoverEnabled = changes.hoverTranslate.newValue !== false;
      if (changes.hoverKey) hoverKey = changes.hoverKey.newValue || hoverKey;
      if (changes.selectionTranslate) selectionEnabled = changes.selectionTranslate.newValue !== false;
      if (changes.inputTranslate) inputEnabled = changes.inputTranslate.newValue !== false;
      if (changes.inputTargetLang) inputTargetLang = changes.inputTargetLang.newValue || inputTargetLang;
    });
  }

  // ===== 输入框翻译：在可编辑区按 Alt+Enter → 就地译成 inputTargetLang（写外语场景）=====
  function editableTarget(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
    if (el.tagName === 'TEXTAREA') return el;
    if (el.tagName === 'INPUT' && /^(text|search|email|url|)$/i.test(el.getAttribute('type') || '')) return el;
    if (el.isContentEditable) return el;
    return null;
  }

  document.addEventListener('keydown', async (e) => {
    if (!inputEnabled) return;
    if (!(e.altKey && e.key === 'Enter')) return;
    const el = editableTarget(e.target);
    if (!el) return;
    const isCE = el.isContentEditable;
    const text = (isCE ? el.innerText : el.value) || '';
    if (!text.trim() || text.trim().length > 5000) return;
    e.preventDefault();
    try {
      const resp = await api.runtime.sendMessage({
        type: 'translate', text: text.trim(),
        engine: state.engine, targetLang: inputTargetLang, sourceLang: 'auto'
      });
      if (resp && resp.success && resp.translation) {
        if (isCE) { el.innerText = resp.translation; }
        else { el.value = resp.translation; el.dispatchEvent(new Event('input', { bubbles: true })); }
      }
    } catch (err) { /* 静默失败，保留原文 */ }
  }, true);

  function hoverKeyHeld(e) {
    const prop = HOVER_KEY_PROP[hoverKey];
    return prop ? Boolean(e[prop]) : false;
  }

  function findHoverBlock(node) {
    let el = node;
    while (el && el !== document.body) {
      if (el.nodeType === Node.ELEMENT_NODE && HOVER_BLOCK_TAGS.has(el.tagName) && shouldTranslate(el)) {
        const text = extractText(el);
        if (text && text.trim().length >= 5 && !isAlreadyTargetLang(text, state.targetLang)) return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  document.addEventListener('mouseover', (e) => {
    if (!hoverEnabled || hoverKey === 'off') return;
    if (!hoverKeyHeld(e)) return;
    const block = findHoverBlock(e.target);
    if (!block || block === lastHoverEl || block.dataset.yllDone) return;
    lastHoverEl = block;
    translateBlock(block);
  }, true);
  // 松开触发键后重置，允许再次划过同一段落触发
  document.addEventListener('keyup', () => { lastHoverEl = null; });

  // ===== 页面翻译主流程 =====

  async function translatePage() {
    if (state.isTranslating) return;

    const settings = await getSettings();
    state.engine = settings.engine || 'google';
    state.targetLang = settings.targetLang || 'zh-CN';
    state.isTranslating = true;
    showProgressBar();

    try {
      const blocks = collectBlocks();
      state.totalCount = blocks.length;
      state.translatedCount = 0;
      updateProgressBar();

      if (blocks.length === 0) {
        state.isTranslating = false;
        hideProgressBar();
        return;
      }

      // 并发翻译，限制3个并发
      const CONCURRENCY = 3;
      for (let i = 0; i < blocks.length; i += CONCURRENCY) {
        await Promise.allSettled(
          blocks.slice(i, i + CONCURRENCY).map(el => translateBlock(el))
        );
        updateProgressBar();
      }

      state.isTranslated = true;
    } finally {
      state.isTranslating = false;
      hideProgressBar();
    }
  }

  async function translateBlock(el) {
    const text = extractText(el);
    if (!text || text.trim().length < 5) return;

    // 跳过已经是目标语言的内容
    if (isAlreadyTargetLang(text, state.targetLang)) return;

    try {
      const resp = await api.runtime.sendMessage({
        type: 'translate',
        text: text.trim(),
        engine: state.engine,
        targetLang: state.targetLang,
        sourceLang: 'auto'
      });

      if (resp && resp.success && resp.translation) {
        injectTranslation(el, resp.translation);
        state.translatedCount++;
      }
    } catch (err) {
      // 静默失败，不打断其他段落
    }
  }

  // ===== DOM 遍历：找到可翻译块 =====

  function collectBlocks() {
    const results = [];
    const seen = new WeakSet();

    // 优先选择语义化文本块
    const selector = [
      'article p', 'main p', '.content p', '.post p', '.article p',
      'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'li', 'blockquote', 'figcaption', 'td', 'th',
      'dt', 'dd', 'summary'
    ].join(', ');

    for (const el of document.querySelectorAll(selector)) {
      if (seen.has(el)) continue;
      if (!shouldTranslate(el)) continue;

      const text = extractText(el);
      if (!text || text.trim().length < 15) continue;

      seen.add(el);
      results.push(el);
    }

    return results;
  }

  function shouldTranslate(el) {
    // 跳过已翻译
    if (el.dataset.yllDone) return false;

    // 跳过语灵灵自己插入的元素
    if (el.dataset.yllUi) return false;
    if (el.closest('[data-yll-ui]')) return false;

    // 跳过标签
    if (SKIP_TAGS.has(el.tagName)) return false;

    // 跳过导航、页眉、页脚等
    const container = el.closest('nav, header, footer, aside, [role]');
    if (container) {
      const tag = container.tagName;
      if (['NAV', 'HEADER', 'FOOTER', 'ASIDE'].includes(tag)) return false;
      const role = container.getAttribute('role');
      if (role && SKIP_ROLES.has(role)) return false;
    }

    // 跳过包含代码的块
    if (el.querySelector('code, pre, .code, .highlight')) return false;

    // 跳过隐藏元素
    if (el.offsetParent === null && el.tagName !== 'BODY') return false;

    return true;
  }

  function extractText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // 跳过语灵灵注入的内容
        if (!node.dataset.yllInject) {
          text += node.textContent;
        }
      }
    }
    return text;
  }

  // 简单判断是否已经是目标语言（避免翻译中文→中文）
  function isAlreadyTargetLang(text, targetLang) {
    const isCJK = targetLang.startsWith('zh') || targetLang.startsWith('ja') || targetLang.startsWith('ko');
    if (!isCJK) return false;

    const cjkChars = (text.match(/[一-鿿぀-ヿ가-힯]/g) || []).length;
    const ratio = cjkChars / Math.max(text.replace(/\s/g, '').length, 1);
    return ratio > 0.35; // 超过35%是CJK字符则跳过
  }

  // ===== 注入翻译 =====

  function injectTranslation(el, translation) {
    el.dataset.yllDone = '1';

    const div = document.createElement('div');
    div.className = 'yll-tr';
    div.setAttribute('data-yll-inject', '1');
    div.setAttribute('data-yll-ui', 'true');
    div.textContent = translation;

    el.insertAdjacentElement('afterend', div);
  }

  function removeTranslations() {
    document.querySelectorAll('[data-yll-inject]').forEach(el => el.remove());
    document.querySelectorAll('[data-yll-done]').forEach(el => delete el.dataset.yllDone);
    state.isTranslated = false;
    state.translatedCount = 0;
    state.totalCount = 0;
  }

  // ===== 进度条 =====

  let progressBar = null;

  function showProgressBar() {
    if (!progressBar) {
      progressBar = document.createElement('div');
      progressBar.id = 'yll-progress';
      progressBar.setAttribute('data-yll-ui', 'true');
      progressBar.innerHTML = '<div id="yll-progress-bar"></div>';
      document.body.appendChild(progressBar);
    }
    progressBar.style.display = 'block';
    document.getElementById('yll-progress-bar').style.width = '0%';
  }

  function updateProgressBar() {
    if (!progressBar) return;
    const pct = state.totalCount > 0
      ? Math.round((state.translatedCount / state.totalCount) * 100)
      : 0;
    const bar = document.getElementById('yll-progress-bar');
    if (bar) bar.style.width = pct + '%';
  }

  function hideProgressBar() {
    if (progressBar) {
      setTimeout(() => {
        if (progressBar) progressBar.style.display = 'none';
      }, 600);
    }
  }

  // ===== 工具函数 =====

  function getSettings() {
    return storageGet(['targetLang', 'engine']);
  }

  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // Expose internals for automated testing only
  if (typeof window !== 'undefined' && window.__yllTestMode) {
    window.__yllInternals = {
      isAlreadyTargetLang,
      extractText,
      shouldTranslate,
      escHtml,
      collectBlocks,
      injectTranslation,
      removeTranslations,
      findHoverBlock,
      hoverKeyHeld,
      setHoverKey: (k) => { hoverKey = k; }
    };
  }

})();

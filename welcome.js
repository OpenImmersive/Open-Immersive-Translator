'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

document.getElementById('btnStart').addEventListener('click', async () => {
  try {
    const tab = await api.tabs.getCurrent();
    if (tab && tab.id != null) { await api.tabs.remove(tab.id); return; }
  } catch (e) { /* fall through */ }
  window.close();
});

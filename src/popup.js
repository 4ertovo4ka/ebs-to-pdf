// src/popup.js

// Функция определения поддерживаемой ЭБС по URL
function detectEbs(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const path = u.pathname;

    if (host === 'lanbook.com') {
      return 'lan';
    }
    if (host === 'urait.ru') {
      return 'urait';
    }
    // Используем регулярное выражение для ibooks.ru
    if (host === 'ibooks.ru') {
      return 'ibooks';
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Запрос текущей вкладки
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs.length === 0) {
    document.getElementById('status').textContent = 'Нет активной вкладки';
    return;
  }

  const tab = tabs[0];
  // Запрашиваем актуальный URL через content script, чтобы обойти SPA
  chrome.tabs.sendMessage(tab.id, { action: "GET_CURRENT_URL" }, (response) => {
    const url = response?.url || tab.url; // fallback на tab.url если сообщение не прошло

    // Проверяем, поддерживается ли сайт
    const ebs = detectEbs(url);

    // Скрываем все галочки
    document.getElementById('check-lan').classList.remove('visible');
    document.getElementById('check-urait').classList.remove('visible');
    document.getElementById('check-ibooks').classList.remove('visible');

    if (ebs) {
      document.getElementById('status').textContent = 'Скачивание поддерживается';
      document.getElementById(`check-${ebs}`).classList.add('visible');
    } else {
      document.getElementById('status').textContent = 'Скачивание не поддерживается';
    }
  });
});

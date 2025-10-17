"use strict";

import CryptoJS from "crypto-js";

// Убираем IIFE, так как webpack сам оборачивает код
console.log("PDF Downloader content script loaded.");

// Создаем глобальную ссылку на CryptoJS для доступа из всех функций
window.CryptoJS = CryptoJS;

// --- Главная функция инициализации ---
function initContentScript() {
  // Глобальный флаг, чтобы не добавлять кнопку дважды
  if (window.isPdfDownloaderScriptRunning) {
    console.log("PDF Downloader script already running.");
    return;
  }
  window.isPdfDownloaderScriptRunning = true;

  // Функция запуска
  async function downloadPdf() {
    console.log("Download PDF button clicked.");

    const hostname = window.location.hostname;
    const pathname = window.location.pathname;

    // --- Логика для LanBook ---
    if (hostname === "reader.lanbook.com" && pathname.includes("/book/")) {
      try {
        const response = await chrome.runtime.sendMessage({
          action: "DOWNLOAD_PDF_LANBOOK",
        });

        if (response && !response.success) {
          alert(
            response.message || "Неизвестная ошибка при скачивании (LanBook)."
          );
        }
      } catch (error) {
        console.error(
          "Error communicating with background script (LanBook):",
          error
        );
        alert("Ошибка связи с расширением (LanBook): " + error.message);
      }
    }
    // --- Логика для Urait ---
    else if (
      hostname === "urait.ru" &&
      (pathname.includes("/course-viewer") || pathname.includes("/viewer/page"))
    ) {
      try {
        // Обновляем состояние кнопки сразу при клике
        updateDownloadButtonState("processing");

        const response = await chrome.runtime.sendMessage({
          action: "DOWNLOAD_SVG_PAGES_URAIT",
        });

        if (response && !response.success) {
          updateDownloadButtonState("error");
          alert(
            response.message || "Неизвестная ошибка при скачивании (Urait)."
          );
        } else if (response && response.success) {
          updateDownloadButtonState("success");
          console.log(response.message);
        }
      } catch (error) {
        console.error(
          "Error communicating with background script (Urait):",
          error
        );
        updateDownloadButtonState("error");
        alert("Ошибка связи с расширением (Urait): " + error.message);
      }
    }
    // --- Логика для iBooks ---
    else if (
      hostname === "ibooks.ru" &&
      (pathname.includes("/reading") ||
        pathname.match(/\/bookshelf\/\d+\/reading/) ||
        pathname.endsWith("/reading"))
    ) {
      try {
        // Обновляем состояние кнопки сразу при клике
        updateDownloadButtonState("processing");

        const success = await downloadIbooks();
        if (success) {
          updateDownloadButtonState("success");
        } else {
          updateDownloadButtonState("error");
        }
      } catch (error) {
        console.error("Error downloading from iBooks:", error);
        updateDownloadButtonState("error");
        alert("Ошибка при скачивании с iBooks: " + error.message);
      }
    } else {
      console.log("Download not supported on this page.");
      alert("Скачивание PDF/SVG не поддерживается на этой странице.");
    }
  }

  // --- Функция для скачивания с iBooks ---
  async function downloadIbooks() {
    let bookshelfEid = null; // eid из URL (334743)
    let bookEid = null; // eid из HTML (771302382)
    let pid = null;

    console.log("=== downloadIbooks() Debug ===");
    console.log("Current URL:", window.location.href);

    // 1. Получаем bookshelfEid из URL
    const bookshelfMatch = window.location.pathname.match(
      /\/bookshelf\/(\d+)\/reading/
    );
    if (bookshelfMatch) {
      bookshelfEid = bookshelfMatch[1];
      console.log("✅ Found bookshelf eid from URL:", bookshelfEid);
    }

    if (!bookshelfEid) {
      console.error("❌ Could not extract bookshelf eid from URL");
      alert("Не удалось определить ID коллекции книг.");
      return false;
    }

    // 2. Получаем bookEid и pid из HTML
    console.log("🔍 Searching for book eid and pid in HTML...");

    // Ищем bookEid в script тегах
    const scripts = document.querySelectorAll("script");
    for (let script of scripts) {
      const content = script.textContent;

      // Ищем var eid = "число"
      const eidMatch = content.match(/var\s+eid\s*=\s*["'](\d+)["']/);
      if (eidMatch) {
        bookEid = eidMatch[1];
        console.log("✅ Found book eid from script:", bookEid);
      }

      // Ищем var pid = "значение"
      const pidMatch = content.match(/var\s+pid\s*=\s*["']([^"']+)["']/);
      if (pidMatch) {
        pid = pidMatch[1];
        console.log("✅ Found pid from script:", pid);
      }

      // Если нашли оба, выходим
      if (bookEid && pid) break;
    }

    // Если не нашли в одном скрипте, продолжаем поиск отдельно
    if (!bookEid) {
      console.log("🔍 Continuing search for book eid...");
      for (let script of scripts) {
        const content = script.textContent;
        const eidMatch = content.match(/var\s+eid\s*=\s*["'](\d+)["']/);
        if (eidMatch) {
          bookEid = eidMatch[1];
          console.log("✅ Found book eid in separate script:", bookEid);
          break;
        }
      }
    }

    if (!pid) {
      console.log("🔍 Continuing search for pid...");
      for (let script of scripts) {
        const content = script.textContent;
        const pidMatch = content.match(/var\s+pid\s*=\s*["']([^"']+)["']/);
        if (pidMatch) {
          pid = pidMatch[1];
          console.log("✅ Found pid in separate script:", pid);
          break;
        }
      }
    }

    if (!bookEid) {
      console.error("❌ Could not find book eid in HTML");
      alert("Не удалось найти ID книги в HTML.");
      return false;
    }

    if (!pid) {
      console.error("❌ Could not find pid in HTML");
      alert("Не удалось найти PID в HTML.");
      return false;
    }

    console.log(
      "🎯 Final values - bookshelfEid:",
      bookshelfEid,
      "bookEid:",
      bookEid,
      "pid:",
      pid
    );

    // 3. Формируем правильный URL для скачивания
    const downloadUrl = `https://ibooks.ru/bookshelf/${bookshelfEid}/reading/${bookEid}/xbook`;
    console.log("🔗 Using download URL:", downloadUrl);

    // 4. Загрузить зашифрованный файл
    let encryptedData;
    try {
      updateDownloadButtonState("processing", "Загрузка книги...");
      const response = await fetch(downloadUrl, {
        credentials: "include",
        headers: {
          Accept: "application/octet-stream",
        },
      });

      console.log(
        "📥 Download response status:",
        response.status,
        response.statusText
      );

      if (!response.ok) {
        console.error(
          "❌ Failed to fetch book file:",
          response.status,
          response.statusText
        );
        alert("Не удалось загрузить файл книги. Статус: " + response.status);
        return false;
      }

      encryptedData = await response.arrayBuffer();
      console.log(
        "✅ Book downloaded successfully, size:",
        encryptedData.byteLength,
        "bytes"
      );
    } catch (e) {
      console.error("❌ Error fetching book data:", e);
      alert("Ошибка при загрузке файла книги: " + e.message);
      return false;
    }

    // 5. Расшифровать (используем bookEid для расшифровки)
    updateDownloadButtonState("processing", "Расшифровка...");
    console.log("🔓 Starting decryption...");
    const decryptedBuffer = decryptIbooks(encryptedData, bookEid, pid);
    if (!decryptedBuffer) {
      console.error("❌ Decryption failed.");
      alert("Ошибка при расшифровке книги.");
      return false;
    }
    console.log(
      "✅ Decryption successful, size:",
      decryptedBuffer.byteLength,
      "bytes"
    );

    // 6. Сохранить как PDF
    try {
      updateDownloadButtonState("processing", "Сохранение...");
      const blob = new Blob([decryptedBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      console.log("💾 Sending download request...");
      console.log("Filename:", `ibook_${bookEid}.pdf`);
      console.log("URL size:", decryptedBuffer.byteLength, "bytes");

      const response = await chrome.runtime.sendMessage({
        action: "DOWNLOAD_FILE",
        url: url,
        filename: `ibook_${bookEid}.pdf`,
      });

      console.log("Background response:", response);

      if (response && response.success) {
        console.log("✅ iBook download completed successfully");
        // Освобождаем URL после успешной отправки
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return true;
      } else {
        console.error("❌ Background reported download failure:", response);
        alert(response?.message || "Ошибка при сохранении файла.");
        URL.revokeObjectURL(url);
        return false;
      }
    } catch (e) {
      console.error("❌ Error creating blob or downloading:", e);
      alert("Ошибка при создании файла: " + e.message);
      return false;
    }
  }

  // --- Функция расшифровки для ibooks.ru ---
  function decryptIbooks(encryptedArrayBuffer, bookEid, pid) {
    console.log("🔐 Starting decryption process...");
    console.log("Using bookEid:", bookEid, "pid:", pid);
    console.log("Input size:", encryptedArrayBuffer.byteLength, "bytes");

    try {
      // 1. Вычисляем хеши
      console.log("📊 Step 1: Calculating hashes...");
      const hash1 = window.CryptoJS.MD5(bookEid).toString(
        window.CryptoJS.enc.Hex
      );
      console.log("Hash1 (MD5 bookEid):", hash1);

      const hash2 = window.CryptoJS.MD5(pid + hash1).toString(
        window.CryptoJS.enc.Hex
      );
      console.log("Hash2 (MD5 pid+hash1):", hash2);

      // Ключ как строка
      const keyStr = hash2;
      console.log("Encryption key string:", keyStr);

      // 2. Подготавливаем ключ
      console.log("🔑 Step 2: Preparing key...");
      const key = window.CryptoJS.enc.Utf8.parse(keyStr);
      console.log("Key parsed successfully");

      // 3. Подготавливаем зашифрованные данные
      console.log("📦 Step 3: Preparing encrypted data...");
      const words = [];
      const bytes = new Uint8Array(encryptedArrayBuffer);

      console.log("Bytes length:", bytes.length);
      console.log("First 10 bytes:", Array.from(bytes.slice(0, 10)));

      // Проверяем, что данные не пустые
      if (bytes.length === 0) {
        console.error("❌ Empty encrypted data");
        return null;
      }

      // Конвертируем Uint8Array в WordArray
      for (let i = 0; i < bytes.length; i += 4) {
        let word = 0;
        for (let j = 0; j < 4; j++) {
          if (i + j < bytes.length) {
            word |= bytes[i + j] << (24 - j * 8);
          }
        }
        words.push(word);
      }

      const ciphertext = window.CryptoJS.lib.WordArray.create(
        words,
        bytes.length
      );
      console.log(
        "Ciphertext prepared, words:",
        words.length,
        "sigBytes:",
        ciphertext.sigBytes
      );

      // 4. Расшифровка
      console.log("🔓 Step 4: Decrypting...");
      const decrypted = window.CryptoJS.AES.decrypt(
        { ciphertext: ciphertext },
        key,
        {
          mode: window.CryptoJS.mode.ECB,
          padding: window.CryptoJS.pad.NoPadding,
        }
      );

      console.log("Decryption completed, sigBytes:", decrypted.sigBytes);

      // Конвертируем результат в ArrayBuffer
      const sigBytes = decrypted.sigBytes;
      const decWords = decrypted.words;
      const u8 = new Uint8Array(sigBytes);

      for (let i = 0; i < sigBytes; i++) {
        const wordIndex = i >>> 2;
        const byteIndexInWord = i & 3;
        u8[i] = (decWords[wordIndex] >>> (24 - byteIndexInWord * 8)) & 0xff;
      }

      console.log(
        "✅ Decryption successful, output size:",
        u8.byteLength,
        "bytes"
      );

      // Проверяем, что это валидный PDF (должен начинаться с '%PDF')
      const decoder = new TextDecoder();
      const header = decoder.decode(u8.slice(0, 10));
      console.log("File header:", header);

      if (header.includes("%PDF")) {
        console.log("✅ Valid PDF file detected");
      } else {
        console.log("⚠️ File header does not look like PDF");
      }

      return u8.buffer;
    } catch (e) {
      console.error("❌ Decryption error:", e);
      console.error("Error stack:", e.stack);
      return null;
    }
  }

  // Проверяем, нужно ли добавлять кнопку *сейчас* (относительно DOM и URL)
  function isDownloadPage() {
    const hostname = window.location.hostname;
    const pathname = window.location.pathname;

    // Проверка для Lanbook
    if (hostname === "reader.lanbook.com" && pathname.includes("/book/")) {
      return true;
    }
    // Проверка для Urait
    if (
      hostname === "urait.ru" &&
      (pathname.includes("/course-viewer") || pathname.includes("/viewer/page"))
    ) {
      return true;
    }
    // Проверка для iBooks
    if (hostname === "ibooks.ru") {
      if (
        pathname.includes("/reading") ||
        pathname.match(/\/bookshelf\/\d+\/reading/) ||
        pathname === "/reading" ||
        pathname.endsWith("/reading")
      ) {
        return true;
      }
    }
    return false;
  }

  // Функция добавления кнопки
  function addDownloadButton() {
    const isPageValid = isDownloadPage();

    // Проверяем, не добавлена ли кнопка уже
    let existingButton = document.getElementById("pdfDownloadBtn");
    if (existingButton) {
      // Если кнопка есть, просто обновим видимость в зависимости от isPageValid
      existingButton.style.display = isPageValid ? "block" : "none";
      console.log(
        `PDF Download button visibility updated. Valid page: ${isPageValid}`
      );
      return;
    }

    // Если кнопка не добавлена, и страница валидна, проверим условия для добавления
    if (isPageValid) {
      const hostname = window.location.hostname;

      // Для LanBook: ждём rdr-reader
      if (hostname === "reader.lanbook.com") {
        const rdrReaderElement = document.querySelector("rdr-reader");
        if (rdrReaderElement) {
          console.log("rdr-reader found in DOM (LanBook).");
          // Создаём и добавляем кнопку
          createAndAddButton();
          return;
        } else {
          console.log("rdr-reader not found yet (LanBook), button will wait.");
          return;
        }
      }
      // Для Urait и iBooks: можно добавить сразу, если URL валиден
      else if (hostname === "urait.ru" || hostname === "ibooks.ru") {
        console.log(`${hostname} viewer URL detected.`);
        createAndAddButton();
        return;
      }
    } else {
      console.log(
        "PDF Downloader: Button not needed on this page (URL check failed)."
      );
    }
  }

  // Вспомогательная функция для создания и добавления кнопки
  function createAndAddButton() {
    const existingButton = document.getElementById("pdfDownloadBtn");
    if (existingButton) {
      // Кнопка уже есть, просто покажем
      existingButton.style.display = "block";
      console.log("PDF Download button shown.");
      return;
    }

    const button = document.createElement("button");
    button.id = "pdfDownloadBtn";
    // Уточним текст кнопки в зависимости от сайта
    const hostname = window.location.hostname;
    button.textContent = "Сохранить книгу"


    button.style.cssText = `
          position: fixed;
          top: 10px;
          right: 10px;
          z-index: 10000;
          padding: 10px 15px;
          background-color: #07c4d9;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          font-family: Arial, sans-serif;
      `;
    button.onclick = downloadPdf;

    document.body.appendChild(button);
    console.log("PDF Download button added.");
  }

  // Функция управления кнопкой
  function updateDownloadButtonState(state, text = "") {
    const button = document.getElementById("pdfDownloadBtn");
    if (!button) return;

    const hostname = window.location.hostname;
    let baseText = "Сохранить книгу";


    switch (state) {
      case "downloading":
        button.textContent = text;
        button.style.backgroundColor = "#D99507";
        button.disabled = true;
        break;

      case "processing":
        button.textContent = text || "Обработка...";
        button.style.backgroundColor = "#307B84";
        button.disabled = true;
        break;

      case "success":
        button.textContent = "Готово!";
        button.style.backgroundColor = "#07D978";
        button.disabled = false;
        setTimeout(() => updateDownloadButtonState("ready"), 2000);
        break;

      case "ready":
      default:
        button.textContent = baseText;
        button.style.backgroundColor = "#07c4d9";
        button.disabled = false;
        break;
    }
  }

  // --- Инициализация ---
  console.log("Initializing PDF Downloader content script...");

  // Попробуем добавить кнопку сразу
  addDownloadButton();

  // Наблюдаем за изменениями в DOM
  const observer = new MutationObserver(function (mutations) {
    let rdrReaderFound = false;
    for (let mutation of mutations) {
      if (mutation.type === "childList") {
        for (let node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            if (node.tagName.toLowerCase() === "rdr-reader") {
              rdrReaderFound = true;
              break;
            }
            if (node.querySelector && node.querySelector("rdr-reader")) {
              rdrReaderFound = true;
              break;
            }
          }
        }
      }
      if (rdrReaderFound) break;
    }
    if (
      rdrReaderFound &&
      window.location.hostname === "reader.lanbook.com" &&
      window.location.pathname.includes("/book/")
    ) {
      console.log("rdr-reader appeared in DOM via MutationObserver (LanBook).");
      addDownloadButton();
    }
  });

  // Начинаем наблюдение
  observer.observe(document.body, { childList: true, subtree: true });

  // Обновляем кнопку при изменении URL
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    originalPushState.apply(history, args);
    setTimeout(() => {
      addDownloadButton();
      console.log("URL changed via pushState, checked button.");
    }, 100);
  };

  history.replaceState = function (...args) {
    originalReplaceState.apply(history, args);
    setTimeout(() => {
      addDownloadButton();
      console.log("URL changed via replaceState, checked button.");
    }, 100);
  };

  window.addEventListener("popstate", function () {
    setTimeout(() => {
      addDownloadButton();
      console.log("URL changed via popstate, checked button.");
    }, 100);
  });

  // Обработчик сообщений о прогрессе скачивания
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "DOWNLOAD_PROGRESS_UPDATE") {
      updateDownloadButtonState(
        "downloading",
        `Страница ${request.currentPage}`
      );
    }
    return false;
  });

  console.log("PDF Downloader content script initialized.");
}

// Запускаем инициализацию когда DOM готов
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initContentScript);
} else {
  initContentScript();
}

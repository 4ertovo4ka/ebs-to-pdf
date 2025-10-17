let svgCollection = {};
const downloadProgress = {};

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('PdfDownloaderDB', 1);

    request.onerror = (event) => {
      console.error('IndexedDB error:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('svgBooks')) {
        const objectStore = db.createObjectStore('svgBooks', { keyPath: 'bookId' });
        console.log('IndexedDB object store "svgBooks" created.');
      }
    };
  });
}

// --- Функция для сохранения данных книги в IndexedDB ---
async function saveSvgDataToDB(bookId, svgArray) {
  const db = await openDB();
  const transaction = db.transaction(['svgBooks'], 'readwrite');
  const store = transaction.objectStore('svgBooks');

  const dataToStore = {
    bookId: bookId,
    svgPages: svgArray,
    timestamp: Date.now()
  };

  const request = store.put(dataToStore);

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      console.log(`SVG data for book ${bookId} saved to IndexedDB.`);
      resolve();
    };
    request.onerror = (event) => {
      console.error(`Error saving SVG data for book ${bookId} to IndexedDB:`, event.target.error);
      reject(event.target.error);
    };
  });
}

// --- Функция для удаления данных книги из IndexedDB ---
async function deleteSvgDataFromDB(bookId) {
  const db = await openDB();
  const transaction = db.transaction(['svgBooks'], 'readwrite');
  const store = transaction.objectStore('svgBooks');

  const request = store.delete(bookId);

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      console.log(`SVG data for book ${bookId} deleted from IndexedDB.`);
      resolve();
    };
    request.onerror = (event) => {
      console.error(`Error deleting SVG data for book ${bookId} from IndexedDB:`, event.target.error);
      resolve(); // Не критичная ошибка
    };
  });
}

// --- Функция для загрузки страниц методом грубого перебора ---
async function fetchPagesBruteForceCollectingContent(tabId, bookId) {
  console.log(`Fetching pages for book ${bookId} from Urait...`);

  let pageNum = 1;
  let successCount = 0;
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 5;

  while (consecutiveErrors < maxConsecutiveErrors) {
    console.log(`Fetching page ${pageNum}...`);

    // Отправляем прогресс в content script
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'DOWNLOAD_PROGRESS_UPDATE',
        currentPage: pageNum
      });
    } catch (error) {
      console.log('Cannot send progress update:', error);
    }

    const pageUrl = `https://urait.ru/viewer/page/${bookId}/${pageNum}`; // Убраны пробелы

    try {
      const fetchResult = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: 'MAIN',
        func: async (url) => {
          try {
            const response = await fetch(url);
            if (response.status === 404) {
              return { status: 404, svgContent: null, error: null };
            }
            if (!response.ok) {
              return { status: response.status, svgContent: null, error: `HTTP error! status: ${response.status}` };
            }
            const svgContent = await response.text();
            return { status: 200, svgContent: svgContent, error: null };
          } catch (fetchError) {
            console.error(`Fetch error for ${url}:`, fetchError);
            return { status: null, svgContent: null, error: `Fetch error: ${fetchError.message}` };
          }
        },
        args: [pageUrl]
      });

      if (fetchResult?.[0]?.result) {
        const resultFromPage = fetchResult[0].result;

        if (resultFromPage.status === 404) {
          console.log(`Page ${pageNum} not found (404). Assuming end of book.`);
          consecutiveErrors = maxConsecutiveErrors;
          break;
        } else if (resultFromPage.status === 200 && resultFromPage.svgContent) {
          console.log(`Received SVG content for page ${pageNum}`);
          svgCollection[bookId].pages.push(resultFromPage.svgContent);
          successCount++;
          consecutiveErrors = 0;
        } else {
          console.error(`Error fetching page ${pageNum}`);
          consecutiveErrors++;
        }
      } else {
        console.error(`Script execution failed for page ${pageNum}`);
        consecutiveErrors++;
      }
    } catch (error) {
      console.error(`Error executing script for page ${pageNum}:`, error);
      consecutiveErrors++;
    }
    pageNum++;
  }

  console.log(`Finished fetching pages for book ${bookId}. Collected: ${successCount}`);
  return successCount;
}

// --- Обработчик LanBook PDF download ---
async function handleLanBookDownload(sender, sendResponse) {
  if (!sender.tab || !sender.url?.includes('reader.lanbook.com/book/')) {
    sendResponse({ success: false, message: 'Скачивание не поддерживается на этой странице (LanBook).' });
    return;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: () => {
        console.log('Running download script in MAIN world context via background script (LanBook).');
        const app = window.PDFViewerApplication;
        const transport = app?.pdfDocument?.loadingTask?._transport;

        if (transport?._params?.data) {
          console.log('Found Uint8Array document data in main world (LanBook).');
          const pdfData = transport._params.data;
          const blob = new Blob([pdfData], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          const bookId = window.location.pathname.split('/').pop() || 'downloaded_book';
          link.download = `book_${bookId}_original.pdf`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          console.log('PDF file created and downloading (LanBook).');
          return { success: true, message: 'PDF скачан (LanBook).' };
        } else {
          console.log('Uint8Array data not found in main world (LanBook).');
          return { success: false, message: 'PDF ещё не загружен или не удалось извлечь данные (LanBook). Убедитесь, что страница полностью открыта.' };
        }
      }
    });

    if (results?.[0]?.result) {
      sendResponse(results[0].result);
    } else {
      sendResponse({ success: false, message: 'Ошибка выполнения скрипта (LanBook).' });
    }
  } catch (error) {
    console.error('Error executing script in main world (LanBook):', error);
    sendResponse({ success: false, message: 'Ошибка выполнения скрипта (LanBook): ' + error.message });
  }
}

// --- Обработчик Urait SVG download ---
async function handleUraitSvgDownload(sender, sendResponse) {
  if (!sender.tab || !(sender.url?.includes('urait.ru/course-viewer') || sender.url?.includes('urait.ru/viewer/page'))) {
    sendResponse({ success: false, message: 'Скачивание не поддерживается на этой странице (Urait).' });
    return;
  }

  console.log('Initiating Urait page download process -> Collecting SVG content...');

  try {
    // Получаем bookId из текущей страницы
    const results = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: () => {
        const pathParts = window.location.pathname.split('/');
        const bookId = pathParts.find(part => /^[A-F0-9-]+$/.test(part) && part.includes('-'));
        return { bookId };
      }
    });

    if (!results?.[0]?.result) {
      sendResponse({ success: false, message: 'Не удалось получить информацию о книге с Urait.' });
      return;
    }

    const { bookId } = results[0].result;
    console.log(`Book ID found: ${bookId}`);

    if (!bookId) {
      sendResponse({ success: false, message: 'Не удалось определить ID книги на Urait.' });
      return;
    }

    // Инициализируем коллекцию для этой книги
    svgCollection[bookId] = { pages: [], completed: 0, totalExpected: null };

    // Собираем страницы
    const totalDownloaded = await fetchPagesBruteForceCollectingContent(sender.tab.id, bookId);
    svgCollection[bookId].totalExpected = totalDownloaded;

    console.log(`Collected ${totalDownloaded} SVG pages for ${bookId}. Saving to IndexedDB...`);

    const pagesToSave = svgCollection[bookId].pages;
    delete svgCollection[bookId]; // Освобождаем память

    // Сохраняем в IndexedDB
    await saveSvgDataToDB(bookId, pagesToSave);
    console.log(`SVG pages saved to IndexedDB for book ${bookId}.`);

    // Создаем вкладку для сборки PDF
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('pdf-assembler.html') });
    console.log(`PDF assembler tab opened: ${tab.id}`);

    // Ждем загрузки вкладки и отправляем сообщение
    setTimeout(async () => {
      try {
        await chrome.runtime.sendMessage({
          action: 'INITIATE_PDF_ASSEMBLY',
          bookId: bookId
        });
        console.log('Initiation message sent to assembler page.');
        sendResponse({ success: true, message: `Сбор данных для книги ${bookId} завершён. Открыта страница для создания PDF.` });
      } catch (error) {
        console.error('Error sending initiation message to assembler page:', error);
        // Удаляем данные, если сообщение не дошло
        await deleteSvgDataFromDB(bookId).catch(err =>
          console.error('Error deleting data after message failure:', err)
        );
        sendResponse({ success: false, message: 'Ошибка при открытии страницы сборки PDF.' });
      }
    }, 2000);

  } catch (error) {
    console.error('Error in Urait download process:', error);
    sendResponse({ success: false, message: `Ошибка сбора данных: ${error.message}` });
  }
}

// --- Функция для обработки скачивания файлов (iBooks) ---
async function handleFileDownload(request, sendResponse) {
  console.log('📥 Handling file download request:', request.filename);

  try {
    // Используем chrome.downloads API для скачивания файла
    const downloadId = await chrome.downloads.download({
      url: request.url,
      filename: request.filename,
      saveAs: true, // Показываем диалог сохранения
      conflictAction: 'uniquify' // Добавляем номер если файл уже существует
    });

    console.log(`✅ Download started with ID: ${downloadId}`);

    // Отслеживаем статус скачивания
    const downloadListener = (delta) => {
      if (delta.id === downloadId) {
        console.log('Download delta:', delta);

        if (delta.state && delta.state.current === 'complete') {
          console.log(`✅ Download completed: ${request.filename}`);
          // Освобождаем URL после успешного скачивания
          URL.revokeObjectURL(request.url);
          chrome.downloads.onChanged.removeListener(downloadListener);
          // Отправляем успешный ответ если еще не отправлен
          if (!responseSent) {
            responseSent = true;
            sendResponse({ success: true, message: 'Файл успешно скачан' });
          }
        } else if (delta.state && delta.state.current === 'interrupted') {
          console.error(`❌ Download interrupted: ${request.filename}`);
          URL.revokeObjectURL(request.url);
          chrome.downloads.onChanged.removeListener(downloadListener);
          if (!responseSent) {
            responseSent = true;
            sendResponse({
              success: false,
              message: 'Скачивание прервано. Попробуйте еще раз.'
            });
          }
        }
      }
    };

    let responseSent = false;
    chrome.downloads.onChanged.addListener(downloadListener);

    // Таймаут на случай если событие не придет
    setTimeout(() => {
      if (!responseSent) {
        responseSent = true;
        console.log('⚠️ Download timeout, assuming success');
        sendResponse({
          success: true,
          message: 'Запрос на скачивание отправлен. Проверьте папку загрузок.'
        });
      }
    }, 3000);

  } catch (error) {
    console.error('❌ Error handling file download:', error);

    // Fallback: используем старый метод если chrome.downloads не доступен
    try {
      console.log('🔄 Trying fallback download method...');
      const link = document.createElement('a');
      link.href = request.url;
      link.download = request.filename;

      // Создаем временный контейнер
      const container = document.createElement('div');
      container.style.display = 'none';
      container.appendChild(link);
      document.body.appendChild(container);

      // Имитируем клик
      link.click();

      // Очищаем через некоторое время
      setTimeout(() => {
        document.body.removeChild(container);
        URL.revokeObjectURL(request.url);
      }, 1000);

      console.log('✅ Fallback download initiated');
      sendResponse({
        success: true,
        message: 'Файл скачивается через fallback метод'
      });

    } catch (fallbackError) {
      console.error('❌ Fallback download method also failed:', fallbackError);
      sendResponse({
        success: false,
        message: `Ошибка при скачивании: ${error.message}. Fallback также не сработал: ${fallbackError.message}`
      });
    }
  }

  return true; // Сообщаем, что ответ будет асинхронным
}

// --- Обработчик удаления данных из DB ---
async function handleDeleteSvgData(request) {
  console.log(`Received deletion request for book ${request.bookId} from assembler page.`);
  try {
    await deleteSvgDataFromDB(request.bookId);
    console.log(`Deletion confirmed for book ${request.bookId}.`);
  } catch (error) {
    console.error(`Error deleting data for book ${request.bookId} from DB:`, error);
  }
}

// --- Главный обработчик сообщений ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request);

  // Обработка асинхронных запросов
  if (request.action === 'DOWNLOAD_PDF_LANBOOK') {
    handleLanBookDownload(sender, sendResponse);
    return true; // Сообщаем, что ответ будет асинхронным
  }

  else if (request.action === 'DOWNLOAD_SVG_PAGES_URAIT') {
    handleUraitSvgDownload(sender, sendResponse);
    return true; // Сообщаем, что ответ будет асинхронным
  }

  else if (request.action === 'DELETE_SVG_DATA_FROM_DB' && request.bookId) {
    handleDeleteSvgData(request);
    // Не требуется sendResponse для этого действия
  }
  // --- НОВЫЙ ОБРАБОТЧИК ДЛЯ iBOOKS ---
  else if (request.action === 'DOWNLOAD_FILE' && request.url && request.filename) {
    handleFileDownload(request, sendResponse);
    return true; // Сообщаем, что ответ будет асинхронным
  }

  // Для синхронных запросов sendResponse не вызывается явно
  return false;
});

console.log('Background script initialized.');
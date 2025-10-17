// Импортируем библиотеки через npm
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

console.log('PDF Assembler page loaded.');

// --- Глобальные переменные ---
let bookId = null;
let svgContentArray = [];

// --- Функция для открытия IndexedDB ---
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
    });
}

// --- Функция для загрузки данных книги из IndexedDB ---
async function loadSvgDataFromDB(bookIdToLoad) {
    const db = await openDB();
    const transaction = db.transaction(['svgBooks'], 'readonly');
    const store = transaction.objectStore('svgBooks');

    const request = store.get(bookIdToLoad);

    return new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
            const result = event.target.result;
            if (result) {
                console.log(`Retrieved ${result.svgPages.length} SVG pages for book ${bookIdToLoad} from IndexedDB.`);
                resolve(result.svgPages);
            } else {
                console.error(`No stored data found for book ID: ${bookIdToLoad} in IndexedDB.`);
                reject(new Error(`No stored data found for book ID: ${bookIdToLoad}`));
            }
        };
        request.onerror = (event) => {
            console.error(`Error retrieving SVG data for book ${bookIdToLoad} from IndexedDB:`, event.target.error);
            reject(event.target.error);
        };
    });
}

// --- Функция для удаления данных книги из IndexedDB ---
async function deleteSvgDataFromDB(bookIdToDelete) {
    try {
        await chrome.runtime.sendMessage({
            action: 'DELETE_SVG_DATA_FROM_DB',
            bookId: bookIdToDelete
        });
        console.log(`Deletion request for book ${bookIdToDelete} sent to background.`);
    } catch (error) {
        console.error(`Error sending deletion request for book ${bookIdToDelete} to background:`, error);
    }
}

// --- Функция сборки PDF из массива строк SVG ---
async function assemblePdfFromContentArray(svgArray) {
    if (!Array.isArray(svgArray) || svgArray.length === 0) {
        console.error('No SVG content provided for PDF assembly.');
        document.getElementById('status').textContent = 'Ошибка: Нет данных для сборки.';
        if (bookId) {
            try {
                await deleteSvgDataFromDB(bookId);
            } catch (err) {
                console.error('Error deleting data after array error:', err);
            }
        }
        return;
    }

    console.log('Starting PDF assembly from content array.');
    document.getElementById('status').textContent = `Создаю PDF из ${svgArray.length} страниц...`;

    // Инициализация PDF с размером A4
    const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4'
    });

    let isFirstPage = true;
    const progressBarDiv = document.getElementById('progressBar').children[0];
    const total = svgArray.length;
    const renderContainer = document.getElementById('svg-render-container');

    // Размеры A4 в точках (pt)
    const A4_WIDTH = 595.28;
    const A4_HEIGHT = 841.89;

    for (let i = 0; i < total; i++) {
        const svgString = svgArray[i];
        console.log(`Processing page ${i + 1}/${total}`);

        progressBarDiv.style.width = `${((i + 1) / total) * 100}%`;
        document.getElementById('status').textContent = `Обрабатываю страницу ${i + 1} из ${total}...`;

        try {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = svgString;
            const svgElement = tempDiv.querySelector('svg');

            if (!svgElement) {
                console.error(`No <svg> element found in page ${i + 1}.`);
                document.getElementById('status').textContent = `Ошибка: Нет элемента <svg> на странице ${i + 1}.`;
                try {
                    await deleteSvgDataFromDB(bookId);
                } catch (err) {
                    console.error('Error deleting data after SVG element error:', err);
                }
                return;
            }

            // Определение размеров SVG
            let svgWidth, svgHeight;
            const viewBox = svgElement.getAttribute('viewBox');

            if (viewBox) {
                const vb = viewBox.split(' ').map(Number);
                if (vb.length === 4) {
                    svgWidth = vb[2];
                    svgHeight = vb[3];
                    console.log(`Using viewBox dimensions: ${svgWidth} x ${svgHeight}`);
                }
            }

            // Если viewBox нет, используем width/height атрибуты
            if (!svgWidth || !svgHeight) {
                svgWidth = parseFloat(svgElement.getAttribute('width')) || A4_WIDTH;
                svgHeight = parseFloat(svgElement.getAttribute('height')) || A4_HEIGHT;
                console.log(`Using width/height attributes: ${svgWidth} x ${svgHeight}`);
            }

            // Масштабирование под A4
            const scaleX = A4_WIDTH / svgWidth;
            const scaleY = A4_HEIGHT / svgHeight;
            const scale = Math.min(scaleX, scaleY);

            const scaledWidth = svgWidth * scale;
            const scaledHeight = svgHeight * scale;
            const offsetX = (A4_WIDTH - scaledWidth) / 2;
            const offsetY = (A4_HEIGHT - scaledHeight) / 2;

            console.log(`Original SVG: ${svgWidth}x${svgHeight}, Scaled: ${scaledWidth}x${scaledHeight}, Scale: ${scale}`);

            // Настройка стилей для рендеринга
            const tempDivWidthPx = svgWidth;
            const tempDivHeightPx = svgHeight;

            tempDiv.style.width = `${tempDivWidthPx}px`;
            tempDiv.style.height = `${tempDivHeightPx}px`;
            tempDiv.style.display = 'block';
            tempDiv.style.overflow = 'visible';
            tempDiv.style.margin = '0';
            tempDiv.style.padding = '0';
            tempDiv.style.border = 'none';
            tempDiv.style.position = 'relative';
            tempDiv.style.boxSizing = 'border-box';

            // Настройки SVG элемента
            svgElement.style.width = '100%';
            svgElement.style.height = '100%';
            svgElement.style.margin = '0';
            svgElement.style.padding = '0';
            svgElement.style.border = 'none';
            svgElement.style.display = 'block';

            // Явно устанавливаем viewBox если его нет
            if (!viewBox) {
                svgElement.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
            }

            renderContainer.innerHTML = '';
            renderContainer.appendChild(tempDiv);

            // Рендеринг с высоким качеством
            const renderScale = 3;
            const canvas = await html2canvas(tempDiv, {
                scale: renderScale,
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#FFFFFF',
                logging: false,
                width: tempDivWidthPx,
                height: tempDivHeightPx
            });

            console.log(`Canvas rendered: ${canvas.width} x ${canvas.height} px`);

            // Добавление страницы в PDF
            if (!isFirstPage) {
                pdf.addPage();
            } else {
                isFirstPage = false;
            }

            // Устанавливаем текущую страницу как A4
            pdf.setPage(pdf.internal.getNumberOfPages());

            // Добавляем canvas с правильным масштабированием и центрированием
            pdf.addImage({
                imageData: canvas,
                x: offsetX,
                y: offsetY,
                width: scaledWidth,
                height: scaledHeight,
                compression: 'FAST'
            });

            renderContainer.removeChild(tempDiv);

        } catch (error) {
            console.error(`Error processing SVG page ${i + 1} with html2canvas:`, error);
            document.getElementById('status').textContent = `Ошибка при обработке страницы ${i + 1} (html2canvas).`;
            try {
                await deleteSvgDataFromDB(bookId);
            } catch (err) {
                console.error('Error deleting data after html2canvas error:', err);
            }
            renderContainer.innerHTML = '';
            return;
        }
    }

    // Сохранение PDF
    console.log('PDF assembly complete. Saving...');
    document.getElementById('status').textContent = 'Сохраняю PDF...';

    try {
        const pdfBlob = pdf.output('blob');
        const pdfUrl = URL.createObjectURL(pdfBlob);

        const link = document.createElement('a');
        link.href = pdfUrl;
        link.download = `book_${bookId}_assembled.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(pdfUrl);

        console.log('PDF saved.');
        document.getElementById('status').textContent = 'PDF успешно создан и скачивается!';
        progressBarDiv.style.width = '100%';

    } catch (outputError) {
        console.error('Error during pdf.output() or subsequent steps:', outputError);
        document.getElementById('status').textContent = `Ошибка при сохранении PDF: ${outputError.message || outputError}`;
        try {
            await deleteSvgDataFromDB(bookId);
        } catch (err) {
            console.error('Error deleting data after output error:', err);
        }
        return;
    }

    renderContainer.innerHTML = '';

    try {
        await deleteSvgDataFromDB(bookId);
    } catch (err) {
        console.error('Error deleting data after assembly:', err);
    }
}

// --- Обработчик сообщений от background ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('PDF Assembler received message:', request);
    if (sender.id === chrome.runtime.id && request.action === 'INITIATE_PDF_ASSEMBLY' && request.bookId) {
        bookId = request.bookId;
        console.log(`Initiation received for book ${bookId}. Fetching SVG data from IndexedDB...`);
        document.getElementById('status').textContent = `Получаю данные для книги ${bookId} из IndexedDB...`;

        // Загружаем данные из IndexedDB
        loadSvgDataFromDB(bookId)
            .then((retrievedSvgArray) => {
                svgContentArray = retrievedSvgArray;
                // Запускаем сборку PDF сразу, так как библиотеки уже импортированы
                assemblePdfFromContentArray(svgContentArray);
            })
            .catch(error => {
                console.error(`Error retrieving SVG data for book ${bookId} from IndexedDB:`, error);
                document.getElementById('status').textContent = `Ошибка при получении данных: ${error.message || error}`;
            });
    }
    return false;
});

console.log('PDF Assembler script initialized, waiting for message.');
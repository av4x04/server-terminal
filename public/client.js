// public/client.js
const term = new Terminal({
  theme: {
    background: 'transparent',
    foreground: '#e6eef2',
    cursor: '#00d084',
    selection: 'rgba(0, 208, 132, 0.3)',
  },
  fontSize: 14,
  fontFamily: 'Menlo, "DejaVu Sans Mono", Consolas, "Lucida Console", monospace',
  cursorBlink: true,
  cursorStyle: 'block',
  allowTransparency: true
});

term.open(document.getElementById('terminal'));

const socket = io();

// --- DOM Elements & Loader Logic ---
const statusText = document.getElementById('status-text');
const loader = document.getElementById('loader');
const loaderText = document.getElementById('loader-text');
const terminalContainer = document.getElementById('terminal');

function showLoader(text) {
  loaderText.textContent = text;
  loader.style.display = 'flex';
  terminalContainer.style.opacity = '0.2';
}

function hideLoader() {
  loader.style.display = 'none';
  terminalContainer.style.opacity = '1';
  term.focus();
}


// --- Socket Event Handlers ---

// Khi người dùng gõ phím trong terminal trên trình duyệt
term.onData(data => {
  // Gửi dữ liệu đó đến server
  socket.emit('input', data);
});

// Khi server gửi dữ liệu output về
socket.on('output', data => {
  // Ghi dữ liệu đó vào terminal trên trình duyệt
  term.write(data);
});

// Khi nhận lịch sử terminal từ server
socket.on('history', history => {
  term.write(history);
});

// Xử lý resize terminal
function resizeTerminal() {
  const cols = term.cols;
  const rows = term.rows;
  socket.emit('resize', { cols, rows });
}

// Resize khi thay đổi kích thước cửa sổ
window.addEventListener('resize', resizeTerminal);

// Resize ban đầu
resizeTerminal();

// Khi kết nối thành công
socket.on('connect', () => {
  console.log('🟢 Đã kết nối đến server');
  statusText.textContent = 'Đã kết nối';
  hideLoader();
});

// Khi mất kết nối
socket.on('disconnect', () => {
  console.log('🔴 Mất kết nối với server');
  statusText.textContent = 'Mất kết nối';
  showLoader('Mất kết nối. Đang thử lại... ⏳');
  term.write('\x1b[31m⚠️  Mất kết nối với server. Đang thử kết nối lại...\x1b[0m\r\n');
});

socket.on('connect_error', () => {
    statusText.textContent = 'Lỗi kết nối';
    showLoader('Không thể kết nối! 😭');
});


// Initial state
showLoader('Đang vỗ cánh kết nối...');

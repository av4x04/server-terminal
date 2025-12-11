
// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const fs = require('fs').promises; 
const fsSync = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const cp = require('child_process');

// Robust Library Loading
let pty;
try {
    pty = require('node-pty');
} catch (e) {
    console.warn("WARNING: node-pty not found or failed to load. Falling back to basic shell.");
}

let puppeteer;
try { puppeteer = require('puppeteer'); } catch(e) { console.warn("Puppeteer not installed."); }

const app = express();
const server = http.createServer(app);

// Upload Configuration
const upload = multer({ dest: os.tmpdir() });

const io = new Server(server, {
  pingInterval: 25000,
  pingTimeout: 60000,
  maxHttpBufferSize: 1e8, // 100MB socket limit
  cors: { origin: '*' }
});

// Shell detection
const IS_WIN = os.platform() === 'win32';
const SHELL = IS_WIN ? 'powershell.exe' : (fsSync.existsSync('/bin/bash') ? '/bin/bash' : 'sh');
const HOME_DIR = process.env.HOME || process.cwd();
const GLOBAL_TERM_ID = 'main-server-term'; 

// --- Shared Desktop State ---
let desktopState = {
    windows: {}, 
    zIndexCounter: 100
};

const activeResources = {
    terminals: new Map(),
    browsers: new Map()
};

// --- HTTP Routes ---
app.get('/api/download', (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send('Missing path');
    try {
        if (!fsSync.existsSync(filePath)) return res.status(404).send('File not found');
        res.download(filePath, (err) => {
            if (err && !res.headersSent) res.status(500).send('Access denied');
        });
    } catch (e) { res.status(500).send('Error'); }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const targetDir = req.body.path || HOME_DIR;
        const tempPath = req.file.path;
        const targetPath = path.join(targetDir, req.file.originalname);
        await fs.copyFile(tempPath, targetPath);
        await fs.unlink(tempPath);
        io.emit('fs-change', { path: targetDir });
        res.json({ success: true, path: targetPath });
    } catch (e) {
        console.error("Upload error:", e);
        res.status(500).json({ error: e.message });
    }
});

// --- Puppeteer (Persistent Chrome) ---
async function createBrowserSession(windowId, startUrl = 'https://www.google.com') {
    if (!puppeteer) return null;
    if (activeResources.browsers.has(windowId)) return activeResources.browsers.get(windowId);

    try {
        console.log(`Launching Browser for ${windowId}...`);
        const browser = await puppeteer.launch({
            headless: 'new',
            ignoreHTTPSErrors: true,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
                '--single-process', '--disable-gpu', '--window-size=1280,720'
            ]
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1024, height: 680 });
        await page.setRequestInterception(false); // Enable images
        try { await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }); } catch(e) {}

        const resource = { browser, page, lastFrame: null, lastUrl: startUrl };
        activeResources.browsers.set(windowId, resource);

        const sendFrame = async () => {
            if (!activeResources.browsers.has(windowId)) return;
            try {
                const screenshot = await page.screenshot({ type: 'jpeg', quality: 65, encoding: 'base64' });
                resource.lastFrame = screenshot;
                io.to(windowId).emit('browser-frame', { id: windowId, data: screenshot });
                if(page.url() !== resource.lastUrl) {
                    resource.lastUrl = page.url();
                    io.to(windowId).emit('browser-url', { id: windowId, url: resource.lastUrl });
                }
            } catch (e) {
                if(e.message.includes('Target closed') || e.message.includes('Session closed')) resource.cleanup();
            }
        };

        const interval = setInterval(sendFrame, 200); // 5 FPS
        resource.triggerUpdate = async () => await sendFrame();
        resource.cleanup = async () => {
            clearInterval(interval);
            activeResources.browsers.delete(windowId);
            try { await browser.close(); } catch(e) {}
        };
        return resource;
    } catch (e) { 
        console.error("Browser Launch Error:", e);
        return null; 
    }
}

// --- Terminal Logic (Robust) ---
const HISTORY_LIMIT = 1024 * 50;
class RingBuffer {
  constructor(limitBytes) {
    this.buf = Buffer.allocUnsafe(limitBytes);
    this.limit = limitBytes;
    this.start = 0; this.len = 0;
  }
  append(input) {
    const b = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
    if (b.length >= this.limit) {
      b.copy(this.buf, 0, b.length - this.limit);
      this.start = 0; this.len = this.limit; return;
    }
    const free = this.limit - this.len;
    if (b.length > free) {
      this.start = (this.start + (b.length - free)) % this.limit;
      this.len = this.limit;
    } else { this.len += b.length; }
    const writePos = (this.start + this.len - b.length) % this.limit;
    const firstPart = Math.min(b.length, this.limit - writePos);
    b.copy(this.buf, writePos, 0, firstPart);
    if (firstPart < b.length) b.copy(this.buf, 0, firstPart);
  }
  toString(enc = 'utf8') {
    if (this.len === 0) return '';
    if (this.start + this.len <= this.limit) return this.buf.slice(this.start, this.start + this.len).toString(enc);
    const tailLen = (this.start + this.len) - this.limit;
    return Buffer.concat([this.buf.slice(this.start, this.limit), this.buf.slice(0, tailLen)]).toString(enc);
  }
}

function createTerminal(forcedId = null) {
  const id = forcedId || uuidv4();
  if (activeResources.terminals.has(id)) return activeResources.terminals.get(id);

  let ptyProc = null;
  let isRaw = false;

  // Try node-pty first
  if (pty) {
    try {
        ptyProc = pty.spawn(SHELL, [], {
            name: 'xterm-256color', cols: 80, rows: 30, cwd: HOME_DIR, env: process.env
        });
        isRaw = true;
    } catch (err) { console.error("PTY Spawn Failed, trying fallback:", err); }
  }

  // Fallback to child_process if node-pty failed or missing
  if (!ptyProc) {
      console.log("Using child_process fallback for terminal");
      try {
          ptyProc = cp.spawn(SHELL, [], { cwd: HOME_DIR, env: process.env, shell: true });
          // Emulate basic PTY interface
          ptyProc.resize = () => {}; 
          ptyProc.write = (data) => { if(ptyProc.stdin) ptyProc.stdin.write(data); };
          
          // In fallback mode, we need to pipe stdout/stderr manually
          ptyProc.onData = (fn) => {
              ptyProc.stdout.on('data', fn);
              ptyProc.stderr.on('data', fn);
          };
      } catch(e) {
          console.error("Fatal: Cannot spawn any shell");
          return null;
      }
  }

  const session = { id, name: `Term ${id}`, pty: ptyProc, history: new RingBuffer(HISTORY_LIMIT) };

  const handleData = (d) => {
      // Ensure data is sent as string to avoid binary issues on client
      const text = d.toString('utf8');
      session.history.append(text);
      io.emit('term-output', { sessionId: id, data: text });
  };

  if (isRaw) {
      ptyProc.on('data', handleData);
  } else {
      // Fallback mode listeners
      if(ptyProc.stdout) ptyProc.stdout.on('data', handleData);
      if(ptyProc.stderr) ptyProc.stderr.on('data', handleData);
  }

  ptyProc.on('exit', () => {
      console.log('Terminal exited:', id);
      if (id === GLOBAL_TERM_ID) {
          activeResources.terminals.delete(id);
          createTerminal(GLOBAL_TERM_ID);
      } else {
          activeResources.terminals.delete(id);
      }
  });

  activeResources.terminals.set(id, session);
  return session;
}

// Create Main Terminal
createTerminal(GLOBAL_TERM_ID);

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  socket.emit('desktop-sync', desktopState);
  
  // --- WINDOWS EVENTS ---
  socket.on('window-open', (data) => {
      const id = 'win-' + uuidv4().substr(0, 8);
      desktopState.zIndexCounter++;
      const win = {
          id, type: data.type, title: data.title || 'App',
          x: 100 + (Math.random()*50), y: 50 + (Math.random()*50), 
          width: data.width || 600, height: data.height || 400,
          minimized: false, zIndex: desktopState.zIndexCounter
      };
      desktopState.windows[id] = win;
      io.emit('window-created', win);
      if (data.type === 'browser') createBrowserSession(id);
  });

  socket.on('window-move', ({ id, x, y }) => {
      if (desktopState.windows[id]) {
          desktopState.windows[id].x = x; desktopState.windows[id].y = y;
          socket.broadcast.emit('window-update-pos', { id, x, y });
      }
  });

  socket.on('window-resize', ({ id, width, height }) => {
      if (desktopState.windows[id]) {
          desktopState.windows[id].width = width; desktopState.windows[id].height = height;
          socket.broadcast.emit('window-update-size', { id, width, height });
          const b = activeResources.browsers.get(id);
          if (b) { b.page.setViewport({ width, height }).catch(()=>{}); b.triggerUpdate(); }
      }
  });

  socket.on('window-focus', ({ id }) => {
      if (desktopState.windows[id]) {
          desktopState.zIndexCounter++;
          desktopState.windows[id].zIndex = desktopState.zIndexCounter;
          desktopState.windows[id].minimized = false;
          io.emit('window-update-z', { id, zIndex: desktopState.zIndexCounter });
          io.emit('window-update-state', { id, minimized: false });
      }
  });

  socket.on('window-minimize', ({ id }) => {
      if (desktopState.windows[id]) {
          desktopState.windows[id].minimized = !desktopState.windows[id].minimized;
          io.emit('window-update-state', { id, minimized: desktopState.windows[id].minimized });
      }
  });

  socket.on('window-close', ({ id }) => {
      if (desktopState.windows[id]) {
          delete desktopState.windows[id];
          io.emit('window-removed', { id });
          const b = activeResources.browsers.get(id);
          if (b) b.cleanup();
      }
  });

  // --- BROWSER EVENTS ---
  socket.on('join-window-stream', async ({ id }) => {
      socket.join(id);
      let r = activeResources.browsers.get(id);
      if (!r && desktopState.windows[id]?.type === 'browser') r = await createBrowserSession(id);
      if (r && r.lastFrame) {
          socket.emit('browser-frame', { id, data: r.lastFrame });
          if(r.page) socket.emit('browser-url', { id, url: r.page.url() });
      }
  });

  socket.on('browser-input', async ({ id, type, payload }) => {
      let r = activeResources.browsers.get(id);
      if (!r && desktopState.windows[id]) r = await createBrowserSession(id, (type==='navigate'?payload.url:undefined));
      if (!r) return;
      try {
          if (type === 'navigate') {
              await r.page.goto(payload.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
              io.to(id).emit('browser-url', { id, url: r.page.url() });
          }
          if (type === 'click') await r.page.mouse.click(payload.x, payload.y);
          if (type === 'scroll') await r.page.mouse.wheel({ deltaY: payload.dy });
          if (type === 'type') await r.page.keyboard.type(payload.text);
          if (type === 'key') await r.page.keyboard.press(payload.key);
          r.triggerUpdate();
      } catch (e) { }
  });

  // --- TERMINAL EVENTS ---
  socket.on('req-global-term', (cb) => {
      let s = activeResources.terminals.get(GLOBAL_TERM_ID);
      if (!s) s = createTerminal(GLOBAL_TERM_ID); // Try create if missing
      
      if(s) {
          cb({ id: s.id });
          socket.emit('term-history', { sessionId: s.id, history: s.history.toString() });
      } else {
          cb({ error: 'Server Shell Unavailable' });
      }
  });
  
  socket.on('subscribe-session', (sid) => {
      const s = activeResources.terminals.get(sid);
      if (s) socket.emit('term-history', { sessionId: sid, history: s.history.toString() });
  });

  socket.on('term-input', ({ sessionId, data }) => {
      const s = activeResources.terminals.get(sessionId);
      if (s) s.pty.write(data);
  });

  socket.on('term-resize', ({ sessionId, cols, rows }) => {
      const s = activeResources.terminals.get(sessionId);
      if (s) try { s.pty.resize(cols, rows); } catch(e){}
  });

  // --- FILE SYSTEM EVENTS ---
  socket.on('fs-list', async ({ path: p }, cb) => {
    try {
        const t = p || HOME_DIR;
        const items = await fs.readdir(t, { withFileTypes: true });
        const details = await Promise.all(items.map(async (i) => {
            try {
                const stat = await fs.stat(path.join(t, i.name));
                return { name: i.name, isDir: i.isDirectory(), size: stat.size, mtime: stat.mtime };
            } catch(e) { return null; }
        }));
        cb({ path: t, items: details.filter(x=>x).sort((a,b) => (a.isDir===b.isDir)?0:a.isDir?-1:1) });
    } catch (e) { cb({ error: e.message }); }
  });

  socket.on('fs-delete', async ({ path: p }, cb) => {
      try {
          await fs.rm(p, { recursive: true, force: true });
          io.emit('fs-change', { path: path.dirname(p) }); 
          cb({ success: true });
      } catch(e) { cb({ error: e.message }); }
  });

  socket.on('fs-mkdir', async ({ path: p }, cb) => {
      try {
          await fs.mkdir(p);
          io.emit('fs-change', { path: path.dirname(p) });
          cb({ success: true });
      } catch(e) { cb({ error: e.message }); }
  });

  socket.on('get-sys-info', (cb) => {
      cb({
          host: os.hostname(), plat: os.platform(),
          mem: { total: os.totalmem(), free: os.freemem() },
          uptime: os.uptime(), cpu: os.cpus().length > 0 ? os.cpus()[0].model : 'Unknown'
      });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`CloudOS v3.1 Robust running on port ${PORT}`));

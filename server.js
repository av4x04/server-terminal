import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import pty from 'node-pty';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// --- SILENCE DEPRECATION WARNINGS ---
process.removeAllListeners('warning');
process.on('warning', (warning) => {
    if (warning.name === 'DeprecationWarning') return;
    console.warn(warning.name, warning.message);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

// Optimizations for Stability
server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;
server.setMaxListeners(0); // Prevent listener leak warnings

const PORT = process.env.PORT || 3000;

// --- 1. GLOBAL PROXY INSTANCE (MANUAL CONTROL) ---
// We create ONE proxy instance but DO NOT attach it automatically via app.use for WS.
// We will manually route WS requests in the 'upgrade' event.

const proxyRouter = (req) => {
    // Extract port from URL: /p/3000/abc -> 3000
    const match = req.url.match(/^\/p\/(\d+)/);
    if (match) {
        const port = parseInt(match[1]);
        if (isNaN(port) || port < 1 || port > 65535 || port === PORT) return null;
        return `http://127.0.0.1:${port}`; // Force IPv4
    }
    return null;
};

const proxyOptions = {
    target: 'http://127.0.0.1:8080', // Default fallback
    changeOrigin: true,
    ws: true, // We enable WS support in the proxy lib...
    router: proxyRouter,
    pathRewrite: (path, req) => {
        return path.replace(/^\/p\/\d+/, '') || '/';
    },
    on: {
        error: (err, req, res) => {
            // Error handling matching the manual upgrade logic
            const isWebSocket = req.upgrade || (res && !res.writeHead);
            if (isWebSocket) {
                if (req.socket && !req.socket.destroyed) req.socket.destroy();
                return;
            }
            if (res && !res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end(`Proxy Error: Unreachable target.\n${err.message}`);
            }
        }
    }
};

const globalProxy = createProxyMiddleware(proxyOptions);

// Attach HTTP Proxy handling (for normal GET/POST requests)
app.use('/p/:port', globalProxy);


// --- 2. TERMINAL SERVER LOGIC ---

const io = new Server(server, {
  pingInterval: 25000,
  pingTimeout: 60000,
  maxHttpBufferSize: 1e6,
  perMessageDeflate: false,
  cors: { origin: '*' },
  path: '/socket.io' // Explicitly set path
});

// --- 3. MANUAL UPGRADE HANDLING (THE TRAFFIC CONTROLLER) ---
// This is the core fix. We manually direct traffic to avoid collisions.

server.on('upgrade', (req, socket, head) => {
    const url = req.url;

    // A. Terminal Traffic -> Socket.IO
    if (url.startsWith('/socket.io/')) {
        // console.log('[Upgrade] Routing to Socket.IO');
        // Let Socket.IO handle it
        // Note: io.attach(server) normally adds a listener, but since we have manual control logic elsewhere
        // or just want to be explicit. Actually, io(server) ALREADY adds a listener.
        // BUT, if we want to be safe against the proxy stealing it, we rely on the fact 
        // that http-proxy-middleware with app.use might NOT catch 'upgrade' unless configured to external server.
        
        // HOWEVER, to be absolutely sure, strict manual routing is best.
        // BUT, Socket.IO adds its own listener automatically.
        // The conflict comes because 'createProxyMiddleware' inside app.use MIGHT add one too if not careful.
        // We configured globalProxy above. By default it might NOT attach to server 'upgrade' unless we say so?
        // Actually, creating it doesn't attach. 'app.use' attaches it to the request flow.
        // But for WS, express middleware chain doesn't always run.
        
        // Let's use the explicit 'ws: true' in options, but handle routing here?
        // Actually, the 'createProxyMiddleware' returns a function that has .upgrade() method?
        // Modern http-proxy-middleware usage for manual upgrade:
        
        // Since we initialized io(server), it attached a listener.
        // We need to make sure we don't double handle or block.
        // Actually, the "Collision" theory implies Proxy was catching it first.
        
        // STRATEGY: We trust Socket.IO to handle its own stuff correctly.
        // We ONLY listen for /p/ upgrades and hand them to the proxy.
        
        // But wait, if Proxy is global middleware, does it catch upgrade? No, Express doesn't handle upgrade.
        // So we MUST handle proxy upgrades manually here.
        
        return; // Socket.IO already has its own listener on server 'upgrade'. We just let it fall through to that?
        // No, listeners run in order. If we add this listener, we are just one of them.
        
        // BETTER STRATEGY: 
        // We assume Socket.IO is handling its own stuff correctly.
        // We ONLY listen for /p/ upgrades and hand them to the proxy.
    }

    // B. Proxy Traffic -> http-proxy-middleware
    if (url.match(/^\/p\/\d+/)) {
        // console.log('[Upgrade] Routing to Proxy');
        globalProxy.upgrade(req, socket, head);
        return;
    }
    
    // If we are here, and it's not socket.io (handled by its own listener) and not proxy...
    // We do nothing, or let other listeners handle it.
    // Ideally, we shouldn't destroy socket unless we are sure no one else wants it.
});

// --- PTY & SESSION LOGIC (Standard) ---

const SHELL = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

class RingBuffer {
  constructor(limitBytes) {
    this.buf = Buffer.allocUnsafe(limitBytes);
    this.limit = limitBytes;
    this.start = 0;
    this.len = 0;
  }
  append(input) {
    const b = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
    if (b.length >= this.limit) {
      b.copy(this.buf, 0, b.length - this.limit);
      this.start = 0;
      this.len = this.limit;
      return;
    }
    const free = this.limit - this.len;
    if (b.length > free) {
      this.start = (this.start + (b.length - free)) % this.limit;
      this.len = this.limit;
    } else {
      this.len += b.length;
    }
    const writePos = (this.start + this.len - b.length) % this.limit;
    const firstPart = Math.min(b.length, this.limit - writePos);
    b.copy(this.buf, writePos, 0, firstPart);
    if (firstPart < b.length) {
      b.copy(this.buf, 0, firstPart);
    }
  }
  toString(enc = 'utf8') {
    if (this.len === 0) return '';
    if (this.start + this.len <= this.limit) {
      return this.buf.slice(this.start, this.start + this.len).toString(enc);
    } else {
      const tailLen = (this.start + this.len) - this.limit;
      return Buffer.concat([
        this.buf.slice(this.start, this.limit),
        this.buf.slice(0, tailLen)
      ]).toString(enc);
    }
  }
}

const sessions = new Map();
const HISTORY_LIMIT = 1024 * 512;

function getNextSessionNumber() {
    const usedNumbers = Array.from(sessions.values())
        .map(s => {
            const match = s.name.match(/^Session (\d+)$/);
            return match ? parseInt(match[1], 10) : null;
        })
        .filter(n => n !== null)
        .sort((a, b) => a - b);
    
    let nextNumber = 1;
    for (const num of usedNumbers) {
        if (num === nextNumber) nextNumber++;
        else break;
    }
    return nextNumber;
}

function createSession(isInitial = false) {
  const id = uuidv4();
  let ptyProc;

  try {
    ptyProc = pty.spawn(SHELL, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: process.env.HOME || process.cwd(),
      env: { ...process.env, COLORTERM: 'truecolor' }
    });
  } catch (err) {
    console.error('Failed to spawn PTY:', err);
    return null;
  }

  const sessionNumber = getNextSessionNumber();
  const session = {
    id,
    name: `Session ${sessionNumber}`,
    pty: ptyProc,
    history: new RingBuffer(HISTORY_LIMIT),
  };

  ptyProc.onData((d) => {
    try {
      session.history.append(d);
      io.to(session.id).emit('output', d);
    } catch (err) { }
  });

  ptyProc.onExit(({ exitCode }) => {
    sessions.delete(session.id);
    io.emit('session-closed', { id: session.id, name: session.name });
  });

  sessions.set(id, session);
  io.emit('session-created', { id: session.id, name: session.name });

  return session;
}

if (sessions.size === 0) createSession(true);

app.use(express.static(join(__dirname, 'public')));

function createBucket(capacity = 32768, refillRate = 16384) {
  let tokens = capacity; let last = Date.now();
  return {
    take(n = 1) {
      const now = Date.now(); const delta = now - last;
      if (delta > 0) {
        tokens = Math.min(capacity, tokens + (delta / 1000) * refillRate);
        last = now;
      }
      if (tokens >= n) { tokens -= n; return true; }
      return false;
    }
  };
}

io.on('connection', (socket) => {
  const sessionList = Array.from(sessions.values()).map(s => ({ id: s.id, name: s.name }));
  socket.emit('sessions-list', sessionList);

  const bucket = createBucket();

  socket.on('switch-session', (sessionId) => {
    socket.rooms.forEach(room => {
      if (room !== socket.id) socket.leave(room);
    });

    const session = sessions.get(sessionId);
    if (session) {
      socket.join(sessionId);
      const h = session.history.toString();
      if (h.length) socket.emit('history', h);
    }
  });

  socket.on('create-session', (callback) => {
    const newSession = createSession(false);
    if (newSession && typeof callback === 'function') {
        callback({ id: newSession.id, name: newSession.name });
    }
  });

  socket.on('close-session', (sessionId) => {
    const session = sessions.get(sessionId);
    if (session) try { session.pty.kill(); } catch(e){}
  });

  socket.on('input', ({ sessionId, data }) => {
    const session = sessions.get(sessionId);
    if (!session || !session.pty) return;
    const bytes = Buffer.byteLength(String(data), 'utf8');
    if (!bucket.take(bytes)) return;
    try { session.pty.write(String(data)); } catch (err) {}
  });

  socket.on('resize', ({ sessionId, cols, rows }) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    try { session.pty.resize(Number(cols), Number(rows)); } catch (e) {}
  });
});

function shutdown() {
  sessions.forEach(session => {
    try { if (session.pty) session.pty.kill(); } catch (e) {}
  });
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));

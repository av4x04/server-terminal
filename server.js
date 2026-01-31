import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import pty from 'node-pty';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// SILENCE DEPRECATION WARNINGS
process.removeAllListeners('warning');
process.on('warning', (warning) => {
    if (warning.name === 'DeprecationWarning') return;
    console.warn(warning.name, warning.message);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

// FIX: Prevent MaxListeners warning and improve stability
server.setMaxListeners(0);
// FIX: Keep-Alive settings to play nice with Render/Nginx Load Balancers
server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

const PORT = process.env.PORT || 3000;

// --- 1. PROXY LOGIC ---
app.use('/p/:port', (req, res, next) => {
    const port = parseInt(req.params.port);
    
    if (isNaN(port) || port < 1 || port > 65535 || port === PORT) {
        return res.status(400).send('Invalid or restricted port.');
    }

    const proxy = createProxyMiddleware({
        target: `http://127.0.0.1:${port}`,
        changeOrigin: true,
        ws: true,
        pathRewrite: {
            [`^/p/${port}`]: '',
        },
        on: {
            error: (err, req, res) => {
                // Completely silent error handling for WebSocket drops to prevent crashes
                const isWebSocket = req.upgrade || (res && !res.writeHead);
                if (isWebSocket) {
                    if (req.socket && !req.socket.destroyed) req.socket.destroy();
                    return;
                }
                
                if (res && !res.headersSent) {
                    res.writeHead(502, { 'Content-Type': 'text/plain' });
                    res.end(`Proxy Error: Service on port ${port} is unreachable.\nCheck if your server is running.`);
                }
            },
            proxyReq: (proxyReq, req, res) => {
                // Fix for some apps expecting connection keep-alive
                proxyReq.setHeader('Connection', 'keep-alive');
            }
        }
    });

    proxy(req, res, next);
});


// --- 2. TERMINAL SERVER LOGIC ---

const io = new Server(server, {
  pingInterval: 25000,
  pingTimeout: 60000,
  maxHttpBufferSize: 1e6,
  perMessageDeflate: false,
  cors: { origin: '*' }
});

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
    } catch (err) {
      // ignore
    }
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

// Simple Rate Limiter
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
    if (session) {
      try { session.pty.kill(); } catch(e){}
    }
  });

  socket.on('input', ({ sessionId, data }) => {
    const session = sessions.get(sessionId);
    if (!session || !session.pty) return;
    const bytes = Buffer.byteLength(String(data), 'utf8');
    if (!bucket.take(bytes)) return;
    try {
      session.pty.write(String(data));
    } catch (err) {
      // PTY might be dead, ignore write error
    }
  });

  socket.on('resize', ({ sessionId, cols, rows }) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    try { session.pty.resize(Number(cols), Number(rows)); } catch (e) {}
  });
});

function shutdown() {
  console.log('Shutdown');
  sessions.forEach(session => {
    try { if (session.pty) session.pty.kill(); } catch (e) {}
  });
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));

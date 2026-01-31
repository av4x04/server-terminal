import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import pty from 'node-pty';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
server.setMaxListeners(0); // Fix MaxListenersExceededWarning
const PORT = process.env.PORT || 3000;

// --- 1. ROBUST PROXY LOGIC (Single Instance - High Performance) ---
// Docs: https://github.com/chimurai/http-proxy-middleware#router-function

const dynamicProxy = createProxyMiddleware({
    target: 'http://127.0.0.1:8080', // Fix: Use IPv4 explicitly
    changeOrigin: true,
    ws: true, // Enable WebSocket support
    router: (req) => {
        // Extract port from url: /p/3000/foo -> match[1] = 3000
        const match = req.url.match(/^\/p\/(\d+)/);
        if (match) {
            const port = parseInt(match[1]);
            // Security check: Don't allow proxying to the main server port itself
            if (port === PORT) return null;
            return `http://127.0.0.1:${port}`; // Fix: Use IPv4 explicitly
        }
        return null;
    },
    pathRewrite: (path, req) => {
        // Remove /p/3000 from the path so the target app receives /foo
        // /p/3000/foo -> /foo
        return path.replace(/^\/p\/\d+/, '') || '/';
    },
    logger: console,
    on: {
        error: (err, req, res) => {
            // CRITICAL FIX: Handle WebSocket errors distinct from HTTP errors
            // to prevent "res.writeHead is not a function" crash.
            
            const isWebSocket = req.upgrade || (res && !res.writeHead); 
            
            if (isWebSocket) {
                console.log(`[Proxy-WS] Error on ${req.url}: Client disconnected or target offline.`);
                // Just destroy the socket, don't try to send HTTP response
                if (req.socket) req.socket.destroy();
                return;
            }

            // Standard HTTP Error Handling
            console.error(`[Proxy-HTTP] Error on ${req.url}:`, err.message);
            if (res && !res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end(`Proxy Error: Target service is not running or unreachable.\nDetails: ${err.message}`);
            }
        },
        proxyReq: (proxyReq, req, res) => {
            // Optional: Fix for some apps that require strict host headers
            // proxyReq.setHeader('X-Forwarded-Prefix', req.baseUrl);
        }
    }
});

// Mount the single proxy instance at /p
app.use('/p', dynamicProxy);


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
const HISTORY_LIMIT = 1024 * 512; // 512KB

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
      console.error(`Error on PTY data for session ${session.id}:`, err);
    }
  });

  ptyProc.onExit(({ exitCode, signal }) => {
    console.log(`PTY for session ${session.id} exited with code ${exitCode}`);
    sessions.delete(session.id);
    io.emit('session-closed', { id: session.id, name: session.name });
  });

  sessions.set(id, session);
  console.log(`Created session ${session.name} (${session.id})`);
  io.emit('session-created', { id: session.id, name: session.name });

  return session;
}

// Ensure at least one session exists
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
  // console.log('Client connected', socket.id); // Reduced verbosity

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
      session.pty.kill();
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
      console.error(`PTY [${session.id}] write error`, err);
    }
  });

  socket.on('resize', ({ sessionId, cols, rows }) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    cols = Number(cols) || 80;
    rows = Number(rows) || 30;
    try { session.pty.resize(cols, rows); } catch (e) {}
  });
});

// Graceful Shutdown
function shutdown() {
  console.log('Server shutting down...');
  sessions.forEach(session => {
    try { if (session.pty) session.pty.kill(); } catch (e) {}
  });
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));

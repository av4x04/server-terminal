import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import pty from 'node-pty';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import net from 'net';

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

// Server Optimizations
server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

const PORT = process.env.PORT || 3000;

// --- LOGGING UTILITY ---
const log = {
    info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
    error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
    debug: (msg, ...args) => process.env.DEBUG && console.log(`[DEBUG] ${msg}`, ...args)
};

// --- PROXY CONFIGURATION ---
const proxyRouter = (req) => {
    const match = req.url.match(/^\/p\/(\d+)/);
    if (match) {
        const port = parseInt(match[1]);
        if (isNaN(port) || port < 1 || port > 65535 || port === PORT) {
            log.warn(`Invalid proxy port: ${port}`);
            return null;
        }
        return `http://127.0.0.1:${port}`;
    }
    return null;
};

const proxyOptions = {
    target: 'http://127.0.0.1:8080',
    changeOrigin: true,
    ws: false, // We handle WebSocket upgrades manually
    router: proxyRouter,
    pathRewrite: (path) => {
        return path.replace(/^\/p\/\d+/, '') || '/';
    },
    timeout: 30000,
    proxyTimeout: 30000,
    on: {
        error: (err, req, res) => {
            log.error('Proxy error:', err.message);
            if (res && !res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end(`Proxy Error: Unable to reach target service.\n${err.message}`);
            }
        },
        proxyReq: (proxyReq, req) => {
            log.debug(`Proxying ${req.method} ${req.url}`);
        }
    }
};

const globalProxy = createProxyMiddleware(proxyOptions);

// Attach HTTP Proxy for regular requests
app.use('/p/:port', globalProxy);

// --- SOCKET.IO CONFIGURATION ---
const io = new Server(server, {
    pingInterval: 25000,
    pingTimeout: 60000,
    maxHttpBufferSize: 1e6,
    perMessageDeflate: false,
    cors: { origin: '*' },
    path: '/socket.io',
    transports: ['websocket', 'polling']
});

// --- PORT AVAILABILITY CHECKER ---
function checkPortAvailable(port, timeout = 2000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let isResolved = false;

        const cleanup = () => {
            if (!isResolved) {
                isResolved = true;
                socket.destroy();
            }
        };

        const timer = setTimeout(() => {
            cleanup();
            resolve(false);
        }, timeout);

        socket.setTimeout(timeout);
        
        socket.on('connect', () => {
            clearTimeout(timer);
            cleanup();
            resolve(true);
        });

        socket.on('error', () => {
            clearTimeout(timer);
            cleanup();
            resolve(false);
        });

        socket.on('timeout', () => {
            clearTimeout(timer);
            cleanup();
            resolve(false);
        });

        try {
            socket.connect(port, '127.0.0.1');
        } catch (err) {
            clearTimeout(timer);
            cleanup();
            resolve(false);
        }
    });
}

// --- MANUAL UPGRADE HANDLER (CRITICAL FIX) ---
// Remove all default upgrade listeners to avoid conflicts
server.removeAllListeners('upgrade');

server.on('upgrade', async (req, socket, head) => {
    const url = req.url || '';
    
    log.debug(`Upgrade request: ${url}`);

    // Priority 1: Socket.IO WebSocket connections
    if (url.startsWith('/socket.io/')) {
        log.debug('Routing to Socket.IO');
        
        // Let Socket.IO's engine handle the upgrade
        if (io.engine) {
            io.engine.handleUpgrade(req, socket, head);
        } else {
            log.error('Socket.IO engine not ready');
            socket.destroy();
        }
        return;
    }

    // Priority 2: Proxy WebSocket connections
    const proxyMatch = url.match(/^\/p\/(\d+)/);
    if (proxyMatch) {
        const targetPort = parseInt(proxyMatch[1]);
        
        log.debug(`Proxy upgrade request to port ${targetPort}`);

        // Validate port
        if (isNaN(targetPort) || targetPort < 1 || targetPort > 65535 || targetPort === PORT) {
            log.warn(`Invalid proxy target port: ${targetPort}`);
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            socket.destroy();
            return;
        }

        // Check if target port is available
        const isAvailable = await checkPortAvailable(targetPort, 3000);
        
        if (!isAvailable) {
            log.warn(`Target port ${targetPort} is not available`);
            socket.write('HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\n');
            socket.write(`Target service on port ${targetPort} is not available\n`);
            socket.destroy();
            return;
        }

        // Proceed with proxy upgrade
        try {
            globalProxy.upgrade(req, socket, head);
            log.debug(`Successfully proxied WebSocket to port ${targetPort}`);
        } catch (err) {
            log.error(`Proxy upgrade failed: ${err.message}`);
            if (!socket.destroyed) {
                socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
                socket.destroy();
            }
        }
        return;
    }

    // Priority 3: Unknown requests
    log.warn(`Unknown upgrade request: ${url}`);
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
});

// --- RING BUFFER FOR TERMINAL HISTORY ---
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

    clear() {
        this.start = 0;
        this.len = 0;
    }
}

// --- SESSION MANAGEMENT ---
const sessions = new Map();
const HISTORY_LIMIT = 1024 * 512; // 512KB history per session
const SHELL = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

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
        if (num === nextNumber) {
            nextNumber++;
        } else {
            break;
        }
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
            env: { 
                ...process.env, 
                COLORTERM: 'truecolor',
                TERM: 'xterm-256color'
            }
        });
    } catch (err) {
        log.error('Failed to spawn PTY:', err);
        return null;
    }

    const sessionNumber = getNextSessionNumber();
    const session = {
        id,
        name: `Session ${sessionNumber}`,
        pty: ptyProc,
        history: new RingBuffer(HISTORY_LIMIT),
        createdAt: new Date(),
        lastActivity: new Date()
    };

    ptyProc.onData((data) => {
        try {
            session.history.append(data);
            session.lastActivity = new Date();
            io.to(session.id).emit('output', data);
        } catch (err) {
            log.error('Error handling PTY data:', err);
        }
    });

    ptyProc.onExit(({ exitCode, signal }) => {
        log.info(`Session ${session.name} exited (code: ${exitCode}, signal: ${signal})`);
        sessions.delete(session.id);
        io.emit('session-closed', { id: session.id, name: session.name });
    });

    sessions.set(id, session);
    io.emit('session-created', { id: session.id, name: session.name });

    log.info(`Created ${session.name} (${id})`);
    return session;
}

// Create initial session
if (sessions.size === 0) {
    createSession(true);
}

// --- RATE LIMITING ---
class TokenBucket {
    constructor(capacity = 32768, refillRate = 16384) {
        this.capacity = capacity;
        this.tokens = capacity;
        this.refillRate = refillRate;
        this.lastRefill = Date.now();
    }

    refill() {
        const now = Date.now();
        const delta = now - this.lastRefill;
        
        if (delta > 0) {
            const tokensToAdd = (delta / 1000) * this.refillRate;
            this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
            this.lastRefill = now;
        }
    }

    take(amount = 1) {
        this.refill();
        
        if (this.tokens >= amount) {
            this.tokens -= amount;
            return true;
        }
        return false;
    }

    reset() {
        this.tokens = this.capacity;
        this.lastRefill = Date.now();
    }
}

// --- SOCKET.IO EVENT HANDLERS ---
io.on('connection', (socket) => {
    log.info(`Client connected: ${socket.id}`);

    const bucket = new TokenBucket(32768, 16384);

    // Send current sessions list
    const sessionList = Array.from(sessions.values()).map(s => ({
        id: s.id,
        name: s.name,
        createdAt: s.createdAt,
        lastActivity: s.lastActivity
    }));
    socket.emit('sessions-list', sessionList);

    // Switch to a session
    socket.on('switch-session', (sessionId) => {
        log.debug(`Client ${socket.id} switching to session ${sessionId}`);

        // Leave all current rooms except own room
        socket.rooms.forEach(room => {
            if (room !== socket.id) {
                socket.leave(room);
            }
        });

        const session = sessions.get(sessionId);
        if (session) {
            socket.join(sessionId);
            
            // Send session history
            const history = session.history.toString();
            if (history.length > 0) {
                socket.emit('history', history);
            }
            
            log.debug(`Client ${socket.id} joined session ${session.name}`);
        } else {
            log.warn(`Client ${socket.id} tried to join non-existent session ${sessionId}`);
            socket.emit('error', { message: 'Session not found' });
        }
    });

    // Create new session
    socket.on('create-session', (callback) => {
        log.debug(`Client ${socket.id} creating new session`);

        const newSession = createSession(false);
        
        if (newSession) {
            if (typeof callback === 'function') {
                callback({ 
                    id: newSession.id, 
                    name: newSession.name,
                    createdAt: newSession.createdAt
                });
            }
        } else {
            if (typeof callback === 'function') {
                callback({ error: 'Failed to create session' });
            }
        }
    });

    // Close session
    socket.on('close-session', (sessionId) => {
        log.debug(`Client ${socket.id} closing session ${sessionId}`);

        const session = sessions.get(sessionId);
        if (session) {
            try {
                session.pty.kill();
                log.info(`Session ${session.name} closed by client`);
            } catch (err) {
                log.error(`Error closing session ${session.name}:`, err);
            }
        }
    });

    // Handle terminal input
    socket.on('input', ({ sessionId, data }) => {
        const session = sessions.get(sessionId);
        
        if (!session || !session.pty) {
            log.warn(`Input to invalid session: ${sessionId}`);
            return;
        }

        const bytes = Buffer.byteLength(String(data), 'utf8');
        
        // Rate limiting
        if (!bucket.take(bytes)) {
            log.warn(`Rate limit exceeded for client ${socket.id}`);
            return;
        }

        try {
            session.pty.write(String(data));
            session.lastActivity = new Date();
        } catch (err) {
            log.error(`Error writing to PTY:`, err);
        }
    });

    // Handle terminal resize
    socket.on('resize', ({ sessionId, cols, rows }) => {
        const session = sessions.get(sessionId);
        
        if (!session) {
            return;
        }

        const validCols = Math.max(1, Math.min(500, Number(cols) || 80));
        const validRows = Math.max(1, Math.min(200, Number(rows) || 30));

        try {
            session.pty.resize(validCols, validRows);
            log.debug(`Resized session ${session.name} to ${validCols}x${validRows}`);
        } catch (err) {
            log.error(`Error resizing PTY:`, err);
        }
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
        log.info(`Client disconnected: ${socket.id} (${reason})`);
    });

    // Handle errors
    socket.on('error', (err) => {
        log.error(`Socket error from ${socket.id}:`, err);
    });
});

// --- STATIC FILES ---
app.use(express.static(join(__dirname, 'public')));

// --- HEALTH CHECK ENDPOINT ---
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        sessions: sessions.size,
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
    });
});

// --- GRACEFUL SHUTDOWN ---
function shutdown(signal) {
    log.info(`Received ${signal}, shutting down gracefully...`);

    // Close all sessions
    sessions.forEach(session => {
        try {
            if (session.pty) {
                session.pty.kill();
            }
        } catch (err) {
            log.error(`Error killing PTY:`, err);
        }
    });

    // Close Socket.IO
    io.close(() => {
        log.info('Socket.IO closed');
    });

    // Close HTTP server
    server.close(() => {
        log.info('HTTP server closed');
        process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
        log.error('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// --- UNCAUGHT EXCEPTION HANDLER ---
process.on('uncaughtException', (err) => {
    log.error('Uncaught Exception:', err);
    shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    log.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// --- START SERVER ---
server.listen(PORT, '0.0.0.0', () => {
    log.info(`Server listening on http://localhost:${PORT}`);
    log.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    log.info(`Platform: ${os.platform()} ${os.arch()}`);
    log.info(`Node version: ${process.version}`);
});

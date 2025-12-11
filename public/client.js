
// public/client.js
const socket = io({ transports: ['websocket'] });

// --- UI Helpers ---
const ctxMenu = {
    el: document.getElementById('context-menu'),
    show: (e, items) => {
        e.preventDefault(); e.stopPropagation();
        ctxMenu.el.innerHTML = items.map(i => {
            if(i === '-') return '<div class="ctx-divider"></div>';
            return `<div class="ctx-item ${i.danger?'danger':''}" onclick="${i.action}">
                <i class="fas ${i.icon}" style="width:20px"></i> ${i.label}
            </div>`;
        }).join('');
        ctxMenu.el.style.left = e.clientX + 'px';
        ctxMenu.el.style.top = e.clientY + 'px';
        ctxMenu.el.style.display = 'block';
    }
};

// --- Window Manager ---
class WindowManager {
    constructor() {
        this.windows = new Map();
        this.container = document.getElementById('windows-container');
        this.taskList = document.getElementById('task-list');
    }

    sync(state) {
        this.windows.forEach((win, id) => { if (!state.windows[id]) this.removeWindow(id); });
        Object.values(state.windows).forEach(winState => {
            if (this.windows.has(winState.id)) this.updateWindow(winState);
            else this.createWindow(winState);
        });
        this.renderTaskbar();
    }

    createWindow(state) {
        if(this.windows.has(state.id)) return;
        const win = new AppWindow(state);
        this.windows.set(state.id, win);
        this.container.appendChild(win.element);
        
        if (state.type === 'term') app.initTerminal(win);
        if (state.type === 'browser') app.initBrowser(win);
        if (state.type === 'fm') app.initFileManager(win, state.contentState);
        if (state.type === 'store') app.initStore(win);
        if (state.type === 'sys') app.initSysMonitor(win);
    }

    updateWindow(state) {
        const win = this.windows.get(state.id);
        if(win) win.updateState(state);
    }

    removeWindow(id) {
        const win = this.windows.get(id);
        if (win) {
            win.destroy();
            win.element.remove();
            this.windows.delete(id);
        }
    }

    renderTaskbar() {
        this.taskList.innerHTML = '';
        this.windows.forEach(win => {
            const el = document.createElement('div');
            el.className = `task-item ${!win.minimized ? 'active' : ''} ${win.minimized ? 'minimized' : ''}`;
            el.innerHTML = `<i class="${win.icon}"></i><span>${win.title}</span>`;
            el.onclick = () => {
                if (win.minimized) socket.emit('window-focus', { id: win.id });
                else socket.emit('window-minimize', { id: win.id });
            };
            this.taskList.appendChild(el);
        });
    }
}

class AppWindow {
    constructor(state) {
        this.id = state.id;
        this.type = state.type;
        this.title = state.title;
        this.minimized = state.minimized;
        this.element = document.createElement('div');
        this.element.className = 'window';
        const icons = { 'term': 'fas fa-terminal', 'browser': 'fas fa-globe', 'fm': 'fas fa-folder-open', 'store': 'fas fa-shopping-bag', 'sys': 'fas fa-hdd' };
        this.icon = icons[this.type] || 'fas fa-window-maximize';
        this.element.innerHTML = `
            <div class="title-bar">
                <div class="title-text"><i class="${this.icon}" style="margin-right:8px; opacity:0.7;"></i>${this.title}</div>
                <div class="window-controls">
                    <div class="win-btn min" title="Minimize"></div>
                    <div class="win-btn close" title="Close"></div>
                </div>
            </div>
            <div class="window-content"></div>
            <div class="resize-handle"></div>
        `;
        this.content = this.element.querySelector('.window-content');
        this.updateState(state);
        this.element.addEventListener('mousedown', () => {
            socket.emit('window-focus', { id: this.id });
            document.querySelectorAll('.window').forEach(w => w.classList.remove('active'));
            this.element.classList.add('active');
        });
        this.element.querySelector('.close').onclick = (e) => { e.stopPropagation(); socket.emit('window-close', { id: this.id }); };
        this.element.querySelector('.min').onclick = (e) => { e.stopPropagation(); socket.emit('window-minimize', { id: this.id }); };
        this.setupDrag();
        this.setupResize();
    }
    updateState(state) {
        this.element.style.width = state.width + 'px';
        this.element.style.height = state.height + 'px';
        this.element.style.transform = `translate(${state.x}px, ${state.y}px)`;
        this.element.style.zIndex = state.zIndex;
        this.element.style.display = state.minimized ? 'none' : 'flex';
        this.minimized = state.minimized;
    }
    destroy() { if (this.cleanup) this.cleanup(); }
    setupDrag() {
        const bar = this.element.querySelector('.title-bar');
        let isDragging = false, startX, startY;
        bar.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('win-btn')) return;
            isDragging = true;
            const rect = this.element.getBoundingClientRect();
            startX = e.clientX - rect.left; startY = e.clientY - rect.top;
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const x = e.clientX - startX; const y = e.clientY - startY;
            this.element.style.transform = `translate(${x}px, ${y}px)`;
            if (Math.random() > 0.8) socket.emit('window-move', { id: this.id, x, y });
        });
        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                const rect = this.element.getBoundingClientRect();
                socket.emit('window-move', { id: this.id, x: rect.left, y: rect.top });
            }
        });
    }
    setupResize() {
        const handle = this.element.querySelector('.resize-handle');
        let isResizing = false, startX, startY, startW, startH;
        handle.addEventListener('mousedown', (e) => {
            isResizing = true; e.stopPropagation();
            startX = e.clientX; startY = e.clientY;
            startW = this.element.offsetWidth; startH = this.element.offsetHeight;
        });
        window.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const w = Math.max(300, startW + (e.clientX - startX));
            const h = Math.max(200, startH + (e.clientY - startY));
            this.element.style.width = w + 'px'; this.element.style.height = h + 'px';
            if (this.onResize) this.onResize(w, h);
            if (Math.random() > 0.8) socket.emit('window-resize', { id: this.id, width: w, height: h });
        });
        window.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                socket.emit('window-resize', { id: this.id, width: this.element.offsetWidth, height: this.element.offsetHeight });
            }
        });
    }
}

const wm = new WindowManager();

// --- Socket Events ---
socket.on('desktop-sync', (state) => {
    document.getElementById('loading-screen').style.display = 'none';
    wm.sync(state);
});
socket.on('window-created', (win) => wm.createWindow(win));
socket.on('window-removed', ({ id }) => wm.removeWindow(id));
socket.on('window-update-pos', ({ id, x, y }) => {
    const win = wm.windows.get(id); if (win) win.element.style.transform = `translate(${x}px, ${y}px)`;
});
socket.on('window-update-size', ({ id, width, height }) => {
    const win = wm.windows.get(id); if (win) {
        win.element.style.width = width + 'px'; win.element.style.height = height + 'px';
        if (win.onResize) win.onResize(width, height);
    }
});
socket.on('window-update-z', ({ id, zIndex }) => {
    const win = wm.windows.get(id); if (win) win.element.style.zIndex = zIndex;
});
socket.on('window-update-state', ({ id, minimized }) => {
    const win = wm.windows.get(id); if (win) {
        win.minimized = minimized; win.element.style.display = minimized ? 'none' : 'flex'; wm.renderTaskbar();
    }
});

const app = {
    requestOpen: (type) => {
        const specs = { 'term': {w:700,h:480}, 'browser': {w:1024,h:680}, 'fm': {w:750,h:500}, 'store': {w:800,h:550}, 'sys': {w:400,h:300} };
        const s = specs[type] || {w:500,h:400};
        socket.emit('window-open', { type, title: getTitle(type), width: s.w, height: s.h });
    },

    initTerminal: (win) => {
        const c = document.createElement('div');
        c.className = 'terminal-container';
        win.content.appendChild(c);
        
        const term = new Terminal({
            fontFamily: '"JetBrains Mono", monospace', fontSize: 13,
            theme: { background: '#0c0c0c', foreground: '#f0f0f0' }, allowTransparency: true, cursorBlink: true
        });
        
        // Robust FitAddon loading
        let fit;
        if (typeof FitAddon !== 'undefined') {
            fit = (FitAddon.FitAddon) ? new FitAddon.FitAddon() : new FitAddon();
            term.loadAddon(fit);
        }

        term.open(c);
        if(fit) fit.fit();

        let sessionId;
        const attach = (sid) => {
            sessionId = sid;
            socket.emit('subscribe-session', sid);
            const onData = (msg) => { if(msg.sessionId === sid) term.write(msg.data); };
            const onHist = (msg) => { if(msg.sessionId === sid) { term.reset(); term.write(msg.history); } };
            socket.on('term-output', onData);
            socket.on('term-history', onHist);
            term.onData(d => socket.emit('term-input', { sessionId: sid, data: d }));
            win.cleanup = () => {
                socket.off('term-output', onData);
                socket.off('term-history', onHist);
                term.dispose();
            };
        };

        socket.emit('req-global-term', (s) => {
            if(s.error) return term.write('\r\n\x1b[31mTerminal Error: ' + s.error + '\x1b[0m\r\n');
            attach(s.id);
        });

        win.onResize = () => { if(fit) fit.fit(); if(sessionId) socket.emit('term-resize', { sessionId, cols: term.cols, rows: term.rows }); };
        setTimeout(() => { if(fit) fit.fit(); }, 100);
    },

    initBrowser: (win) => {
        win.content.innerHTML = `
            <div style="display:flex; flex-direction:column; height:100%; background:#111;">
                <div style="display:flex; padding:8px; gap:8px; background:#222; border-bottom:1px solid #333;">
                    <button id="b-back" class="btn"><i class="fas fa-arrow-left"></i></button>
                    <input id="b-url" type="text" style="flex:1; background:#000; color:#fff; border:1px solid #444; padding:6px; border-radius:4px;" value="https://google.com">
                    <button id="b-go" class="btn">Go</button>
                    <button id="b-reload" class="btn"><i class="fas fa-redo"></i></button>
                </div>
                <div id="b-view" style="flex:1; position:relative; overflow:hidden; background:#181818; display:flex; align-items:center; justify-content:center;">
                    <img id="b-img" style="width:100%; height:100%; object-fit:contain; z-index:1;" alt="Browser">
                    <div id="b-msg" style="position:absolute; color:#555;">Loading Browser...</div>
                </div>
            </div>
        `;
        const img = win.content.querySelector('#b-img');
        const urlInput = win.content.querySelector('#b-url');
        const goBtn = win.content.querySelector('#b-go');
        
        socket.emit('join-window-stream', { id: win.id });
        socket.on('browser-frame', (m) => { if(m.id===win.id) { img.src='data:image/jpeg;base64,'+m.data; win.content.querySelector('#b-msg').style.display='none'; } });
        socket.on('browser-url', (m) => { if(m.id===win.id && document.activeElement!==urlInput) urlInput.value=m.url; });

        const nav = () => {
            let u=urlInput.value; if(!u.startsWith('http')) u='https://'+u;
            socket.emit('browser-input', { id:win.id, type:'navigate', payload:{url:u} });
        };
        goBtn.onclick = nav;
        win.content.querySelector('#b-reload').onclick = () => app.initBrowser(win); // Manual reload UI
        urlInput.onkeydown = (e) => { if(e.key==='Enter') nav(); };
        win.content.querySelector('#b-view').addEventListener('mousedown', (e) => {
            const r = img.getBoundingClientRect();
            socket.emit('browser-input', { id:win.id, type:'click', payload:{x:(e.clientX-r.left)*(1024/r.width), y:(e.clientY-r.top)*(680/r.height)} });
        });
        win.content.addEventListener('keydown', (e) => {
            if(document.activeElement!==urlInput) {
                if(e.key.length===1) socket.emit('browser-input', { id:win.id, type:'type', payload:{text:e.key} });
                else socket.emit('browser-input', { id:win.id, type:'key', payload:{key:e.key} });
            }
        });
        win.cleanup = () => { socket.off('browser-frame'); socket.off('browser-url'); };
    },

    initFileManager: (win, state) => {
        // ... (Similar to v3 but ensure robust)
        win.content.innerHTML = `<div class="fm-layout"><div class="fm-toolbar"><button id="fm-up" class="btn"><i class="fas fa-arrow-up"></i></button><div id="fm-path" class="fm-path">/</div></div><div id="fm-grid" class="fm-grid"></div></div>`;
        const grid = win.content.querySelector('#fm-grid');
        let path = state?.path || '.';
        
        const load = (p) => socket.emit('fs-list', {path:p}, (res) => {
            if(res.error) return;
            path = res.path; win.content.querySelector('#fm-path').innerText = path; grid.innerHTML = '';
            res.items.forEach(i => {
                const el = document.createElement('div'); el.className = `fm-item ${i.isDir?'dir':'file'}`;
                el.innerHTML = `<i class="fas ${i.isDir?'fa-folder':'fa-file-alt'}" style="color:${i.isDir?'#5dade2':'#999'}"></i><span>${i.name}</span>`;
                el.ondblclick = () => { if(i.isDir) load(path+'/'+i.name); };
                el.oncontextmenu = (e) => {
                    const fullPath = (path==='/'?'':path)+'/'+i.name;
                    ctxMenu.show(e, [
                        {icon:'fa-download', label:'Download', action:`const a=document.createElement('a');a.href='/api/download?path=${encodeURIComponent(fullPath)}';a.download='${i.name}';a.click();`},
                        {icon:'fa-trash', label:'Delete', danger:true, action:`window.app.fsDel('${win.id}','${fullPath.replace(/'/g,"\\'")}')`}
                    ]);
                };
                grid.appendChild(el);
            });
        });
        win.content.querySelector('#fm-up').onclick = () => load(path+'/..');
        
        // Drag drop logic
        grid.ondragover = (e) => { e.preventDefault(); grid.style.background='rgba(255,255,255,0.05)'; };
        grid.ondrop = async (e) => {
            e.preventDefault(); grid.style.background='transparent';
            if(e.dataTransfer.files[0]) {
                const fd = new FormData(); fd.append('file', e.dataTransfer.files[0]); fd.append('path', path);
                await fetch('/api/upload', {method:'POST', body:fd}); load(path);
            }
        };

        window.app.fsDel = (wid, p) => { if(confirm('Delete?')) socket.emit('fs-delete', {path:p}, ()=>load(path)); };
        load(path);
    },

    initStore: (win) => {
         win.content.innerHTML = `<div style="padding:20px;text-align:center"><h2>App Store</h2><p>Simulated Package Manager</p></div>`;
    },

    initSysMonitor: (win) => {
        win.content.innerHTML = `<div style="padding:15px; font-family:monospace; color:#0f0;" id="sys-out">Loading...</div>`;
        const iv = setInterval(() => socket.emit('get-sys-info', d => {
            if(win.element.parentNode) win.content.querySelector('#sys-out').innerText = `CPU: ${d.cpu}\nRAM: ${Math.round((d.mem.total-d.mem.free)/1048576)}MB / ${Math.round(d.mem.total/1048576)}MB`;
        }), 1000);
        win.cleanup = () => clearInterval(iv);
    }
};

function getTitle(t) { return {'term':'Terminal','browser':'Cloud Web','fm':'Files','store':'Store','sys':'System'}[t] || 'App'; }
window.app = app;

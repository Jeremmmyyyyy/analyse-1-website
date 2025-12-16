(() => {
  // Read config from the script tag's data-attributes
  const script = document.currentScript;
  const getStr = (name, def) => (script?.dataset?.[name] ?? def);
  const getBool = (name, def) => {
    const v = script?.dataset?.[name];
    if (v == null) return def;
    return ["1","true","yes","on"].includes(String(v).toLowerCase());
  };
  const getNum = (name, def) => {
    const v = script?.dataset?.[name];
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };

  // Utils
  function getToken() {
    const cookieToken = document.cookie.split('; ').find(row => row.startsWith('token='));
    return cookieToken ? cookieToken.split('=')[1] : null;
  }

  function decodeJWT(token) {
    try {
      const payload = token.split('.')[1];
      const decoded = JSON.parse(atob(payload));
      return decoded;
    } catch (error) {
      return null;
    }
  }

  function hexToRgb(hex) {
    try {
      let h = String(hex).replace("#", "");
      if (h.length === 3) h = h.split("").map(c => c + c).join("");
      if (h.length !== 6) return null;
      const n = parseInt(h, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(",");
    } catch { return null; }
  }
  const uid = () => (crypto?.randomUUID?.() ?? (Date.now().toString(36) + Math.random().toString(36).slice(2)));
  function normAnswer(v) { const s = String(v || "").toLowerCase(); return (s === "full" || s === "full answer") ? "full" : "hints"; }
  function saveLocal(key, val) { try { localStorage.setItem(key, val); } catch {} }
  function loadLocal(key, def) { try { const v = localStorage.getItem(key); return v ? v : def; } catch { return def; } }
  function htmlUnescape(s){
    try {
      const ta = document.createElement('textarea');
      ta.innerHTML = s;
      return ta.value;
    } catch { return s; }
  }

  // Content rendering helpers (Markdown, math, code copy, lightbox, PDFs)
  const escapeHtml = (s) => String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

  function renderMarkdown(text) {
    // Minimal, safe-ish markdown with KaTeX placeholders to prevent line-break corruption of math blocks
    const raw = String(text || "");
    // Escape HTML first
    let esc = escapeHtml(raw);
    // Extract math blocks and inline math to placeholders so later formatting doesn't insert <br/> inside
    const math = { blocks: [], inlines: [] };
    esc = esc.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => {
      const id = math.blocks.push(m) - 1; return `@@CBW_MBLOCK_${id}@@`;
    });
    esc = esc.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => {
      const id = math.blocks.push(m) - 1; return `@@CBW_MBLOCK_${id}@@`;
    });
    // Inline $...$ (very simple; ignores escaped \$)
    esc = esc.replace(/(^|[^\\])\$([^\n$]+?)\$/g, (w, pre, m) => {
      const id = math.inlines.push(m) - 1; return `${pre}@@CBW_MINLINE_${id}@@`;
    });
    // Inline \(...\)
    esc = esc.replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => {
      const id = math.inlines.push(m) - 1; return `@@CBW_MINLINE_${id}@@`;
    });

    // Fenced code blocks ```lang\n...```
    let html = esc.replace(/```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (m, lang, code) => {
      return `<pre><button class="cbw-copybtn" data-copy>Copy</button><code class="cbw-code" data-lang="${lang||''}">${code.replace(/\n$/,'')}</code></pre>`;
    });
    // Headings (process before paragraphs)
    html = html
      .replace(/(^|\n)######\s+([^\n]+)/g, '$1<h6>$2</h6>')
      .replace(/(^|\n)#####\s+([^\n]+)/g, '$1<h5>$2</h5>')
      .replace(/(^|\n)####\s+([^\n]+)/g, '$1<h4>$2</h4>')
      .replace(/(^|\n)###\s+([^\n]+)/g, '$1<h3>$2</h3>')
      .replace(/(^|\n)##\s+([^\n]+)/g, '$1<h2>$2</h2>')
      .replace(/(^|\n)#\s+([^\n]+)/g, '$1<h1>$2</h1>');
    // Unordered lists
    html = html.replace(/(?:^|\n)([\t ]*[-*] [^\n]+(?:\n[\t ]*[-*] [^\n]+)*)/g, (m, block) => {
      const items = block.trim().split(/\n/).map(l => l.replace(/^[\t ]*[-*] /, ''));
      return `\n<ul>${items.map(i=>`<li>${i}</li>`).join('')}</ul>`;
    });
    // Ordered lists
    html = html.replace(/(?:^|\n)((?:[\t ]*\d+\. [^\n]+)(?:\n[\t ]*\d+\. [^\n]+)*)/g, (m, block) => {
      const items = block.trim().split(/\n/).map(l => l.replace(/^[\t ]*\d+\. /, ''));
      return `\n<ol>${items.map(i=>`<li>${i}</li>`).join('')}</ol>`;
    });
    // Blockquotes
    html = html.replace(/(^|\n)(?:>\s?.*(?:\n|$))+/g, (block) => {
      const lines = block.split(/\n/).map(l => l.replace(/^>\s?/, ''));
      const content = lines.join('\n').trim();
      if (!content) return block;
      return `\n<blockquote>${content.replace(/\n/g,'<br/>')}</blockquote>`;
    });
    // Inline code
    html = html.replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`);
    // Bold and italic
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Links
    html = html.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    
    // Tables: Markdown table format
    // Matches: | col1 | col2 |\n|------|------|\n| val1 | val2 |
    html = html.replace(/\|(.+)\n\|[\s:|-]+\n((?:\|.+\n?)*)/g, (match, headerLine, bodyLines) => {
      // Parse header
      const headers = headerLine.split('|').map(h => h.trim()).filter(h => h);
      
      // Parse body rows
      const rows = bodyLines.trim().split('\n').map(row => 
        row.split('|').map(cell => cell.trim()).filter(cell => cell !== '')
      ).filter(row => row.length > 0);
      
      if (headers.length === 0) return match;
      
      // Build HTML table
      let table = '<table class="cbw-table"><thead><tr>';
      headers.forEach(h => table += `<th>${h}</th>`);
      table += '</tr></thead><tbody>';
      
      rows.forEach(row => {
        table += '<tr>';
        for (let i = 0; i < headers.length; i++) {
          table += `<td>${row[i] || ''}</td>`;
        }
        table += '</tr>';
      });
      
      table += '</tbody></table>';
      return table;
    });
    
    // Paragraphs: split by double newlines; don't wrap block elements
    html = html.split(/\n\n+/).map(p => {
      const t = p.trim();
      if (!t) return '';
      if (/^(<ul|<ol|<pre|<h1|<h2|<h3|<h4|<h5|<h6|<blockquote|<table|@@CBW_MBLOCK_)/i.test(t)) return t;
      return `<p>${t.replace(/\n/g,'<br/>')}</p>`;
    }).join('');

    // Restore math placeholders as dedicated span markers (URL-encoded for safety)
    html = html.replace(/@@CBW_MBLOCK_(\d+)@@/g, (_, i) => {
      const tex = math.blocks[+i] || '';
      return `<span class="cbw-math" data-display="1" data-tex="${encodeURIComponent(tex)}"></span>`;
    });
    html = html.replace(/@@CBW_MINLINE_(\d+)@@/g, (_, i) => {
      const tex = math.inlines[+i] || '';
      return `<span class="cbw-math" data-display="0" data-tex="${encodeURIComponent(tex)}"></span>`;
    });

    const frag = document.createElement('div');
    frag.innerHTML = html;
    return frag;
  }

  let katexLoaded = false;
  async function ensureKatexLoaded() {
    if (katexLoaded) return;
    await new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
      link.onload = () => resolve(); document.head.appendChild(link);
    });
    await new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
      s.onload = () => resolve(); document.head.appendChild(s);
    });
    await new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js';
      s.onload = () => resolve(); document.head.appendChild(s);
    });
    katexLoaded = true;
  }
  async function typesetMath(container) {
    try {
      await ensureKatexLoaded();
      const nodes = container.querySelectorAll('.cbw-math');
      nodes.forEach(el => {
        const enc = el.getAttribute('data-tex') || '';
        const display = el.getAttribute('data-display') === '1';
        let tex = '';
        try { tex = decodeURIComponent(enc); } catch { tex = enc; }
        // Unescape HTML entities (e.g., &#039; for prime symbol) inside TeX
        tex = htmlUnescape(tex);
        try { window.katex.render(tex, el, { displayMode: display, throwOnError: false }); } catch {}
      });
    } catch {}
  }

  function enhanceCodeBlocks(container){
    container.querySelectorAll('pre').forEach(pre => {
      const btn = pre.querySelector('[data-copy]');
      const code = pre.querySelector('code');
      if (btn && code) {
        btn.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(code.textContent || ''); btn.textContent = 'Copied'; setTimeout(()=>btn.textContent='Copy', 1200); } catch {}
        });
      }
    });
  }

  let pdfjsLoaded = false;
  async function ensurePdfJsLoaded(){
    if (pdfjsLoaded) return;
    await new Promise((resolve)=>{
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
      s.onload = () => resolve(); document.head.appendChild(s);
    });
    if (window['pdfjsLib']) {
      window['pdfjsLib'].GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      pdfjsLoaded = true;
    }
  }
  async function renderPdfThumbnail(url, canvas, scale=0.25){
    try {
      await ensurePdfJsLoaded();
      const pdf = await window['pdfjsLib'].getDocument(url).promise;
      const page = await pdf.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const maxDim = 240; // render small thumb then let CSS shrink
      const s = Math.min(maxDim / Math.max(vp.width, vp.height), 1);
      const viewport = page.getViewport({ scale: s });
      const ctx = canvas.getContext('2d');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (e) {
      // leave canvas blank on failure
    }
  }

  async function pdfToJpegFile(file, maxDim, quality){
    try {
      await ensurePdfJsLoaded();
      const ab = await file.arrayBuffer();
      const pdf = await window['pdfjsLib'].getDocument({ data: new Uint8Array(ab) }).promise;
      const page = await pdf.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const s = Math.min(maxDim / Math.max(vp.width, vp.height), 1);
      const viewport = page.getViewport({ scale: s });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', Math.max(0.3, Math.min(1, quality))));
      if (!blob) return file;
      const name = (file.name || 'document').replace(/\.(pdf)$/i, '') + '.jpg';
      return new File([blob], name, { type: 'image/jpeg' });
    } catch { return file; }
  }

  // Lightbox
  let lightboxEl; let lightboxContent; let lightboxClose;
  function ensureLightbox(){
    if (lightboxEl) return lightboxEl;
    lightboxEl = document.createElement('div'); lightboxEl.className = 'cbw-lightbox';
    lightboxClose = document.createElement('button'); lightboxClose.className = 'cbw-lb-close'; lightboxClose.textContent = 'Close';
    lightboxContent = document.createElement('div');
    lightboxEl.appendChild(lightboxClose); lightboxEl.appendChild(lightboxContent);
    lightboxEl.addEventListener('click', (e)=>{ if (e.target === lightboxEl) closeLightbox(); });
    lightboxClose.addEventListener('click', closeLightbox);
    document.body.appendChild(lightboxEl);
    return lightboxEl;
  }
  function openLightboxImage(url){
    ensureLightbox();
    lightboxContent.innerHTML = '';
    const img = document.createElement('img'); img.src = url; img.alt = 'preview';
    lightboxContent.appendChild(img);
    lightboxEl.style.display = 'flex';
  }
  function openLightboxPdf(url){
    ensureLightbox();
    lightboxContent.innerHTML = '';
    const iframe = document.createElement('iframe'); iframe.src = url; iframe.width = '100%'; iframe.height = '100%';
    lightboxContent.appendChild(iframe);
    lightboxEl.style.display = 'flex';
  }
  function closeLightbox(){ if (lightboxEl) lightboxEl.style.display = 'none'; }

  // Config
  const cfg = {
    webhookUrl: getStr("webhook", "https://botafogo.epfl.ch/n8n/webhook-test/d1022362-c8df-4bcb-bd18-f95d1a7d024e"),
    placeholder: getStr("placeholder", "Start new chat"),
    buttonText: getStr("buttontext", "Send"),
    accentColor: getStr("accent", "#6366f1"),
    showTimestamps: getBool("timestamps", true),
    maxWidth: getNum("maxwidth", 840),
    bottomOffset: getNum("bottomoffset", 64),
    title: getStr("title", "Chatbot"),
    defaultAnswer: normAnswer(getStr("defaultanswer", "hints")),
    proxy: getStr("proxy", ""), // optional proxy base; if set, final URL = proxy + encodeURIComponent(webhookUrl)
    maxUploadMB: (() => { const n = Number(getStr('maxuploadmb','10')); return Number.isFinite(n) ? n : 10; })(),
    maxHistory: (() => { const n = Number(getStr('maxhistory','0')); return Number.isFinite(n) ? n : 0; })(),
    maxImageDim: (() => { const n = Number(getStr('maximagedim','1600')); return Number.isFinite(n) ? n : 1600; })(),
    imageQuality: (() => { const n = Number(getStr('imagequality','0.82')); return Number.isFinite(n) ? n : 0.82; })(),
    retryImageQuality: (() => { const n = Number(getStr('retryimagequality','0.6')); return Number.isFinite(n) ? n : 0.6; })(),
    pdfStrategy: (() => { const v = String(getStr('pdfstrategy','send')).toLowerCase(); return ['send','image'].includes(v) ? v : 'send'; })(),
    allowPdf: getBool('allowpdf', false),
    username: getStr("username", ""),
  };

  // Toggle state persisted
  let answerMode = loadLocal("cbw-answer", cfg.defaultAnswer); // "hints" | "full"
  let topic = loadLocal("cbw-topic", "");                    // string topic label
  let startFullscreen = loadLocal("cbw-fullscreen", getBool("fullscreen", false) ? "true" : "false") === "true";
  let isDarkTheme = loadLocal("cbw-theme", "light") === "dark";  // "light" | "dark"

  // CSS
  const css = `
:root { --cbw-accent: ${cfg.accentColor}; --cbw-accent-rgb: ${hexToRgb(cfg.accentColor) || "99,102,241"}; --cbw-z: 2147483646; }
.cbw-hidden { display: none !important; }

* { box-sizing: border-box; }

/* Bubble Button */
.cbw-btn { position: fixed; right: 20px; bottom: 20px; width: 56px; height: 56px; border-radius: 50%; background: var(--cbw-accent); color: #fff; border: none; box-shadow: 0 4px 12px rgba(0,0,0,.15); display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: var(--cbw-z); transition: all .2s ease; }
.cbw-btn:hover { transform: scale(1.05); box-shadow: 0 6px 20px rgba(var(--cbw-accent-rgb),0.4); }
.cbw-btn:focus { outline: none; box-shadow: 0 0 0 3px rgba(var(--cbw-accent-rgb),0.2); }

/* Panel */
.cbw-panel { position: fixed; z-index: var(--cbw-z); right: 20px; bottom: 84px; width: min(420px, 96vw); height: min(700px, 90vh); background: #fff; color: #000; border-radius: 16px; overflow: hidden; box-shadow: 0 5px 40px rgba(0,0,0,0.16); display: none; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
.cbw-panel.fullscreen { inset: 0; right: 0; bottom: 0; width: 100vw; height: 100vh; border-radius: 0; }

/* Header */
.cbw-header { display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: #fff; border-bottom: 1px solid #e5e5e5; }
.cbw-title { font-weight: 700; font-size: 16px; color: #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.3px; }
.cbw-spacer { flex: 1; }

.cbw-seg { display: inline-flex; align-items: center; gap: 0; background: transparent; border: none; border-radius: 10px; overflow: hidden; }
.cbw-seg button { appearance: none; border: none; margin: 0; padding: 6px 10px; color: #6b7280; background: transparent; cursor: pointer; font: 500 12px/1 ui-sans-serif,-apple-system,Segoe UI,Roboto,system-ui,sans-serif; letter-spacing: .2px; }
.cbw-seg button:hover { background: #f3f4f6; color: #000; }
.cbw-seg button.active { background: transparent; color: var(--cbw-accent); font-weight: 600; }
.cbw-seg button:focus { outline: 2px solid var(--cbw-accent); outline-offset: -2px; }
.cbw-seg.cbw-seg-mini button { padding: 5px 8px; font-size: 11.5px; }

.cbw-iconbtn { background: transparent; color: #6b7280; border: 0; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; display: grid; place-items: center; transition: all .2s; }
.cbw-iconbtn:hover { background: #f3f4f6; color: #000; }
.cbw-iconbtn:focus { outline: 2px solid var(--cbw-accent); outline-offset: -2px; }
.cbw-theme-btn { transition: transform .3s ease; }
.cbw-theme-btn:active { transform: rotate(20deg); }

/* Body */
.cbw-body { flex: 1; display: flex; flex-direction: column; min-height: 0; background: #fff; }

/* Messages */
.cbw-messages { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 16px 16px; padding-bottom: calc(16px + ${cfg.bottomOffset}px + env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; gap: 12px; scroll-behavior: smooth; }
.cbw-messages::-webkit-scrollbar { width: 8px; }
.cbw-messages::-webkit-scrollbar-track { background: transparent; }
.cbw-messages::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }
.cbw-messages::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
.cbw-empty { margin: auto; text-align: center; opacity: 0.5; font-size: 15px; letter-spacing: 0.3px; color: #6b7280; }
.cbw-row { display: flex; width: 100%; gap: 8px; }
.cbw-row.user { justify-content: flex-end; }
.cbw-row.bot { justify-content: flex-start; }

.cbw-bubble { max-width: 85%; background: #f3f4f6; border: none; padding: 10px 14px; border-radius: 14px; line-height: 1.5; font-size: 15px; display: flex; flex-direction: column; gap: 8px; word-break: break-word; animation: cbw-fade-in .3s ease; color: #1f2937; overflow: hidden; }
.cbw-row.user .cbw-bubble { background: var(--cbw-accent); border: none; color: #fff; border-radius: 14px; }
.cbw-text { white-space: pre-wrap; word-wrap: break-word; overflow-x: auto; overflow-y: hidden; }
.cbw-text p { margin: 0 0 6px; }
.cbw-text p:last-child { margin-bottom: 0; }
.cbw-text h1, .cbw-text h2, .cbw-text h3, .cbw-text h4, .cbw-text h5, .cbw-text h6 { margin: 8px 0 6px; line-height: 1.3; font-weight: 700; }
.cbw-text h1 { font-size: 18px; }
.cbw-text h2 { font-size: 16px; }
.cbw-text h3 { font-size: 15px; }
.cbw-text h4 { font-size: 14px; }
.cbw-text h5 { font-size: 14px; }
.cbw-text h6 { font-size: 13px; opacity: .9; }
.cbw-row.user .cbw-text a { color: #fff; text-decoration: underline; opacity: 0.95; }
.cbw-row.bot .cbw-text a { color: var(--cbw-accent); text-decoration: underline; }
.cbw-text ul, .cbw-text ol { margin: 6px 0; padding-left: 20px; }
.cbw-text li { margin: 3px 0; }
.cbw-text code { background: #eff1f5; color: #d63384; padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 13px; }
.cbw-row.user .cbw-text code { background: rgba(255,255,255,0.25); color: #fff; }
.cbw-text pre { position: relative; margin: 8px 0; }
.cbw-code { background: #1f2937; color: #f3f4f6; border: 1px solid #374151; border-radius: 8px; padding: 12px; overflow: auto; font-size: 13px; line-height: 1.4; }
.cbw-copybtn { position: absolute; top: 8px; right: 8px; border: none; border-radius: 6px; padding: 5px 10px; font-size: 11px; cursor: pointer; background: #374151; color: #f3f4f6; transition: all .2s; font-weight: 500; }
.cbw-copybtn:hover { background: #4b5563; }
.cbw-text blockquote { margin: 8px 0; padding: 0 0 0 12px; border-left: 3px solid #d1d5db; opacity: .85; font-style: italic; }
.cbw-row.user .cbw-text blockquote { border-left-color: rgba(255,255,255,0.4); }

/* Context Banner */
.cbw-context-banner { background: #f3f4f6; color: #4b5563; padding: 8px 12px; font-size: 12px; border-bottom: 1px solid #e5e7eb; display: none; align-items: center; justify-content: center; gap: 8px; flex-shrink: 0; line-height: 1.3; }
.cbw-context-banner svg { flex-shrink: 0; color: var(--cbw-accent); }
.cbw-panel.dark-theme .cbw-context-banner { background: #1f2937; color: #9ca3af; border-color: #374151; }
 
/* Context Visuals */
.cbw-bubble { position: relative; }
.cbw-bubble::after { content: ''; position: absolute; bottom: 6px; right: 6px; width: 8px; height: 8px; border-radius: 50%; display: none; z-index: 1; }
.cbw-row.in-context .cbw-bubble::after { display: block; background: #22c55e; box-shadow: 0 0 0 2px #fff; }
.cbw-row.out-context .cbw-bubble::after { display: block; background: #ef4444; box-shadow: 0 0 0 2px #fff; }

/* Dark mode adjustments for dots */
.cbw-panel.dark-theme .cbw-row.in-context .cbw-bubble::after,
.cbw-panel.dark-theme .cbw-row.out-context .cbw-bubble::after { box-shadow: 0 0 0 2px #374151; }
.cbw-panel.dark-theme .cbw-row.user.in-context .cbw-bubble::after,
.cbw-panel.dark-theme .cbw-row.user.out-context .cbw-bubble::after { box-shadow: 0 0 0 2px var(--cbw-accent); }

/* Toggle Switch */
.cbw-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; font-size: 12px; color: #6b7280; font-weight: 600; margin-right: auto; }
.cbw-toggle input { display: none; }
.cbw-toggle-track { width: 32px; height: 18px; background: #e5e7eb; border-radius: 9px; position: relative; transition: all .2s; flex-shrink: 0; }
.cbw-toggle-thumb { width: 14px; height: 14px; background: #fff; border-radius: 50%; position: absolute; top: 2px; left: 2px; transition: all .2s; box-shadow: 0 1px 2px rgba(0,0,0,0.2); }
.cbw-toggle input:checked ~ .cbw-toggle-track { background: var(--cbw-accent); }
.cbw-toggle input:checked ~ .cbw-toggle-track .cbw-toggle-thumb { transform: translateX(14px); }
.cbw-panel.dark-theme .cbw-toggle { color: #9ca3af; }
.cbw-panel.dark-theme .cbw-toggle-track { background: #374151; }

/* Math - prevent overflow */
.cbw-math[data-display="1"] { display: block; width: 100%; overflow-x: auto; overflow-y: hidden; padding: 4px 0; margin: 4px 0; }
.katex { max-width: 100%; }
.katex-display { max-width: 100%; }
.katex-html { max-width: 100%; }

/* Tables */
.cbw-text table { border-collapse: collapse; margin: 8px 0; width: 100%; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; font-size: 14px; }
.cbw-text table thead { background: #f3f4f6; }
.cbw-text table th { padding: 8px 10px; text-align: left; font-weight: 600; color: #1f2937; border-bottom: 2px solid #d1d5db; }
.cbw-text table td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; color: #374151; }
.cbw-text table tbody tr:last-child td { border-bottom: none; }
.cbw-text table tbody tr:hover { background: #f9fafb; }
.cbw-row.user .cbw-text table { border-color: rgba(255,255,255,0.3); }
.cbw-row.user .cbw-text table thead { background: rgba(255,255,255,0.15); }
.cbw-row.user .cbw-text table th { color: #fff; border-bottom-color: rgba(255,255,255,0.2); }
.cbw-row.user .cbw-text table td { color: rgba(255,255,255,0.95); border-bottom-color: rgba(255,255,255,0.15); }
.cbw-row.user .cbw-text table tbody tr:hover { background: rgba(255,255,255,0.1); }

.cbw-time { font-size: 11px; opacity: .5; align-self: flex-end; letter-spacing: .3px; font-weight: 500; user-select: none; margin-top: 2px; }

/* Attachments in bubbles */
.cbw-attachments { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
.cbw-thumb { width: 80px; height: 60px; border-radius: 8px; object-fit: cover; border: 1px solid #e5e5e5; cursor: zoom-in; transition: all .2s; }
.cbw-row.user .cbw-thumb { border-color: rgba(255,255,255,0.3); }
.cbw-thumb:hover { opacity: 0.8; }
.cbw-file { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 8px; background: #f3f4f6; border: 1px solid #e5e5e5; font-size: 12px; color: #374151; }
.cbw-row.user .cbw-file { background: rgba(255,255,255,0.15); border-color: rgba(255,255,255,0.2); color: #fff; }
.cbw-pdfthumb { position: relative; width: 80px; height: 60px; border-radius: 8px; overflow: hidden; border: 1px solid #e5e5e5; background: #f9fafb; display: grid; place-items: center; color: #6b7280; font-size: 11px; font-weight: 600; cursor: zoom-in; }
.cbw-row.user .cbw-pdfthumb { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.2); color: rgba(255,255,255,0.9); }
.cbw-pdfbadge { position: absolute; bottom: 2px; right: 2px; background: #ef4444; color: #fff; font-size: 9px; padding: 2px 4px; border-radius: 4px; font-weight: 600; }

/* Loading dots */
.cbw-bubble.loading { padding: 12px 14px; }
.cbw-dots { display: flex; gap: 4px; }
.cbw-dots span { width: 8px; height: 8px; border-radius: 50%; background: #9ca3af; animation: cbw-dots 1.2s ease-in-out infinite; }
.cbw-dots span:nth-child(2){ animation-delay:.2s; }
.cbw-dots span:nth-child(3){ animation-delay:.4s; }

/* Input Area */
.cbw-input-area { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid #e5e5e5; background: #fff; }
.cbw-topic-btn { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; background: linear-gradient(135deg, #f3f4f6 0%, #f9fafb 100%); border: 1px solid #e5e5e5; color: #1f2937; border-radius: 10px; cursor: pointer; font: 13px ui-sans-serif,-apple-system,Segoe UI,Roboto,system-ui,sans-serif; font-weight: 500; transition: all .2s; }
.cbw-topic-btn:hover { background: linear-gradient(135deg, #e5e7eb 0%, #f3f4f6 100%); border-color: #d1d5db; }
.cbw-topic-btn:focus { outline: none; border-color: var(--cbw-accent); box-shadow: 0 0 0 3px rgba(var(--cbw-accent-rgb),0.1); }
.cbw-topic-btn svg { flex-shrink: 0; }
.cbw-topic-btn span { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cbw-filelist { display: flex; gap: 8px; flex-wrap: wrap; max-height: 96px; overflow: auto; }
.cbw-filelist::-webkit-scrollbar { height: 6px; }
.cbw-filelist::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
.cbw-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 8px; background: #f3f4f6; border: 1px solid #e5e5e5; font-size: 12px; }
.cbw-chip .thumb { width: 28px; height: 28px; border-radius: 6px; object-fit: cover; border: 1px solid #e5e5e5; }
.cbw-chip .name { font-size: 12px; color: #374151; font-weight: 500; }
.cbw-chip .rm { width: 20px; height: 20px; display: grid; place-items: center; background: #e5e5e5; border: none; border-radius: 4px; color: #6b7280; cursor: pointer; transition: all .2s; }
.cbw-chip .rm:hover { background: #d1d5db; color: #374151; }

.cbw-input { display: flex; gap: 10px; background: #f9fafb; border: 1px solid #e5e5e5; border-radius: 12px; padding: 10px 12px; transition: all .2s; align-items: flex-end; }
.cbw-input:focus-within { background: #fff; border-color: var(--cbw-accent); box-shadow: 0 0 0 3px rgba(var(--cbw-accent-rgb),0.1); }
.cbw-actions { display: flex; align-items: center; gap: 4px; }
.cbw-attach { width: 36px; height: 36px; background: transparent; color: #6b7280; border: none; border-radius: 8px; display: grid; place-items: center; cursor: pointer; transition: all .2s; position: relative; }
.cbw-attach:hover { background: #f3f4f6; color: #1f2937; }
.cbw-attach .badge { position: absolute; transform: translate(11px,-11px); background: #ef4444; color: white; font-size: 10px; border-radius: 50%; padding: 2px 5px; line-height: 1; font-weight: 700; min-width: 18px; text-align: center; }
.cbw-textarea { flex: 1; border: none; resize: none; background: transparent; color: #1f2937; font: 15px/1.5 ui-sans-serif,-apple-system,Segoe UI,Roboto,system-ui,sans-serif; outline: none; padding: 0; max-height: 100px; }
.cbw-textarea::placeholder { color: #9ca3af; }
.cbw-send { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: var(--cbw-accent); color: #fff; border: none; border-radius: 8px; cursor: pointer; transition: all .2s; flex-shrink: 0; }
.cbw-send:hover:not(:disabled){ background: rgba(var(--cbw-accent-rgb),0.9); transform: scale(1.05); }
.cbw-send:active:not(:disabled){ transform: scale(0.95); }
.cbw-send:disabled{ opacity: 0.4; cursor: not-allowed; }
.cbw-send:focus { outline: 2px solid var(--cbw-accent); outline-offset: 2px; }
.cbw-hint { text-align: center; font-size: 11px; opacity: 0.5; letter-spacing: .3px; user-select: none; color: #6b7280; }

/* Modal (answer choice) */
.cbw-modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.4); display: none; align-items: center; justify-content: center; backdrop-filter: blur(4px); padding: 20px; overflow-y: auto; z-index: 100; }
.cbw-modal { width: 100%; max-width: 340px; background: #fff; color: #1f2937; border: 1px solid #e5e5e5; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.15); padding: 18px; display: flex; flex-direction: column; gap: 14px; max-height: 70vh; overflow-y: auto; margin: auto; }
.cbw-modal h3 { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: -0.3px; }
.cbw-modal p { margin: 0; opacity: 0.7; font-size: 14px; line-height: 1.5; }
.cbw-modal-actions { display: flex; gap: 10px; }
.cbw-choice { flex: 1; padding: 10px 16px; border-radius: 8px; border: none; cursor: pointer; color: #fff; font: 600 14px/1 ui-sans-serif,-apple-system,Segoe UI,Roboto,system-ui,sans-serif; letter-spacing: -0.2px; box-shadow: none; transition: all .2s; }
.cbw-choice.green { background: #10b981; }
.cbw-choice.green:hover { background: #059669; }
.cbw-choice.red { background: #ef4444; }
.cbw-choice.red:hover { background: #dc2626; }
.cbw-choice:focus { outline: 2px solid rgba(var(--cbw-accent-rgb),0.5); outline-offset: 2px; }
.cbw-modal .cbw-cancel { align-self: center; background: transparent; border: 1px solid #d1d5db; color: #6b7280; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; opacity: 1; transition: all .2s; }
.cbw-modal .cbw-cancel:hover { border-color: #9ca3af; color: #1f2937; background: #f9fafb; }

/* Info Modal */
.cbw-info-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid #e5e5e5; }
.cbw-info-icon { width: 48px; height: 48px; background: var(--cbw-accent); border-radius: 12px; display: grid; place-items: center; color: #fff; flex-shrink: 0; }
.cbw-info-title { font-size: 18px; font-weight: 700; color: #1f2937; }
.cbw-info-body { display: flex; flex-direction: column; gap: 12px; }
.cbw-info-item { display: flex; gap: 12px; align-items: flex-start; font-size: 14px; line-height: 1.5; color: #4b5563; }
.cbw-info-dot-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #4b5563; margin-top: 4px; }
.cbw-info-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.cbw-info-dot.green { background: #22c55e; }
.cbw-info-dot.red { background: #ef4444; }

/* Dark theme adjustments for Info Modal */
.cbw-panel.dark-theme .cbw-info-header { border-bottom-color: #374151; }
.cbw-panel.dark-theme .cbw-info-title { color: #f3f4f6; }
.cbw-panel.dark-theme .cbw-info-item { color: #d1d5db; }
.cbw-panel.dark-theme .cbw-info-dot-row { color: #9ca3af; }

/* Topic Modal */
.cbw-topic-modal { max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; }
.cbw-topic-modal h3 { margin: 0 0 12px; font-size: 16px; }
.cbw-topic-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; overflow-y: auto; max-height: 60vh; padding-right: 6px; margin-bottom: 8px; }
.cbw-topic-list::-webkit-scrollbar { width: 6px; }
.cbw-topic-list::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
.cbw-topic-list::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
.cbw-topic-item { padding: 8px 10px; border: 1px solid #e5e5e5; background: #f9fafb; border-radius: 6px; color: #1f2937; font: 12px ui-sans-serif,-apple-system,Segoe UI,Roboto,system-ui,sans-serif; cursor: pointer; transition: all .2s; text-align: center; font-weight: 500; line-height: 1.3; white-space: normal; word-break: break-word; }
.cbw-topic-item:hover { background: #f3f4f6; border-color: #d1d5db; }
.cbw-topic-item.active { background: var(--cbw-accent); color: #fff; border-color: var(--cbw-accent); }
.cbw-topic-back { grid-column: 1 / -1; }
.cbw-topic-cancel { align-self: center; background: transparent; border: 1px solid #d1d5db; color: #6b7280; border-radius: 8px; padding: 8px 16px; font-size: 13px; cursor: pointer; opacity: 1; transition: all .2s; margin-top: 4px; }
.cbw-topic-cancel:hover { border-color: #9ca3af; color: #1f2937; background: #f9fafb; }

/* Dark theme - Topic Modal */
.cbw-panel.dark-theme .cbw-topic-btn { background: linear-gradient(135deg, #374151 0%, #1f2937 100%); border-color: #4b5563; color: #f3f4f6; }
.cbw-panel.dark-theme .cbw-topic-btn:hover { background: linear-gradient(135deg, #4b5563 0%, #374151 100%); border-color: #6b7280; }
.cbw-panel.dark-theme .cbw-topic-item { background: #374151; border-color: #4b5563; color: #f3f4f6; }
.cbw-panel.dark-theme .cbw-topic-item:hover { background: #4b5563; border-color: #6b7280; }
.cbw-panel.dark-theme .cbw-topic-item.active { background: var(--cbw-accent); color: #fff; border-color: var(--cbw-accent); }
.cbw-panel.dark-theme .cbw-topic-back { background: #374151; border-color: #4b5563; color: #f3f4f6; }
.cbw-panel.dark-theme .cbw-topic-back:hover { background: #4b5563; border-color: #6b7280; }
.cbw-panel.dark-theme .cbw-topic-cancel { border-color: #4b5563; color: #9ca3af; }
.cbw-panel.dark-theme .cbw-topic-cancel:hover { border-color: #6b7280; color: #f3f4f6; background: #374151; }
.cbw-panel.dark-theme .cbw-topic-modal { background: #111827; color: #f3f4f6; }
.cbw-panel.dark-theme .cbw-topic-list::-webkit-scrollbar-thumb { background: #4b5563; }
.cbw-panel.dark-theme .cbw-topic-list::-webkit-scrollbar-thumb:hover { background: #6b7280; }

/* Light theme - Topic Modal */
.cbw-panel .cbw-topic-modal { background: #fff; }

@media (max-width: 600px) { .cbw-topic-list { grid-template-columns: 1fr; max-height: 50vh; } }

/* Lightbox */
.cbw-lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: calc(var(--cbw-z) + 1); display: none; align-items: center; justify-content: center; }
.cbw-lightbox img, .cbw-lightbox iframe { max-width: 95vw; max-height: 90vh; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,.3); background: #fff; }
.cbw-lightbox iframe { width: 95vw; height: 90vh; }
.cbw-lightbox .cbw-lb-close { position: absolute; top: 16px; right: 16px; background: rgba(255,255,255,0.2); color: #fff; border: none; border-radius: 8px; padding: 8px 12px; cursor: pointer; font: 13px ui-sans-serif,-apple-system,Segoe UI,Roboto,system-ui,sans-serif; font-weight: 500; transition: all .2s; }
.cbw-lightbox .cbw-lb-close:hover { background: rgba(255,255,255,0.3); }

@keyframes cbw-dots { 0%,60%,100% { opacity: 0.3; } 30% { opacity: 1; } }
@keyframes cbw-fade-in { 0% { opacity: 0; transform: translateY(2px); } 100% { opacity: 1; transform: translateY(0); } }

/* Dark Theme */
.cbw-panel.dark-theme { background: #1f2937; color: #f3f4f6; }
.cbw-panel.dark-theme .cbw-header { background: #111827; border-bottom-color: #374151; }
.cbw-panel.dark-theme .cbw-title { color: #f3f4f6; }
.cbw-panel.dark-theme .cbw-iconbtn { color: #9ca3af; }
.cbw-panel.dark-theme .cbw-iconbtn:hover { background: #374151; color: #f3f4f6; }
.cbw-panel.dark-theme .cbw-body { background: #1f2937; }
.cbw-panel.dark-theme .cbw-messages { background: #1f2937; }
.cbw-panel.dark-theme .cbw-messages::-webkit-scrollbar-thumb { background: #4b5563; }
.cbw-panel.dark-theme .cbw-messages::-webkit-scrollbar-thumb:hover { background: #6b7280; }
.cbw-panel.dark-theme .cbw-empty { color: #9ca3af; }
.cbw-panel.dark-theme .cbw-bubble { background: #374151; color: #f3f4f6; }
.cbw-panel.dark-theme .cbw-row.user .cbw-bubble { background: var(--cbw-accent); color: #fff; }
.cbw-panel.dark-theme .cbw-text a { color: #60a5fa; }
.cbw-panel.dark-theme .cbw-row.user .cbw-text a { color: rgba(255,255,255,0.95); }
.cbw-panel.dark-theme .cbw-text code { background: #111827; color: #fca5a5; }
.cbw-panel.dark-theme .cbw-row.user .cbw-text code { background: rgba(0,0,0,0.3); color: #fff; }
.cbw-panel.dark-theme .cbw-text blockquote { border-left-color: #4b5563; }
.cbw-panel.dark-theme .cbw-row.user .cbw-text blockquote { border-left-color: rgba(255,255,255,0.3); }
.cbw-panel.dark-theme .cbw-text table { border-color: #4b5563; }
.cbw-panel.dark-theme .cbw-text table thead { background: #111827; }
.cbw-panel.dark-theme .cbw-text table th { color: #e5e7eb; border-bottom-color: #4b5563; }
.cbw-panel.dark-theme .cbw-text table td { color: #d1d5db; border-bottom-color: #374151; }
.cbw-panel.dark-theme .cbw-text table tbody tr:hover { background: #1f2937; }
.cbw-panel.dark-theme .cbw-row.user .cbw-text table { border-color: rgba(255,255,255,0.2); }
.cbw-panel.dark-theme .cbw-row.user .cbw-text table thead { background: rgba(255,255,255,0.1); }
.cbw-panel.dark-theme .cbw-row.user .cbw-text table th { color: #fff; border-bottom-color: rgba(255,255,255,0.2); }
.cbw-panel.dark-theme .cbw-row.user .cbw-text table td { color: rgba(255,255,255,0.95); border-bottom-color: rgba(255,255,255,0.1); }
.cbw-panel.dark-theme .cbw-row.user .cbw-text table tbody tr:hover { background: rgba(255,255,255,0.05); }
.cbw-panel.dark-theme .cbw-thumb { border-color: #4b5563; }
.cbw-panel.dark-theme .cbw-row.user .cbw-thumb { border-color: rgba(255,255,255,0.3); }
.cbw-panel.dark-theme .cbw-file { background: #374151; border-color: #4b5563; color: #e5e7eb; }
.cbw-panel.dark-theme .cbw-row.user .cbw-file { background: rgba(0,0,0,0.2); border-color: rgba(255,255,255,0.2); }
.cbw-panel.dark-theme .cbw-pdfthumb { background: #111827; border-color: #4b5563; color: #9ca3af; }
.cbw-panel.dark-theme .cbw-row.user .cbw-pdfthumb { background: rgba(0,0,0,0.3); border-color: rgba(255,255,255,0.2); }
.cbw-panel.dark-theme .cbw-input-area { background: #1f2937; border-top-color: #374151; }
.cbw-panel.dark-theme .cbw-topiclabel { color: #9ca3af; }
.cbw-panel.dark-theme .cbw-chip { background: #374151; border-color: #4b5563; color: #e5e7eb; }
.cbw-panel.dark-theme .cbw-chip .thumb { border-color: #4b5563; }
.cbw-panel.dark-theme .cbw-chip .name { color: #e5e7eb; }
.cbw-panel.dark-theme .cbw-chip .rm { background: #4b5563; color: #9ca3af; }
.cbw-panel.dark-theme .cbw-chip .rm:hover { background: #6b7280; color: #f3f4f6; }
.cbw-panel.dark-theme .cbw-input { background: #111827; border-color: #4b5563; }
.cbw-panel.dark-theme .cbw-input:focus-within { background: #1f2937; border-color: var(--cbw-accent); }
.cbw-panel.dark-theme .cbw-attach { color: #9ca3af; }
.cbw-panel.dark-theme .cbw-attach:hover { background: #374151; color: #f3f4f6; }
.cbw-panel.dark-theme .cbw-textarea { color: #f3f4f6; }
.cbw-panel.dark-theme .cbw-textarea::placeholder { color: #6b7280; }
.cbw-panel.dark-theme .cbw-hint { color: #6b7280; }
.cbw-panel.dark-theme .cbw-modal-backdrop { background: rgba(0,0,0,0.6); }
.cbw-panel.dark-theme .cbw-modal-backdrop .cbw-modal { background: #111827; color: #f3f4f6; border-color: #374151; }
.cbw-panel.dark-theme .cbw-modal h3 { color: #f3f4f6; }
.cbw-panel.dark-theme .cbw-modal p { color: #d1d5db; }
.cbw-panel.dark-theme .cbw-modal .cbw-cancel { border-color: #4b5563; color: #9ca3af; background: transparent; }
.cbw-panel.dark-theme .cbw-modal .cbw-cancel:hover { border-color: #6b7280; color: #f3f4f6; background: #374151; }
.cbw-panel.dark-theme .cbw-time { color: rgba(243, 244, 246, 0.5); }
.cbw-panel.dark-theme .cbw-dots span { background: #6b7280; }

/* Feedback buttons */
.cbw-feedback { display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end; }
.cbw-feedback-btn { background: transparent; border: 1px solid #e5e7eb; border-radius: 4px; padding: 4px 8px; cursor: pointer; color: #6b7280; display: flex; align-items: center; gap: 4px; font-size: 12px; transition: all 0.2s; }
.cbw-feedback-btn:hover { background: #f3f4f6; color: #374151; border-color: #d1d5db; }
.cbw-feedback-btn.active { background: #e5e7eb; color: #111827; border-color: #9ca3af; }
.cbw-panel.dark-theme .cbw-feedback-btn { border-color: #4b5563; color: #9ca3af; }
.cbw-panel.dark-theme .cbw-feedback-btn:hover { background: #374151; color: #f3f4f6; border-color: #6b7280; }
.cbw-panel.dark-theme .cbw-feedback-btn.active { background: #4b5563; color: #f3f4f6; border-color: #9ca3af; }

@media (max-width: 760px) { .cbw-title { display: none; } }
@media (max-width: 900px) { .cbw-panel:not(.fullscreen) { width: min(96vw, 400px); height: min(80vh, 70vh); } .cbw-bubble { max-width: 88%; font-size: 14px; padding: 10px 12px; } }
  `;

  // Inject CSS
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // Build DOM
  const bubble = document.createElement("button");
  bubble.className = "cbw-btn";
  bubble.setAttribute("aria-label", "Open chatbot");
  bubble.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M2 12.5C2 7.81 6.03 4 11 4s9 3.81 9 8.5S15.97 21 11 21c-.76 0-1.5-.08-2.2-.24-.18-.04-.37 0-.52.1l-2.37 1.58c-.54.36-1.25-.08-1.15-.72l.38-2.39c.03-.2-.04-.4-.19-.54C2.98 17.02 2 14.86 2 12.5z"></path></svg>`;

  const panel = document.createElement("div");
  panel.className = "cbw-panel" + (startFullscreen ? " fullscreen" : "");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", cfg.title);

  const header = document.createElement("div");
  header.className = "cbw-header";

  // Title removed to make space

  // Right side actions: expand + close
  const expandBtn = document.createElement("button");
  expandBtn.className = "cbw-iconbtn"; expandBtn.setAttribute("aria-label", "Toggle fullscreen");
  expandBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3H3v4h2V5h2V3zm14 0h-4v2h2v2h2V3zM5 17H3v4h4v-2H5v-2zm16 0h-2v2h-2v2h4v-4z"/></svg>`;

  const closeBtn = document.createElement("button");
  closeBtn.className = "cbw-iconbtn"; closeBtn.setAttribute("aria-label", "Close");
  closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.7 3.7a1 1 0 0 1 1.4 0L8 6.6l2.9-2.9a1 1 0 1 1 1.4 1.4L9.4 8l2.9 2.9a1 1 0 1 1-1.4 1.4L8 9.4l-2.9 2.9a1 1 0 1 1-1.4-1.4L6.6 8 3.7 5.1a1 1 0 0 1 0-1.4z"/></svg>`;

  // Info Button
  const infoBtn = document.createElement("button");
  infoBtn.className = "cbw-iconbtn"; infoBtn.setAttribute("aria-label", "Information");
  infoBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  infoBtn.addEventListener("click", () => showInfoModal());

  // Reset Button
  const resetBtn = document.createElement("button");
  resetBtn.className = "cbw-iconbtn"; resetBtn.setAttribute("aria-label", "Reset conversation");
  resetBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
  resetBtn.addEventListener("click", () => {
    if(confirm("Are you sure you want to reset the conversation?")) {
      resetConversation();
    }
  });

  const themeBtn = document.createElement("button");
  themeBtn.className = "cbw-iconbtn cbw-theme-btn"; themeBtn.setAttribute("aria-label", "Toggle dark/light theme");
  const updateThemeIcon = () => {
    if (isDarkTheme) {
      themeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v6m0 10v6M4.22 4.22l4.24 4.24m6.08 0l4.24-4.24M1 12h6m10 0h6m-16.78 7.78l4.24-4.24m6.08 0l4.24 4.24" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    } else {
      themeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    }
  };
  updateThemeIcon();
  themeBtn.addEventListener("click", () => {
    isDarkTheme = !isDarkTheme;
    saveLocal("cbw-theme", isDarkTheme ? "dark" : "light");
    applyTheme();
    updateThemeIcon();
  });

  // Answer Mode Toggle
  const toggleLabel = document.createElement("label");
  toggleLabel.className = "cbw-toggle";
  toggleLabel.title = "Toggle answer mode";
  
  const toggleInput = document.createElement("input");
  toggleInput.type = "checkbox";
  toggleInput.checked = answerMode === "full";
  toggleInput.addEventListener("change", () => {
    setAnswer(toggleInput.checked ? "full" : "hints");
  });

  const toggleTrack = document.createElement("div");
  toggleTrack.className = "cbw-toggle-track";
  const toggleThumb = document.createElement("div");
  toggleThumb.className = "cbw-toggle-thumb";
  toggleTrack.appendChild(toggleThumb);

  const textHint = document.createElement("span");
  textHint.textContent = "Hints";
  
  const textFull = document.createElement("span");
  textFull.textContent = "Full";

  toggleLabel.appendChild(toggleInput);
  toggleLabel.appendChild(textHint);
  toggleLabel.appendChild(toggleTrack);
  toggleLabel.appendChild(textFull);

  header.appendChild(toggleLabel);
  const spacer = document.createElement("div"); spacer.className = "cbw-spacer"; header.appendChild(spacer);
  header.appendChild(infoBtn);
  header.appendChild(resetBtn);
  header.appendChild(themeBtn);
  header.appendChild(expandBtn);
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "cbw-body";

  const contextBanner = document.createElement("div");
  contextBanner.className = "cbw-context-banner";
  body.appendChild(contextBanner);

  function updateContextBanner() {
    const pageName = new URLSearchParams(window.location.search).get('page');
    const sectionName = getSectionName(topic);
    
    let parts = [];
    if (pageName) {
      let displayName = pageName;
      // Try to find a more descriptive name in the sidebar
      try {
        const el = document.getElementById(pageName);
        if (el) {
          // Check for link text first
          const link = el.querySelector('a');
          const text = link ? link.textContent : el.textContent;
          if (text && text.trim()) {
            displayName = text.trim();
          }
        }
      } catch (e) {}
      parts.push(`Page: ${displayName}`);
    }
    if (sectionName) parts.push(`Chapter: ${sectionName}`);
    
    if (parts.length > 0) {
      contextBanner.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
        <span>Contexte: ${parts.join(" | ")}</span>
      `;
      contextBanner.style.display = "flex";
      typesetMath(contextBanner);
    } else {
      contextBanner.style.display = "none";
    }
  }

  // Listen for URL changes to update banner
  const _pushState = history.pushState;
  history.pushState = function() {
    _pushState.apply(history, arguments);
    updateContextBanner();
  };
  
  const _replaceState = history.replaceState;
  history.replaceState = function() {
    _replaceState.apply(history, arguments);
    updateContextBanner();
  };

  window.addEventListener('popstate', updateContextBanner);
  window.addEventListener('hashchange', updateContextBanner);

  const messagesEl = document.createElement("div"); messagesEl.className = "cbw-messages";

  const inputArea = document.createElement("div"); inputArea.className = "cbw-input-area";

  // Modern topic selector button (opens modal)
  const topicBtn = document.createElement("button"); 
  topicBtn.type = "button";
  topicBtn.className = "cbw-topic-btn"; 
  topicBtn.setAttribute("aria-label", "Select topic");
  topicBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> <span id="cbw-topic-display">(No topic)</span>`;
  topicBtn.addEventListener("click", () => showTopicModal());

  const fileList = document.createElement("div"); fileList.className = "cbw-filelist";

  const inputWrap = document.createElement("div"); inputWrap.className = "cbw-input";

  const actions = document.createElement("div"); actions.className = "cbw-actions";
  const attachBtn = document.createElement("button"); attachBtn.type = "button"; attachBtn.className = "cbw-attach"; attachBtn.setAttribute("aria-label", "Attach files");
  attachBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83l8.5-8.49"/></svg>`;
  const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.accept = cfg.allowPdf ? "image/*,.pdf" : "image/*"; fileInput.multiple = true; fileInput.style.display = "none";

  // Answer choice modal (built below); remove bulky toggle from input bar

  const textarea = document.createElement("textarea"); textarea.className = "cbw-textarea"; textarea.placeholder = cfg.placeholder; textarea.rows = 1; textarea.spellcheck = true;

  const sendBtn = document.createElement("button"); sendBtn.className = "cbw-send"; sendBtn.setAttribute("aria-label", cfg.buttonText); sendBtn.title = cfg.buttonText;
  sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" /></svg>`;

  const hint = document.createElement("div"); hint.className = "cbw-hint"; hint.textContent = "Enter to send · Shift+Enter newline";

  actions.appendChild(attachBtn);

  inputWrap.appendChild(actions);
  inputWrap.appendChild(textarea);
  inputWrap.appendChild(sendBtn);

  inputArea.appendChild(topicBtn);
  inputArea.appendChild(fileList);
  inputArea.appendChild(inputWrap);
  inputArea.appendChild(hint);

  body.appendChild(messagesEl);
  body.appendChild(inputArea);

  panel.appendChild(header);
  panel.appendChild(body);

  // Modal for topic selection
  const topicModalBackdrop = document.createElement('div');
  topicModalBackdrop.className = 'cbw-modal-backdrop cbw-topic-modal-backdrop';
  const topicModal = document.createElement('div');
  topicModal.className = 'cbw-modal cbw-topic-modal';
  topicModal.innerHTML = `
    <h3>Select a Topic</h3>
    <div class="cbw-topic-list"></div>
  `;
  topicModalBackdrop.appendChild(topicModal);
  panel.appendChild(topicModalBackdrop);

  // Course structure with two-level hierarchy
  const COURSE_STRUCTURE = {
    "I. Préface": {
      "I.1 Un cours d'Analyse 1": "m_intro_objectifs",
      "I.2 À propos de ce site": "m_intro_format_de_ce_cours",
      "I.3 Références bibliographiques": "m_intro_referencesbiblio",
      "I.4 Fonctionnalités Web": "m_intro_essais_css",
      "I.5 Symboles et conventions": "m_intro_symboles_conventions"
    },
    "II. Notions élémentaires": {
      "II.1 Sommes et produits": "m_elementaire_sommes_produits",
      "II.2 Fonctions": "m_fonctions_defs_inj_surj",
      "II.3 Cas des fonctions réelles": "m_fonctions_generalites_fonctions_reelles",
      "II.4 Trigonométrie": "m_elementaire_trigo",
      "II.5 Fonctions trigonométriques réciproques": "m_elementaire_reciproques_trigo",
      "II.6 Exponentielles et logarithmes": "m_elementaire_exp_log",
      "II.7 Preuves par récurrence": "m_recurrence"
    },
    "III. Outils graphiques": {
      "III.1 Indications": "m_graphes_syntaxe",
      "III.2 Fonctions $f:\\mathbb{R}\\to\\mathbb{R}$": "m_graphes_fonction_sur_R",
      "III.3 Suite $a_n=f(n)$": "m_graphes_suite_reelle",
      "III.4 Suite $x_{n+1}=g(x_n)$": "m_graphes_suite_recurrence"
    },
    "1. Nombres: $\\mathbb{R}$": {
      "1.1 Introduction": "m_reels_intro",
      "1.2 Règles de calcul: $+,-,\\cdot,\\div$": "m_reels_R_est_un_corps",
      "1.3 Ordre: $\\leqslant,\\geqslant,\\lt,\\gt$": "m_reels_R_est_ordonne",
      "1.4 Intervalles": "m_reels_notations_intervalles",
      "1.5 Valeur absolue et distance": "m_reels_valeur_absolue",
      "1.6 Supremum et infimum": "m_reels_supremum_infimum",
      "1.7 Solutions de $x^2=2$": "m_reels_xcarre_egal_2",
      "1.8 Densité dans $\\mathbb{R}$": "m_reels_densite_Q_vs_R",
      "1.9 Ensembles ouverts et fermés": "m_reels_topologie"
    },
    "2. Nombres: $\\mathbb{C}$": {
      "2.1 Introduction": "m_complexes_intro",
      "2.2 Définition": "m_complexes_definitions",
      "2.3 Le plan complexe": "m_complexes_representation_polaire",
      "2.4 Exponentielle complexe": "m_complexes_exponentielle",
      "2.5 Racines de nombres complexes": "m_complexes_racines",
      "2.6 Le Théorème Fondamental de l'Algèbre": "m_complexes_Theor_Fond_Alg",
      "2.7 Polynômes et factorisation": "m_complexes_polynomes_factorisation"
    },
    "3. Suites réelles": {
      "3.1 Définitions et exemples": "m_suites_definitions_de_base",
      "3.2 Limite: $a_n\\to L$": "m_suites_limite_vers_L",
      "3.3 Propriétés de la limite": "m_suites_limite_proprietes",
      "3.4 Le Théorème des deux gendarmes": "m_suites_gendarmes",
      "3.5 Les suites monotones et bornées": "m_suites_majorees_convergent",
      "3.6 Suites qui tendent vers l'infini": "m_suites_limites_infinies",
      "3.7 Comportements polynômiaux, logarithmiques, exponentiels": "m_suites_hierarchie",
      "3.8 Indéterminations": "m_suites_indeterminations",
      "3.9 Série géométrique et applications": "m_suites_serie_geometrique",
      "3.10 Critère de d'Alembert pour les suites": "m_suites_critere_dAlembert",
      "3.11 Limite supérieure, limite inférieure": "m_suites_liminf_limsup",
      "3.12 Le Théorème de Bolzano-Weierstrass": "m_suites_Bolzano_Weierstrass",
      "3.13 Suites de Cauchy": "m_suites_Cauchy"
    },
    "4. Suites définies par récurrence": {
      "4.1 Définition, exemples": "m_suites_definies_par_recurrence_intro",
      "4.2 Étude d'un cas simple": "m_suites_definies_par_recurrence_un_exemple",
      "4.3 Remarques générales": "m_suites_definies_recurrence_generalites",
      "4.4 Approche graphique": "m_suites_definies_recurrence_approche_graphique"
    },
    "5. Séries numériques": {
      "5.1 Définitions et exemples": "m_series_definition",
      "5.2 Propriétés des séries convergentes": "m_series_proprietes",
      "5.3 Le critère de comparaison": "m_series_critere_comparaison",
      "5.4 Le critère de Leibniz": "m_series_critere_alterne",
      "5.5 Séries téléscopiques": "m_series_telescopiques",
      "5.6 Séries $\\sum_n\\frac{1}{n^p}$": "m_series_un_sur_np",
      "5.7 Le critère de la limite du quotient": "m_series_critere_limite_quotient",
      "5.8 Séries absolument convergentes": "m_series_absolument_convergentes",
      "5.9 Le critère de d'Alembert": "m_series_critere_dAlembert",
      "5.10 Le critère de Cauchy": "m_series_critere_Cauchy",
      "5.11 Séries dépendant d'un paramètre": "m_series_avec_parametre"
    },
    "6. Fonctions réelles": {
      "6.1 Introduction": "m_fonctions_reelles_intro",
      "6.2 Monotonie": "m_fonctions_monotones",
      "6.3 Parité": "m_fonctions_paires_impaires",
      "6.4 Périodicité": "m_fonctions_periodiques",
      "6.5 Max/min, sup/inf de fonctions": "m_fonctions_maximum_minimum_supremum_infimum",
      "6.6 Convexité/concavité": "m_fonctions_convexite"
    },
    "7. Limites de fonctions": {
      "7.1 Introduction": "m_fonctions_limites_intro_generale",
      "7.2 Limite $x\\to x_0$": "m_fonctions_limite_en_xzero",
      "7.3 Le théorème des deux gendarmes": "m_fonctions_limite_en_xzero_gendarmes",
      "7.4 Limites latérales $x\\to x_0^\\pm$": "m_fonctions_limite_laterale",
      "7.5 Propriétés de la limite": "m_fonctions_limite_en_xzero_proprietes_standards",
      "7.6 Quelques indéterminations ''$\\frac00$''": "m_fonctions_limite_quelques_limites",
      "7.7 Limites infinies en un point": "m_fonctions_limite_infinie_en_xzero",
      "7.8 Limites $x\\to\\pm\\infty$": "m_fonctions_limite_en_linfini"
    },
    "8. Fonctions continues": {
      "8.1 Définition de la continuité": "m_fonctions_continuite_definition",
      "8.2 Prolongement par continuité": "m_fonctions_continuite_prolongement",
      "8.3 Continuité sur un intervalle compact": "m_fonctions_continuite_sur_a_b",
      "8.4 Le théorème de la valeur intermédiaire": "m_fonctions_continuite_valeur_intermediaire",
      "8.5 Continuité et calcul de limites": "m_fonctions_continuite_et_limites"
    },
    "9. Dérivée et calcul différentiel": {
      "9.1 Définition de la dérivée, exemples": "m_derivee_introduction",
      "9.2 Dérivée et approximation linéaire": "m_derivee_approx_lineaire",
      "9.3 Règles de dérivation": "m_derivee_comme_fonction_regles_derivation",
      "9.4 Dérivées des fonctions élémentaires": "m_derivee_fonctions_elementaires",
      "9.5 Dérivée d'une fonction réciproque": "m_derivee_fonction_reciproque",
      "9.6 Dérivées latérales": "m_derivee_laterale",
      "9.7 Dérivées d'ordres supérieurs": "m_derivee_ordres_superieurs",
      "9.8 Fonctions continûment dérivables": "m_derivee_fonctions_C1",
      "9.9 Extréma locaux et le Théorème de Rolle": "m_derivee_theoreme_Rolle",
      "9.10 Le Théorème des accroissements finis": "m_derivee_theoreme_accroissements_finis",
      "9.11 La règle de Bernoulli-l'Hôpital": "m_derivee_Bernoulli_lHopital",
      "9.12 Sur la recherche des extrema d'une fonction sur un intervalle $[a,b]$": "m_derivee_extremas_globaux_sur_a_b",
      "9.13 Dérivée seconde et convexité/concavité": "m_derivee_convexite"
    },
    "10. Développements limités": {
      "10.1 Introduction": "m_DL_intro",
      "10.2 Définition et unicité": "m_DL_definition_et_unicite",
      "10.3 Propriétés de base": "m_DL_proprietes_base",
      "10.4 La formule de Taylor": "m_DL_formule_Taylor",
      "10.5 Utilisation de DL pour le calcul de limites": "m_DL_et_calcul_de_limites",
      "10.6 Composition de DL": "m_DL_compositions_de_DL"
    },
    "11. Séries entières et séries de Taylor": {
      "11.1 Introduction": "m_series_Taylor_intro",
      "11.2 Séries entières": "m_series_Taylor_series_entieres",
      "11.3 Séries entières et représentation de fonctions": "m_series_Taylor_definition",
      "11.4 Exemples": "m_series_Taylor_exemples"
    },
    "12. Intégrale": {
      "12.1 Introduction": "m_integrale_intro",
      "12.2 Définition de l'intégrale de Riemann-Darboux": "m_integrale_definition_Riemann_Darboux",
      "12.3 Les fonctions intégrables": "m_integrale_fonctions_integrables",
      "12.4 Le Théorème de la Moyenne": "m_integrale_theo_Moyenne",
      "12.5 Théorème Fondamental de l'Analyse": "m_integrale_Theoreme_Fondamental",
      "12.6 Primitives élémentaires": "m_integrale_TABLE_PRIMITIVES",
      "12.7 Intégration: par parties": "m_integrale_par_parties",
      "12.8 Intégration: changement de variable": "m_integrale_definie_changement_de_variable",
      "12.9 Intégration: fonctions rationnelles": "m_integrale_fonctions_rationnelles"
    },
    "13. Intégrales généralisées": {
      "13.1 Introduction": "m_integrale_generalisee_intro",
      "13.2 Type I": "m_integrale_generalisee_type_I",
      "13.3 Type II": "m_integrale_generalisee_type_II",
      "13.4 Type III": "m_integrale_generalisee_type_III"
    },
    "14. Compléments": {
      "14.1 $\\exp$ et $\\log$": "m_fonctions_EXPLOG",
      "14.2 $\\log$ et $\\exp$": "m_fonctions_LOGEXP",
      "14.3 Fonctions hyperboliques": "m_fonctions_hyperboliques"
    }
  };

  // Helper to find section name from ID
  function getSectionName(topicId) {
    if (!topicId) return null;
    for (const chapter in COURSE_STRUCTURE) {
      const sections = COURSE_STRUCTURE[chapter];
      for (const section in sections) {
        if (sections[section] === topicId) return section;
      }
    }
    return topicId;
  }

  // Populate topic list - Two-level hierarchy
  const topicListEl = topicModal.querySelector('.cbw-topic-list');
  let currentChapter = null;
  let topicCloseBtn = null;

  // Helper to render text with math support
  function renderTopicItemText(text) {
    const container = document.createElement('div');
    // Process math: replace $...$ with spans
    let html = text;
    const mathInlines = [];
    html = html.replace(/\$([^\n$]+?)\$/g, (_, m) => {
      const id = mathInlines.push(m) - 1;
      return `@@MATH_${id}@@`;
    });
    // Escape HTML
    html = escapeHtml(html);
    // Restore math placeholders
    html = html.replace(/@@MATH_(\d+)@@/g, (_, i) => {
      const tex = mathInlines[+i] || '';
      return `<span class="cbw-math" data-display="0" data-tex="${encodeURIComponent(tex)}"></span>`;
    });
    container.innerHTML = html;
    return container;
  }

  function showChapters() {
    topicListEl.innerHTML = '';
    topicModal.querySelector('h3').textContent = 'Select a Chapter';
    
    // Add "No topic" option
    const noTopicItem = document.createElement('button');
    noTopicItem.type = 'button';
    noTopicItem.className = 'cbw-topic-item' + (topic === '' ? ' active' : '');
    noTopicItem.textContent = '(No topic)';
    noTopicItem.addEventListener('click', () => {
      topic = '';
      saveLocal('cbw-topic', topic);
      document.querySelectorAll('.cbw-topic-item').forEach(el => el.classList.remove('active'));
      noTopicItem.classList.add('active');
      document.getElementById('cbw-topic-display').innerHTML = '';
      document.getElementById('cbw-topic-display').appendChild(document.createTextNode('(No topic)'));
      hideTopicModal();
      updateContextBanner();
    });
    topicListEl.appendChild(noTopicItem);
    
    // Add all chapters
    Object.keys(COURSE_STRUCTURE).forEach(chapter => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'cbw-topic-item';
      const textContainer = renderTopicItemText(chapter);
      item.appendChild(textContainer);
      item.addEventListener('click', () => {
        currentChapter = chapter;
        showSections(chapter);
      });
      topicListEl.appendChild(item);
    });
    // Remove all close buttons
    topicModal.querySelectorAll('.cbw-topic-cancel').forEach(btn => btn.remove());
    // Add close button
    topicCloseBtn = document.createElement('button');
    topicCloseBtn.type = 'button';
    topicCloseBtn.className = 'cbw-topic-cancel';
    topicCloseBtn.textContent = 'Close';
    topicCloseBtn.addEventListener('click', hideTopicModal);
    topicModal.appendChild(topicCloseBtn);
    // Render math in all buttons
    topicListEl.querySelectorAll('button').forEach(btn => typesetMath(btn));
  }

  function showSections(chapter) {
    topicListEl.innerHTML = '';
    topicModal.querySelector('h3').textContent = `Select a Section from "${chapter}"`;
    const sections = COURSE_STRUCTURE[chapter];
    Object.keys(sections).forEach(sectionName => {
      const moduleId = sections[sectionName];
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'cbw-topic-item' + (topic === moduleId ? ' active' : '');
      const textContainer = renderTopicItemText(sectionName);
      item.appendChild(textContainer);
      item.addEventListener('click', () => {
        topic = moduleId;
        saveLocal('cbw-topic', topic);
        document.querySelectorAll('.cbw-topic-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        document.getElementById('cbw-topic-display').innerHTML = '';
        const displayContainer = renderTopicItemText(sectionName);
        document.getElementById('cbw-topic-display').appendChild(displayContainer);
        typesetMath(document.getElementById('cbw-topic-display'));
        hideTopicModal();
        updateContextBanner();
      });
      topicListEl.appendChild(item);
    });
    // Add back button with proper dark mode support
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'cbw-topic-item cbw-topic-back';
    backBtn.textContent = '← Back to Chapters';
    backBtn.addEventListener('click', showChapters);
    topicListEl.appendChild(backBtn);
    // Render math in all buttons
    topicListEl.querySelectorAll('button').forEach(btn => typesetMath(btn));
  }

  showChapters();

  // Append to DOM on ready
  const onReady = () => {
    document.body.appendChild(bubble);
    document.body.appendChild(panel);
    const savedOpen = localStorage.getItem("cbw-open") === "true";
    setOpen(savedOpen);
    // modal will ask answer style on send
    applyFullscreen(startFullscreen);
    applyTheme();
    document.getElementById('cbw-topic-display').textContent = topic || "(No topic)";
    updateContextBanner();
  };
  if (document.readyState === "complete" || document.readyState === "interactive") onReady(); else document.addEventListener("DOMContentLoaded", onReady);

  // State
  let isLoading = false;
  let sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const messages = [];
  const attachments = []; // { file: File, url?: string, kind: 'image'|'pdf'|'other' }

  // Topic modal functions
  function showTopicModal() {
    topicModalBackdrop.style.display = 'flex';
  }
  function hideTopicModal() {
    topicModalBackdrop.style.display = 'none';
  }
  topicModal.querySelector('.cbw-topic-cancel').addEventListener('click', hideTopicModal);
  topicModalBackdrop.addEventListener('click', (e) => { if (e.target === topicModalBackdrop) hideTopicModal(); });

  function buildHistory() {
    try {
      const slice = cfg.maxHistory > 0 ? messages.slice(-cfg.maxHistory) : messages;
      return slice.map(m => ({
        role: m.isUser ? 'user' : 'assistant',
        content: m.text
      }));
    } catch { return []; }
  }

  function bytesToMB(n){ return n / (1024*1024); }
  function estimateTotalSize(files){ return files.reduce((s,f)=>s+(f?.size||0),0); }
  function isImageFile(file){ return (file?.type||'').toLowerCase().startsWith('image/'); }

  async function compressImageFile(file, maxDim, quality){
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        const tw = Math.max(1, Math.round(width * scale));
        const th = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = tw; canvas.height = th;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(file); return; }
        ctx.drawImage(img, 0, 0, tw, th);
        canvas.toBlob((blob) => {
          if (!blob) { resolve(file); return; }
          const out = new File([blob], file.name.replace(/\.(png|webp|gif|jpeg|jpg)$/i, '') + '.jpg', { type: 'image/jpeg' });
          resolve(out);
        }, 'image/jpeg', Math.max(0.3, Math.min(1, quality)));
      };
      img.onerror = () => resolve(file);
      const r = new FileReader();
      r.onload = () => { img.src = r.result; };
      r.onerror = () => resolve(file);
      r.readAsDataURL(file);
    });
  }

  async function processAttachmentsForLimit(attList){
    // First pass: compress large images
    let files = [];
    for (const a of attList){
      let f = a.file;
      if (isImageFile(f) && f.size > 800*1024){
        f = await compressImageFile(f, cfg.maxImageDim, cfg.imageQuality);
      } else if (a.kind === 'pdf' && cfg.pdfStrategy === 'image') {
        // Convert PDF first page to JPEG to reduce size
        f = await pdfToJpegFile(f, cfg.maxImageDim, cfg.imageQuality);
      }
      files.push(f);
    }
    // Check total size
    let totalMB = bytesToMB(estimateTotalSize(files));
    if (totalMB <= cfg.maxUploadMB) return files;
    // Second pass: stronger compression for images if still too big
    const files2 = [];
    for (let i=0;i<attList.length;i++){
      const orig = attList[i].file;
      const wasImg = isImageFile(orig);
      if (wasImg){
        const f2 = await compressImageFile(files[i], Math.round(cfg.maxImageDim*0.75), cfg.retryImageQuality);
        files2.push(f2);
      } else {
        files2.push(files[i]);
      }
    }
    totalMB = bytesToMB(estimateTotalSize(files2));
    return files2; // even if still big; backend may still 413, but we tried to help
  }

  function setAnswer(val) { answerMode = normAnswer(val); saveLocal("cbw-answer", answerMode); }
  // Topic change - removed, now using modal

  // Helpers
  function setOpen(open) {
    panel.style.display = open ? "flex" : "none";
    bubble.setAttribute("aria-expanded", String(open));
    try { localStorage.setItem("cbw-open", String(open)); } catch {}
    if (open) setTimeout(() => textarea.focus(), 50);
  }
  function applyFullscreen(fs) {
    panel.classList.toggle("fullscreen", fs);
    saveLocal("cbw-fullscreen", fs ? "true" : "false");
  }
  function applyTheme() {
    panel.classList.toggle("dark-theme", isDarkTheme);
  }
  function scrollToBottom() { 
    // Use requestAnimationFrame to ensure smooth scroll within container
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }
  function autosize() { textarea.style.height = "0px"; const h = textarea.scrollHeight; textarea.style.height = Math.min(h, 200) + "px"; }
  function formatTime(ts) { try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } }
  function renderEmptyIfNeeded() {
    if (messages.length === 0 && !isLoading) {
      const greeting = "Hello je suis bot-afogo je peux répondre à tes questions d'analyse ! N'oublie pas de consulter les informations (bouton ℹ️) si tu as des questions sur l'utilisation du chat.";
      const botMsg = { id: uid(), text: greeting, isUser: false, ts: Date.now() };
      messages.push(botMsg);
      appendMessage(botMsg.text, false, botMsg.ts, [], null, null);
    }
  }
  function clearEmpty() { messagesEl.querySelectorAll(".cbw-empty").forEach(n => n.remove()); }

  function appendMessage(text, isUser, ts, atts = [], mode = null, msgId = null) {
    clearEmpty();
    const row = document.createElement("div"); row.className = "cbw-row " + (isUser ? "user" : "bot");
    const bubble = document.createElement("div"); bubble.className = "cbw-bubble";
    if (text) { const content = document.createElement("div"); content.className = "cbw-text"; const frag = renderMarkdown(text); content.append(...Array.from(frag.childNodes)); bubble.appendChild(content); }

    if (atts && atts.length) {
      const cont = document.createElement("div"); cont.className = "cbw-attachments";
      atts.forEach(a => {
        if (a.kind === 'image' && a.url) {
          const img = document.createElement('img'); img.src = a.url; img.className = 'cbw-thumb'; img.alt = a.file?.name || 'image'; img.style.cursor = 'zoom-in'; img.addEventListener('click', ()=> openLightboxImage(a.url)); cont.appendChild(img);
        } else if (a.kind === 'pdf' && a.url) {
          const holder = document.createElement('div'); holder.className = 'cbw-pdfthumb'; holder.textContent = 'PDF'; const badge = document.createElement('span'); badge.className = 'cbw-pdfbadge'; badge.textContent = 'PDF'; holder.appendChild(badge); const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60; holder.appendChild(canvas); renderPdfThumbnail(a.url, canvas); holder.style.cursor = 'zoom-in'; holder.addEventListener('click', ()=> openLightboxPdf(a.url)); cont.appendChild(holder);
        } else {
          const f = document.createElement('div'); f.className = 'cbw-file'; f.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6" fill="#fff" opacity=".2"/></svg> <span>${a.file?.name || 'file'}</span>`; cont.appendChild(f);
        }
      });
      bubble.appendChild(cont);
    }

    const showTime = cfg.showTimestamps;
    const showMode = mode && !isUser;
    if (showTime || showMode) {
      const meta = document.createElement("div"); meta.className = "cbw-time";
      const parts = [];
      if (showTime) parts.push(formatTime(ts));
      if (showMode) parts.push(mode === "full" ? "Full" : "Hint");
      meta.textContent = parts.join(" · ");
      bubble.appendChild(meta);
    }

    if (!isUser && msgId) {
      // Only show feedback on the last bot message
      messagesEl.querySelectorAll('.cbw-feedback').forEach(el => el.remove());

      const feedback = document.createElement("div");
      feedback.className = "cbw-feedback";
      
      const upBtn = document.createElement("button");
      upBtn.className = "cbw-feedback-btn";
      upBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>`;
      upBtn.title = "Helpful";
      upBtn.onclick = () => handleFeedback(msgId, 'up', upBtn, downBtn);

      const downBtn = document.createElement("button");
      downBtn.className = "cbw-feedback-btn";
      downBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path></svg>`;
      downBtn.title = "Not helpful";
      downBtn.onclick = () => handleFeedback(msgId, 'down', downBtn, upBtn);

      feedback.appendChild(upBtn);
      feedback.appendChild(downBtn);
      bubble.appendChild(feedback);
    }
    
    row.appendChild(bubble); messagesEl.appendChild(row); scrollToBottom(); updateContextVisuals();
    // Enhance after attached to DOM to avoid timing issues
    const contentNode = bubble.querySelector('.cbw-text');
    if (contentNode) {
      enhanceCodeBlocks(contentNode);
      // Run math typesetting on next frame to ensure scripts/styles are ready
      requestAnimationFrame(() => typesetMath(contentNode));
    }
  }

  function handleFeedback(msgId, type, btn, otherBtn) {
    const token = getToken();
    const userData = token ? decodeJWT(token) : null;
    const sciper = userData ? userData.sciper : undefined;

    const isRemoving = btn.classList.contains('active');

    if (isRemoving) {
      btn.classList.remove('active');
    } else {
      btn.classList.add('active');
      otherBtn.classList.remove('active');
    }

    fetch('https://botafogo.epfl.ch/n8n/webhook/dc7a2345-701f-4d1a-8234-28705ee40457', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgId,
        sessionId,
        sciper,
        liked: type === 'up'
      })
    }).catch(err => console.error('Feedback error', err));
  }
  function appendLoading() { clearEmpty(); const row = document.createElement("div"); row.className = "cbw-row bot"; const bub = document.createElement("div"); bub.className = "cbw-bubble loading"; bub.innerHTML = `<div class="cbw-dots"><span></span><span></span><span></span></div>`; row.appendChild(bub); messagesEl.appendChild(row); return row; }

  function updateFileListUI() {
    fileList.innerHTML = "";
    attachments.forEach((a, idx) => {
      const chip = document.createElement('div'); chip.className = 'cbw-chip';
      if (a.kind === 'image' && a.url) { const im = document.createElement('img'); im.src = a.url; im.className = 'thumb'; chip.appendChild(im); }
      else { const ic = document.createElement('div'); ic.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6" fill="#fff" opacity=".2"/></svg>`; chip.appendChild(ic.firstChild); }
      const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = a.file?.name || 'file'; chip.appendChild(nm);
      const rm = document.createElement('button'); rm.className = 'rm'; rm.setAttribute('aria-label', 'Remove attachment'); rm.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path fill="#fff" d="M3.7 3.7a1 1 0 0 1 1.4 0L8 6.6l2.9-2.9a1 1 0 1 1 1.4 1.4L9.4 8l2.9 2.9a1 1 0 1 1-1.4 1.4L8 9.4l-2.9 2.9a1 1 0 1 1-1.4-1.4L6.6 8 3.7 5.1a1 1 0 0 1 0-1.4z"/></svg>`;
      rm.addEventListener('click', () => { const [rem] = attachments.splice(idx,1); if (rem?.url) URL.revokeObjectURL(rem.url); updateFileListUI(); updateAttachBadge(); });
      chip.appendChild(rm);
      fileList.appendChild(chip);
    });
  }
  function updateAttachBadge() {
    // show small badge by appending a span only when count>0
    attachBtn.querySelector('.badge')?.remove();
    if (attachments.length > 0) {
      const b = document.createElement('span'); b.className = 'badge'; b.textContent = String(attachments.length);
      attachBtn.style.position = 'relative'; attachBtn.appendChild(b);
    }
  }

  function safeKind(file) { const t = (file?.type || '').toLowerCase(); if (t.startsWith('image/')) return 'image'; if (t === 'application/pdf' || file?.name?.toLowerCase().endsWith('.pdf')) return 'pdf'; return 'other'; }

  // Events
  bubble.addEventListener("click", () => setOpen(panel.style.display !== "flex"));
  closeBtn.addEventListener("click", () => setOpen(false));
  expandBtn.addEventListener("click", () => applyFullscreen(!panel.classList.contains('fullscreen')));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
  textarea.addEventListener("input", autosize);
  textarea.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  textarea.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const kind = safeKind(file);
          const obj = { file, kind, url: URL.createObjectURL(file) };
          attachments.push(obj);
          updateFileListUI();
          updateAttachBadge();
        }
        break;
      }
    }
  });
  sendBtn.addEventListener("click", sendMessage);
  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener('change', () => {
    Array.from(fileInput.files || []).forEach(f => {
      const kind = safeKind(f);
      const obj = { file: f, kind };
      if (kind === 'pdf' && !cfg.allowPdf) {
        // Skip PDFs entirely if disabled
        return;
      }
      if (kind === 'image' || (kind === 'pdf' && cfg.allowPdf)) obj.url = URL.createObjectURL(f);
      if (kind === 'image' || (cfg.allowPdf && kind === 'pdf')) attachments.push(obj);
    });
    fileInput.value = '';
    updateFileListUI(); updateAttachBadge();
  });

  // Initial empty state
  renderEmptyIfNeeded();

  // Safer JSON parsing
  async function safeJson(res) {
    const ct = res.headers.get("content-type") || "";
    const text = await res.text();
    if (ct.includes("application/json")) { try { return JSON.parse(text); } catch {} }
    try { return JSON.parse(text); } catch {}
    return text;
  }
  function extractReply(data) {
    if (typeof data === "string") return data;
    if (typeof data?.output === "string") return data.output;
    if (typeof data?.data?.output === "string") return data.data.output;
    if (typeof data?.result?.output === "string") return data.result.output;
    if (Array.isArray(data?.output)) return data.output.map(v => typeof v === "string" ? v : JSON.stringify(v)).join("\n\n");
    if (data?.output && typeof data.output === "object") return JSON.stringify(data.output);
    if (typeof data?.response === "string") return data.response;
    if (data && typeof data === "object") return JSON.stringify(data);
    return "Sorry, I couldn’t parse a response.";
  }

  function buildRequest(messageText, sendFiles) {
    // Extract course name from section (the display text is now the section name, send it directly)
    const topicToSend = topic || undefined;

    // Get page name from URL
    const pageName = new URLSearchParams(window.location.search).get('page') || undefined;

    // Get Sciper
    const token = getToken();
    const userData = token ? decodeJWT(token) : null;
    const sciper = userData ? userData.sciper : undefined;

    // Get only the last message
    const fullHistory = buildHistory();
    const messagesToSend = fullHistory.length > 0 ? [fullHistory[fullHistory.length - 1]] : [];
    
    // If we have attachments, send multipart/form-data; otherwise JSON
    if (sendFiles && sendFiles.length > 0) {
      const fd = new FormData();
      // fd.append('message', messageText); // Removed to avoid duplication
      fd.append('sessionId', sessionId);
      if (topicToSend) fd.append('topic', topicToSend);
      if (pageName) fd.append('page', pageName);
      if (sciper) fd.append('sciper', sciper);
      fd.append('answer', answerMode);
      try { fd.append('messages', JSON.stringify(messagesToSend)); } catch {}
      sendFiles.forEach((f, i) => fd.append('files', f, f.name || `file_${i}`));
      return {
        body: fd,
        headers: { 'Accept': 'application/json' },
      };
    } else {
      return {
        body: JSON.stringify({ sessionId, topic: topicToSend, page: pageName, answer: answerMode, messages: messagesToSend, sciper }),
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      };
    }
  }

  // Send message
  function sendMessage() {
    if (isLoading) return;
    const raw = textarea.value.trim();
    if (!raw && attachments.length === 0) return;
    performSend(raw);
  }

  async function performSend(raw){
    if (isLoading) return;
    const currentMode = answerMode;
    // push user message
    textarea.value = ""; autosize();
    const userAtts = attachments.map(a => {
      const c = { file: a.file, kind: a.kind };
      if (a.url) {
        try { c.url = URL.createObjectURL(a.file); } catch { c.url = a.url; }
      }
      return c;
    }); // snapshot for rendering with independent URLs
    const userMsg = { id: uid(), text: raw, isUser: true, ts: Date.now(), atts: userAtts };
    messages.push(userMsg);
    appendMessage(userMsg.text, true, userMsg.ts, userAtts);

    // loading
    isLoading = true; sendBtn.disabled = true;
    const loadingNode = appendLoading();

    try {
      const filesToSend = await processAttachmentsForLimit(userAtts);
      const { body, headers } = buildRequest(raw, filesToSend);
      const finalUrl = cfg.proxy ? (cfg.proxy + encodeURIComponent(cfg.webhookUrl)) : cfg.webhookUrl;
      const res = await fetch(finalUrl, { method: 'POST', headers, body, credentials: 'same-origin', mode: 'cors' });

      const data = await safeJson(res);

      loadingNode.remove();
      if (!res.ok) {
        console.error('Webhook error', res.status, data);
        let msg = `Error ${res.status}. ${extractReply(data)}`;
        if (res.status === 413) msg = 'Server rejected the request (too large). Images were compressed, but may still be too big.';
        const botMsg = { id: uid(), text: msg, isUser: false, ts: Date.now() };
        messages.push(botMsg); appendMessage(botMsg.text, false, botMsg.ts, [], null, botMsg.id);
      } else {
        const reply = extractReply(data);
        const botMsg = { id: uid(), text: reply, isUser: false, ts: Date.now(), mode: currentMode };
        messages.push(botMsg); appendMessage(botMsg.text, false, botMsg.ts, [], currentMode, botMsg.id);
      }
    } catch (err) {
      console.error(err);
      loadingNode.remove();
      const botMsg = { id: uid(), text: 'Network error. Please try again.', isUser: false, ts: Date.now() };
      messages.push(botMsg); appendMessage(botMsg.text, false, botMsg.ts, [], null, botMsg.id);
    } finally {
      // cleanup attachments after send
      while (attachments.length) { const a = attachments.pop(); if (a?.url) URL.revokeObjectURL(a.url); }
      updateFileListUI(); updateAttachBadge();
      isLoading = false; sendBtn.disabled = false; renderEmptyIfNeeded();
      updateContextVisuals();
    }
  }

  function resetConversation() {
    messages.length = 0;
    messagesEl.innerHTML = '';
    sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    renderEmptyIfNeeded();
    while (attachments.length) { const a = attachments.pop(); if (a?.url) URL.revokeObjectURL(a.url); }
    updateFileListUI();
    updateAttachBadge();
  }

  function showInfoModal() {
    const infoModalBackdrop = document.createElement('div');
    infoModalBackdrop.className = 'cbw-modal-backdrop';
    infoModalBackdrop.style.display = 'flex'; // Make it visible
    const infoModal = document.createElement('div');
    infoModal.className = 'cbw-modal';
    infoModal.innerHTML = `
      <div class="cbw-info-header">
        <div class="cbw-info-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M12 22a2 2 0 0 1 2-2v-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2v2a2 2 0 0 1 2 2z"/><path d="M2 12a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/><path d="M22 12a2 2 0 0 1-2-2h-2a2 2 0 0 1-2 2 2 2 0 0 1 2 2h2a2 2 0 0 1 2-2z"/><rect x="8" y="8" width="8" height="8" rx="2"/></svg>
        </div>
        <div class="cbw-info-title">Assistant Analyse I</div>
      </div>
      <div class="cbw-info-body">
        <div class="cbw-info-item">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>Ce chatbot est en version bêta. Les réponses peuvent contenir des erreurs et ne doivent pas être considérées comme une vérité absolue.</span>
        </div>
        <div class="cbw-info-item">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span>En cas de problème ou de doute, veuillez contacter le professeur ou les assistants.</span>
        </div>
        <div class="cbw-info-item">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><rect x="2" y="6" width="20" height="12" rx="6" ry="6"/><circle cx="8" cy="12" r="2"/></svg>
          <span>Utilisez le sélecteur en haut pour choisir entre "Hints" (indices) et "Full" (réponse complète).</span>
        </div>
        <div class="cbw-info-item">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/><path d="M12 6v6l4 2"/></svg>
          <span>Modèles utilisés : gpt-oss 120B et qwen-VL-70B, hébergés à l'EPFL. Vos questions restent privées et ne sont pas envoyées dans le cloud.</span>
        </div>
        <div class="cbw-info-item">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
          <span>Merci de noter chaque réponse (👍/👎) pour nous aider à améliorer le modèle.</span>
        </div>
        <div class="cbw-info-item" style="flex-direction:column; gap:8px;">
          <span><strong>Mémoire du chatbot :</strong></span>
          <div class="cbw-info-dot-row">
            <div class="cbw-info-dot green"></div>
            <span>En mémoire (5 derniers échanges)</span>
          </div>
          <div class="cbw-info-dot-row">
            <div class="cbw-info-dot red"></div>
            <span>Oublié (hors contexte)</span>
          </div>
        </div>
      </div>
      <button type="button" class="cbw-cancel" style="margin-top:12px; width:100%;">Fermer</button>
    `;
    infoModalBackdrop.appendChild(infoModal);
    panel.appendChild(infoModalBackdrop);
    
    const close = () => infoModalBackdrop.remove();
    infoModal.querySelector('.cbw-cancel').addEventListener('click', close);
    infoModalBackdrop.addEventListener('click', (e) => { if(e.target === infoModalBackdrop) close(); });
  }

  function updateContextVisuals() {
    const rows = Array.from(messagesEl.querySelectorAll('.cbw-row'));
    rows.forEach(r => {
      r.classList.remove('in-context');
      r.classList.remove('out-context');
    });
    
    // Last 10 messages are in context
    const contextRows = rows.slice(-10);
    contextRows.forEach(r => r.classList.add('in-context'));
    
    // Others are out of context
    const outContextRows = rows.slice(0, -10);
    outContextRows.forEach(r => r.classList.add('out-context'));
  }
})();

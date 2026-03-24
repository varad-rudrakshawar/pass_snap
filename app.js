// ── PassSnap App ───────────────────────────────────────────────────

const $ = id => document.getElementById(id);

// ── STATE ──────────────────────────────────────────────────────────
const state = {
  originalDataUrl: null,       // raw uploaded image
  removedBgDataUrl: null,      // after remove.bg (PNG with transparency)
  compositeDataUrl: null,      // with chosen background color
  enhancedDataUrl: null,       // after slider adjustments
  bgColor: '#5b9bd5',
  apiKey: localStorage.getItem('removebg_key') || '',
  enhance: { brightness: 0, contrast: 0, saturation: 0, sharpness: 0 }
};

// ── COLOR PALETTE ──────────────────────────────────────────────────
const COLORS = [
  // Classic passport blues
  '#5b9bd5','#4a90d9','#2d6fa8','#1a5276','#0d3b6e','#1e3a5f',
  // Whites / creams
  '#ffffff','#f5f5f0','#fffde7','#fafafa','#f0f4ff','#eef2ff',
  // Grays
  '#e0e0e0','#bdbdbd','#9e9e9e','#757575','#616161','#424242',
  // Greens
  '#a8d5a2','#66bb6a','#43a047','#2e7d32','#1b5e20','#c8e6c9',
  // Reds / pinks
  '#ef9a9a','#e57373','#c62828','#ffcdd2','#ff8a80','#ff5252',
  // Yellows / oranges
  '#fff59d','#ffd54f','#ffb300','#ff8f00','#e65100','#ffe0b2',
  // Purples / lavenders
  '#ce93d8','#ab47bc','#7b1fa2','#e1bee7','#b39ddb','#7e57c2',
  // Sky / cyan
  '#81d4fa','#29b6f6','#0288d1','#b2ebf2','#4dd0e1','#00838f',
  // Teal
  '#80cbc4','#26a69a','#00695c','#a7ffeb','#1de9b6','#00bfa5',
  // Browns / earth
  '#bcaaa4','#8d6e63','#5d4037','#d7ccc8','#a1887f','#795548',
];

// ── INIT ───────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  buildPalette();
  restoreApiKey();
  bindEvents();
  registerSW();
  updateSteps(1);
});

// ── PALETTE ────────────────────────────────────────────────────────
function buildPalette() {
  const palette = $('colorPalette');
  COLORS.forEach(hex => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch';
    sw.style.background = hex;
    sw.dataset.color = hex;
    if (hex === state.bgColor) sw.classList.add('selected');
    sw.addEventListener('click', () => selectBgColor(hex, sw));
    palette.appendChild(sw);
  });
}

function selectBgColor(hex, swatchEl) {
  document.querySelectorAll('.color-swatch.selected').forEach(s => s.classList.remove('selected'));
  swatchEl.classList.add('selected');
  state.bgColor = hex;
  $('customColor').value = hex;
  $('customColorHex').textContent = hex;
  compositePreview();
}

// ── API KEY ────────────────────────────────────────────────────────
function restoreApiKey() {
  if (state.apiKey) $('apiKey').value = state.apiKey;
}

$('saveKey').addEventListener('click', () => {
  const key = $('apiKey').value.trim();
  if (!key) return showToast('Please enter an API key', 'error');
  state.apiKey = key;
  localStorage.setItem('removebg_key', key);
  showToast('API key saved ✓', 'success');
});

// ── UPLOAD ─────────────────────────────────────────────────────────
function bindEvents() {
  const zone = $('uploadZone');
  const fileInput = $('fileInput');

  zone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => handleFile(e.target.files[0]));
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragover');
    handleFile(e.dataTransfer.files[0]);
  });

  // BG panel
  $('backToUpload').addEventListener('click', () => goPanel(1));
  $('goToEnhance').addEventListener('click', () => { buildEnhanceCanvas(); goPanel(3); });
  $('applyCustom').addEventListener('click', () => {
    const hex = $('customColor').value;
    $('customColorHex').textContent = hex;
    state.bgColor = hex;
    // deselect all, apply
    document.querySelectorAll('.color-swatch.selected').forEach(s => s.classList.remove('selected'));
    compositePreview();
  });
  $('customColor').addEventListener('input', () => {
    $('customColorHex').textContent = $('customColor').value;
  });

  // Enhance panel
  $('backToBg').addEventListener('click', () => goPanel(2));
  $('goToDownload').addEventListener('click', () => { buildSheetCanvas(); goPanel(4); });
  ['brightness','contrast','saturation','sharpness'].forEach(id => {
    $(id).addEventListener('input', () => {
      state.enhance[id] = parseInt($(id).value);
      $(`${id}Val`).textContent = $(id).value;
      applyEnhance();
    });
  });
  $('resetEnhance').addEventListener('click', resetEnhance);

  // Download
  $('downloadBtn').addEventListener('click', downloadSheet);
  $('startOver').addEventListener('click', () => location.reload());

  // PWA install
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredPrompt = e;
    $('installBtn').style.display = 'flex';
  });
  $('installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') $('installBtn').style.display = 'none';
    deferredPrompt = null;
  });
}

// ── FILE HANDLING ──────────────────────────────────────────────────
async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return showToast('Please upload an image file', 'error');
  if (file.size > 10 * 1024 * 1024) return showToast('File too large (max 10MB)', 'error');

  const reader = new FileReader();
  reader.onload = async e => {
    state.originalDataUrl = e.target.result;
    $('originalPreview').src = state.originalDataUrl;
    goPanel(2);
    await removeBackground(file);
  };
  reader.readAsDataURL(file);
}

// ── REMOVE BACKGROUND ─────────────────────────────────────────────
async function removeBackground(file) {
  const overlay = $('processingOverlay');
  overlay.classList.remove('hidden');
  $('processingText').textContent = 'Removing background…';

  // If no API key, fall back to showing original and let user proceed
  if (!state.apiKey) {
    overlay.classList.add('hidden');
    showToast('No API key — using original image. Add remove.bg key for BG removal.', 'error');
    state.removedBgDataUrl = state.originalDataUrl;
    compositePreview();
    return;
  }

  try {
    const formData = new FormData();
    formData.append('image_file', file);
    formData.append('size', 'auto');

    const res = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': state.apiKey },
      body: formData
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.errors?.[0]?.title || `HTTP ${res.status}`);
    }

    const blob = await res.blob();
    state.removedBgDataUrl = await blobToDataUrl(blob);
    overlay.classList.add('hidden');
    showToast('Background removed ✓', 'success');
    compositePreview();
  } catch (err) {
    overlay.classList.add('hidden');
    showToast(`BG removal failed: ${err.message}`, 'error');
    state.removedBgDataUrl = state.originalDataUrl;
    compositePreview();
  }
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

// ── COMPOSITE PREVIEW ─────────────────────────────────────────────
function compositePreview() {
  if (!state.removedBgDataUrl) return;
  const canvas = $('bgPreview');
  const img = new Image();
  img.onload = () => {
    // Maintain passport ratio: 1 × 1.25 (35mm × 45mm)
    const W = 350, H = 450;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Fill background
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(0, 0, W, H);

    // Draw image centered & cropped to fill
    const scale = Math.max(W / img.width, H / img.height);
    const sw = img.width * scale, sh = img.height * scale;
    const sx = (W - sw) / 2, sy = (H - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh);

    state.compositeDataUrl = canvas.toDataURL('image/png');
  };
  img.src = state.removedBgDataUrl;
}

// ── ENHANCE ────────────────────────────────────────────────────────
function buildEnhanceCanvas() {
  const canvas = $('enhanceCanvas');
  const W = 350, H = 450;
  canvas.width = W; canvas.height = H;
  applyEnhance();
}

function applyEnhance() {
  const src = state.compositeDataUrl || state.originalDataUrl;
  if (!src) return;
  const canvas = $('enhanceCanvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.filter = buildCSSFilter();
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';
    if (state.enhance.sharpness > 0) applySharpness(ctx, canvas.width, canvas.height);
    state.enhancedDataUrl = canvas.toDataURL('image/jpeg', 0.97);
  };
  img.src = src;
}

function buildCSSFilter() {
  const { brightness, contrast, saturation } = state.enhance;
  const b = 1 + brightness / 100;
  const c = 1 + contrast / 100;
  const s = 1 + saturation / 100;
  return `brightness(${b}) contrast(${c}) saturate(${s})`;
}

function applySharpness(ctx, w, h) {
  const level = state.enhance.sharpness;
  if (level <= 0) return;
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const kernel = [0, -level/10, 0, -level/10, 1 + 4*level/10, -level/10, 0, -level/10, 0];
  const tmp = new Uint8ClampedArray(d);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let v = 0;
        v += tmp[((y-1)*w+(x-1))*4+c] * kernel[0];
        v += tmp[((y-1)*w+x)*4+c]     * kernel[1];
        v += tmp[((y-1)*w+(x+1))*4+c] * kernel[2];
        v += tmp[(y*w+(x-1))*4+c]     * kernel[3];
        v += tmp[(y*w+x)*4+c]         * kernel[4];
        v += tmp[(y*w+(x+1))*4+c]     * kernel[5];
        v += tmp[((y+1)*w+(x-1))*4+c] * kernel[6];
        v += tmp[((y+1)*w+x)*4+c]     * kernel[7];
        v += tmp[((y+1)*w+(x+1))*4+c] * kernel[8];
        d[i+c] = Math.max(0, Math.min(255, v));
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function resetEnhance() {
  ['brightness','contrast','saturation','sharpness'].forEach(id => {
    state.enhance[id] = 0;
    $(id).value = 0;
    $(`${id}Val`).textContent = 0;
  });
  applyEnhance();
}

// ── SHEET CANVAS (4×6 @ 300dpi = 1200×1800px) ─────────────────────
// Each photo: 1×1.25 in = 300×375px
// Grid: 4 cols × 4 rows... no — let's use 3 cols × 4 rows = 12 photos
// with 0.1in gaps = 30px, margins 0.15in = 45px
function buildSheetCanvas() {
  const src = state.enhancedDataUrl || state.compositeDataUrl || state.originalDataUrl;
  if (!src) return;

  const SHEET_W = 1200; // 4in @ 300dpi
  const SHEET_H = 1800; // 6in @ 300dpi
  const COLS = 3;
  const ROWS = 4;
  const MARGIN_X = 45;  // 0.15in
  const MARGIN_Y = 45;
  const GAP = 15;       // 0.05in

  const photoW = Math.floor((SHEET_W - 2 * MARGIN_X - (COLS - 1) * GAP) / COLS);
  const photoH = Math.floor((SHEET_H - 2 * MARGIN_Y - (ROWS - 1) * GAP) / ROWS);

  const canvas = $('sheetCanvas');
  canvas.width = SHEET_W;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext('2d');

  // Sheet background (white photo paper)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SHEET_W, SHEET_H);

  const img = new Image();
  img.onload = () => {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const x = MARGIN_X + col * (photoW + GAP);
        const y = MARGIN_Y + row * (photoH + GAP);

        // Draw photo
        ctx.save();
        // slight shadow per photo
        ctx.shadowColor = 'rgba(0,0,0,0.12)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;
        ctx.drawImage(img, x, y, photoW, photoH);
        ctx.restore();

        // thin border
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, photoW, photoH);
      }
    }
  };
  img.src = src;
}

// ── DOWNLOAD ───────────────────────────────────────────────────────
function downloadSheet() {
  buildSheetCanvas(); // rebuild at full res
  setTimeout(() => {
    const canvas = $('sheetCanvas');
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'passsnap_passport_4x6.jpg';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Download started ✓', 'success');
      saveToHistory(canvas.toDataURL('image/jpeg', 0.95));
    }, 'image/jpeg', 0.97);
  }, 200);
}

// ── PWA HISTORY (IndexedDB) ────────────────────────────────────────
function saveToHistory(dataUrl) {
  const req = indexedDB.open('PassSnapDB', 1);
  req.onupgradeneeded = e => e.target.result.createObjectStore('photos', { autoIncrement: true });
  req.onsuccess = e => {
    const db = e.target.result;
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').add({ dataUrl, date: new Date().toISOString() });
  };
}

// ── PANEL NAVIGATION ──────────────────────────────────────────────
function goPanel(n) {
  ['panel-upload','panel-bg','panel-enhance','panel-download'].forEach((id, i) => {
    $(id).classList.toggle('hidden', i + 1 !== n);
  });
  updateSteps(n);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateSteps(active) {
  [1,2,3,4].forEach(n => {
    const el = $(`step${n}`);
    el.classList.remove('active','done');
    if (n === active) el.classList.add('active');
    else if (n < active) el.classList.add('done');
  });
}

// ── TOAST ──────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

// ── SERVICE WORKER ─────────────────────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
      .then(() => console.log('SW registered'))
      .catch(e => console.warn('SW failed:', e));
  }
}

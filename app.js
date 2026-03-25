// ── PassSnap App (v2) ──────────────────────────────────────────────
// 3 steps: Upload → Enhance → Download
// No background removal. Increased cut gaps with dashed guide lines.

const $ = id => document.getElementById(id);

// ── STATE ──────────────────────────────────────────────────────────
const state = {
  originalDataUrl: null,
  enhancedDataUrl: null,
  enhance: { brightness: 0, contrast: 0, saturation: 0, sharpness: 0 }
};

// ── INIT ───────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  registerSW();
  updateSteps(1);
});

// ── BIND EVENTS ────────────────────────────────────────────────────
function bindEvents() {
  // Upload
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

  // Enhance panel
  $('backToUpload').addEventListener('click', () => goPanel(1));
  $('goToDownload').addEventListener('click', () => { buildSheetCanvas(); goPanel(3); });
  ['brightness','contrast','saturation','sharpness'].forEach(id => {
    $(id).addEventListener('input', () => {
      state.enhance[id] = parseInt($(id).value);
      $(`${id}Val`).textContent = $(id).value;
      applyEnhance();
    });
  });
  $('resetEnhance').addEventListener('click', resetEnhance);

  // Download panel
  $('backToEnhance').addEventListener('click', () => goPanel(2));
  $('downloadBtn').addEventListener('click', downloadSheet);
  $('startOver').addEventListener('click', () => location.reload());

  // PWA install prompt
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
function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return showToast('Please upload an image file', 'error');
  if (file.size > 10 * 1024 * 1024) return showToast('File too large (max 10MB)', 'error');

  const reader = new FileReader();
  reader.onload = e => {
    state.originalDataUrl = e.target.result;
    // Reset enhance sliders when new image loaded
    resetEnhanceState();
    buildEnhanceCanvas();
    goPanel(2);
    showToast('Photo loaded ✓', 'success');
  };
  reader.readAsDataURL(file);
}

// ── ENHANCE ────────────────────────────────────────────────────────
function buildEnhanceCanvas() {
  const canvas = $('enhanceCanvas');
  // passport ratio 35mm × 45mm = 1 : 1.286
  canvas.width = 350;
  canvas.height = 450;
  applyEnhance();
}

function applyEnhance() {
  const src = state.originalDataUrl;
  if (!src) return;
  const canvas = $('enhanceCanvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply CSS filter for brightness / contrast / saturation
    ctx.filter = buildCSSFilter();

    // Cover-fit the image into canvas (keep aspect, crop to fill)
    const W = canvas.width, H = canvas.height;
    const scale = Math.max(W / img.width, H / img.height);
    const sw = img.width * scale, sh = img.height * scale;
    const sx = (W - sw) / 2, sy = (H - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh);
    ctx.filter = 'none';

    // Software sharpness pass
    if (state.enhance.sharpness > 0) applySharpness(ctx, W, H);

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
  const k = level / 10;
  const kernel = [0, -k, 0, -k, 1 + 4*k, -k, 0, -k, 0];
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const tmp = new Uint8ClampedArray(d);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let v = 0;
        v += tmp[((y-1)*w+(x-1))*4+c] * kernel[0];
        v += tmp[((y-1)*w+ x   )*4+c] * kernel[1];
        v += tmp[((y-1)*w+(x+1))*4+c] * kernel[2];
        v += tmp[(  y  *w+(x-1))*4+c] * kernel[3];
        v += tmp[(  y  *w+ x   )*4+c] * kernel[4];
        v += tmp[(  y  *w+(x+1))*4+c] * kernel[5];
        v += tmp[((y+1)*w+(x-1))*4+c] * kernel[6];
        v += tmp[((y+1)*w+ x   )*4+c] * kernel[7];
        v += tmp[((y+1)*w+(x+1))*4+c] * kernel[8];
        d[i+c] = Math.max(0, Math.min(255, v));
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function resetEnhanceState() {
  ['brightness','contrast','saturation','sharpness'].forEach(id => {
    state.enhance[id] = 0;
    $(id).value = 0;
    $(`${id}Val`).textContent = 0;
  });
}

function resetEnhance() {
  resetEnhanceState();
  applyEnhance();
}

// ── SHEET CANVAS ───────────────────────────────────────────────────
// Output: 1200 × 1800 px  (4 × 6 in @ 300 DPI)
// Layout: 3 cols × 4 rows = 12 photos
//
// Passport photo size: 35 × 45 mm → at 300 DPI ≈ 413 × 531 px
// BUT we fit 3 cols in 1200 px with generous gaps, so we calculate:
//
// MARGIN_X = 54 px (0.18 in) each side
// GAP_X    = 48 px (0.16 in) between cols  ← wide enough to cut
// GAP_Y    = 54 px (0.18 in) between rows  ← wide enough to cut
// MARGIN_Y = 54 px (0.18 in) top/bottom
//
// photoW = (1200 - 2*54 - 2*48) / 3 = (1200 - 108 - 96) / 3 = 332 px
// photoH = (1800 - 2*54 - 3*54) / 4 = (1800 - 108 - 162) / 4 = 382 px
// Ratio 332:382 ≈ 1:1.15 (close to passport 35:45 = 1:1.29)
// Adjusted: use GAP_Y = 30px, MARGIN_Y = 45 to get taller photos.
//
// Final clean numbers used below:
const SHEET = {
  W: 1200, H: 1800,
  COLS: 3, ROWS: 4,
  MARGIN_X: 54,
  MARGIN_Y: 54,
  GAP_X: 48,   // ~4mm gap — plenty for scissors
  GAP_Y: 48,   // ~4mm gap
};

function buildSheetCanvas() {
  const src = state.enhancedDataUrl || state.originalDataUrl;
  if (!src) return;

  const { W, H, COLS, ROWS, MARGIN_X, MARGIN_Y, GAP_X, GAP_Y } = SHEET;
  const photoW = Math.floor((W - 2 * MARGIN_X - (COLS - 1) * GAP_X) / COLS);
  const photoH = Math.floor((H - 2 * MARGIN_Y - (ROWS - 1) * GAP_Y) / ROWS);

  const canvas = $('sheetCanvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // White photo paper base
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const img = new Image();
  img.onload = () => {
    // Draw 12 photos
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const x = MARGIN_X + col * (photoW + GAP_X);
        const y = MARGIN_Y + row * (photoH + GAP_Y);

        // Clip to photo rectangle
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, photoW, photoH);
        ctx.clip();

        // Cover-fit image
        const scale = Math.max(photoW / img.width, photoH / img.height);
        const sw = img.width * scale, sh = img.height * scale;
        const sx = x + (photoW - sw) / 2;
        const sy = y + (photoH - sh) / 2;
        ctx.drawImage(img, sx, sy, sw, sh);
        ctx.restore();

        // Thin solid border around each photo
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, photoW, photoH);
      }
    }

    // ── CUT GUIDE LINES ─────────────────────────────────────────
    // Draw dashed lines in the gap zones so it's clear where to cut
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 5]);

    // Vertical cut guides (between columns + outer edges)
    const colPositions = [];
    for (let col = 0; col < COLS; col++) {
      const x = MARGIN_X + col * (photoW + GAP_X);
      colPositions.push(x);                // left edge of photo
      colPositions.push(x + photoW);       // right edge of photo
    }
    // Draw a dashed line in the middle of each gap
    // Left margin midpoint
    drawVLine(ctx, MARGIN_X / 2, H);
    // Between columns
    for (let col = 0; col < COLS - 1; col++) {
      const rightEdge = MARGIN_X + col * (photoW + GAP_X) + photoW;
      const midX = rightEdge + GAP_X / 2;
      drawVLine(ctx, midX, H);
    }
    // Right margin midpoint
    drawVLine(ctx, W - MARGIN_X / 2, H);

    // Horizontal cut guides (between rows + outer edges)
    drawHLine(ctx, MARGIN_Y / 2, W);
    for (let row = 0; row < ROWS - 1; row++) {
      const bottomEdge = MARGIN_Y + row * (photoH + GAP_Y) + photoH;
      const midY = bottomEdge + GAP_Y / 2;
      drawHLine(ctx, midY, W);
    }
    drawHLine(ctx, H - MARGIN_Y / 2, W);

    ctx.restore();
  };
  img.src = src;
}

function drawVLine(ctx, x, h) {
  ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
}
function drawHLine(ctx, y, w) {
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
}

// ── DOWNLOAD ───────────────────────────────────────────────────────
function downloadSheet() {
  // Rebuild at full resolution then export
  buildSheetCanvas();
  setTimeout(() => {
    const canvas = $('sheetCanvas');
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'passsnap_4x6_passport_sheet.jpg';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Download started ✓', 'success');
      saveToHistory(canvas.toDataURL('image/jpeg', 0.92));
    }, 'image/jpeg', 0.97);
  }, 300);
}

// ── PWA HISTORY (IndexedDB) ────────────────────────────────────────
function saveToHistory(dataUrl) {
  try {
    const req = indexedDB.open('PassSnapDB', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('photos', { autoIncrement: true });
    req.onsuccess = e => {
      const db = e.target.result;
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').add({ dataUrl, date: new Date().toISOString() });
    };
  } catch (e) { /* non-critical */ }
}

// ── PANEL NAVIGATION ──────────────────────────────────────────────
const PANELS = ['panel-upload', 'panel-enhance', 'panel-download'];

function goPanel(n) {
  PANELS.forEach((id, i) => {
    $(id).classList.toggle('hidden', i + 1 !== n);
  });
  updateSteps(n);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateSteps(active) {
  [1, 2, 3].forEach(n => {
    const el = $(`step${n}`);
    el.classList.remove('active', 'done');
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
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}

// ── SERVICE WORKER ─────────────────────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
      .catch(e => console.warn('SW:', e));
  }
}

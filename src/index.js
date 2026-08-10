import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// ── Config ────────────────────────────────────────────────
function normalizeApiBase(value) {
  const base = (value || '').trim().replace(/\/$/, '');
  if (!base) return 'http://localhost:5000/api';
  return base.endsWith('/api') ? base : `${base}/api`;
}

const API_BASE = normalizeApiBase(window.VISIFY_API_URL || import.meta.env.VITE_API_BASE_URL);
// Explicit API key is only set when a merchant uses the advanced override —
// normally the block auto-detects the shop and no key is needed.
const BRAND_API_KEY = window.VISIFY_API_KEY;
const SHOP_DOMAIN = window.VISIFY_SHOP_DOMAIN;
const PRODUCT_HANDLE = window.VISIFY_PRODUCT_ID;
const CONFIGURATOR_ID = window.VISIFY_CONFIGURATOR_ID;

function configuratorEndpoint() {
  const isMongoId = typeof PRODUCT_HANDLE === 'string' && /^[a-f0-9]{24}$/i.test(PRODUCT_HANDLE);

  if (isMongoId) {
    return `${API_BASE}/public/products/${PRODUCT_HANDLE}`;
  }

  if (BRAND_API_KEY && PRODUCT_HANDLE) {
    return `${API_BASE}/configurator/public/${BRAND_API_KEY}/${PRODUCT_HANDLE}`;
  }

  if (SHOP_DOMAIN && PRODUCT_HANDLE) {
    return `${API_BASE}/configurator/public/by-shop/${SHOP_DOMAIN}/${PRODUCT_HANDLE}`;
  }

  if (CONFIGURATOR_ID) {
    return `${API_BASE}/public/products/${CONFIGURATOR_ID}`;
  }

  return null;
}

let scene, camera, renderer, controls;
let animationId = null;
let loadedParts = {};
let selectedVariants = {};
let sessionId = null;
let configuratorData = null;
let totalPrice = 0;
let baseModelCenter = new THREE.Vector3();

// ── Loader ────────────────────────────────────────────────
const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
loader.setDRACOLoader(dracoLoader);
const textureLoader = new THREE.TextureLoader();
const textureCache = {};

// ── Host Theme Detection ────────────────────────────────────
// Reads colors/font/radius from the merchant's own Shopify theme (or
// whatever page the widget is embedded in) so the panel looks native
// instead of imposing a fixed brand look. Falls back to neutral
// defaults when nothing theme-like is found (e.g. dashboard preview).
function readCssVar(styles, names) {
  for (const name of names) {
    const value = styles.getPropertyValue(name).trim();
    if (value) return value;
  }
  return null;
}

function findHostButton() {
  const selectors = [
    '.product-form__submit',
    'form[action*="/cart/add"] button[type="submit"]',
    'button[name="add"]',
    '.shopify-payment-button__button--unbranded',
    '.btn', '.button', 'button[type="submit"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) return el;
  }
  return null;
}

function detectHostTheme() {
  const fallback = {
    font: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
    text: '#1a1a1a',
    bg: '#ffffff',
    accent: '#1a1a1a',
    accentContrast: '#ffffff',
    radius: '8px',
  };

  try {
    const rootStyles = getComputedStyle(document.documentElement);
    const bodyStyles = getComputedStyle(document.body);
    const hostBtn = findHostButton();
    const btnStyles = hostBtn ? getComputedStyle(hostBtn) : null;

    const font = readCssVar(rootStyles, ['--font-body-family', '--font-family-base', '--body-font-family'])
      || bodyStyles.fontFamily
      || fallback.font;

    const text = readCssVar(rootStyles, ['--color-base-text', '--color-text', '--color-foreground', '--text-color'])
      || bodyStyles.color
      || fallback.text;

    const bg = readCssVar(rootStyles, ['--color-base-background-1', '--color-background', '--background-color'])
      || fallback.bg;

    const accent = readCssVar(rootStyles, ['--color-base-accent-1', '--color-accent', '--color-primary', '--color-button'])
      || btnStyles?.backgroundColor
      || fallback.accent;

    const accentContrast = readCssVar(rootStyles, ['--color-base-solid-button-labels', '--color-button-text'])
      || btnStyles?.color
      || fallback.accentContrast;

    let radius = readCssVar(rootStyles, ['--buttons-radius-outset', '--buttons-radius', '--inputs-radius-outset']);
    if (radius == null && btnStyles) radius = btnStyles.borderRadius;
    if (radius == null) radius = fallback.radius;

    return { font, text, bg, accent, accentContrast, radius };
  } catch {
    return fallback;
  }
}

function applyHostTheme(root) {
  if (!root) return;
  const theme = detectHostTheme();
  root.style.setProperty('--v-font', theme.font);
  root.style.setProperty('--v-text', theme.text);
  root.style.setProperty('--v-bg', theme.bg);
  root.style.setProperty('--v-accent', theme.accent);
  root.style.setProperty('--v-accent-contrast', theme.accentContrast);
  root.style.setProperty('--v-radius', theme.radius);
}

// ── CSS ──────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  #visify-root * {
    margin: 0; padding: 0; box-sizing: border-box;
    font-family: var(--v-font);
    -webkit-font-smoothing: antialiased;
  }

  #visify-root {
    --v-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --v-text: #1a1a1a;
    --v-bg: #ffffff;
    --v-accent: #1a1a1a;
    --v-accent-contrast: #ffffff;
    --v-radius: 8px;

    width: 100%;
    height: 100%;
    display: flex;
    background: #fafafa;
    overflow: hidden;
    position: relative;
    border: 1px solid #e5e5e5;
    border-radius: var(--v-radius);
    color: var(--v-text);
  }

  /* ── Canvas ── */
  #visify-canvas { flex: 1; display: block; min-width: 0; cursor: grab; background: #fafafa; }
  #visify-canvas:active { cursor: grabbing; }

  /* ── Side Panel ── */
  #visify-panel {
    width: 340px;
    flex-shrink: 0;
    background: var(--v-bg);
    border-left: 1px solid #ececec;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Panel Header */
  .v-panel-header {
    padding: 28px 24px 18px;
    border-bottom: 1px solid #f0f0f0;
    flex-shrink: 0;
  }

  .v-product-name {
    color: var(--v-text);
    font-size: 20px;
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: -0.01em;
  }

  .v-brand-name {
    color: #8a8a8a;
    font-size: 13px;
    margin-top: 6px;
    font-weight: 400;
  }

  /* Price Layout */
  .v-price-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 24px;
    border-bottom: 1px solid #f0f0f0;
    flex-shrink: 0;
  }

  .v-price-label {
    color: #8a8a8a;
    font-size: 13px;
    font-weight: 500;
  }

  .v-price-value {
    color: var(--v-text);
    font-size: 22px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  /* Parts container */
  .v-parts-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 16px 0;
  }
  .v-parts-scroll::-webkit-scrollbar { width: 4px; }
  .v-parts-scroll::-webkit-scrollbar-track { background: transparent; }
  .v-parts-scroll::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 2px; }

  /* Category label */
  .v-cat-label {
    padding: 14px 24px 8px;
    font-size: 11px;
    color: #a0a0a0;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 600;
  }

  /* Part rows */
  .v-part-section {
    padding: 0 16px;
    margin-bottom: 4px;
  }

  .v-part-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    cursor: pointer;
    border-radius: calc(var(--v-radius) * 0.6);
    border: 1px solid transparent;
    transition: background 0.15s ease;
  }
  .v-part-header:hover { background: #f6f6f6; }

  .v-part-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--v-text);
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .v-part-price {
    font-size: 13px;
    color: #8a8a8a;
    font-weight: 400;
  }

  /* Active dynamic states */
  .v-part-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #d8d8d8;
    transition: background 0.2s;
  }
  .v-part-dot.active {
    background: var(--v-accent);
  }

  .v-part-section:has(.v-part-dot.active) .v-part-header {
    background: #fafafa;
  }
  .v-part-section:has(.v-part-dot.active) .v-part-name {
    font-weight: 600;
  }

  /* Toggle buttons */
  .v-part-toggle {
    width: 26px;
    height: 26px;
    border-radius: calc(var(--v-radius) * 0.5);
    border: 1px solid #ddd;
    background: #ffffff;
    color: var(--v-text);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }
  .v-part-toggle:hover { border-color: var(--v-accent); color: var(--v-accent); }
  .v-part-toggle.added { border-color: var(--v-accent); background: var(--v-accent); color: var(--v-accent-contrast); }

  /* Swatches */
  .v-variants {
    padding: 10px 12px 14px 28px;
    display: none;
  }
  .v-variants.open { display: block; }

  .v-variant-label {
    font-size: 12px;
    color: #8a8a8a;
    margin-bottom: 10px;
    font-weight: 500;
  }

  .v-swatches { display: flex; gap: 10px; flex-wrap: wrap; }

  .v-swatch {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 1px solid rgba(0,0,0,0.12);
    outline: 2px solid transparent;
    outline-offset: 2px;
    cursor: pointer;
    transition: transform 0.15s, outline-color 0.15s;
    position: relative;
  }
  .v-swatch:hover { transform: scale(1.08); }
  .v-swatch.active { outline-color: var(--v-accent); }

  /* Checkout CTA */
  .v-cart-section {
    padding: 20px 24px;
    border-top: 1px solid #f0f0f0;
    background: var(--v-bg);
    flex-shrink: 0;
  }

  .v-cart-btn {
    width: 100%;
    background: var(--v-accent);
    color: var(--v-accent-contrast);
    border: none;
    padding: 16px 18px;
    border-radius: var(--v-radius);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s ease;
  }
  .v-cart-btn:hover { opacity: 0.88; }
  .v-cart-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .v-powered {
    text-align: center;
    padding-top: 14px;
    font-size: 11px;
    color: #a0a0a0;
    font-weight: 400;
  }
  .v-powered a { color: #8a8a8a; text-decoration: none; font-weight: 500; }

  /* Loading overlay */
  #visify-loading {
    position: absolute;
    inset: 0;
    background: #ffffff;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    z-index: 20;
  }

  .v-spinner {
    width: 32px; height: 32px;
    border: 2px solid #f0f0f0;
    border-top-color: var(--v-accent);
    border-radius: 50%;
    animation: v-spin 0.8s linear infinite;
  }
  @keyframes v-spin { to { transform: rotate(360deg); } }

  .v-loading-logo {
    color: var(--v-text);
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.1em;
  }
  .v-loading-logo span { color: var(--v-accent); }

  .v-progress {
    width: 120px;
    height: 2px;
    background: #f0f0f0;
    overflow: hidden;
  }
  .v-progress-fill { height: 100%; background: var(--v-accent); width: 0%; transition: width 0.2s ease; }

  /* Responsive */
  @media (max-width: 768px) {
    #visify-root { flex-direction: column; height: auto; }
    #visify-canvas { height: 320px; }
    #visify-panel { width: 100%; border-left: none; border-top: 1px solid #ececec; }
  }
`;
document.head.appendChild(style);

// ── Init ──────────────────────────────────────────────────
async function init() {
  const container = document.getElementById('visify-configurator');
  if (!container) return;

  container.innerHTML = `
    <div id="visify-root">
      <div id="visify-loading">
        <div class="v-spinner"></div>
        <div class="v-loading-logo">VI<span>SI</span>FY</div>
        <div class="v-progress"><div class="v-progress-fill" id="v-fill"></div></div>
      </div>
    </div>
  `;
  applyHostTheme(document.getElementById('visify-root'));

  try {
    const endpoint = configuratorEndpoint();
    if (!endpoint) {
      document.getElementById('visify-loading').innerHTML = `<p style="color:#ef4444;font-size:13px;">⚠️ Missing product identifier</p>`;
      return;
    }

    const requestInit = BRAND_API_KEY
      ? { headers: { 'X-API-Key': BRAND_API_KEY } }
      : undefined;

    const res = await fetch(endpoint, requestInit);
    const data = await res.json();

    if (!res.ok) {
      document.getElementById('visify-loading').innerHTML = `<p style="color:#ef4444;font-size:13px;">⚠️ ${data.message}</p>`;
      return;
    }

    configuratorData = data.configurator || data.product;
    const brandData = data.brand || null;
    totalPrice = configuratorData.basePrice || 0;

    const sessionRes = await fetch(`${API_BASE}/configurator/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandId: brandData?.id || configuratorData.brandId,
        configuratorProductId: configuratorData._id,
      }),
    });
    const sessionData = await sessionRes.json();
    sessionId = sessionData.session._id;

  } catch (err) {
    document.getElementById('visify-loading').innerHTML = `<p style="color:#ef4444;font-size:13px;">⚠️ Connection Error</p>`;
    return;
  }

  document.getElementById('visify-root').innerHTML = `
    <div id="visify-loading">
      <div class="v-spinner"></div>
      <div class="v-loading-logo">VI<span>SI</span>FY</div>
      <div class="v-progress"><div class="v-progress-fill" id="v-fill"></div></div>
    </div>
    <canvas id="visify-canvas"></canvas>
    <div id="visify-panel">
      <div class="v-panel-header">
        <div class="v-product-name">${configuratorData.name}</div>
        <div class="v-brand-name">Customize Option Layout</div>
      </div>
      <div class="v-price-row">
        <span class="v-price-label">Total Price</span>
        <span class="v-price-value" id="v-total-price">$${totalPrice.toFixed(2)}</span>
      </div>
      <div class="v-parts-scroll" id="v-parts-list"></div>
      <div class="v-cart-section">
        <button class="v-cart-btn" id="v-cart-btn">Add to Cart</button>
        <div class="v-powered">Powered by <a href="https://visify.io" target="_blank">Visify</a></div>
      </div>
    </div>
  `;

  setupThreeJS();
  await loadModel(configuratorData.baseModelUrl, 'base', true);
  buildPartsPanel();

  for (const part of configuratorData.parts) {
    if (part.isDefault || part.isRequired) {
      await addPartToScene(part);
    }
  }

  document.getElementById('v-cart-btn').addEventListener('click', handleAddToCart);
  document.getElementById('visify-loading').style.display = 'none';
}

// ── Three.js Layout Engine Setup ──────────────────────────
function setupThreeJS() {
  const canvas = document.getElementById('visify-canvas');
  const root = document.getElementById('visify-root');

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#fafafa');

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);

  camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 1000);
  const cp = configuratorData.cameraPosition || { x: 0, y: 1, z: 3 };
  camera.position.set(cp.x, cp.y, cp.z);

  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const dir = new THREE.DirectionalLight(0xffffff, 1.5);
  dir.position.set(5, 8, 5);
  scene.add(dir);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2; // Prevents camera from going under floor grid

  const resizeObserver = new ResizeObserver(() => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });
  resizeObserver.observe(canvas);

  animate();
}

function animate() {
  animationId = requestAnimationFrame(animate);
  if (controls) controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
}

// Explicitly release the GPU/WebGL context when the tab/page goes away —
// without this, every page that ever loaded the viewer keeps its context
// alive (rAF loop never stops), quickly exhausting the browser-wide WebGL
// context limit on low-end/integrated GPUs and on most mobile browsers.
function destroyViewer() {
  if (animationId) cancelAnimationFrame(animationId);
  if (renderer) {
    renderer.dispose();
    renderer.forceContextLoss?.();
  }
}
window.addEventListener('pagehide', destroyViewer);

function loadModel(url, id, isBase = false) {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const fillEl = document.getElementById('v-fill');
    loader.load(
      url,
      (gltf) => {
        const group = gltf.scene;
        const box = new THREE.Box3().setFromObject(group);
        const size = box.getSize(new THREE.Vector3());

        if (isBase) {
          const center = box.getCenter(new THREE.Vector3());
          group.position.sub(center);
          baseModelCenter.copy(center);
          const len = size.length();
          camera.position.set(0, len * 0.4, len * 1.4);
          controls.target.set(0, 0, 0);
        } else {
          group.position.sub(baseModelCenter);
        }

        scene.add(group);
        loadedParts[id] = group;
        resolve(group);
      },
      (xhr) => {
        if (xhr.total > 0 && fillEl) {
          const pct = Math.round((xhr.loaded / xhr.total) * 100);
          fillEl.style.width = pct + '%';
        }
      },
      () => resolve(null)
    );
  });
}

async function addPartToScene(part) {
  if (loadedParts[part._id]) return;
  await loadModel(part.modelUrl, part._id);
  updatePrice();
}

function removePartFromScene(partId) {
  const group = loadedParts[partId];
  if (group) {
    scene.remove(group);
    delete loadedParts[partId];
    updatePrice();
  }
}

function forEachPartMaterial(partId, fn) {
  const group = loadedParts[partId];
  if (!group) return;
  group.traverse((child) => {
    if (child.isMesh && child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(fn);
    }
  });
}

function applyColorToPart(partId, hexColor) {
  const color = new THREE.Color(hexColor);
  forEachPartMaterial(partId, (mat) => {
    if (mat.map) {
      mat.map = null;
      mat.needsUpdate = true;
    }
    if (mat.color) mat.color.set(color);
  });
}

function applyTextureToPart(partId, textureUrl) {
  if (!textureUrl) return;
  const cached = textureCache[textureUrl];
  const onLoaded = (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    forEachPartMaterial(partId, (mat) => {
      if ('map' in mat) {
        mat.map = texture;
        if (mat.color) mat.color.set(0xffffff);
        mat.needsUpdate = true;
      }
    });
  };

  if (cached) {
    onLoaded(cached);
    return;
  }
  textureLoader.load(textureUrl, (texture) => {
    textureCache[textureUrl] = texture;
    onLoaded(texture);
  });
}

function applyVariantToPart(partId, variant) {
  if (!variant) return;
  if (variant.type === 'texture') {
    applyTextureToPart(partId, variant.value);
  } else {
    applyColorToPart(partId, variant.value);
  }
}

function updatePrice() {
  totalPrice = configuratorData.basePrice || 0;
  configuratorData.parts.forEach(part => {
    if (loadedParts[part._id]) {
      totalPrice += part.basePrice || 0;
      const selectedVariantId = selectedVariants[part._id];
      if (selectedVariantId) {
        const variant = part.variants.find(v => v._id === selectedVariantId);
        if (variant) totalPrice += variant.priceModifier || 0;
      }
    }
  });
  const priceEl = document.getElementById('v-total-price');
  if (priceEl) priceEl.textContent = `$${totalPrice.toFixed(2)}`;
}

function buildPartsPanel() {
  const list = document.getElementById('v-parts-list');
  if (!list) return;

  if (configuratorData.parts.length === 0) {
    list.innerHTML = '<p style="color:#71717a;font-size:12px;padding:20px;text-align:center;">No modifications available</p>';
    return;
  }

  const categories = {};
  configuratorData.parts.forEach(part => {
    const cat = part.category || 'Options';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(part);
  });

  let html = '';
  Object.entries(categories).forEach(([cat, parts]) => {
    html += `<div class="v-cat-label">${cat}</div>`;
    parts.forEach(part => {
      const isAdded = !!loadedParts[part._id];
      const hasVariants = part.variants.length > 0;

      html += `
        <div class="v-part-section">
          <div class="v-part-header" data-part-id="${part._id}">
            <div class="v-part-name">
              <span class="v-part-dot ${isAdded ? 'active' : ''}" id="dot-${part._id}"></span>
              ${part.name}
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              ${part.basePrice > 0 ? `<span class="v-part-price">+$${part.basePrice}</span>` : ''}
              ${!part.isRequired ? `
                <button class="v-part-toggle ${isAdded ? 'added' : ''}" id="toggle-${part._id}" data-part-id="${part._id}">
                  ${isAdded ? '✓' : '+'}
                </button>
              ` : ''}
            </div>
          </div>
          ${hasVariants ? `
            <div class="v-variants ${isAdded ? 'open' : ''}" id="variants-${part._id}">
              <div class="v-variant-label">${part.variants.every(v => v.type === 'texture') ? 'Select Texture' : 'Select Option'}</div>
              <div class="v-swatches">
                ${part.variants.map((v, i) => `
                  <button
                    class="v-swatch ${i === 0 ? 'active' : ''}"
                    style="background:${v.type === 'texture' ? `url('${v.value}') center/cover` : v.value}"
                    title="${v.label}"
                    data-part-id="${part._id}"
                    data-variant-id="${v._id}"
                    data-value="${v.value}"
                    data-type="${v.type}"
                  ></button>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `;
    });
  });

  list.innerHTML = html;

  // Click Action Logic bindings
  list.querySelectorAll('.v-part-toggle').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const partId = btn.dataset.partId;
      const part = configuratorData.parts.find(p => p._id === partId);
      if (!part) return;

      const isAdded = !!loadedParts[partId];

      if (isAdded) {
        removePartFromScene(partId);
        btn.classList.remove('added');
        btn.textContent = '+';
        document.getElementById(`dot-${partId}`)?.classList.remove('active');
        document.getElementById(`variants-${partId}`)?.classList.remove('open');
      } else {
        btn.disabled = true;
        await addPartToScene(part);
        btn.disabled = false;
        btn.classList.add('added');
        btn.textContent = '✓';
        document.getElementById(`dot-${partId}`)?.classList.add('active');
        document.getElementById(`variants-${partId}`)?.classList.add('open');

        if (part.variants.length > 0) {
          applyVariantToPart(partId, part.variants[0]);
          selectedVariants[partId] = part.variants[0]._id;
          updatePrice();
        }
      }
    });
  });

  list.querySelectorAll('.v-part-header').forEach(header => {
    header.addEventListener('click', () => {
      const partId = header.dataset.partId;
      const toggleBtn = document.getElementById(`toggle-${partId}`);
      if (toggleBtn) {
        toggleBtn.click();
      } else {
        const variantsEl = document.getElementById(`variants-${partId}`);
        if (variantsEl) variantsEl.classList.toggle('open');
      }
    });
  });

  list.querySelectorAll('.v-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const partId = swatch.dataset.partId;
      const variantId = swatch.dataset.variantId;
      const value = swatch.dataset.value;
      const type = swatch.dataset.type;

      list.querySelectorAll(`.v-swatch[data-part-id="${partId}"]`).forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');

      selectedVariants[partId] = variantId;
      if (loadedParts[partId]) {
        applyVariantToPart(partId, { type, value });
      }
      updatePrice();
    });
  });
}

// ── Shopify AJAX Integration Handler ──────────────────────
async function handleAddToCart() {
  const btn = document.getElementById('v-cart-btn');
  btn.disabled = true;
  btn.textContent = 'Adding to cart...';

  const selectedParts = configuratorData.parts
    .filter(part => loadedParts[part._id])
    .map(part => {
      const variantId = selectedVariants[part._id];
      const variant = part.variants.find(v => v._id === variantId);
      return {
        partId: part._id,
        partName: part.name,
        variantId: variant?._id || null,
        variantLabel: variant?.label || 'Default',
        variantValue: variant?.value || '',
        priceModifier: variant?.priceModifier || 0,
      };
    });

  try {
    await fetch(`${API_BASE}/configurator/session/${sessionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedParts, totalPrice }),
    });

    const cartRes = await fetch(`${API_BASE}/configurator/session/${sessionId}/cart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const cartData = await cartRes.json();

    if (!cartRes.ok || !cartData.shopifyCartData?.checkoutUrl) {
      btn.disabled = false;
      btn.textContent = cartData.message || 'Unavailable — try again';
      return;
    }

    if (cartData.shopifyCartData.isDevStub) {
      // SKIP_DRAFT_ORDER=true on the backend — real Shopify Draft Order API
      // isn't being called (Protected Customer Data access pending Shopify
      // review), so there's nothing real to redirect to. Confirm the
      // computed price/parts reached here correctly instead of silently
      // landing on an empty native /cart page.
      btn.textContent = `✅ Dev stub OK — $${cartData.shopifyCartData.totalPrice}`;
      return;
    }

    // Redirects to a Shopify Draft Order checkout priced at the exact
    // configured total (base + selected parts) — no native variant/cart
    // involved, so there's no way for the charged price to drift from what
    // was shown here.
    window.location.href = cartData.shopifyCartData.checkoutUrl;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Add to Cart';
  }
}

init();

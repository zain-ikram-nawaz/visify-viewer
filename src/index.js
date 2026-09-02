import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// ── Config ────────────────────────────────────────────────
function normalizeApiBase(value) {
  const base = (value || '').trim().replace(/\/$/, '');
  if (!base) return 'https://visify-backend.zingcalc.com/api';
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
let originalMaterialStates = {};
let sessionId = null;
let sessionToken = null;
let configuratorData = null;
let totalPrice = 0;
let baseModelCenter = new THREE.Vector3();
let defaultCameraPosition = new THREE.Vector3();
let defaultCameraTarget = new THREE.Vector3();
let canvasHintTimer = null;
let webglAvailable = true;

// ── Loader ────────────────────────────────────────────────
const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
loader.setDRACOLoader(dracoLoader);
const textureLoader = new THREE.TextureLoader();
const textureCache = {};

// ── Small utils ───────────────────────────────────────────
function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const contentType = response.headers.get('content-type') || 'unknown content type';
    throw new Error(`Configurator API returned a non-JSON response (${response.status}, ${contentType}). Check the API URL.`);
  }
}

function formatMoney(value) {
  const amount = Number(value) || 0;
  const currency = configuratorData?.currencyCode || 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

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
// Styles live in ./visify.css (kept as a separate file so it can be
// cached independently and edited without touching the widget script).
//
// NOTE: we deliberately avoid `import.meta.url` here — it throws unless
// this exact file is evaluated as a real ES module, which isn't
// guaranteed once it goes through a bundler or gets embedded as a plain
// <script> on a merchant's site. Instead we resolve the CSS path from
// the actual <script> tag's own src, which works in every case, and we
// allow an explicit override for setups that host the CSS elsewhere.
function resolveScriptUrl() {
  try {
    if (document.currentScript && document.currentScript.src) {
      return document.currentScript.src;
    }
  } catch {}
  // Fallback: last <script> on the page that looks like this widget.
  const scripts = document.querySelectorAll('script[src*="index"]');
  const match = scripts[scripts.length - 1];
  return match ? match.src : null;
}

function loadStylesheet() {
  if (document.querySelector('link[data-visify-styles]')) return;

  // Explicit override always wins, for setups that host the CSS elsewhere.
  let href = window.VISIFY_CSS_URL || null;

  if (!href) {
    const scriptUrl = resolveScriptUrl();
    try {
      href = scriptUrl ? new URL('./visify.css', scriptUrl).href : 'visify.css';
    } catch {
      href = 'visify.css';
    }
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute('data-visify-styles', 'true');
  document.head.appendChild(link);
}
loadStylesheet();

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
    const data = await readJsonResponse(res);

    if (!res.ok) {
      document.getElementById('visify-loading').innerHTML = `<p style="color:#ef4444;font-size:13px;">⚠️ ${escapeHtml(data.message)}</p>`;
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
    const sessionData = await readJsonResponse(sessionRes);
    if (!sessionRes.ok || !sessionData.session?.sessionToken) {
      throw new Error(sessionData.message || 'Unable to start configurator session');
    }
    sessionId = sessionData.session._id;
    sessionToken = sessionData.session.sessionToken;

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
    <div class="v-canvas-wrap">
      <div class="v-canvas-backdrop" aria-hidden="true">
        <div class="v-stage-ring v-stage-ring-one"></div>
        <div class="v-stage-ring v-stage-ring-two"></div>
        <div class="v-stage-glow"></div>
        <div class="v-stage-caption">LIVE 3D PREVIEW</div>
      </div>
      <canvas id="visify-canvas"></canvas>
      <div class="v-canvas-hint" id="v-canvas-hint">Drag to rotate · Right-drag to move · Scroll or use +/- to zoom</div>
      <div class="v-canvas-instructions" aria-label="3D viewer instructions">
        <span><i class="v-instruction-dot v-instruction-rotate"></i>Rotate</span>
        <span><i class="v-instruction-dot v-instruction-pan"></i>Move</span>
        <span><i class="v-instruction-dot v-instruction-zoom"></i>Zoom</span>
      </div>
      <div class="v-canvas-tools">
        <button class="v-canvas-action v-canvas-icon" id="v-zoom-out" type="button" title="Zoom out" aria-label="Zoom out">−</button>
        <button class="v-canvas-action v-canvas-icon" id="v-zoom-in" type="button" title="Zoom in" aria-label="Zoom in">+</button>
        <button class="v-canvas-action" id="v-reset-view" type="button" title="Reset 3D view">Reset view</button>
      </div>
      <div class="v-canvas-error" id="v-canvas-error" style="display:none;">
        <div class="v-canvas-error-icon">⚠️</div>
        <div class="v-canvas-error-title">Couldn't load 3D preview</div>
        <div class="v-canvas-error-desc" id="v-canvas-error-desc">There was a problem loading the base model.</div>
        <button class="v-canvas-retry" id="v-canvas-retry" type="button">Retry</button>
      </div>
    </div>
    <div id="visify-panel">
      <div class="v-panel-header">
        <div class="v-product-name">${escapeHtml(configuratorData.name)}</div>
        ${configuratorData.description ? `<div class="v-desc" title="${escapeHtml(configuratorData.description)}">${escapeHtml(configuratorData.description)}</div>` : ''}
      </div>
      <div class="v-price-row">
        <span class="v-price-label">Total Price</span>
        <span class="v-price-value" id="v-total-price">${formatMoney(totalPrice)}</span>
      </div>
      <div class="v-price-breakdown" id="v-price-breakdown"></div>
      <div class="v-parts-scroll" id="v-parts-list"></div>
      <div class="v-cart-section">
        <button class="v-cart-btn" id="v-cart-btn">Add to Cart</button>
        <div class="v-powered">Powered by <a href="https://visify.io" target="_blank">Visify</a></div>
      </div>
    </div>
  `;
  const canvasBackdrop = document.querySelector('.v-canvas-backdrop');
  if (canvasBackdrop && configuratorData.shopifyImageUrl) {
    canvasBackdrop.style.setProperty('--v-product-image', `url(${JSON.stringify(configuratorData.shopifyImageUrl)})`);
  }

  let baseGroup = null;
  webglAvailable = true;
  try {
    setupThreeJS();
    baseGroup = await loadModel(configuratorData.baseModelUrl, 'base', true);
  } catch (err) {
    webglAvailable = false;
    document.querySelector('.v-canvas-wrap')?.classList.add('v-no-webgl');
    console.warn('[Visify] 3D preview unavailable; keeping configurator controls active.', err);
  }
  buildPartsPanel();

  for (const part of configuratorData.parts) {
    if (part.isDefault || part.isRequired) {
      const group = await addPartToScene(part);
      if (!group) console.warn(`[Visify] Failed to load required part: ${part.name}`);
    }
  }
  // Re-render after defaults are loaded so toggles/swatches reflect the
  // actual initial selection state instead of the pre-load empty state.
  buildPartsPanel();
  updatePrice();

  document.getElementById('v-cart-btn').addEventListener('click', handleAddToCart);
  document.getElementById('v-canvas-retry').addEventListener('click', retryBaseModel);
  document.getElementById('v-zoom-out').addEventListener('click', () => adjustCameraZoom('out'));
  document.getElementById('v-zoom-in').addEventListener('click', () => adjustCameraZoom('in'));
  document.getElementById('v-reset-view').addEventListener('click', resetCameraView);
  document.getElementById('visify-loading').style.display = 'none';

  if (!webglAvailable) {
    document.getElementById('v-canvas-retry').style.display = 'none';
    showCanvasError(
      configuratorData.shopifyImageUrl
        ? '3D view is unavailable in this browser. Showing a product image preview instead.'
        : '3D preview is unavailable in this browser, but you can still configure and checkout.'
    );
  } else if (baseGroup) {
    showCanvasHint();
  } else {
    document.querySelector('.v-canvas-wrap')?.classList.add('v-model-error');
    showCanvasError(
      configuratorData.baseModelUrl
        ? "The base model couldn't be loaded. Check your connection and try again."
        : 'This configurator is missing a base model.'
    );
  }
}

// ── Three.js Layout Engine Setup ──────────────────────────
function setupThreeJS() {
  const canvas = document.getElementById('visify-canvas');

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (firstError) {
    // Some embedded browsers reject antialias/high-performance context attributes.
    // Retry with the most compatible WebGL settings before giving up.
    console.warn('[Visify] Retrying WebGL with compatibility settings.', firstError);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  scene = new THREE.Scene();
  // Keep the renderer transparent so the lightweight CSS stage backdrop remains visible.
  scene.background = null;

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
  controls.enablePan = true;
  controls.maxPolarAngle = Math.PI / 2; // Prevents camera from going under floor grid
  controls.addEventListener('start', () => {
    document.getElementById('v-canvas-hint')?.classList.add('v-hidden');
  });

  const resizeRenderer = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resizeRenderer).observe(canvas);
  } else {
    window.addEventListener('resize', resizeRenderer);
  }

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

// ── Canvas empty / hint / error states ─────────────────────
function showCanvasHint() {
  const hint = document.getElementById('v-canvas-hint');
  if (!hint) return;
  hint.classList.remove('v-hidden');
  clearTimeout(canvasHintTimer);
  canvasHintTimer = setTimeout(() => hint.classList.add('v-hidden'), 4000);
}

function showCanvasError(message) {
  const errorEl = document.getElementById('v-canvas-error');
  const descEl = document.getElementById('v-canvas-error-desc');
  const hintEl = document.getElementById('v-canvas-hint');
  if (descEl && message) descEl.textContent = message;
  hintEl?.classList.add('v-hidden');
  if (errorEl) errorEl.style.display = 'flex';
}

function hideCanvasError() {
  const errorEl = document.getElementById('v-canvas-error');
  if (errorEl) errorEl.style.display = 'none';
}

async function retryBaseModel() {
  const retryBtn = document.getElementById('v-canvas-retry');
  if (!configuratorData?.baseModelUrl) return;
  if (retryBtn) { retryBtn.disabled = true; retryBtn.textContent = 'Retrying…'; }

  const group = await loadModel(configuratorData.baseModelUrl, 'base', true);

  if (group) {
    hideCanvasError();
    showCanvasHint();
  } else if (retryBtn) {
    retryBtn.disabled = false;
    retryBtn.textContent = 'Retry';
  }
}

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
          defaultCameraPosition.copy(camera.position);
          defaultCameraTarget.copy(controls.target);
        } else {
          group.position.sub(baseModelCenter);
        }

        scene.add(group);
        loadedParts[id] = group;
        if (!isBase) captureOriginalMaterialStates(id, group);
        resolve(group);
      },
      (xhr) => {
        if (xhr.total > 0 && fillEl) {
          const pct = Math.round((xhr.loaded / xhr.total) * 100);
          fillEl.style.width = pct + '%';
        }
      },
      (err) => {
        console.error(`[Visify] Failed to load model (${isBase ? 'base' : id}):`, url, err);
        resolve(null);
      }
    );
  });
}

function captureOriginalMaterialStates(partId, group) {
  const states = [];
  group.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      states.push({
        material,
        map: material.map || null,
        color: material.color?.clone() || null,
      });
    });
  });
  originalMaterialStates[partId] = states;
}

function resetPartMaterials(partId) {
  (originalMaterialStates[partId] || []).forEach(({ material, map, color }) => {
    material.map = map;
    if (color && material.color) material.color.copy(color);
    material.needsUpdate = true;
  });
}

function resetCameraView() {
  if (!camera || !controls || !defaultCameraPosition.length()) return;
  camera.position.copy(defaultCameraPosition);
  controls.target.copy(defaultCameraTarget);
  controls.update();
  showCanvasHint();
}

function adjustCameraZoom(direction) {
  if (!camera || !controls) return;
  const zoomFactor = direction === 'in' ? 1.18 : 1 / 1.18;
  if (direction === 'in') controls.dollyIn(zoomFactor);
  else controls.dollyOut(1 / zoomFactor);
  controls.update();
  document.getElementById('v-canvas-hint')?.classList.add('v-hidden');
}

async function addPartToScene(part) {
  if (loadedParts[part._id]) return loadedParts[part._id];
  if (!webglAvailable) {
    loadedParts[part._id] = { virtualSelection: true };
    updatePrice();
    return loadedParts[part._id];
  }
  const group = await loadModel(part.modelUrl, part._id);
  if (group) updatePrice();
  return group;
}

function removePartFromScene(partId) {
  const group = loadedParts[partId];
  if (group) {
    if (group.isObject3D) scene.remove(group);
    delete loadedParts[partId];
    delete originalMaterialStates[partId];
    delete selectedVariants[partId];
    updatePrice();
  }
}

function forEachPartMaterial(partId, fn) {
  const group = loadedParts[partId];
  if (!group || typeof group.traverse !== 'function') return;
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
  const lines = [{ label: 'Base', amount: configuratorData.basePrice || 0 }];
  configuratorData.parts.forEach(part => {
    if (loadedParts[part._id]) {
      if (part.basePrice) {
        totalPrice += part.basePrice;
        lines.push({ label: part.name, amount: part.basePrice });
      }
      const selectedVariantId = selectedVariants[part._id];
      if (selectedVariantId) {
        const variant = part.variants.find(v => v._id === selectedVariantId);
        if (variant && variant.priceModifier) {
          totalPrice += variant.priceModifier;
          lines.push({ label: variant.label, amount: variant.priceModifier });
        }
      }
    }
  });
  const priceEl = document.getElementById('v-total-price');
  if (priceEl) priceEl.textContent = formatMoney(totalPrice);
  const breakdownEl = document.getElementById('v-price-breakdown');
  if (breakdownEl) {
    breakdownEl.innerHTML = lines
      .filter(line => line.amount)
      .map(line => `<div class="v-price-breakdown-row"><span>${escapeHtml(line.label)}</span><span>${line.amount > 0 ? '+' : ''}${formatMoney(line.amount)}</span></div>`)
      .join('');
  }
}

// ── Part error state (inline, auto-clears) ─────────────────
function showPartError(partId) {
  const header = document.querySelector(`.v-part-header[data-part-id="${partId}"]`);
  const section = header?.closest('.v-part-section');
  if (!header || !section) return;

  let msg = section.querySelector('.v-part-error');
  if (!msg) {
    msg = document.createElement('div');
    msg.className = 'v-part-error';
    msg.textContent = "Couldn't load this option — try again";
    header.insertAdjacentElement('afterend', msg);
  }
  clearTimeout(msg._hideTimer);
  msg._hideTimer = setTimeout(() => msg.remove(), 4000);
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
    html += `<div class="v-cat-label">${escapeHtml(cat)}</div>`;
    parts.forEach(part => {
      const isAdded = !!loadedParts[part._id];
      const hasVariants = part.variants.length > 0;

      html += `
        <div class="v-part-section">
          <div class="v-part-header" data-part-id="${part._id}">
            ${part.thumbnailUrl ? `<img class="v-part-thumb" src="${escapeHtml(part.thumbnailUrl)}" alt="${escapeHtml(part.name)}">` : ''}
            <div class="v-part-name">
              <span class="v-part-dot ${isAdded ? 'active' : ''}" id="dot-${part._id}"></span>
              <span class="v-part-name-text">${escapeHtml(part.name)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              ${part.basePrice > 0 ? `<span class="v-part-price">+${formatMoney(part.basePrice)}</span>` : ''}
              ${!part.isRequired ? `
                <button class="v-part-toggle ${isAdded ? 'added' : ''}" id="toggle-${part._id}" data-part-id="${part._id}">
                  ${isAdded ? '✓' : '+'}
                </button>
              ` : ''}
            </div>
          </div>
          ${part.description ? `<div class="v-part-desc" title="${escapeHtml(part.description)}">${escapeHtml(part.description)}</div>` : ''}
          ${hasVariants ? `
            <div class="v-variants ${isAdded ? 'open' : ''}" id="variants-${part._id}">
              <div class="v-variant-label">${part.variants.every(v => v.type === 'texture') ? 'Select Texture' : 'Select Option'}</div>
              <div class="v-swatches">
                ${part.variants.map((v, i) => `
                  <button
                    class="v-swatch ${i === 0 ? 'active' : ''}"
                    style="background:${v.type === 'texture' ? `url('${v.value}') center/cover` : v.value}"
                    title="${escapeHtml(v.label)}"
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
        btn.textContent = '…';
        const group = await addPartToScene(part);
        btn.disabled = false;

        if (!group) {
          btn.textContent = '+';
          showPartError(partId);
          return;
        }

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
      const isSelected = selectedVariants[partId] === variantId;

      list.querySelectorAll(`.v-swatch[data-part-id="${partId}"]`).forEach(s => s.classList.remove('active'));
      if (isSelected) {
        delete selectedVariants[partId];
        resetPartMaterials(partId);
      } else {
        swatch.classList.add('active');
        selectedVariants[partId] = variantId;
        if (loadedParts[partId]) {
          applyVariantToPart(partId, { type, value });
        }
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
    const updateRes = await fetch(`${API_BASE}/configurator/session/${sessionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
      body: JSON.stringify({ selectedParts, totalPrice }),
    });
    const updateData = await updateRes.json().catch(() => ({}));
    if (!updateRes.ok) throw new Error(updateData.message || 'Could not save your configuration');

    const cartRes = await fetch(`${API_BASE}/configurator/session/${sessionId}/cart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
    });
    const cartData = await readJsonResponse(cartRes);

    if (!cartRes.ok || !cartData.shopifyCartData?.checkoutUrl) {
      btn.disabled = false;
      btn.textContent = cartData.error ? `${cartData.message || 'Checkout unavailable'}: ${cartData.error}` : (cartData.message || 'Unavailable — try again');
      return;
    }

    if (cartData.shopifyCartData.isDevStub) {
      // SKIP_DRAFT_ORDER=true on the backend — real Shopify Draft Order API
      // isn't being called (Protected Customer Data access pending Shopify
      // review), so there's nothing real to redirect to. Confirm the
      // computed price/parts reached here correctly instead of silently
      // landing on an empty native /cart page.
      btn.textContent = `✅ Dev stub OK — ${formatMoney(cartData.shopifyCartData.totalPrice)}`;
      return;
    }

    // Redirects to a Shopify Draft Order checkout priced at the exact
    // configured total (base + selected parts) — no native variant/cart
    // involved, so there's no way for the charged price to drift from what
    // was shown here.
    window.location.href = cartData.shopifyCartData.checkoutUrl;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = err.message || 'Could not start checkout';
    setTimeout(() => {
      if (!btn.disabled) btn.textContent = 'Add to Cart';
    }, 4500);
  }
}

init();

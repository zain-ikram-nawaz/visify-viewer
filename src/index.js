import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// ── Config ────────────────────────────────────────────────
const API_BASE = 'https://visify-backend-production.up.railway.app/api';
const BRAND_API_KEY = window.VISIFY_API_KEY;
const PRODUCT_HANDLE = window.VISIFY_PRODUCT_HANDLE;

// ── State ─────────────────────────────────────────────────
let scene, camera, renderer, controls;
let loadedParts = {};        // partId → THREE.Group
let selectedVariants = {};   // partId → variantId
let sessionId = null;
let configuratorData = null;
let totalPrice = 0;

// ── Loader ────────────────────────────────────────────────
const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
loader.setDRACOLoader(dracoLoader);

// ── CSS ───────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  #visify-root * { margin:0; padding:0; box-sizing:border-box; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }

  #visify-root {
    width: 100%;
    height: 560px;
    display: flex;
    background: #0a0a0a;
    overflow: hidden;
    position: relative;
  }

  /* ── Canvas ── */
  #visify-canvas { flex: 1; display: block; min-width: 0; cursor: grab; }
  #visify-canvas:active { cursor: grabbing; }

  /* ── Panel ── */
  #visify-panel {
    width: 240px;
    flex-shrink: 0;
    background: #0f0f0f;
    border-left: 1px solid rgba(255,255,255,0.05);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Panel Header */
  .v-panel-header {
    padding: 16px 16px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    flex-shrink: 0;
  }

  .v-product-name {
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.4;
  }

  .v-brand-name {
    color: #444;
    font-size: 10px;
    margin-top: 2px;
  }

  /* Price */
  .v-price-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    flex-shrink: 0;
  }

  .v-price-label { color: #444; font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase; }
  .v-price-value { color: #fff; font-size: 18px; font-weight: 700; }

  /* Parts scroll area */
  .v-parts-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .v-parts-scroll::-webkit-scrollbar { width: 3px; }
  .v-parts-scroll::-webkit-scrollbar-track { background: transparent; }
  .v-parts-scroll::-webkit-scrollbar-thumb { background: #222; border-radius: 3px; }

  /* Part section */
  .v-part-section {
    padding: 0 12px;
    margin-bottom: 4px;
  }

  .v-part-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 6px;
    cursor: pointer;
    border-radius: 8px;
    transition: background 0.15s;
  }

  .v-part-header:hover { background: rgba(255,255,255,0.03); }

  .v-part-name {
    font-size: 12px;
    font-weight: 500;
    color: #ccc;
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .v-part-price {
    font-size: 10px;
    color: #555;
  }

  /* Part active indicator */
  .v-part-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #333;
    transition: background 0.2s;
    flex-shrink: 0;
  }
  .v-part-dot.active { background: #4F46E5; }

  /* Add/Remove button */
  .v-part-toggle {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1px solid #333;
    background: transparent;
    color: #666;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    flex-shrink: 0;
  }
  .v-part-toggle:hover { border-color: #4F46E5; color: #4F46E5; }
  .v-part-toggle.added { border-color: #4F46E5; background: #4F46E5; color: #fff; }

  /* Variants */
  .v-variants {
    padding: 4px 6px 8px 16px;
    display: none;
  }
  .v-variants.open { display: block; }

  .v-variant-label {
    font-size: 9px;
    color: #333;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  .v-swatches { display: flex; gap: 6px; flex-wrap: wrap; }

  .v-swatch {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1.5px solid transparent;
    outline: 1.5px solid transparent;
    outline-offset: 2px;
    cursor: pointer;
    transition: transform 0.15s, outline-color 0.15s;
    position: relative;
  }
  .v-swatch:hover { transform: scale(1.15); }
  .v-swatch.active { outline-color: rgba(255,255,255,0.5); transform: scale(1.15); }

  .v-swatch::after {
    content: attr(title);
    position: absolute;
    bottom: calc(100% + 5px);
    left: 50%;
    transform: translateX(-50%);
    background: #111;
    border: 1px solid #222;
    color: #ccc;
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.1s;
  }
  .v-swatch:hover::after { opacity: 1; }

  /* Cart button */
  .v-cart-section {
    padding: 12px;
    border-top: 1px solid rgba(255,255,255,0.05);
    flex-shrink: 0;
  }

  .v-cart-btn {
    width: 100%;
    background: #4F46E5;
    color: #fff;
    border: none;
    padding: 12px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
    letter-spacing: 0.3px;
  }
  .v-cart-btn:hover { background: #3730a3; }
  .v-cart-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .v-powered {
    text-align: center;
    padding: 6px;
    font-size: 8px;
    color: #1f1f1f;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .v-powered a { color: #2a2a2a; text-decoration: none; }
  .v-powered a:hover { color: #4F46E5; }

  /* Loading */
  #visify-loading {
    position: absolute;
    inset: 0;
    background: #0a0a0a;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    z-index: 20;
  }

  .v-loading-logo { color: #fff; font-size: 13px; font-weight: 800; letter-spacing: 5px; }
  .v-loading-logo span { color: #4F46E5; }
  #visify-loading p { color: #333; font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase; }

  .v-spinner {
    width: 28px; height: 28px;
    border: 1.5px solid rgba(255,255,255,0.05);
    border-top-color: #4F46E5;
    border-radius: 50%;
    animation: v-spin 0.7s linear infinite;
  }
  @keyframes v-spin { to { transform: rotate(360deg); } }

  .v-progress { width: 100px; height: 1.5px; background: rgba(255,255,255,0.05); border-radius: 99px; overflow: hidden; }
  .v-progress-fill { height: 100%; background: #4F46E5; width: 0%; transition: width 0.3s ease; }

  .v-error { color: #e63946; font-size: 12px; text-align: center; padding: 20px; }

  /* Mobile */
  @media (max-width: 600px) {
    #visify-root { flex-direction: column; height: auto; }
    #visify-canvas { height: 260px; }
    #visify-panel { width: 100%; border-left: none; border-top: 1px solid rgba(255,255,255,0.05); max-height: 260px; }
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
        <p id="v-loading-text">Connecting...</p>
      </div>
    </div>
  `;

  // ── Fetch configurator data ───────────────────────────
  try {
    const res = await fetch(`${API_BASE}/configurator/public/${BRAND_API_KEY}/${PRODUCT_HANDLE}`);
    const data = await res.json();

    if (!res.ok) {
      document.getElementById('visify-loading').innerHTML =
        `<p class="v-error">⚠️ ${data.message}</p>`;
      return;
    }

    configuratorData = data.configurator;
    totalPrice = configuratorData.basePrice || 0;

    // Create session
    const sessionRes = await fetch(`${API_BASE}/configurator/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandId: data.brand.id,
        configuratorProductId: configuratorData._id,
      }),
    });
    const sessionData = await sessionRes.json();
    sessionId = sessionData.session._id;

  } catch (err) {
    document.getElementById('visify-loading').innerHTML =
      `<p class="v-error">⚠️ Could not connect to Visify.</p>`;
    return;
  }

  // ── Build UI ──────────────────────────────────────────
  document.getElementById('visify-root').innerHTML = `
    <div id="visify-loading">
      <div class="v-spinner"></div>
      <div class="v-loading-logo">VI<span>SI</span>FY</div>
      <div class="v-progress"><div class="v-progress-fill" id="v-fill"></div></div>
      <p id="v-loading-text">Loading model...</p>
    </div>
    <canvas id="visify-canvas"></canvas>
    <div id="visify-panel">
      <div class="v-panel-header">
        <div class="v-product-name">${configuratorData.name}</div>
        <div class="v-brand-name">Configure your product</div>
      </div>
      <div class="v-price-row">
        <span class="v-price-label">Total</span>
        <span class="v-price-value" id="v-total-price">$${totalPrice.toFixed(2)}</span>
      </div>
      <div class="v-parts-scroll" id="v-parts-list"></div>
      <div class="v-cart-section">
        <button class="v-cart-btn" id="v-cart-btn">Add to Cart</button>
        <div class="v-powered">Powered by <a href="https://visify.io" target="_blank">Visify</a></div>
      </div>
    </div>
  `;

  // ── Three.js setup ────────────────────────────────────
  setupThreeJS();

  // ── Load base model ───────────────────────────────────
  await loadModel(configuratorData.baseModelUrl, 'base', true);

  // ── Build parts panel ─────────────────────────────────
  buildPartsPanel();

  // ── Load default parts ────────────────────────────────
  for (const part of configuratorData.parts) {
    if (part.isDefault) {
      await addPartToScene(part);
    }
  }

  // ── Cart button ───────────────────────────────────────
  document.getElementById('v-cart-btn').addEventListener('click', handleAddToCart);

  // Hide loading
  document.getElementById('visify-loading').style.display = 'none';
}

// ── Three.js Setup ────────────────────────────────────────
function setupThreeJS() {
  const canvas = document.getElementById('visify-canvas');
  const root = document.getElementById('visify-root');

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(window.devicePixelRatio);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(configuratorData.backgroundColor || '#0a0a0a');

  const w = root.clientWidth - 240;
  const h = root.clientHeight;
  renderer.setSize(w, h);

  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
  const cp = configuratorData.cameraPosition || { x: 0, y: 1, z: 3 };
  camera.position.set(cp.x, cp.y, cp.z);

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 1.5));
  const dir = new THREE.DirectionalLight(0xffffff, 2);
  dir.position.set(5, 10, 7);
  dir.castShadow = true;
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0x8888ff, 0.4);
  fill.position.set(-5, 0, -5);
  scene.add(fill);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  window.addEventListener('resize', () => {
    const w = root.clientWidth - 240;
    const h = root.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  animate();
}

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
}

// ── Load 3D Model ─────────────────────────────────────────
function loadModel(url, id, isBase = false) {
  return new Promise((resolve) => {
    const fillEl = document.getElementById('v-fill');
    const loadingText = document.getElementById('v-loading-text');

    loader.load(
      url,
      (gltf) => {
        const group = gltf.scene;

        // Auto center
        const box = new THREE.Box3().setFromObject(group);
        const center = box.getCenter(new THREE.Vector3());
        group.position.sub(center);

        if (isBase) {
          const size = box.getSize(new THREE.Vector3()).length();
          camera.position.set(0, size * 0.3, size * 1.5);
          controls.reset();
        }

        group.userData.visifyId = id;
        scene.add(group);
        loadedParts[id] = group;
        resolve(group);
      },
      (xhr) => {
        if (xhr.total > 0 && fillEl) {
          const pct = Math.round((xhr.loaded / xhr.total) * 100);
          fillEl.style.width = pct + '%';
          if (loadingText) loadingText.textContent = `Loading... ${pct}%`;
        }
      },
      (err) => {
        console.error('Model error:', err);
        resolve(null);
      }
    );
  });
}

// ── Add Part to Scene ─────────────────────────────────────
async function addPartToScene(part) {
  if (loadedParts[part._id]) return;
  await loadModel(part.modelUrl, part._id);
  updatePrice();
}

// ── Remove Part from Scene ────────────────────────────────
function removePartFromScene(partId) {
  const group = loadedParts[partId];
  if (group) {
    scene.remove(group);
    delete loadedParts[partId];
    updatePrice();
  }
}

// ── Apply Color to Part ───────────────────────────────────
function applyColorToPart(partId, hexColor) {
  const group = loadedParts[partId];
  if (!group) return;
  const color = new THREE.Color(hexColor);
  group.traverse((child) => {
    if (child.isMesh && child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(mat => { if (mat.color) mat.color.set(color); });
    }
  });
}

// ── Update Price ──────────────────────────────────────────
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

// ── Build Parts Panel ─────────────────────────────────────
function buildPartsPanel() {
  const list = document.getElementById('v-parts-list');
  if (!list) return;

  if (configuratorData.parts.length === 0) {
    list.innerHTML = '<p style="color:#333; font-size:11px; padding:16px; text-align:center;">No parts configured</p>';
    return;
  }

  // Group by category
  const categories = {};
  configuratorData.parts.forEach(part => {
    const cat = part.category || 'general';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(part);
  });

  let html = '';
  Object.entries(categories).forEach(([cat, parts]) => {
    html += `<div style="padding:8px 16px 4px; font-size:8px; color:#2a2a2a; letter-spacing:2px; text-transform:uppercase;">${cat}</div>`;
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
              <div class="v-variant-label">Color</div>
              <div class="v-swatches">
                ${part.variants.map((v, i) => `
                  <button
                    class="v-swatch ${i === 0 ? 'active' : ''}"
                    style="background:${v.type === 'color' ? v.value : '#555'}"
                    title="${v.label}${v.priceModifier ? ` +$${v.priceModifier}` : ''}"
                    data-part-id="${part._id}"
                    data-variant-id="${v._id}"
                    data-color="${v.type === 'color' ? v.value : ''}"
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

  // ── Event listeners ───────────────────────────────────

  // Toggle buttons
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
        btn.textContent = '...';
        await addPartToScene(part);
        btn.disabled = false;
        btn.classList.add('added');
        btn.textContent = '✓';
        document.getElementById(`dot-${partId}`)?.classList.add('active');
        document.getElementById(`variants-${partId}`)?.classList.add('open');

        // Apply first variant color by default
        if (part.variants.length > 0 && part.variants[0].type === 'color') {
          applyColorToPart(partId, part.variants[0].value);
          selectedVariants[partId] = part.variants[0]._id;
          updatePrice();
        }
      }
    });
  });

  // Swatch buttons
  list.querySelectorAll('.v-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const partId = swatch.dataset.partId;
      const variantId = swatch.dataset.variantId;
      const color = swatch.dataset.color;
      const type = swatch.dataset.type;

      // Active state
      list.querySelectorAll(`.v-swatch[data-part-id="${partId}"]`).forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');

      selectedVariants[partId] = variantId;

      if (type === 'color' && color && loadedParts[partId]) {
        applyColorToPart(partId, color);
      }

      updatePrice();
    });
  });
}

// ── Add to Cart ───────────────────────────────────────────
async function handleAddToCart() {
  const btn = document.getElementById('v-cart-btn');
  btn.disabled = true;
  btn.textContent = 'Adding...';

  // Build selected parts list
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
    // Update session
    await fetch(`${API_BASE}/configurator/session/${sessionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedParts, totalPrice }),
    });

    // Get cart data
    const cartRes = await fetch(`${API_BASE}/configurator/session/${sessionId}/cart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const cartData = await cartRes.json();

    // Shopify cart mein add karo
    const properties = {};
    cartData.shopifyCartData.properties.forEach(p => {
      properties[p.name] = p.value;
    });

    // Shopify AJAX Cart API
    const shopifyRes = await fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: window.VISIFY_SHOPIFY_VARIANT_ID || 1,
        quantity: 1,
        properties,
      }),
    });

    if (shopifyRes.ok) {
      btn.textContent = '✓ Added!';
      btn.style.background = '#059669';
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = 'Add to Cart';
        btn.style.background = '';
      }, 2500);
    } else {
      throw new Error('Shopify cart error');
    }

  } catch (err) {
    console.error('Cart error:', err);
    btn.disabled = false;
    btn.textContent = 'Add to Cart';
  }
}

init();
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// ── API Config ────────────────────────────────────────────
const API_BASE = 'https://visify-backend-production.up.railway.app/api';
const BRAND_API_KEY = window.VISIFY_API_KEY;
const PRODUCT_HANDLE = window.VISIFY_PRODUCT_HANDLE;
// ── Inject CSS ────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  #visify-root * { margin:0; padding:0; box-sizing:border-box; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }

  #visify-root {
    width: 100%;
    height: 480px;
    display: flex;
    background: #0f0f0f;
    overflow: hidden;
    position: relative;
  }

  #visify-canvas { flex: 1; display: block; min-width: 0; }

  /* ── Panel ── */
  #visify-panel {
    width: 180px;
    flex-shrink: 0;
    background: #0f0f0f;
    border-left: 1px solid rgba(255,255,255,0.05);
    padding: 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* ── Product info ── */
  .v-product-name {
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.4;
    margin-bottom: 2px;
  }

  .v-brand-name {
    color: #444;
    font-size: 10px;
    letter-spacing: 0.3px;
    margin-bottom: 16px;
    padding-bottom: 14px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }

  /* ── Labels ── */
  #visify-panel .v-label {
    color: #3a3a3a;
    font-size: 8px;
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-bottom: 8px;
    display: block;
  }

  .v-section { margin-bottom: 16px; }

  .v-divider {
    height: 1px;
    background: rgba(255,255,255,0.04);
    margin-bottom: 16px;
  }

  /* ── Color swatches ── */
  .v-colors { display: flex; gap: 7px; flex-wrap: wrap; }

  .v-color-btn {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 1.5px solid transparent;
    outline: 1.5px solid transparent;
    outline-offset: 2px;
    cursor: pointer;
    transition: transform 0.15s ease, outline-color 0.15s ease;
    position: relative;
    flex-shrink: 0;
  }
  .v-color-btn:hover { transform: scale(1.12); }
  .v-color-btn.v-active {
    outline-color: rgba(255,255,255,0.6);
    transform: scale(1.12);
  }

  /* Tooltip */
  .v-color-btn::after {
    content: attr(title);
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%) translateY(3px);
    background: rgba(15,15,15,0.95);
    border: 1px solid rgba(255,255,255,0.08);
    color: #ccc;
    font-size: 9px;
    padding: 3px 7px;
    border-radius: 4px;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.12s ease, transform 0.12s ease;
    letter-spacing: 0.3px;
  }
  .v-color-btn:hover::after {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  /* ── Loading overlay ── */
  #visify-loading {
    position: absolute;
    inset: 0;
    background: #0f0f0f;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    z-index: 10;
  }

  .v-loading-logo {
    color: #fff;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 5px;
    text-transform: uppercase;
  }
  .v-loading-logo span { color: #4F46E5; }

  #visify-loading p {
    color: #333;
    font-size: 9px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
  }

  .v-spinner {
    width: 28px;
    height: 28px;
    border: 1.5px solid rgba(255,255,255,0.05);
    border-top-color: #4F46E5;
    border-radius: 50%;
    animation: v-spin 0.7s linear infinite;
  }
  @keyframes v-spin { to { transform: rotate(360deg); } }

  .v-progress {
    width: 120px;
    height: 1.5px;
    background: rgba(255,255,255,0.05);
    border-radius: 99px;
    overflow: hidden;
  }
  .v-progress-fill {
    height: 100%;
    background: #4F46E5;
    width: 0%;
    transition: width 0.3s ease;
  }

  /* ── Powered by ── */
  #visify-panel .v-powered {
    margin-top: auto;
    color: #222;
    font-size: 8px;
    text-align: center;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  #visify-panel .v-powered a {
    color: #333;
    text-decoration: none;
    transition: color 0.15s;
  }
  #visify-panel .v-powered a:hover { color: #4F46E5; }

  .v-error { color: #e63946; font-size: 12px; text-align: center; padding: 20px; }

  /* ── Responsive — mobile ── */
  @media (max-width: 600px) {
    #visify-root { flex-direction: column; height: auto; }
    #visify-canvas { height: 280px; width: 100%; }
    #visify-panel {
      width: 100%;
      border-left: none;
      border-top: 1px solid rgba(255,255,255,0.05);
      flex-direction: row;
      align-items: center;
      padding: 10px 14px;
      gap: 14px;
      overflow-x: auto;
    }
    .v-product-name { font-size: 11px; white-space: nowrap; margin-bottom: 0; }
    .v-brand-name { display: none; }
    .v-divider { display: none; }
    .v-section { margin-bottom: 0; flex-shrink: 0; }
    .v-label { display: none; }
    .v-colors { flex-wrap: nowrap; }
    #visify-panel .v-powered { margin-top: 0; white-space: nowrap; flex-shrink: 0; }
  }
`;
document.head.appendChild(style);

// ── Init ──────────────────────────────────────────────────
async function init() {
  const container = document.getElementById('visify-configurator');
  if (!container) {
    console.error('Visify: <div id="visify-configurator"> not found.');
    return;
  }

  // Pehle loading dikhao
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

  // ── API se data fetch karo ────────────────────────────
  let productData, brandData;
  try {
const res = await fetch(`${API_BASE}/embed/handle/${BRAND_API_KEY}/${PRODUCT_HANDLE}`);
    const data = await res.json();

    if (!res.ok) {
      document.getElementById('visify-loading').innerHTML =
        `<p class="v-error">⚠️ ${data.message}</p>`;
      return;
    }

    productData = data.product;
    brandData = data.brand;
    console.log('brandData:', brandData);
  } catch (err) {
    document.getElementById('visify-loading').innerHTML =
      `<p class="v-error">⚠️ Could not connect to Visify server.</p>`;
    console.error('Visify API error:', err);
    return;
  }

  // ── Full UI inject karo ───────────────────────────────
  document.getElementById('visify-root').innerHTML = `
    <div id="visify-loading">
      <div class="v-spinner"></div>
      <div class="v-loading-logo">VI<span>SI</span>FY</div>
      <div class="v-progress"><div class="v-progress-fill" id="v-fill"></div></div>
      <p id="v-loading-text">Loading 3D Model...</p>
    </div>
    <canvas id="visify-canvas"></canvas>
    <div id="visify-panel">
      <div class="v-logo">VI<span>SI</span>FY</div>
      <div class="v-section">
        <span class="v-label">Product</span>
        <div class="v-product-name">${productData.name}</div>
        <div class="v-brand-name">${brandData.name}</div>
      </div>
      <div class="v-divider"></div>
      <div class="v-section">
        <span class="v-label">Color</span>
        <div class="v-colors" id="v-colors"></div>
      </div>
      <div class="v-powered">Powered by <a href="https://visify.io" target="_blank">Visify</a></div>
    </div>
  `;

  // Colors — API se
  const colorsEl = document.getElementById('v-colors');
  productData.variants.forEach((variant, i) => {
    const btn = document.createElement('button');
    btn.className = 'v-color-btn' + (i === 0 ? ' v-active' : '');
    btn.style.background = variant.color;
    btn.dataset.color = variant.color;
    btn.title = variant.label;
    colorsEl.appendChild(btn);
  });

  // ── Three.js setup ────────────────────────────────────
  const canvas = document.getElementById('visify-canvas');
  const loadingEl = document.getElementById('visify-loading');
  const fillEl = document.getElementById('v-fill');
  const loadingText = document.getElementById('v-loading-text');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#111111');

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 1, 3);

  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const dir = new THREE.DirectionalLight(0xffffff, 2);
  dir.position.set(5, 10, 7);
  scene.add(dir);
  const fillLight = new THREE.DirectionalLight(0x8888ff, 0.5);
  fillLight.position.set(-5, 0, -5);
  scene.add(fillLight);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  function resizeViewer() {
    const root = document.getElementById('visify-root');
    const w = root.clientWidth - 220;
    const h = root.clientHeight;
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resizeViewer();
  window.addEventListener('resize', resizeViewer);

  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  loader.setDRACOLoader(dracoLoader);

  let modelMaterials = [];
  let currentModel = null;

  // ── Model load karo — API se mila URL ─────────────────
  function loadModel(url) {
    loadingEl.style.display = 'flex';
    fillEl.style.width = '0%';
    if (currentModel) {
      scene.remove(currentModel);
      currentModel = null;
      modelMaterials = [];
    }

    loader.load(
      url,
      (gltf) => {
        currentModel = gltf.scene;
        currentModel.traverse((child) => {
          if (child.isMesh) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            modelMaterials.push(...mats);
          }
        });
        const box = new THREE.Box3().setFromObject(currentModel);
        const center = box.getCenter(new THREE.Vector3());
        currentModel.position.sub(center);
        const size = box.getSize(new THREE.Vector3()).length();
        camera.position.set(0, size * 0.3, size * 1.2);
        controls.reset();
        scene.add(currentModel);
        loadingEl.style.display = 'none';
      },
      (xhr) => {
        if (xhr.total > 0) {
          const pct = Math.round((xhr.loaded / xhr.total) * 100);
          fillEl.style.width = pct + '%';
          loadingText.textContent = `Loading... ${pct}%`;
        }
      },
      (error) => { console.error('Visify model error:', error); }
    );
  }

  // API se mila modelUrl use karo
  loadModel(productData.modelUrl);

  // ── Color change ──────────────────────────────────────
document.getElementById('v-colors').addEventListener('click', (e) => {
  const btn = e.target.closest('.v-color-btn');
  if (!btn) return;
  document.querySelectorAll('.v-color-btn').forEach(b => b.classList.remove('v-active'));
  btn.classList.add('v-active');
  const color = new THREE.Color(btn.dataset.color);
  modelMaterials.forEach((mat) => { if (mat.color) mat.color.set(color); });

  // Track color change
  fetch(`${API_BASE}/embed/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brandId: brandData.id,
      productId: productData.id,
      event: 'color_change',
      variantSelected: btn.title,
    }),
  }).catch(() => {});
});
  // ── Animate ───────────────────────────────────────────
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
}

init();
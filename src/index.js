import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// ── API Config ────────────────────────────────────────────
const API_BASE = 'http://localhost:5000/api';
const BRAND_API_KEY = window.VISIFY_API_KEY;
const PRODUCT_ID = window.VISIFY_PRODUCT_ID;

// ── Inject CSS ────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  #visify-root * { margin:0; padding:0; box-sizing:border-box; font-family:sans-serif; }
  #visify-root {
    width: 100%; height: 500px;
    display: flex;
    background: #111;
    border-radius: 12px;
    overflow: hidden;
    position: relative;
  }
  #visify-canvas { flex: 1; display: block; }
  #visify-panel {
    width: 200px;
    background: #1a1a1a;
    padding: 20px 14px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  #visify-panel .v-logo {
    color: #fff;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 2px;
    padding-bottom: 14px;
    border-bottom: 1px solid #2a2a2a;
  }
  #visify-panel .v-logo span { color: #4F46E5; }
  #visify-panel .v-label {
    color: #888;
    font-size: 10px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-bottom: 10px;
    display: block;
  }
  .v-product-name {
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.4;
  }
  .v-brand-name {
    color: #666;
    font-size: 11px;
    margin-top: 2px;
  }
  .v-colors { display: flex; gap: 7px; flex-wrap: wrap; }
  .v-color-btn {
    width: 32px; height: 32px;
    border-radius: 50%;
    border: 3px solid transparent;
    cursor: pointer;
    transition: transform 0.15s;
    position: relative;
  }
  .v-color-btn:hover { transform: scale(1.1); }
  .v-color-btn.v-active { border-color: #fff; transform: scale(1.15); }
  .v-color-btn[title]:hover::after {
    content: attr(title);
    position: absolute;
    bottom: -22px;
    left: 50%;
    transform: translateX(-50%);
    background: #333;
    color: #fff;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
  }
  #visify-loading {
    position: absolute;
    inset: 0;
    background: #111;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    z-index: 10;
  }
  #visify-loading h3 { color: #fff; font-size: 16px; letter-spacing: 2px; }
  #visify-loading p { color: #666; font-size: 12px; }
  .v-spinner {
    width: 40px; height: 40px;
    border: 3px solid #333;
    border-top-color: #4F46E5;
    border-radius: 50%;
    animation: v-spin 0.8s linear infinite;
  }
  @keyframes v-spin { to { transform: rotate(360deg); } }
  .v-progress {
    width: 160px; height: 3px;
    background: #333; border-radius: 2px; overflow: hidden;
  }
  .v-progress-fill {
    height: 100%; background: #4F46E5;
    width: 0%; transition: width 0.3s;
  }
  #visify-panel .v-powered {
    margin-top: auto;
    color: #444;
    font-size: 10px;
    text-align: center;
  }
  #visify-panel .v-powered a { color: #4F46E5; text-decoration: none; }
  .v-error {
    color: #e63946;
    font-size: 12px;
    text-align: center;
    padding: 20px;
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
        <h3>VISIFY</h3>
        <div class="v-progress"><div class="v-progress-fill" id="v-fill"></div></div>
        <p id="v-loading-text">Connecting...</p>
      </div>
    </div>
  `;

  // ── API se data fetch karo ────────────────────────────
  let productData, brandData;
  try {
    const res = await fetch(`${API_BASE}/embed/${BRAND_API_KEY}/${PRODUCT_ID}`);
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
      <h3>VISIFY</h3>
      <div class="v-progress"><div class="v-progress-fill" id="v-fill"></div></div>
      <p id="v-loading-text">Loading 3D Model...</p>
    </div>
    <canvas id="visify-canvas"></canvas>
    <div id="visify-panel">
      <div class="v-logo">VI<span>SI</span>FY</div>
      <div>
        <div class="v-product-name">${productData.name}</div>
        <div class="v-brand-name">${brandData.name}</div>
      </div>
      <div>
        <span class="v-label">Select Color</span>
        <div class="v-colors" id="v-colors"></div>
      </div>
      <div class="v-powered">Powered by <a href="#">Visify</a></div>
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
    const w = root.clientWidth - 200;
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
      productId: PRODUCT_ID,
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
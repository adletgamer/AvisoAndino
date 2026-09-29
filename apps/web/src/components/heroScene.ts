// Módulo cargado solo con import() dinámico desde HeroVisual: queda en su propio chunk con three.js.
import {
  AmbientLight,
  BufferAttribute,
  Color,
  DirectionalLight,
  Fog,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SphereGeometry,
  WebGLRenderer,
} from 'three';

/** Ruido determinista barato (sin dependencias) para relieve reproducible. */
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function smoothNoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function ridge(x: number, y: number): number {
  let total = 0, amp = 1, freq = 0.18;
  for (let i = 0; i < 4; i++) {
    total += (1 - Math.abs(smoothNoise(x * freq, y * freq) * 2 - 1)) * amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return total;
}

export function heightAt(x: number, z: number): number {
  const range = Math.exp(-((z + 2) ** 2) / 60); // cordillera principal a lo largo de X
  return Math.max(0, ridge(x, z) * 3.2 * range + ridge(x + 40, z) * 0.6 - 0.8);
}

export function mountHeroScene(canvas: HTMLCanvasElement): () => void {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));

  const scene = new Scene();
  scene.fog = new Fog(new Color('#10301f'), 16, 40);

  const camera = new PerspectiveCamera(42, 1, 0.1, 100);

  const geometry = new PlaneGeometry(60, 34, 70, 40).toNonIndexed(); // caras planas: low-poly
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.getAttribute('position') as BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const low = new Color('#1f5a43'), mid = new Color('#7c6a4a'), snow = new Color('#f3efe4');
  const tmp = new Color();
  for (let i = 0; i < pos.count; i++) {
    const h = heightAt(pos.getX(i), pos.getZ(i));
    pos.setY(i, h);
  }
  for (let i = 0; i < pos.count; i += 3) {
    const h = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    if (h > 3.1) tmp.copy(snow);
    else if (h > 1.3) tmp.copy(mid).lerp(snow, Math.max(0, (h - 2.3) / 1.2));
    else tmp.copy(low).lerp(mid, h / 1.3);
    for (let k = 0; k < 3; k++) colors.set([tmp.r, tmp.g, tmp.b], (i + k) * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const terrain = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  scene.add(terrain);

  scene.add(new AmbientLight('#ffe9c4', 0.55));
  const sun = new DirectionalLight('#ffd08a', 1.9);
  sun.position.set(8, 12, 6);
  scene.add(sun);

  // Marcador de alerta sobre una cumbre, con anillo que pulsa.
  // Cumbre más alta en la zona derecha del encuadre (visible junto al texto del hero).
  let markerX = 6, markerZ = -3, best = -Infinity;
  for (let x = 3; x <= 10; x += 0.25) {
    for (let z = -6; z <= -1; z += 0.25) {
      const h = heightAt(x, z);
      if (h > best) { best = h; markerX = x; markerZ = z; }
    }
  }
  const markerY = best + 0.45;
  const marker = new Mesh(new SphereGeometry(0.32, 16, 10), new MeshBasicMaterial({ color: '#ffb020' }));
  marker.position.set(markerX, markerY, markerZ);
  scene.add(marker);
  const ringMaterial = new MeshBasicMaterial({ color: '#f8b93c', transparent: true, opacity: 0.8 });
  const ring = new Mesh(new RingGeometry(0.42, 0.6, 40), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(markerX, markerY - 0.2, markerZ);
  scene.add(ring);

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  let frame = 0;
  let visible = true;
  const start = performance.now();
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    if (!visible) return;
    const t = (now - start) / 1000;
    camera.position.set(2 + Math.sin(t * 0.06) * 2.5, 3.6 + Math.sin(t * 0.11) * 0.3, 17 + Math.cos(t * 0.05) * 1.2);
    camera.lookAt(3, 4.6, -6); // mirada algo alta: cordillera en la franja inferior, cielo arriba
    const pulse = (t * 0.8) % 1;
    ring.scale.setScalar(1 + pulse * 3.2);
    ringMaterial.opacity = 0.85 * (1 - pulse);
    marker.scale.setScalar(1 + Math.sin(t * 4) * 0.12);
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(tick);

  const onVisibility = () => { visible = document.visibilityState === 'visible'; };
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    geometry.dispose();
    renderer.dispose();
  };
}

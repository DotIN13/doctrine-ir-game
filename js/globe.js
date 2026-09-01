/* ============================================================
   THE MAP
   Countries are authored discs at fixed coordinates, so the
   labels always sit on their own land. Neutral terrain fills
   the rest of the world.

   PERFORMANCE NOTE — measured, not guessed. Two things dominated:
   UnrealBloomPass (114ms/frame vs 17ms without it — ~11 full-screen
   passes) and the planet shader below. Bloom is now three passes at
   quarter resolution; the shader's noise is baked to a texture.
   The first version evaluated fBm noise twice *per country disc*
   (15 discs => 31 fBm calls per pixel per frame) using a
   sin-based hash: roughly 3,600 sin() calls per pixel, which
   measured 2.6 fps. Now noise is evaluated exactly twice per
   pixel — one field for terrain, one shared field that warps
   every coastline — with a sin-free hash. Everything else here
   (segment counts, bloom resolution, pixel ratio, frame cap)
   is chosen with the same intent.
   ============================================================ */
import * as THREE from 'three';

const MAXD = 16;
const FRAME_CAP = 1000 / 34;   /* a slowly turning globe does not need 60fps */

/* Gradient-noise fBm, used ONLY by the one-off bake below. Gradient noise
   is what the coastline and terrain thresholds were tuned against; value
   noise has a different distribution and flattened both. The hash is
   sine-free (Dave Hoskins) so the bake stays quick. */
const NOISE = `
vec3 hash33(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return -1.0 + 2.0 * fract((p.xxy + p.yxx) * p.zyx);
}
float gnoise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f*f*(3.0-2.0*f);
  return mix(mix(mix(dot(hash33(i+vec3(0,0,0)), f-vec3(0,0,0)),
                     dot(hash33(i+vec3(1,0,0)), f-vec3(1,0,0)), u.x),
                 mix(dot(hash33(i+vec3(0,1,0)), f-vec3(0,1,0)),
                     dot(hash33(i+vec3(1,1,0)), f-vec3(1,1,0)), u.x), u.y),
             mix(mix(dot(hash33(i+vec3(0,0,1)), f-vec3(0,0,1)),
                     dot(hash33(i+vec3(1,0,1)), f-vec3(1,0,1)), u.x),
                 mix(dot(hash33(i+vec3(0,1,1)), f-vec3(0,1,1)),
                     dot(hash33(i+vec3(1,1,1)), f-vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm(vec3 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * gnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}`;

const VERT = `
varying vec3 vN; varying vec3 vPos; varying vec3 vWorld; varying vec2 vUv;
void main(){
  vN = normalize(normalMatrix * normal);
  vPos = position;
  vUv = uv;
  vec4 w = modelMatrix * vec4(position,1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const BAKE_FRAG = `
precision highp float;
varying vec2 vUv;
${NOISE}
void main(){
  /* three's SphereGeometry: uv=(u, 1-v), phi=u*2PI, theta=v*PI,
     pos = (-cos(phi)sin(theta), cos(theta), sin(phi)sin(theta)) */
  float u = vUv.x, v = 1.0 - vUv.y;
  float phi = u * 6.28318530718;
  float th  = v * 3.14159265359;
  vec3 n = vec3(-cos(phi)*sin(th), cos(th), sin(phi)*sin(th));
  float h = fbm(n*1.7 + vec3(11.3,4.1,7.7));
  float w = 0.52*fbm(n*3.4) + 0.16*fbm(n*8.0);
  gl_FragColor = vec4(h, w, 0.0, 1.0);
}`;
const BAKE_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PLANET_FRAG = `
precision highp float;
varying vec3 vN; varying vec3 vPos; varying vec3 vWorld; varying vec2 vUv;
uniform float uTime; uniform float uEsc; uniform vec3 uLight;
uniform int uDiscN;
uniform vec3 uDiscC[${MAXD}];
uniform float uDiscR[${MAXD}];
uniform float uDiscCos[${MAXD}];   /* cos(radius), precomputed on the CPU */
uniform float uDiscSin[${MAXD}];   /* sin(radius), for the linearisation   */
uniform vec3 uDiscCol[${MAXD}];
uniform float uDiscHi[${MAXD}];
uniform sampler2D uFields;
void main(){
  vec3 n = normalize(vPos);

  /* Terrain height and coastline warp are static, so they are baked once
     into an equirectangular texture instead of being evaluated per pixel
     per frame. This one fetch replaces 48 hash calls. */
  vec2 f = texture2D(uFields, vUv).rg;
  float h    = f.r;    /* unnamed terrain       */
  float warp = f.g;    /* shared coastline warp */

  float neutral = smoothstep(0.025, 0.085, h);
  float nEdge   = 1.0 - smoothstep(0.0, 0.030, abs(h - 0.055));

  /* --- authored countries: a dot product and a compare each --- */
  float owned = 0.0, hi = 0.0, edge = 0.0;
  vec3 own = vec3(0.0);
  /* Comparing cosines instead of angles. The warped radius
     R*(1+warp) is folded into the threshold to first order:
     cos(R+e) ~ cos(R) - e*sin(R), which is accurate because
     |e| stays under ~0.03 rad. Angular distance inside the border
     is recovered as dd/sin(R) for the coastline falloff. */
  for (int i = 0; i < ${MAXD}; i++) {
    if (i >= uDiscN) break;
    float e   = uDiscR[i] * warp;
    float thr = uDiscCos[i] - e * uDiscSin[i];
    float dd  = dot(n, uDiscC[i]) - thr;
    float ins = step(0.0, dd);
    float d   = dd / max(uDiscSin[i], 1e-3);
    float rim = ins * (1.0 - smoothstep(0.0, min(0.030, 0.22*uDiscR[i]), d));
    if (ins > 0.5) { own = uDiscCol[i]; hi = uDiscHi[i]; }
    owned = max(owned, ins);
    edge  = max(edge, rim);
  }

  vec3 deep  = vec3(0.012,0.036,0.074);
  vec3 ocean = vec3(0.028,0.090,0.163);
  vec3 shelf = vec3(0.042,0.112,0.158);
  vec3 nLand = vec3(0.118,0.148,0.152);

  vec3 col = mix(deep, ocean, smoothstep(-0.55,0.03,h));
  col = mix(col, shelf, smoothstep(-0.015,0.03,h)*(1.0-neutral)*0.45);
  col = mix(col, nLand, neutral*(1.0-owned));

  /* named country fill: solid land tinted with the country colour.
     Idle countries stay muted; the ones in the news get lifted. */
  vec3 landBase = vec3(0.105,0.130,0.140);
  vec3 fill = mix(landBase, own, 0.52 + 0.26*hi);
  fill *= (0.86 + 0.26*hi);
  col = mix(col, fill, owned*0.96);

  vec3 accent = mix(vec3(0.35,0.85,1.0), vec3(1.0,0.42,0.28), clamp(uEsc,0.0,1.0));
  col += own * edge * (0.10 + 0.30*hi) * (0.78 + 0.22*sin(uTime*1.9));
  col += accent * nEdge * (1.0-owned) * 0.055;

  /* graticule */
  float lon = atan(n.z, n.x);
  float g = smoothstep(0.988,1.0,abs(sin(lon*12.0)))
          + smoothstep(0.988,1.0,abs(sin(n.y*14.0)));
  col += accent * g * 0.055;

  /* light */
  float d2 = max(dot(n, normalize(uLight)), 0.0);
  float night = 1.0 - smoothstep(0.0, 0.35, d2);
  col *= (0.26 + 1.05*pow(d2,0.72));
  col += own * owned * night * 0.10 * hi * (0.6+0.4*sin(uTime*2.4));
  col += vec3(0.95,0.78,0.42) * night * owned * 0.045;

  float fr = 1.0 - max(dot(normalize(vN), normalize(cameraPosition - vWorld)), 0.0);
  col += accent * (fr*fr*fr) * 0.34;
  gl_FragColor = vec4(col, 1.0);
}`;

const ATMO_FRAG = `
varying vec3 vN; varying vec3 vPos; varying vec3 vWorld;
uniform float uEsc; uniform float uTime;
void main(){
  vec3 v = normalize(cameraPosition - vWorld);
  float i = pow(1.0 - abs(dot(normalize(vN), v)), 2.7);
  vec3 c = mix(vec3(0.24,0.62,1.0), vec3(1.0,0.32,0.20), clamp(uEsc,0.0,1.0));
  gl_FragColor = vec4(c, i*0.60*(1.0 + 0.10*sin(uTime*2.0)*uEsc));
}`;

const ARC_VERT = `varying float vT; void main(){ vT=uv.x; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const ARC_FRAG = `
varying float vT; uniform float uTime; uniform vec3 uColor; uniform float uSeed;
void main(){
  float head = fract(uTime*0.34 + uSeed);
  float d = vT - head; d = d - floor(d + 0.5);
  float pulse = exp(-pow(d*7.0, 2.0));
  float a = clamp((0.16 + 0.30*sin(vT*3.14159))*0.55 + pulse*1.45, 0.0, 1.7);
  gl_FragColor = vec4(uColor*(0.7+pulse*1.8), a);
}`;

/* ── bloom, the cheap way ─────────────────────────────────────────────
   Bright-pass and downsample to a quarter, blur separably at that size,
   add back. Three small passes instead of eleven, and the two blur
   passes touch 1/16 of the pixels. */
const FS_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BRIGHT_FRAG = `
precision mediump float;
varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uThresh;
void main(){
  /* 4 taps so the downsample does not alias the thin glowing coastlines */
  vec3 c = texture2D(tDiffuse, vUv + uTexel*vec2(-0.5,-0.5)).rgb
         + texture2D(tDiffuse, vUv + uTexel*vec2( 0.5,-0.5)).rgb
         + texture2D(tDiffuse, vUv + uTexel*vec2(-0.5, 0.5)).rgb
         + texture2D(tDiffuse, vUv + uTexel*vec2( 0.5, 0.5)).rgb;
  c *= 0.25;
  float l = max(max(c.r, c.g), c.b);
  gl_FragColor = vec4(c * (max(l - uThresh, 0.0) / max(l, 1e-4)), 1.0);
}`;
const BLUR_FRAG = `
precision mediump float;
varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uDir;
void main(){
  vec3 s = texture2D(tDiffuse, vUv).rgb * 0.227027;
  s += (texture2D(tDiffuse, vUv + uDir*1.3846).rgb + texture2D(tDiffuse, vUv - uDir*1.3846).rgb) * 0.3162162;
  s += (texture2D(tDiffuse, vUv + uDir*3.2307).rgb + texture2D(tDiffuse, vUv - uDir*3.2307).rgb) * 0.0702702;
  gl_FragColor = vec4(s, 1.0);
}`;
const COMP_FRAG = `
precision mediump float;
varying vec2 vUv; uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uAmt;
void main(){
  gl_FragColor = vec4(texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * uAmt, 1.0);
}`;

const R = 1.0;
let renderer, scene, camera, planet, atmo, stars, labelBox;
let fsScene, fsCam, fsQuad, matBright, matBlur, matComp;
let rtScene, rtA, rtB, bloomOn = true;
let arcGroup, markGroup, ringGroup;
const uTime = {value: 0}, uEsc = {value: 0};
const uDiscN = {value: 0},
      uDiscC = {value: Array.from({length: MAXD}, () => new THREE.Vector3(0, 1, 0))},
      uDiscR = {value: new Array(MAXD).fill(0)},
      uDiscCos = {value: new Array(MAXD).fill(1)},
      uDiscSin = {value: new Array(MAXD).fill(1)},
      uDiscCol = {value: Array.from({length: MAXD}, () => new THREE.Color(0x223)) },
      uDiscHi = {value: new Array(MAXD).fill(0)};
let spin = 0.026, targetQ = null, camDist = 5.0, targetDist = 5.0;
let shake = 0, labels = [], flashEl = null, dragging = false;
const tmp = new THREE.Vector3();

/* shared marker geometry — one buffer instead of four per marker */
let RING_GEO, CORE_GEO;

/* perf state */
let tier = 0, emaFrame = 1 / 60, slowFrames = 0, viewW = 1, viewH = 1;
const perf = {avgMs: 0, tier: 0, bloom: true, ratio: 1};

function ll2v(lat, lng, r) {
  const p = (90 - lat) * Math.PI / 180, t = (lng + 180) * Math.PI / 180;
  return new THREE.Vector3(-r * Math.sin(p) * Math.cos(t), r * Math.cos(p), r * Math.sin(p) * Math.sin(t));
}

function makeStars() {
  const n = 1500, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = 26 + Math.random() * 60, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    pos[i*3] = r*Math.sin(ph)*Math.cos(th); pos[i*3+1] = r*Math.cos(ph); pos[i*3+2] = r*Math.sin(ph)*Math.sin(th);
    const w = 0.55 + Math.random() * 0.45;
    col[i*3] = w*0.85; col[i*3+1] = w*0.93; col[i*3+2] = w;
    sz[i] = Math.random() < 0.04 ? 2.4 : 0.7 + Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('asize', new THREE.BufferAttribute(sz, 1));
  return new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: {uTime}, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, vertexColors: true,
    vertexShader: `attribute float asize; varying vec3 vC; varying float vS;
      void main(){ vC=color; vS=asize; vec4 mv=modelViewMatrix*vec4(position,1.0);
      gl_PointSize=asize*(260.0/-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vC; varying float vS; uniform float uTime;
      void main(){ float d=length(gl_PointCoord-0.5); if(d>0.5) discard;
      gl_FragColor=vec4(vC, pow(1.0-d*2.0,2.2)*(0.6+0.4*sin(uTime*2.2+vS*40.0))); }`
  }));
}

/* Groups were being emptied without disposing, leaking a set of GPU
   buffers per situation. */
function clearGroup(g) {
  while (g.children.length) {
    const c = g.children[0];
    g.remove(c);
    c.traverse(o => {
      if (o.geometry && o.geometry !== RING_GEO && o.geometry !== CORE_GEO) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

function makeArc(a, b, color) {
  const v1 = ll2v(a[0], a[1], R * 1.005), v2 = ll2v(b[0], b[1], R * 1.005);
  const mid = v1.clone().add(v2).multiplyScalar(0.5).normalize()
    .multiplyScalar(R * (1.15 + v1.distanceTo(v2) * 0.20));
  const geo = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(v1, mid, v2), 48, 0.0058, 6, false);
  return new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: {uTime, uColor: {value: new THREE.Color(color)}, uSeed: {value: Math.random()}},
    vertexShader: ARC_VERT, fragmentShader: ARC_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
  }));
}

function makeMarker(lat, lng, color, big) {
  const g = new THREE.Group();
  const p = ll2v(lat, lng, R * 1.002), up = p.clone().normalize();
  const size = big ? 0.40 : 0.24;
  for (let i = 0; i < 3; i++) {
    const q = new THREE.Mesh(RING_GEO, new THREE.ShaderMaterial({
      uniforms: {uTime, uColor: {value: new THREE.Color(color)}, uOff: {value: i / 3}},
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec2 vU; uniform float uTime; uniform vec3 uColor; uniform float uOff;
        void main(){ float t=fract(uTime*0.5+uOff); float r=length(vU-0.5)*2.0;
          gl_FragColor=vec4(uColor, exp(-pow((r-t)*6.0,2.0))*(1.0-t)*0.75); }`
    }));
    q.scale.setScalar(size);
    q.position.copy(p); q.lookAt(p.clone().add(up)); g.add(q);
  }
  const core = new THREE.Mesh(CORE_GEO,
    new THREE.MeshBasicMaterial({color: new THREE.Color(color)}));
  core.scale.setScalar(big ? 0.013 : 0.008);
  core.position.copy(p); g.add(core);
  return g;
}

function makeTargets() {
  const ratio = renderer.getPixelRatio();
  const w = Math.max(2, Math.floor(viewW * ratio)), h = Math.max(2, Math.floor(viewH * ratio));
  const q = {minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
             depthBuffer: false, stencilBuffer: false, generateMipmaps: false};
  [rtScene, rtA, rtB].forEach(t => t && t.dispose());
  rtScene = new THREE.WebGLRenderTarget(w, h,
    Object.assign({}, q, {depthBuffer: true}));
  const qw = Math.max(2, w >> 2), qh = Math.max(2, h >> 2);
  rtA = new THREE.WebGLRenderTarget(qw, qh, q);
  rtB = new THREE.WebGLRenderTarget(qw, qh, q);
  matBright.uniforms.uTexel.value.set(1 / w, 1 / h);
}

function renderFrame(bloomAmt) {
  if (!bloomOn) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
  renderer.setRenderTarget(rtScene);
  renderer.render(scene, camera);

  fsQuad.material = matBright;
  matBright.uniforms.tDiffuse.value = rtScene.texture;
  renderer.setRenderTarget(rtA);
  renderer.render(fsScene, fsCam);

  const qw = rtA.width, qh = rtA.height;
  fsQuad.material = matBlur;
  matBlur.uniforms.tDiffuse.value = rtA.texture;
  matBlur.uniforms.uDir.value.set(1 / qw, 0);
  renderer.setRenderTarget(rtB);
  renderer.render(fsScene, fsCam);

  matBlur.uniforms.tDiffuse.value = rtB.texture;
  matBlur.uniforms.uDir.value.set(0, 1 / qh);
  renderer.setRenderTarget(rtA);
  renderer.render(fsScene, fsCam);

  fsQuad.material = matComp;
  matComp.uniforms.tScene.value = rtScene.texture;
  matComp.uniforms.tBloom.value = rtA.texture;
  matComp.uniforms.uAmt.value = bloomAmt;
  renderer.setRenderTarget(null);
  renderer.render(fsScene, fsCam);
}

/* ── quality tiers, applied when frames are consistently slow ── */
function applyTier(t) {
  tier = Math.max(0, Math.min(3, t));
  const cap = [1.0, 0.85, 0.7, 0.55][tier];
  const ratio = Math.min(window.devicePixelRatio || 1, cap);
  renderer.setPixelRatio(ratio);
  renderer.setSize(viewW, viewH)   /* keep CSS at viewport size */;
  bloomOn = tier < 3;
  makeTargets();
  perf.tier = tier; perf.bloom = bloomOn; perf.ratio = ratio;
}

/* Half-float keeps the fields smooth; 8-bit would band visibly along the
   coastline thresholds. Falls back if the format is unavailable. */
function bakeFields() {
  const W = 2048, H = 1024;
  const opts = {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false
  };
  let rt;
  try {
    rt = new THREE.WebGLRenderTarget(W, H, Object.assign({type: THREE.HalfFloatType}, opts));
  } catch (e) {
    rt = new THREE.WebGLRenderTarget(W, H, opts);
  }
  const sc = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, depthTest: false, depthWrite: false
  }));
  sc.add(quad);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(sc, cam);
  renderer.setRenderTarget(prev);
  quad.geometry.dispose();
  quad.material.dispose();
  return rt.texture;
}

const API = {
  init(el) {
    viewW = el.clientWidth; viewH = el.clientHeight;
    renderer = new THREE.WebGLRenderer({antialias: false, powerPreference: 'high-performance'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.0));
    renderer.setSize(viewW, viewH)   /* keep CSS at viewport size */;
    renderer.setClearColor(0x03040a, 1);
    el.appendChild(renderer.domElement);
    labelBox = document.getElementById('labels');

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, viewW / viewH, 0.1, 200);

    RING_GEO = new THREE.PlaneGeometry(1, 1);
    CORE_GEO = new THREE.SphereGeometry(1, 10, 8);

    const fields = bakeFields();
    planet = new THREE.Mesh(new THREE.SphereGeometry(R, 72, 48), new THREE.ShaderMaterial({
      uniforms: {uTime, uEsc, uLight: {value: new THREE.Vector3(0.75, 0.42, 1.0)},
                 uFields: {value: fields},
                 uDiscN, uDiscC, uDiscR, uDiscCos, uDiscSin, uDiscCol, uDiscHi},
      vertexShader: VERT, fragmentShader: PLANET_FRAG}));
    scene.add(planet);

    atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.055, 48, 32), new THREE.ShaderMaterial({
      uniforms: {uEsc, uTime}, vertexShader: VERT, fragmentShader: ATMO_FRAG,
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending}));
    scene.add(atmo);

    stars = makeStars(); scene.add(stars);
    arcGroup = new THREE.Group(); markGroup = new THREE.Group(); ringGroup = new THREE.Group();
    planet.add(arcGroup); planet.add(markGroup); scene.add(ringGroup);

    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(R * (1.5 + i * 0.2), R * (1.512 + i * 0.2), 72),
        new THREE.MeshBasicMaterial({color: i ? 0x24576e : 0x376f8a, transparent: true, opacity: 0.14,
          side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false}));
      ring.rotation.x = Math.PI / 2 + (i ? 0.34 : -0.16);
      ring.rotation.z = i * 0.7;
      ringGroup.add(ring);
    }

    fsScene = new THREE.Scene();
    fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    matBright = new THREE.ShaderMaterial({vertexShader: FS_VERT, fragmentShader: BRIGHT_FRAG,
      uniforms: {tDiffuse: {value: null}, uTexel: {value: new THREE.Vector2()},
                 uThresh: {value: 0.72}}, depthTest: false, depthWrite: false});
    matBlur = new THREE.ShaderMaterial({vertexShader: FS_VERT, fragmentShader: BLUR_FRAG,
      uniforms: {tDiffuse: {value: null}, uDir: {value: new THREE.Vector2()}},
      depthTest: false, depthWrite: false});
    matComp = new THREE.ShaderMaterial({vertexShader: FS_VERT, fragmentShader: COMP_FRAG,
      uniforms: {tScene: {value: null}, tBloom: {value: null}, uAmt: {value: 1.0}},
      depthTest: false, depthWrite: false});
    fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), matBright);
    fsQuad.frustumCulled = false;
    fsScene.add(fsQuad);
    makeTargets();

    flashEl = document.getElementById('flash');

    addEventListener('resize', () => {
      viewW = el.clientWidth; viewH = el.clientHeight;
      camera.aspect = viewW / viewH; camera.updateProjectionMatrix();
      renderer.setSize(viewW, viewH)   /* keep CSS at viewport size */;
      makeTargets();
    });

    let px = 0, py = 0;
    el.addEventListener('pointerdown', e => {dragging = true; px = e.clientX; py = e.clientY; targetQ = null;});
    addEventListener('pointerup', () => dragging = false);
    addEventListener('pointermove', e => {
      if (!dragging) return;
      planet.rotation.y += (e.clientX - px) * 0.005;
      planet.rotation.x = Math.max(-0.9, Math.min(0.9, planet.rotation.x + (e.clientY - py) * 0.004));
      px = e.clientX; py = e.clientY;
    });

    let last = performance.now(), acc = 0;
    (function loop() {
      requestAnimationFrame(loop);
      const now = performance.now();
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.25) dt = 0.25;              /* returning from a background tab */
      acc += dt;
      /* frame cap: skip the draw, keep the clock */
      if (acc * 1000 < FRAME_CAP && !dragging) return;
      const step = acc; acc = 0;

      emaFrame += (step - emaFrame) * 0.1;
      perf.avgMs = +(emaFrame * 1000).toFixed(1);
      if (emaFrame > 0.055) {
        if (++slowFrames > 45) { slowFrames = 0; if (tier < 3) applyTier(tier + 1); }
      } else slowFrames = 0;

      uTime.value += step;
      if (!dragging && !targetQ) planet.rotation.y += spin * step;
      if (targetQ) {
        planet.quaternion.slerp(targetQ, 1 - Math.pow(0.006, step));
        if (planet.quaternion.angleTo(targetQ) < 0.004) targetQ = null;
      }
      camDist += (targetDist - camDist) * (1 - Math.pow(0.03, step));
      atmo.rotation.copy(planet.rotation);
      ringGroup.rotation.y += 0.05 * step;
      stars.rotation.y += 0.004 * step;
      let ox = 0, oy = 0;
      if (shake > 0) {
        shake = Math.max(0, shake - step * 1.7);
        ox = (Math.random() - 0.5) * shake * 0.09; oy = (Math.random() - 0.5) * shake * 0.09;
      }
      camera.position.set(ox, 0.40 + oy, camDist);
      camera.lookAt(0, 0, 0);
      renderFrame(0.85 + uEsc.value * 0.45);
      API._placeLabels();
    })();
    return true;
  },

  /* ---- the map ---- */
  setMap(polities, active) {
    let k = 0;
    const on = new Set(active || []);
    polities.forEach(p => p.discs.forEach(([lat, lng, r]) => {
      if (k >= MAXD) return;
      uDiscC.value[k] = ll2v(lat, lng, 1).normalize();
      uDiscR.value[k] = r;
      uDiscCos.value[k] = Math.cos(r);
      uDiscSin.value[k] = Math.sin(r);
      uDiscCol.value[k] = new THREE.Color(p.color);
      uDiscHi.value[k] = on.has(p.id) ? 1 : 0;
      k++;
    }));
    uDiscN.value = k;
  },
  setLabels(list) {
    labels = list || [];
    if (!labelBox) return;
    labelBox.innerHTML = labels.map((l, i) =>
      `<div class="mlab ${l.active ? 'on' : ''}" data-i="${i}" style="--c:${l.color}">
         <span class="nm">${l.name}</span>${l.role ? `<span class="rl">${l.role}</span>` : ''}</div>`).join('');
    labels.forEach((l, i) => {
      l.el = labelBox.querySelector(`.mlab[data-i="${i}"]`);
      l.v = ll2v(l.lat, l.lng, R * 1.015);
      l.lastX = -1e9; l.lastO = -1;
    });
  },
  _placeLabels() {
    if (!labels.length || !camera) return;
    const camDir = camera.position.clone().normalize();
    labels.forEach(l => {
      if (!l.el) return;
      tmp.copy(l.v).applyQuaternion(planet.quaternion);
      const facing = tmp.clone().normalize().dot(camDir);
      tmp.project(camera);
      const x = (tmp.x * 0.5 + 0.5) * viewW, y = (-tmp.y * 0.5 + 0.5) * viewH;
      const o = facing < 0.06 ? 0 : Math.min(1, (facing - 0.06) * 5);
      /* only touch the DOM when it would actually change */
      if (Math.abs(x - l.lastX) > 0.6 || Math.abs(y - l.lastY) > 0.6) {
        l.el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
        l.lastX = x; l.lastY = y;
      }
      if (Math.abs(o - l.lastO) > 0.02) { l.el.style.opacity = o; l.lastO = o; }
    });
  },
  lookAt(lat, lng) {
    const target = ll2v(lat, lng, 1).normalize();
    targetQ = new THREE.Quaternion().setFromUnitVectors(target, new THREE.Vector3(0, 0.20, 1).normalize());
    targetDist = 4.25;
  },
  pullBack() { targetDist = 5.0; },
  setArcs(list) {
    clearGroup(arcGroup);
    const c = uEsc.value > 0.55 ? '#ff7a52' : '#7ae1ff';
    (list || []).forEach(a => arcGroup.add(makeArc([a[0], a[1]], [a[2], a[3]], c)));
  },
  setMarks(list) {
    clearGroup(markGroup);
    const c = uEsc.value > 0.55 ? '#ff6a48' : '#66d9ff';
    (list || []).forEach(m => markGroup.add(makeMarker(m.lat, m.lng, m.color || c, m.big)));
  },
  setEscalation(v) { uEsc.value = Math.max(0, Math.min(1, v)); },
  shake(a) { shake = Math.min(1.6, shake + (a || 1)); },
  flash(color) {
    if (!flashEl) return;
    flashEl.style.background = color || 'rgba(255,90,60,.30)';
    flashEl.style.transition = 'none';
    flashEl.style.opacity = '1';
    requestAnimationFrame(() => {
      flashEl.style.transition = 'opacity .8s cubic-bezier(.2,.7,.2,1)';
      flashEl.style.opacity = '0';
    });
  },
  stats() { return Object.assign({}, perf); },
  setQuality(t) { applyTier(t); }
};

window.GLOBE = API;
try {
  API.init(document.getElementById('globe'));
  document.body.classList.add('gl-ok');
} catch (err) {
  console.warn('No WebGL — using the flat backdrop.', err);
  document.body.classList.add('gl-fallback');
  const noop = () => {};
  window.GLOBE = {setMap: noop, setLabels: noop, _placeLabels: noop, lookAt: noop, pullBack: noop,
    setArcs: noop, setMarks: noop, setEscalation: noop, shake: noop,
    stats: () => ({avgMs: 0, tier: -1}), setQuality: noop, flash: API.flash};
}
window.dispatchEvent(new Event('globe-ready'));

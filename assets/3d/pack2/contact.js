/* Dvatone pack2: contact shadows on the plinth top (the soft dark "kiss" where an object rests on a surface).
   An orthographic camera looks up from the plinth top and renders only the movable objects (layer 2) as darkness
   by height above the surface; two separable Gaussian blurs soften it. Re-rendered only when something moved. */
const VS_DEPTH = `
uniform float uGround; varying float vH;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vH = w.y - uGround; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FS_DEPTH = `
uniform float uH; uniform float uDark; varying float vH;
void main(){ float a = 1.0 - clamp(vH / uH, 0.0, 1.0); gl_FragColor = vec4(0.0, 0.0, 0.0, a * a * uDark); }`;
const VS_Q = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const FS_BLUR = `
uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
void main(){
  float a = texture2D(tSrc, vUv).a * 0.2270270270;
  a += texture2D(tSrc, vUv + uDir * 1.3846153846).a * 0.3162162162;
  a += texture2D(tSrc, vUv - uDir * 1.3846153846).a * 0.3162162162;
  a += texture2D(tSrc, vUv + uDir * 3.2307692308).a * 0.0702702703;
  a += texture2D(tSrc, vUv - uDir * 3.2307692308).a * 0.0702702703;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`;

export function createContact(THREE, renderer, o) {
  const res = o.res || 512, layer = o.layer || 2;
  let R = o.radius || 3, ground = o.ground || 0, height = o.height || 1.1, dark = o.darkness == null ? 0.9 : o.darkness, blur = o.blur || 2.2;
  const mk = () => {
    const rt = new THREE.WebGLRenderTarget(res, res, { depthBuffer: true, stencilBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    rt.texture.generateMipmaps = false; return rt;
  };
  const rtA = mk(), rtB = mk();
  const cam = new THREE.OrthographicCamera(-R, R, R, -R, 0, height);
  cam.rotation.x = Math.PI / 2;                          /* look up: image right = +X, image up = +Z */
  cam.layers.set(layer);
  const depthMat = new THREE.ShaderMaterial({ vertexShader: VS_DEPTH, fragmentShader: FS_DEPTH,
    uniforms: { uGround: { value: ground }, uH: { value: height }, uDark: { value: dark } }, side: THREE.DoubleSide });
  const blurMat = new THREE.ShaderMaterial({ vertexShader: VS_Q, fragmentShader: FS_BLUR, uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
    depthTest: false, depthWrite: false, blending: THREE.NoBlending });
  const qScene = new THREE.Scene(), qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const qGeo = new THREE.BufferGeometry();
  qGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  qGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new THREE.Mesh(qGeo, blurMat); quad.frustumCulled = false; qScene.add(quad);

  /* display disc on the plinth top: uv maps the camera frustum (v flipped: the camera looks up) */
  const geo = new THREE.CircleGeometry(1, 96);
  geo.rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv, pos = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * 0.5 + 0.5, pos.getZ(i) * 0.5 + 0.5);
  const mat = new THREE.MeshBasicMaterial({ map: rtA.texture, transparent: true, depthWrite: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2; mesh.raycast = () => {};
  function place() {
    mesh.scale.set(R, 1, R); mesh.position.set(0, ground + 0.0015, 0);
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 0; cam.far = height; cam.updateProjectionMatrix();
    cam.position.set(0, ground, 0); cam.updateMatrixWorld(true);
    depthMat.uniforms.uGround.value = ground; depthMat.uniforms.uH.value = height; depthMat.uniforms.uDark.value = dark;
  }
  place();
  function blurPass(src, dst, dx, dy) {
    blurMat.uniforms.tSrc.value = src.texture; blurMat.uniforms.uDir.value.set(dx / res, dy / res);
    renderer.setRenderTarget(dst); renderer.render(qScene, qCam);
  }
  function update(scene) {
    const prevT = renderer.getRenderTarget(), prevC = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
    const ov = scene.overrideMaterial, bg = scene.background, sh = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    scene.overrideMaterial = depthMat; scene.background = null;
    renderer.setClearColor(0x000000, 0);
    mesh.visible = false;
    renderer.setRenderTarget(rtA); renderer.clear(true, true, false); renderer.render(scene, cam);
    scene.overrideMaterial = ov; scene.background = bg; mesh.visible = true;
    blurPass(rtA, rtB, blur, 0); blurPass(rtB, rtA, 0, blur);
    blurPass(rtA, rtB, blur * 0.45, 0); blurPass(rtB, rtA, 0, blur * 0.45);
    renderer.setRenderTarget(prevT); renderer.setClearColor(prevC, prevA);
    renderer.shadowMap.autoUpdate = sh;
  }
  return {
    mesh, update, materials: [depthMat, blurMat],
    set(p) { if (p.radius != null) R = p.radius; if (p.ground != null) ground = p.ground; if (p.height != null) height = p.height; if (p.darkness != null) dark = p.darkness; if (p.blur != null) blur = p.blur; place(); },
    dispose() { rtA.dispose(); rtB.dispose(); depthMat.dispose(); blurMat.dispose(); qGeo.dispose(); geo.dispose(); mat.dispose(); }
  };
}

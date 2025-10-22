/* ===========================
   Double-Slit Ultimate (2D/3D)
   - Fraunhofer + Fresnel (2D/3D)
   - Particles 2D & 3D accumulation
   - Axes + Rulers (3D)
   - CSV / PNG / LaTeX / PDF(Print)
   Vanilla JS + WebGL
=========================== */

// ---------- Utilities ----------
const TAU=Math.PI*2;
const qs=s=>document.querySelector(s);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const lerp=(a,b,t)=>a+(b-a)*t;
const sinc=x=>x===0?1:Math.sin(x)/x;
const getVar=name=>getComputedStyle(document.body).getPropertyValue(name);

// ---------- DOM ----------
const UI={
  themeBtn:qs('#themeBtn'), fps:qs('#fps'),
  view:[...document.querySelectorAll('input[name="view"]')],
  regime:[...document.querySelectorAll('input[name="regime"]')],
  mode:[...document.querySelectorAll('input[name="mode"]')],
  spectrum:qs('#spectrum'),
  lambda:qs('#lambda'), lambdaVal:qs('#lambdaVal'),
  d:qs('#d'), dVal:qs('#dVal'),
  a:qs('#a'), aVal:qs('#aVal'),
  L:qs('#L'), LVal:qs('#LVal'),
  coh:qs('#coh'), cohVal:qs('#cohVal'),
  rate:qs('#rate'), rateVal:qs('#rateVal'),
  quality:qs('#quality'), qualityVal:qs('#qualityVal'),
  span:qs('#span'), spanVal:qs('#spanVal'),
  res:qs('#res'), resVal:qs('#resVal'),
  slit1:qs('#slit1'), slit2:qs('#slit2'),
  normalize:qs('#normalize'), showCurve:qs('#showCurve'), autoSpan:qs('#autoSpan'),
  resetBtn:qs('#resetBtn'), snapBtn:qs('#snapBtn'), csvBtn:qs('#csvBtn'),
  latexBtn:qs('#latexBtn'), pdfBtn:qs('#pdfBtn'),
  toggleRun:qs('#toggleRun'), step:qs('#step'),
  toggleRun3D:qs('#toggleRun3D'),
  presets:[...document.querySelectorAll('[data-preset]')],
  sideView:qs('#sideView'), screen:qs('#screen'),
  glcanvas:qs('#glcanvas'), stage2d:qs('.stage-2d'), stage3d:qs('.stage-3d')
};

// ---------- Shared State ----------
const S={
  currentView:'2d',
  lambda_nm:+UI.lambda.value, d_um:+UI.d.value, a_um:+UI.a.value, L_m:+UI.L.value,
  gamma:+UI.coh.value, spectrum:false, slit1:true, slit2:true, normalize:true,
  // 2D
  regime:'fraunhofer', mode:'wave', particleRate:+UI.rate.value, quality:+UI.quality.value,
  showCurve:true, autoSpan:true, Xmax:(+UI.span.value)/100,
  W2:UI.screen.width, H2:UI.screen.height,
  intensity:new Float32Array(UI.screen.width), cdf:new Float32Array(UI.screen.width),
  hits:new Uint32Array(UI.screen.width),
  imgWave:UI.screen.getContext('2d').createImageData(UI.screen.width, UI.screen.height),
  running:false,
  // 3D
  res:+UI.res.value|0, texW:+UI.res.value|0, texH:256,
  running3D:false, // particles 3D
  hits3D:new Uint32Array(+UI.res.value|0), // تراكم جسيمات 3D على الشاشة (1D عبر x)
  // timing
  last:performance.now(), fpsAcc:0,fpsCount:0,fpsShownAt:0,
  dirty2d:true, dirty3d:true
};

// ---------- Wavelength to RGB ----------
function wavelengthToRGB(nm){
  let R=0,G=0,B=0,a=1,w=nm;
  if(w>=380&&w<440){R=-(w-440)/(440-380);G=0;B=1;}
  else if(w<490){R=0;G=(w-440)/(490-440);B=1;}
  else if(w<510){R=0;G=1;B=-(w-510)/(510-490);}
  else if(w<580){R=(w-510)/(580-510);G=1;B=0;}
  else if(w<645){R=1;G=-(w-645)/(645-580);B=0;}
  else if(w<=700){R=1;G=0;B=0;}
  if(w<420)a=0.3+0.7*(w-380)/(420-380); else if(w>645)a=0.3+0.7*(700-w)/(700-645);
  return [Math.round(R*255),Math.round(G*255),Math.round(B*255),a];
}
function updateLabels(){
  UI.lambdaVal.textContent=S.lambda_nm|0;
  UI.dVal.textContent=S.d_um|0;
  UI.aVal.textContent=S.a_um|0;
  UI.LVal.textContent=S.L_m.toFixed(2);
  UI.cohVal.textContent=S.gamma.toFixed(2);
  UI.rateVal.textContent=S.particleRate|0;
  UI.qualityVal.textContent=S.quality|0;
  UI.spanVal.textContent=(S.Xmax*100).toFixed(1);
  UI.resVal.textContent=S.res|0;
}
const mark2D=()=>S.dirty2d=true;
const mark3D=()=>S.dirty3d=true;

// ---------- 2D: Physics + Draw ----------
const ctxSide=UI.sideView.getContext('2d');
const ctx2=UI.screen.getContext('2d',{willReadFrequently:true});

function autoSpan(){
  const lambda=S.lambda_nm*1e-9, d=Math.max(1e-12,S.d_um*1e-6), L=Math.max(1e-6,S.L_m);
  const fringe=lambda*L/d; S.Xmax=clamp(fringe*6,0.005,0.08);
}
function computeFraunhofer(lambda_nm){
  const W=S.W2, lambda=lambda_nm*1e-9, d=S.d_um*1e-6, a=S.a_um*1e-6, L=S.L_m, gamma=S.gamma;
  const s1=S.slit1?1:0, s2=S.slit2?1:0; const Xmax=S.Xmax; let Imax=0;
  for(let i=0;i<W;i++){
    const x=lerp(-Xmax,Xmax,i/(W-1));
    const beta=Math.PI*a*x/(lambda*L), env=sinc(beta)**2;
    let I=0;
    if((s1^s2)===1) I=env;
    else if(!s1 && !s2) I=0;
    else { const dphi=TAU*d*x/(lambda*L); I=env*(1+gamma*Math.cos(dphi)); }
    S.intensity[i]=I; if(I>Imax) Imax=I;
  }
  if(S.normalize && Imax>0) for(let i=0;i<W;i++) S.intensity[i]/=Imax;
}
function computeFresnel(lambda_nm){
  // هويجنز حقيقي على عرض الشق (1D على x — ثابت رأسيًا)
  const W=S.W2, lambda=lambda_nm*1e-9, d=S.d_um*1e-6, a=S.a_um*1e-6, L=S.L_m, k=TAU/lambda;
  const s1=S.slit1, s2=S.slit2; const Ns=Math.max(16,S.quality|0), dy=a/Ns; const Xmax=S.Xmax;
  const y1c=-d/2, y2c=+d/2; let Imax=0;
  for(let ix=0; ix<W; ix++){
    const x=lerp(-Xmax,Xmax,ix/(W-1));
    let E1r=0,E1i=0,E2r=0,E2i=0;
    if(s1) for(let j=0;j<Ns;j++){ const y=y1c+(j+0.5)*dy, r=Math.hypot(L,x); const ph=k*Math.sqrt(x*x+L*L); E1r+=Math.cos(ph)/r; E1i+=Math.sin(ph)/r; }
    if(s2) for(let j=0;j<Ns;j++){ const y=y2c+(j+0.5)*dy, r=Math.hypot(L,x); const ph=k*Math.sqrt(x*x+L*L); E2r+=Math.cos(ph)/r; E2i+=Math.sin(ph)/r; }
    const I1=E1r*E1r+E1i*E1i, I2=E2r*E2r+E2i*E2i, cross=2*S.gamma*(E1r*E2r+E1i*E2i);
    const I=I1+I2+cross; S.intensity[ix]=I; if(I>Imax) Imax=I;
  }
  if(S.normalize && Imax>0) for(let i=0;i<W;i++) S.intensity[i]/=Imax;
}
function rebuildCDF(){
  const W=S.W2; let sum=0; for(let i=0;i<W;i++) sum+=S.intensity[i];
  let acc=0; for(let i=0;i<W;i++){ acc+=(sum>0?S.intensity[i]/sum:0); S.cdf[i]=acc; }
}
function compute2D(lambda_nm){
  if(S.autoSpan) autoSpan();
  (S.regime==='fraunhofer'?computeFraunhofer:computeFresnel)(lambda_nm);
  rebuildCDF();
}

function drawSideView(){
  const w=UI.sideView.width,h=UI.sideView.height,c=ctxSide; c.clearRect(0,0,w,h);
  c.fillStyle=getVar('--grid'); for(let y=0;y<h;y+=20)c.fillRect(0,y,w,1); for(let x=0;x<w;x+=20)c.fillRect(x,0,1,h);
  const slitX=80, screenX=w-60, centerY=h/2, Lpx=screenX-slitX;
  const d_px=(S.d_um*1e-6)*(Lpx / S.L_m)*100, a_px=Math.max(6,(S.a_um*1e-6)*(Lpx / S.L_m)*300);
  c.fillStyle='#fff'; c.fillRect(slitX-3,0,6,h);
  c.fillStyle='#10d4'; if(S.slit1) c.fillRect(slitX-6,centerY-d_px/2-a_px/2,12,a_px); if(S.slit2) c.fillRect(slitX-6,centerY+d_px/2-a_px/2,12,a_px);
  c.fillStyle='#ddd'; c.fillRect(screenX-4,0,8,h);
  c.strokeStyle='#68c1ff'; c.lineWidth=2; c.beginPath(); c.moveTo(slitX,h-20); c.lineTo(screenX,h-20); c.stroke();
  c.fillStyle='#68c1ff'; c.font='12px system-ui'; c.fillText(`L = ${S.L_m.toFixed(2)} m`, slitX+10,h-24);
}
function draw2D(dt){
  const W=S.W2,H=S.H2,c=ctx2; c.fillStyle=getVar('--grid'); c.fillRect(0,0,W,H);
  if(S.mode==='wave'){
    if(S.spectrum){
      const nmArr=[450,550,650], img=S.imgWave; img.data.fill(0);
      for(const nm of nmArr){
        compute2D(nm); const [r,g,b,a]=wavelengthToRGB(nm);
        for(let x=0;x<W;x++){ const v=Math.floor(255*clamp(S.intensity[x],0,1)*a);
          for(let y=0;y<H;y++){ const p=(y*W+x)*4; img.data[p]+=Math.floor(r*v/255); img.data[p+1]+=Math.floor(g*v/255); img.data[p+2]+=Math.floor(b*v/255); img.data[p+3]=255; }
        }
      }
      c.putImageData(img,0,0);
    }else{
      compute2D(S.lambda_nm); const [r,g,b,a]=wavelengthToRGB(S.lambda_nm); const img=S.imgWave; img.data.fill(0);
      for(let x=0;x<W;x++){ const v=Math.floor(255*clamp(S.intensity[x],0,1)*a);
        for(let y=0;y<H;y++){ const p=(y*W+x)*4; img.data[p]=r? v:0; img.data[p+1]=g? v:0; img.data[p+2]=b? v:0; img.data[p+3]=255; }
      }
      c.putImageData(img,0,0);
    }
    if(S.showCurve){ c.lineWidth=2; c.strokeStyle='rgba(104,193,255,0.95)'; c.beginPath();
      for(let x=0;x<W;x++){ const y=H-8-S.intensity[x]*(H-16); if(x===0)c.moveTo(x,y); else c.lineTo(x,y); } c.stroke();
    }
  }else{
    const particles=Math.floor(S.running? S.particleRate*dt : 0);
    for(let k=0;k<particles;k++){ const u=Math.random(); let lo=0,hi=W-1; while(lo<hi){ const m=(lo+hi)>>1; (S.cdf[m]>=u)?(hi=m):(lo=m+1); } S.hits[lo]=Math.min(0xffffffff,S.hits[lo]+1); }
    let hmax=0; for(let x=0;x<W;x++) if(S.hits[x]>hmax) hmax=S.hits[x];
    if(hmax>0){ for(let x=0;x<W;x++){ const ratio=S.hits[x]/hmax,col=Math.floor(255*ratio); c.strokeStyle=`rgba(${col},${col},${col},1)`; const yTop=H-6-Math.floor((H-12)*ratio); c.beginPath(); c.moveTo(x,H-6); c.lineTo(x,yTop); c.stroke(); } }
    if(S.showCurve){ c.lineWidth=2; c.strokeStyle='rgba(104,193,255,0.85)'; c.beginPath();
      for(let x=0;x<W;x++){ const y=H-8-S.intensity[x]*(H-16); if(x===0)c.moveTo(x,y); else c.lineTo(x,y); } c.stroke();
    }
  }
  c.strokeStyle='rgba(255,255,255,0.15)'; c.strokeRect(0.5,0.5,W-1,H-1);
}

// ---------- 3D: WebGL + Fresnel true + Particles ----------
let gl, progColor, progTex, UC={}, ATTR={}, tex, texData, P,V;
const cam={target:[0,0,0.5], r:2.4, theta:Math.PI*0.20, phi:Math.PI*0.25, minR:1.2, maxR:7};
function camPos(){ const ct=cam.target; const x=ct[0]+cam.r*Math.cos(cam.phi)*Math.sin(cam.theta); const y=ct[1]+cam.r*Math.sin(cam.phi); const z=ct[2]+cam.r*Math.cos(cam.phi)*Math.cos(cam.theta); return [x,y,z]; }
function initGL(){
  gl=UI.glcanvas.getContext('webgl'); if(!gl){ alert('WebGL غير متاح'); return; }
  const vs=`attribute vec3 aPos; attribute vec2 aUV; uniform mat4 uP,uV,uM; varying vec2 vUV; void main(){ vUV=aUV; gl_Position=uP*uV*uM*vec4(aPos,1.0);} `;
  const fsC=`precision mediump float; uniform vec3 uColor; void main(){ gl_FragColor=vec4(uColor,1.0);} `;
  const fsT=`precision mediump float; varying vec2 vUV; uniform sampler2D uTex; void main(){ gl_FragColor=texture2D(uTex,vUV);} `;
  const sh=(t,s)=>{const o=gl.createShader(t); gl.shaderSource(o,s); gl.compileShader(o); if(!gl.getShaderParameter(o,gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(o); return o;};
  const pr=(vs,fs)=>{const p=gl.createProgram(); gl.attachShader(p,vs); gl.attachShader(p,fs); gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw gl.getProgramInfoLog(p); return p;};
  progColor=pr(sh(gl.VERTEX_SHADER,vs),sh(gl.FRAGMENT_SHADER,fsC));
  progTex=pr(sh(gl.VERTEX_SHADER,vs),sh(gl.FRAGMENT_SHADER,fsT));
  UC.color={uP:gl.getUniformLocation(progColor,'uP'),uV:gl.getUniformLocation(progColor,'uV'),uM:gl.getUniformLocation(progColor,'uM'),uColor:gl.getUniformLocation(progColor,'uColor')};
  UC.tex={uP:gl.getUniformLocation(progTex,'uP'),uV:gl.getUniformLocation(progTex,'uV'),uM:gl.getUniformLocation(progTex,'uM')};
  ATTR.aPos=gl.getAttribLocation(progColor,'aPos'); ATTR.aUV=gl.getAttribLocation(progColor,'aUV');
  ATTR.aPosT=gl.getAttribLocation(progTex,'aPos'); ATTR.aUVT=gl.getAttribLocation(progTex,'aUV');
  tex=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,tex); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  resizeGL(); texData=new Uint8Array(S.res*256*4); S.hits3D=new Uint32Array(S.res);
}
function mat4Identity(){return[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];}
function mat4Mul(a,b){const o=new Array(16).fill(0); for(let r=0;r<4;r++)for(let c=0;c<4;c++)o[r*4+c]=a[r*4]*b[c]+a[r*4+1]*b[c+4]+a[r*4+2]*b[c+8]+a[r*4+3]*b[c+12]; return o;}
function mat4Translate(x,y,z){const m=mat4Identity(); m[12]=x;m[13]=y;m[14]=z;return m;}
function mat4Scale(x,y,z){const m=mat4Identity(); m[0]=x;m[5]=y;m[10]=z;return m;}
function mat4Perspective(fov,asp,n,f){const t=1/Math.tan(fov/2), nf=1/(n-f); return [t/asp,0,0,0, 0,t,0,0, 0,0,(f+n)*nf,-1, 0,0,(2*f*n)*nf,0];}
function mat4LookAt(e,c,u=[0,1,0]){let[ex,ey,ez]=e,[cx,cy,cz]=c,zx=ex-cx,zy=ey-cy,zz=ez-cz;let zn=1/Math.hypot(zx,zy,zz);zx*=zn;zy*=zn;zz*=zn;let xx=u[1]*zz-u[2]*zy,xy=u[2]*zx-u[0]*zz,xz=u[0]*zy-u[1]*zx;let xn=1/Math.hypot(xx,xy,xz);xx*=xn;xy*=xn;xz*=xn;let yx=zy*xz-zz*xy,yy=zz*xx-zx*xz,yz=zx*xy-zy*xx;return[xx,yx,zx,0, xy,yy,zy,0, xz,yz,zz,0, -(xx*ex+xy*ey+xz*ez),-(yx*ex+yy*ey+yz*ez),-(zx*ex+zy*ey+zz*ez),1];}
function makeQuad(w,h){const x=w/2,y=h/2; const v=new Float32Array([-x,-y,0,0,0, x,-y,0,1,0, x,y,0,1,1, -x,y,0,0,1]); const i=new Uint16Array([0,1,2,0,2,3]);
  const vao=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,vao); gl.bufferData(gl.ARRAY_BUFFER,v,gl.STATIC_DRAW);
  const ibo=gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,i,gl.STATIC_DRAW);
  return{vao,ibo,n:6};
}
const Q={screen:null,slits:null,src:null,axX:null,axY:null,axZ:null,tick:null};
function initQuads(){
  Q.screen=makeQuad(1.2,0.7); Q.slits=makeQuad(1.2,0.7); Q.src=makeQuad(0.5,0.5);
  // محاور (كواد رفيعة)
  Q.axX=makeQuad(1.6,0.01); Q.axY=makeQuad(0.01,1.0); Q.axZ=makeQuad(0.01,1.0);
  // علامة مسطرة
  Q.tick=makeQuad(0.01,0.05);
}
function bindQuad(q,prog,attrPos,attrUV){gl.bindBuffer(gl.ARRAY_BUFFER,q.vao); gl.vertexAttribPointer(attrPos,3,gl.FLOAT,false,20,0); gl.enableVertexAttribArray(attrPos); gl.vertexAttribPointer(attrUV,2,gl.FLOAT,false,20,12); gl.enableVertexAttribArray(attrUV); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,q.ibo);}
function drawColor(q,M,color){gl.useProgram(progColor); gl.uniformMatrix4fv(UC.color.uP,false,P); gl.uniformMatrix4fv(UC.color.uV,false,V); gl.uniformMatrix4fv(UC.color.uM,false,M); gl.uniform3fv(UC.color.uColor,color); bindQuad(q,progColor,ATTR.aPos,ATTR.aUV); gl.drawElements(gl.TRIANGLES,q.n,gl.UNSIGNED_SHORT,0);}
function drawTex(q,M){gl.useProgram(progTex); gl.uniformMatrix4fv(UC.tex.uP,false,P); gl.uniformMatrix4fv(UC.tex.uV,false,V); gl.uniformMatrix4fv(UC.tex.uM,false,M);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.bindBuffer(gl.ARRAY_BUFFER,q.vao); gl.vertexAttribPointer(ATTR.aPosT,3,gl.FLOAT,false,20,0); gl.enableVertexAttribArray(ATTR.aPosT); gl.vertexAttribPointer(ATTR.aUVT,2,gl.FLOAT,false,20,12); gl.enableVertexAttribArray(ATTR.aUVT); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,q.ibo);
  gl.drawElements(gl.TRIANGLES,q.n,gl.UNSIGNED_SHORT,0);
}
function resizeGL(){const dpr=window.devicePixelRatio||1; const w=Math.floor(UI.glcanvas.clientWidth*dpr), h=Math.floor(560*dpr);
  if(UI.glcanvas.width!==w||UI.glcanvas.height!==h){ UI.glcanvas.width=w; UI.glcanvas.height=h; gl.viewport(0,0,w,h);}
  P=mat4Perspective(45*Math.PI/180, UI.glcanvas.width/UI.glcanvas.height, 0.05, 50);
}

// ---- 3D Intensity (Fraunhofer/Fresnel true) ----
function intensityRow3D(lambda_nm, useFresnel){
  const W=S.res, lambda=lambda_nm*1e-9, d=S.d_um*1e-6, a=S.a_um*1e-6, L=S.L_m, Xmax=S.Xmax;
  const s1=S.slit1?1:0, s2=S.slit2?1:0, gamma=S.gamma;
  let I=new Float32Array(W), Imax=0;
  if(!useFresnel){
    for(let i=0;i<W;i++){ const x=lerp(-Xmax,Xmax,i/(W-1)); const beta=Math.PI*a*x/(lambda*L), env=sinc(beta)**2;
      let val=0; if((s1^s2)===1) val=env; else if(!s1&&!s2) val=0; else { const dphi=TAU*d*x/(lambda*L); val=env*(1+gamma*Math.cos(dphi)); }
      I[i]=val; if(val>Imax) Imax=val;
    }
  } else {
    const k=TAU/lambda, Ns=Math.max(16,S.quality|0), dy=a/Ns, y1c=-d/2, y2c=+d/2;
    for(let ix=0; ix<W; ix++){
      const x=lerp(-Xmax,Xmax,ix/(W-1)); let E1r=0,E1i=0,E2r=0,E2i=0;
      if(s1) for(let j=0;j<Ns;j++){ const y=y1c+(j+0.5)*dy, r=Math.hypot(L,x); const ph=k*Math.sqrt(x*x+L*L); E1r+=Math.cos(ph)/r; E1i+=Math.sin(ph)/r; }
      if(s2) for(let j=0;j<Ns;j++){ const y=y2c+(j+0.5)*dy, r=Math.hypot(L,x); const ph=k*Math.sqrt(x*x+L*L); E2r+=Math.cos(ph)/r; E2i+=Math.sin(ph)/r; }
      const I1=E1r*E1r+E1i*E1i, I2=E2r*E2r+E2i*E2i, cross=2*S.gamma*(E1r*E2r+E1i*E2i); const val=I1+I2+cross;
      I[ix]=val; if(val>Imax) Imax=val;
    }
  }
  if(S.normalize&&Imax>0) for(let i=0;i<W;i++) I[i]/=Imax;
  return I;
}
function rebuildTexture3D(){
  const nmList=S.spectrum?[450,550,650]:[S.lambda_nm], cols=nmList.map(wavelengthToRGB);
  const useFres=(S.regime==='fresnel');
  const rows=nmList.map(nm=>intensityRow3D(nm,useFres));
  S.texW=S.res; S.texH=256; texData=new Uint8Array(S.texW*S.texH*4);
  for(let x=0;x<S.texW;x++){
    let R=0,G=0,B=0;
    if(S.spectrum){
      for(let k=0;k<nmList.length;k++){ const I=rows[k][x], [r,g,b,a]=cols[k]; const v=Math.floor(255*I*a); R=clamp(R+Math.floor(r*v/255),0,255); G=clamp(G+Math.floor(g*v/255),0,255); B=clamp(B+Math.floor(b*v/255),0,255); }
    }else{ const I=rows[0][x]; const [r,g,b,a]=cols[0]; const v=Math.floor(255*I*a); R=r? v:0; G=g? v:0; B=b? v:0; }
    // امزج أثر الجسيمات 3D (hits3D) فوق الشدة (لون أبيض)
    const hmax=S.hits3D.reduce((m,v)=>v>m?v:m,0)|0;
    let add=0; if(hmax>0){ add=Math.floor(255*(S.hits3D[x]/hmax)); R=clamp(R+add,0,255); G=clamp(G+add,0,255); B=clamp(B+add,0,255); }
    for(let y=0;y<S.texH;y++){
      const t=Math.abs((y/(S.texH-1))*2-1), fall=0.9+0.1*(1 - t*t);
      const p=(y*S.texW+x)*4; texData[p]=Math.floor(R*fall); texData[p+1]=Math.floor(G*fall); texData[p+2]=Math.floor(B*fall); texData[p+3]=255;
    }
  }
  gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,S.texW,S.texH,0,gl.RGBA,gl.UNSIGNED_BYTE,texData);
}

// ---- 3D Particles: emit from slits, cast to z=+1.0, accumulate on x ----
function stepParticles3D(dt){
  if(!S.running3D) return;
  const rate = S.particleRate; // نستخدم نفس السلايدر
  const N = Math.floor(rate*dt);
  // هندسة بسيطة: الشقين عند z=0، الشاشة z=+1.0
  for(let i=0;i<N;i++){
    // اختر الشقّ الفعّال عشوائيًا
    const active=[];
    if(S.slit1) active.push(-1); if(S.slit2) active.push(+1);
    if(active.length===0) break;
    const which=active[(Math.random()*active.length)|0];
    // موقع انبعاث y داخل الشق (نستخدم ارتفاع بصري ثابت لأنه 1D)
    const yLocal=0;
    const x0 = which * (S.d_um*1e-6)/2 * 5; // عامل رسم تقريبى لتفريق بصري، لا يؤثر على الفيزياء (نُسقط لاحقًا)
    // انحراف زاوي صغير ~ توزيع غاوسي
    const sigma=0.03; // اتساع شعاع
    const theta = (Math.random()*2-1)*sigma; // أفقياً
    // تقاطع مع الشاشة z=+1.0
    const z0=0, z1=1.0;
    // شعاع تقريبي: من (x0,0,0) باتجاه (theta) ⇒ x على الشاشة ~ x0 + tan(theta)*Lvis
    const Lvis=1.0; // مسافة مرئية بالمشهد
    const xScreen = x0 + Math.tan(theta)*Lvis;
    // حوّل xScreen (مشهد) إلى موضع فيزيائي عبر Xmax: نفترض الشاشة تعرض ±Xmax ⇒ نطبّق قياس خطي
    const u = (xScreen - (-0.6)) / (1.2); // تحويل من [-0.6, +0.6] عرض الشاشة المشهدية إلى 0..1
    const idx = clamp(Math.floor(u*(S.res-1)),0,S.res-1);
    S.hits3D[idx] = Math.min(0xffffffff, S.hits3D[idx]+1);
  }
  S.dirty3d=true;
}

// ---- 3D Axes + Rulers ----
function drawAxesAndRulers(){
  // محاور عند مركز اللوح: X أحمر، Y أخضر، Z أزرق (كواد رفيعة)
  drawColor(Q.axX, mat4Translate(0, -0.5, 0.0), [1,0.2,0.2]);  // X
  drawColor(Q.axY, mat4Translate(-0.8, 0, 0.0), [0.2,1,0.2]);  // Y
  drawColor(Q.axZ, mat4Mul(mat4Translate(-0.8,-0.5,0.5), mat4Scale(0.01,0.01,1)), [0.2,0.6,1]); // Z (تمثيل)
  // مسطرة أعلى الشاشة: علامات كل ~1 سم (بالمشهد)
  const ticks=10;
  for(let i=0;i<=ticks;i++){
    const x=lerp(-0.6,0.6,i/ticks);
    drawColor(Q.tick, mat4Translate(x, 0.36, 1.001), [0.9,0.9,0.9]);
  }
}

// ---- 3D Controls ----
let dragging=false,lastX=0,lastY=0,panning=false;
function bind3DControls(){
  UI.glcanvas.addEventListener('mousedown',e=>{dragging=true; lastX=e.clientX; lastY=e.clientY; panning=e.shiftKey;});
  window.addEventListener('mouseup',()=>dragging=false);
  window.addEventListener('mousemove',e=>{
    if(!dragging)return; const dx=(e.clientX-lastX)/UI.glcanvas.clientWidth, dy=(e.clientY-lastY)/UI.glcanvas.clientHeight; lastX=e.clientX; lastY=e.clientY;
    if(panning){ const scale=cam.r*0.8; cam.target[0]-=dx*scale; cam.target[1]+=dy*scale; }
    else{ cam.theta-=dx*2.5; cam.phi+=dy*2.0; cam.phi=clamp(cam.phi,-Math.PI*0.49,Math.PI*0.49); }
  });
  UI.glcanvas.addEventListener('wheel',e=>{ cam.r*=(1+Math.sign(e.deltaY)*0.08); cam.r=clamp(cam.r,cam.minR,cam.maxR); e.preventDefault(); },{passive:false});
}

// ---------- Exports ----------
function savePNG2D(){
  const W=UI.sideView.width+16+UI.screen.width, H=Math.max(UI.sideView.height,UI.screen.height);
  const tmp=document.createElement('canvas'); tmp.width=W; tmp.height=H; const c=tmp.getContext('2d');
  c.fillStyle=getVar('--bg'); c.fillRect(0,0,W,H); c.drawImage(UI.sideView,0,0); c.drawImage(UI.screen,UI.sideView.width+16,0);
  const a=document.createElement('a'); a.href=tmp.toDataURL('image/png'); a.download='double-slit-2d.png'; a.click();
}
function savePNG3D(){ const a=document.createElement('a'); a.href=UI.glcanvas.toDataURL('image/png'); a.download='double-slit-3d.png'; a.click(); }
function exportCSV2D(){
  const W=S.W2; let csv='x_m,intensity,hits\n';
  for(let i=0;i<W;i++){ const x=lerp(-S.Xmax,S.Xmax,i/(W-1)); csv+=`${x},${S.intensity[i]},${S.hits[i]}\n`; }
  download(csv,'double-slit-2d.csv','text/csv');
}
function exportCSV3D(){
  const I=intensityRow3D(S.spectrum?550:S.lambda_nm,(S.regime==='fresnel'));
  let csv='x_m,intensity,hits3d\n';
  for(let i=0;i<S.res;i++){ const x=lerp(-S.Xmax,S.Xmax,i/(S.res-1)); csv+=`${x},${I[i]},${S.hits3D[i]}\n`; }
  download(csv,'double-slit-3d.csv','text/csv');
}
function exportLaTeX(){
  const tex=`\\documentclass[12pt]{article}
\\usepackage{amsmath,amssymb,siunitx}
\\usepackage[margin=1in]{geometry}
\\title{Double-Slit Simulation Report}
\\date{}
\\begin{document}\\maketitle
\\section*{Parameters}
\\begin{tabular}{ll}
$\\lambda$ & ${S.lambda_nm}\\,\\si{nm}\\\\
$d$ & ${S.d_um}\\,\\si{\\micro m}\\\\
$a$ & ${S.a_um}\\,\\si{\\micro m}\\\\
$L$ & ${S.L_m}\\,\\si{m}\\\\
$\\gamma$ & ${S.gamma.toFixed(2)}\\\\
Active slits & ${(S.slit1?'Left':'-')} ${(S.slit2?'Right':'-')}\\\\
$\\pm X_{\\max}$ & ${(S.Xmax*100).toFixed(1)}\\,\\si{cm}\\\\
View & ${S.currentView.toUpperCase()} \\\\
Regime & ${(S.regime==='fraunhofer'?'Fraunhofer':'Fresnel')}\\\\
\\end{tabular}

\\section*{Fraunhofer (Far-Field)}
\\[
I(x)=I_0\\,\\mathrm{sinc}^2\\!\\left(\\beta\\right)\\left[1+\\gamma\\cos(\\Delta\\phi)\\right],\\quad
\\beta=\\frac{\\pi a x}{\\lambda L},\\quad
\\Delta\\phi=\\frac{2\\pi d x}{\\lambda L}.
\\]

\\section*{Fresnel (Huygens Integral)}
\\[
I(x)\\propto\\bigl|E_1(x)+E_2(x)\\bigr|^2,\\qquad
E_i(x)=\\int_{\\text{slit}_i}\\frac{e^{ikr}}{r}\\,dy,\\quad k=\\frac{2\\pi}{\\lambda}.
\\]

\\section*{Interpretation}
\\begin{itemize}
\\item Fringe spacing $\\Delta x\\approx\\lambda L/d$ (Fraunhofer).
\\item Envelope $\\mathrm{sinc}^2(\\beta)$ controls overall intensity.
\\item Visibility $V\\approx\\gamma$; disabling a slit removes the cosine term.
\\end{itemize}
\\end{document}`;
  download(tex,'double-slit-report.tex','application/x-tex');
}
function printPDF(){
  // نافذة طباعة: تعرض لقطة (حسب العرض الحالي) + القيم + المعادلات (LaTeX نصي للنسخ)
  const img = (S.currentView==='2d')? snapshot2D() : UI.glcanvas.toDataURL('image/png');
  const html = `
  <html><head><meta charset="utf-8"><title>Double-Slit PDF</title>
  <style>body{font-family:system-ui,Segoe UI,Arial;padding:20px} h1{font-size:20px} .muted{color:#555}</style>
  </head><body>
  <h1>Double-Slit Simulation</h1>
  <p class="muted">λ=${S.lambda_nm} nm, d=${S.d_um} μm, a=${S.a_um} μm, L=${S.L_m} m, γ=${S.gamma.toFixed(2)}, Regime=${S.regime}, View=${S.currentView.toUpperCase()}</p>
  <img src="${img}" style="max-width:100%;border:1px solid #ddd;border-radius:8px"/>
  <h3>Equations (LaTeX)</h3>
  <pre>
I(x)=I_0\\,\\mathrm{sinc}^2(\\beta)[1+\\gamma\\cos(\\Delta\\phi)],\\;\\beta=\\frac{\\pi a x}{\\lambda L},\\;\\Delta\\phi=\\frac{2\\pi d x}{\\lambda L}
I(x)\\propto|E_1+E_2|^2,\\;E_i(x)=\\int\\frac{e^{ikr}}{r}\\,dy,\\;k=\\frac{2\\pi}{\\lambda}
  </pre>
  <script>window.print();</script></body></html>`;
  const w=window.open('','_blank'); w.document.open(); w.document.write(html); w.document.close();
}
function snapshot2D(){
  const W=UI.sideView.width+16+UI.screen.width, H=Math.max(UI.sideView.height,UI.screen.height);
  const tmp=document.createElement('canvas'); tmp.width=W; tmp.height=H; const c=tmp.getContext('2d');
  c.fillStyle='#fff'; c.fillRect(0,0,W,H); c.drawImage(UI.sideView,0,0); c.drawImage(UI.screen,UI.sideView.width+16,0);
  return tmp.toDataURL('image/png');
}
function download(data, name, type){ const blob=new Blob([data],{type}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url); }

// ---------- UI bindings ----------
UI.themeBtn.onclick=()=>{ document.body.classList.toggle('theme-light'); document.body.classList.toggle('theme-dark'); };

UI.view.forEach(r=>r.addEventListener('change',()=>{
  S.currentView=document.querySelector('input[name="view"]:checked').value;
  if(S.currentView==='2d'){ UI.stage2d.classList.remove('hidden'); UI.stage3d.classList.add('hidden'); showOnly2D(true); mark2D(); }
  else { UI.stage3d.classList.remove('hidden'); UI.stage2d.classList.add('hidden'); showOnly2D(false); mark3D(); }
}));
function showOnly2D(flag){
  document.querySelectorAll('.only2d').forEach(el=>el.style.display=flag?'inline-block':'none');
  document.querySelectorAll('.only3d').forEach(el=>el.style.display=!flag?'inline-block':'none');
}

UI.regime.forEach(r=>r.addEventListener('change',()=>{ S.regime=checked('regime'); mark2D(); mark3D(); }));
UI.mode.forEach(r=>r.addEventListener('change',()=>{ S.mode=checked('mode'); }));
UI.spectrum.onchange=()=>{ S.spectrum=UI.spectrum.checked; mark2D(); mark3D(); };

UI.lambda.oninput=()=>{ S.lambda_nm=+UI.lambda.value; updateLabels(); mark2D(); mark3D(); };
UI.d.oninput     =()=>{ S.d_um=+UI.d.value; updateLabels(); mark2D(); mark3D(); };
UI.a.oninput     =()=>{ S.a_um=+UI.a.value; updateLabels(); mark2D(); mark3D(); };
UI.L.oninput     =()=>{ S.L_m=+UI.L.value; updateLabels(); mark2D(); mark3D(); };
UI.coh.oninput   =()=>{ S.gamma=+UI.coh.value; updateLabels(); mark2D(); mark3D(); };
UI.rate.oninput  =()=>{ S.particleRate=+UI.rate.value; updateLabels(); };
UI.quality.oninput=()=>{ S.quality=+UI.quality.value; updateLabels(); mark2D(); mark3D(); };
UI.span.oninput  =()=>{ S.Xmax=(+UI.span.value)/100; updateLabels(); mark2D(); mark3D(); };
UI.res.oninput   =()=>{ S.res=+UI.res.value|0; S.hits3D=new Uint32Array(S.res); updateLabels(); mark3D(); };

UI.slit1.onchange=()=>{ S.slit1=UI.slit1.checked; S.hits.fill(0); S.hits3D.fill(0); mark2D(); mark3D(); };
UI.slit2.onchange=()=>{ S.slit2=UI.slit2.checked; S.hits.fill(0); S.hits3D.fill(0); mark2D(); mark3D(); };
UI.normalize.onchange=()=>{ S.normalize=UI.normalize.checked; mark2D(); mark3D(); };
UI.showCurve.onchange=()=>{ S.showCurve=UI.showCurve.checked; };
UI.autoSpan.onchange=()=>{ S.autoSpan=UI.autoSpan.checked; mark2D(); mark3D(); };

UI.resetBtn.onclick=()=>{ S.hits.fill(0); S.hits3D.fill(0); cam.r=2.4; cam.theta=Math.PI*0.20; cam.phi=Math.PI*0.25; cam.target=[0,0,0.5]; mark2D(); mark3D(); };
UI.snapBtn.onclick =()=>{ (S.currentView==='2d')? savePNG2D(): savePNG3D(); };
UI.csvBtn.onclick  =()=>{ (S.currentView==='2d')? exportCSV2D(): exportCSV3D(); };
UI.latexBtn.onclick=exportLaTeX;
UI.pdfBtn.onclick  =printPDF;

UI.toggleRun.onclick =()=>{ S.running=!S.running; };
UI.step.onclick      =()=>{ if(S.currentView==='2d' && S.mode==='particles') draw2D(0.05); };
UI.toggleRun3D.onclick=()=>{ S.running3D=!S.running3D; };

UI.presets.forEach(btn=>btn.addEventListener('click',()=>{
  const p=btn.dataset.preset;
  if(p==='red') setParams({lambda_nm:650,d_um:120,a_um:20,L_m:1.2,gamma:1});
  if(p==='green') setParams({lambda_nm:532,d_um:100,a_um:18,L_m:1.0,gamma:1});
  if(p==='blue') setParams({lambda_nm:450,d_um:90,a_um:16,L_m:0.9,gamma:1});
  if(p==='electron') setParams({lambda_nm:5,d_um:100,a_um:20,L_m:0.8,gamma:1});
}));

window.addEventListener('keydown',(e)=>{
  if(e.code==='Space'){ if(S.currentView==='2d') S.running=!S.running; else S.running3D=!S.running3D; e.preventDefault(); }
  else if(e.key==='r'||e.key==='R'){ UI.resetBtn.click(); }
  else if(e.key==='s'||e.key==='S'){ UI.snapBtn.click(); }
  else if(e.key==='c'||e.key==='C'){ UI.csvBtn.click(); }
  else if(e.key==='t'||e.key==='T'){ UI.themeBtn.click(); }
});

// ---------- Main loop ----------
function checked(name){return document.querySelector(`input[name="${name}"]:checked`).value;}
function loop(now){
  const dt=(now-S.last)/1000; S.last=now;

  if(S.currentView==='2d'){
    if(S.dirty2d){ compute2D(S.lambda_nm); S.dirty2d=false; }
    drawSideView(); draw2D(dt);
  }else{
    resizeGL();
    stepParticles3D(dt); // جسيمات 3D
    if(S.dirty3d){ rebuildTexture3D(); S.dirty3d=false; }
    const eye=camPos(); V=mat4LookAt(eye,[cam.target[0],cam.target[1],cam.target[2]]);
    gl.enable(gl.DEPTH_TEST); gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    // شاشة (تكستشر)
    drawTex(Q.screen, mat4Translate(0,0,1.0));
    // لوح الشقين
    drawColor(Q.slits, mat4Translate(0,0,0.0), [0.85,0.85,0.85]);
    // الشقين (أعمدة مضيئة نحيفة)
    drawColor(makeQuad(0.02,0.45), mat4Translate(-0.15,0,0.001), S.slit1?[0.2,0.85,1.0]:[0.3,0.3,0.3]);
    drawColor(makeQuad(0.02,0.45), mat4Translate(+0.15,0,0.001), S.slit2?[0.2,0.85,1.0]:[0.3,0.3,0.3]);
    // لوح المصدر (للشّكل)
    drawColor(Q.src, mat4Translate(0,0,-0.8), [0.5,0.5,0.6]);
    // محاور + مسطرة
    drawAxesAndRulers();
  }

  const inst=1/Math.max(1e-6,dt); S.fpsAcc+=inst; S.fpsCount++; if(now-S.fpsShownAt>300){ UI.fps.textContent=(S.fpsAcc/S.fpsCount).toFixed(0); S.fpsShownAt=now; S.fpsAcc=0; S.fpsCount=0; }
  requestAnimationFrame(loop);
}

// ---------- Init ----------
function init(){
  updateLabels(); showOnly2D(true);
  initGL(); initQuads(); bind3DControls();
  S.dirty2d=true; S.dirty3d=true;
  requestAnimationFrame(loop);
}
init();

function setParams(obj){
  if('lambda_nm' in obj){ S.lambda_nm=obj.lambda_nm; UI.lambda.value=obj.lambda_nm; }
  if('d_um' in obj){ S.d_um=obj.d_um; UI.d.value=obj.d_um; }
  if('a_um' in obj){ S.a_um=obj.a_um; UI.a.value=obj.a_um; }
  if('L_m' in obj){ S.L_m=obj.L_m; UI.L.value=obj.L_m; }
  if('gamma' in obj){ S.gamma=obj.gamma; UI.coh.value=obj.gamma; }
  updateLabels(); S.hits.fill(0); S.hits3D.fill(0); mark2D(); mark3D();
}

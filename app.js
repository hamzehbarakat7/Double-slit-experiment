/* ====== محاكاة الشق المزدوج — نسخة محسّنة ====== */
const els = {
  themeBtn: q('#themeBtn'),
  regime: [...document.querySelectorAll('input[name="regime"]')],
  mode:   [...document.querySelectorAll('input[name="mode"]')],
  spectrum: q('#spectrum'),
  lambda: q('#lambda'), lambdaVal: q('#lambdaVal'),
  d: q('#d'), dVal: q('#dVal'),
  a: q('#a'), aVal: q('#aVal'),
  L: q('#L'), LVal: q('#LVal'),
  coh: q('#coh'), cohVal: q('#cohVal'),
  rate: q('#rate'), rateVal: q('#rateVal'),
  quality: q('#quality'), qualityVal: q('#qualityVal'),
  slit1: q('#slit1'), slit2: q('#slit2'),
  normalize: q('#normalize'), showCurve: q('#showCurve'),
  autoSpan: q('#autoSpan'),
  resetBtn: q('#resetBtn'), snapBtn: q('#snapBtn'), csvBtn: q('#csvBtn'),
  toggleRun: q('#toggleRun'), step: q('#step'),
  fps: q('#fps'),
  sideView: q('#sideView'), screen: q('#screen'),
  presets: [...document.querySelectorAll('[data-preset]')],
};
const ctxSide = els.sideView.getContext('2d');
const ctxScreen = els.screen.getContext('2d', { willReadFrequently: true });

const state = {
  W: els.screen.width, H: els.screen.height,
  lambda_nm: +els.lambda.value,
  d_um: +els.d.value,
  a_um: +els.a.value,
  L_m: +els.L.value,
  gamma: +els.coh.value,
  particleRate: +els.rate.value,
  quality: +els.quality.value,  // عينات/شق لحساب فرينل
  slit1: true, slit2: true,
  normalize: true,
  showCurve: true,
  autoSpan: true,
  regime: 'fraunhofer',
  mode: 'wave',
  spectrum: false,
  // بيانات حسابية
  intensity: new Float32Array(els.screen.width),
  hits: new Uint32Array(els.screen.width),
  cdf: new Float32Array(els.screen.width),
  // مدى العرض الفعلي ±Xmax (متر) — يتغير تلقائياً عند autoSpan
  Xmax: 0.03,
  running: false,
  dirty: true,
  fpsAcc: 0, fpsCount: 0, fpsShownAt: 0,
  last: performance.now(),
  imgWave: ctxScreen.createImageData(els.screen.width, els.screen.height),
};

// أدوات
function q(s){ return document.querySelector(s); }
function lerp(a,b,t){ return a+(b-a)*t; }
function clamp(x,a,b){ return Math.max(a, Math.min(b,x)); }
function sinc(x){ return x===0?1:Math.sin(x)/x; }
const TAU = Math.PI*2;

// تحويل طول موجي إلى RGB تقريبي (380–700 nm)
function wavelengthToRGB(nm){
  let R=0,G=0,B=0, a=1;
  const w = nm;
  if (w>=380 && w<440){ R=-(w-440)/(440-380); G=0; B=1; }
  else if (w<490){ R=0; G=(w-440)/(490-440); B=1; }
  else if (w<510){ R=0; G=1; B=-(w-510)/(510-490); }
  else if (w<580){ R=(w-510)/(580-510); G=1; B=0; }
  else if (w<645){ R=1; G=-(w-645)/(645-580); B=0; }
  else if (w<=700){ R=1; G=0; B=0; }
  if (w<420) a = 0.3 + 0.7*(w-380)/(420-380);
  else if (w>645) a = 0.3 + 0.7*(700-w)/(700-645);
  return [Math.round(R*255), Math.round(G*255), Math.round(B*255), a];
}

// تقدير تلقائي لـ Xmax لضمان رؤية عدة هدبات مركزية
function autoSpan(){
  const lambda = state.lambda_nm*1e-9;
  const d = Math.max(1e-12, state.d_um*1e-6);
  const L = Math.max(1e-6, state.L_m);
  // المسافة بين هدبتين مضيئتين مجاورتين تقريبًا: Δx ≈ λL/d
  const fringe = lambda*L/d;
  state.Xmax = clamp(fringe*6, 0.005, 0.08); // اعرض ~6 هدبات على الجانبين
}

// حساب الشدة — فرينهوفر (بعيد)
function computeFraunhofer(lambda_nm){
  const W=state.W, H=state.H; const lambda=lambda_nm*1e-9;
  const d=state.d_um*1e-6, a=state.a_um*1e-6, L=state.L_m, gamma=state.gamma;
  const s1=state.slit1?1:0, s2=state.slit2?1:0;
  const Xmax=state.Xmax;
  let Imax=0;

  for(let i=0;i<W;i++){
    const x=lerp(-Xmax,Xmax,i/(W-1));
    const beta = Math.PI*a*x/(lambda*L);
    const env = Math.pow(sinc(beta),2);
    let I=0;
    if((s1^s2)===1){
      I = env;
    }else if(s1===0 && s2===0){
      I = 0;
    }else{
      const dphi = TAU*d*x/(lambda*L);
      I = env*(1 + gamma*Math.cos(dphi));
    }
    state.intensity[i]=I;
    if(I>Imax) Imax=I;
  }
  if(state.normalize && Imax>0) for(let i=0;i<W;i++) state.intensity[i]/=Imax;
}

// حساب الشدة — فرينل (قريب) عبر تكامل عددي على عرض كل شق
function computeFresnel(lambda_nm){
  const W=state.W; const lambda=lambda_nm*1e-9;
  const d=state.d_um*1e-6, a=state.a_um*1e-6, L=state.L_m, gamma=state.gamma;
  const s1=state.slit1, s2=state.slit2;
  const Xmax=state.Xmax;
  const k=TAU/lambda;
  const Ns = Math.max(16, state.quality|0); // عينات/شق
  // مواضع مركزَي الشقين (محور y عمودي على الشق)
  const y1c = -d/2, y2c = +d/2;
  const dy = a/Ns;

  let Imax=0;
  for(let ix=0;ix<W;ix++){
    const x=lerp(-Xmax,Xmax,ix/(W-1));
    let E1r=0,E1i=0,E2r=0,E2i=0;

    if(s1){
      for(let j=0;j<Ns;j++){
        const y=y1c + (j+0.5)*dy;
        const r=Math.hypot(L, x - 0); // نُهمل انحراف y نحو الشاشة (شق رأسي)
        const phase = k*Math.sqrt( (x-0)**2 + L*L + 0 ); // تقريب r
        E1r += Math.cos(phase)/r;
        E1i += Math.sin(phase)/r;
      }
    }
    if(s2){
      for(let j=0;j<Ns;j++){
        const y=y2c + (j+0.5)*dy;
        const r=Math.hypot(L, x - 0);
        const phase = k*Math.sqrt( (x-0)**2 + L*L + 0 );
        E2r += Math.cos(phase)/r;
        E2i += Math.sin(phase)/r;
      }
    }

    // شدتان منفصلتان + مصطلح تداخل بمُعامِل التماسك γ
    const I1 = E1r*E1r + E1i*E1i;
    const I2 = E2r*E2r + E2i*E2i;
    const cross = 2*state.gamma*(E1r*E2r + E1i*E2i);
    const I = I1 + I2 + cross;

    state.intensity[ix]=I;
    if(I>Imax) Imax=I;
  }
  if(state.normalize && Imax>0) for(let i=0;i<W;i++) state.intensity[i]/=Imax;
}

// بناء CDF للجسيمات
function rebuildCDF(){
  const W=state.W; let sum=0;
  for(let i=0;i<W;i++) sum += state.intensity[i];
  let acc=0;
  for(let i=0;i<W;i++){ acc += (sum>0? state.intensity[i]/sum : 0); state.cdf[i]=acc; }
}

// رسم المنظر الجانبي
function drawSideView(){
  const w=els.sideView.width, h=els.sideView.height;
  const c=ctxSide;
  c.clearRect(0,0,w,h);
  c.fillStyle = getVar('--grid'); for(let y=0;y<h;y+=20) c.fillRect(0,y,w,1); for(let x=0;x<w;x+=20) c.fillRect(x,0,1,h);

  const slitX=80, screenX=w-60; const centerY=h/2;
  const Lpx = screenX-slitX;

  const d_px = (state.d_um*1e-6) * (Lpx / state.L_m) * 100;
  const a_px = Math.max(6, (state.a_um*1e-6) * (Lpx / state.L_m) * 300);

  c.fillStyle = '#fff'; c.fillRect(slitX-3,0,6,h);
  c.fillStyle = '#10d4';
  if(state.slit1) c.fillRect(slitX-6, centerY - d_px/2 - a_px/2, 12, a_px);
  if(state.slit2) c.fillRect(slitX-6, centerY + d_px/2 - a_px/2, 12, a_px);

  c.fillStyle = '#ddd'; c.fillRect(screenX-4,0,8,h);

  c.strokeStyle = '#68c1ff'; c.lineWidth=2; c.beginPath(); c.moveTo(slitX,h-20); c.lineTo(screenX,h-20); c.stroke();
  c.fillStyle = '#68c1ff'; c.font='12px system-ui';
  c.fillText(`L = ${state.L_m.toFixed(2)} m`, slitX+10, h-24);
}

// رسم شاشة الرصد
function drawScreen(dt){
  const W=state.W, H=state.H, c=ctxScreen;
  // خلفية
  c.fillStyle = getVar('--grid'); c.fillRect(0,0,W,H);

  if(state.mode==='wave'){
    // موجي: تلوين حسب λ أو طيف RGB
    if(state.spectrum){
      // ثلاث موجات (450/550/650 nm) — تجميع ألوان
      const nmArr = [450,550,650];
      const img = state.imgWave; img.data.fill(0);
      for(const nm of nmArr){
        computeIntensityOnce(nm);
        const [r,g,b,a]=wavelengthToRGB(nm);
        for(let x=0;x<W;x++){
          const val = Math.floor(255*clamp(state.intensity[x],0,1)*a);
          for(let y=0;y<H;y++){
            const p=(y*W + x)*4;
            img.data[p]   = clamp(img.data[p]   + Math.floor(r*val/255),0,255);
            img.data[p+1] = clamp(img.data[p+1] + Math.floor(g*val/255),0,255);
            img.data[p+2] = clamp(img.data[p+2] + Math.floor(b*val/255),0,255);
            img.data[p+3] = 255;
          }
        }
      }
      c.putImageData(img,0,0);
    } else {
      // لون مفرد حسب λ الحالي
      computeIntensityOnce(state.lambda_nm);
      const [r,g,b,a]=wavelengthToRGB(state.lambda_nm);
      const img = state.imgWave; img.data.fill(0);
      for(let x=0;x<W;x++){
        const val = Math.floor(255*clamp(state.intensity[x],0,1)*a);
        for(let y=0;y<H;y++){
          const p=(y*W + x)*4;
          img.data[p]   = r? val : 0;
          img.data[p+1] = g? val : 0;
          img.data[p+2] = b? val : 0;
          img.data[p+3] = 255;
        }
      }
      c.putImageData(img,0,0);
    }

    if(state.showCurve){
      c.lineWidth=2; c.strokeStyle='rgba(104,193,255,0.95)';
      c.beginPath();
      for(let x=0;x<W;x++){
        const I=state.intensity[x]; const y = H - 8 - I*(H-16);
        if(x===0) c.moveTo(x,y); else c.lineTo(x,y);
      }
      c.stroke();
    }
  } else {
    // جسيمات
    const particles = Math.floor(state.running ? state.particleRate*dt : 0);
    if(particles>0) {
      for(let k=0;k<particles;k++){
        const u=Math.random(); let lo=0, hi=W-1;
        while(lo<hi){ const mid=(lo+hi)>>1; (state.cdf[mid]>=u)? (hi=mid):(lo=mid+1); }
        state.hits[lo] = Math.min(0xffffffff, state.hits[lo]+1);
      }
    }
    // ارسم الأعمدة
    let hmax=0; for(let x=0;x<W;x++) if(state.hits[x]>hmax) hmax=state.hits[x];
    if(hmax>0){
      for(let x=0;x<W;x++){
        const ratio=state.hits[x]/hmax;
        const col=Math.floor(255*ratio);
        c.strokeStyle=`rgba(${col},${col},${col},1)`;
        const yTop= H - 6 - Math.floor((H-12)*ratio);
        c.beginPath(); c.moveTo(x,H-6); c.lineTo(x,yTop); c.stroke();
      }
    }
    if(state.showCurve){
      c.lineWidth=2; c.strokeStyle='rgba(104,193,255,0.85)';
      c.beginPath();
      for(let x=0;x<W;x++){
        const I=state.intensity[x]; const y=H-8-I*(H-16);
        if(x===0) c.moveTo(x,y); else c.lineTo(x,y);
      }
      c.stroke();
    }
  }

  // إطار
  c.strokeStyle='rgba(255,255,255,0.15)'; c.strokeRect(0.5,0.5,W-1,H-1);
}

// حساب الشدة مرة واحدة (يحترم الخيار الفيزيائي + يطبق التطبيع/المجال/…)
function computeIntensityOnce(lambda_nm){
  if(state.autoSpan) autoSpan();
  if(state.regime==='fraunhofer') computeFraunhofer(lambda_nm);
  else computeFresnel(lambda_nm);
  rebuildCDF();
}

// إدارة العلم القذر (dirty) — أعد الحساب فقط عند تغيّر المعلمات
function markDirty(){ state.dirty=true; }

// حلقة التشغيل
function loop(now){
  const dt=(now-state.last)/1000; state.last=now;

  if(state.dirty){
    computeIntensityOnce(state.lambda_nm);
    state.dirty=false;
  }

  drawSideView();
  drawScreen(dt);

  // FPS
  const instFPS = 1/Math.max(1e-6, dt);
  state.fpsAcc += instFPS; state.fpsCount++;
  if(now - state.fpsShownAt > 300){
    els.fps.textContent = (state.fpsAcc/state.fpsCount).toFixed(0);
    state.fpsShownAt = now; state.fpsAcc = 0; state.fpsCount = 0;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// أحداث واجهة
els.themeBtn.onclick=()=>{ document.body.classList.toggle('theme-light'); document.body.classList.toggle('theme-dark'); };
els.regime.forEach(r=>r.addEventListener('change', ()=>{ state.regime = checked('regime'); markDirty(); }));
els.mode.forEach(r=>r.addEventListener('change', ()=>{ state.mode = checked('mode'); }));
els.spectrum.onchange = ()=>{ state.spectrum = els.spectrum.checked; markDirty(); };

els.lambda.oninput=()=>{ state.lambda_nm=+els.lambda.value; els.lambdaVal.textContent=state.lambda_nm|0; markDirty(); };
els.d.oninput=()=>{ state.d_um=+els.d.value; els.dVal.textContent=state.d_um|0; markDirty(); };
els.a.oninput=()=>{ state.a_um=+els.a.value; els.aVal.textContent=state.a_um|0; markDirty(); };
els.L.oninput=()=>{ state.L_m=+els.L.value; els.LVal.textContent=state.L_m.toFixed(2); markDirty(); };
els.coh.oninput=()=>{ state.gamma=+els.coh.value; els.cohVal.textContent=state.gamma.toFixed(2); markDirty(); };
els.rate.oninput=()=>{ state.particleRate=+els.rate.value; els.rateVal.textContent=state.particleRate|0; };
els.quality.oninput=()=>{ state.quality=+els.quality.value; els.qualityVal.textContent=state.quality|0; markDirty(); };

els.slit1.onchange=()=>{ state.slit1=els.slit1.checked; resetHits(); markDirty(); };
els.slit2.onchange=()=>{ state.slit2=els.slit2.checked; resetHits(); markDirty(); };
els.normalize.onchange=()=>{ state.normalize=els.normalize.checked; markDirty(); };
els.showCurve.onchange=()=>{ state.showCurve=els.showCurve.checked; };
els.autoSpan.onchange=()=>{ state.autoSpan=els.autoSpan.checked; markDirty(); };

els.resetBtn.onclick=()=>{ resetHits(); };
els.snapBtn.onclick=savePNG;
els.csvBtn.onclick=exportCSV;
els.toggleRun.onclick=()=>{ state.running=!state.running; };
els.step.onclick=()=>{ if(state.mode==='particles'){ // 50ms دفعة
  drawScreen(0.05);
}};

els.presets.forEach(btn=>btn.addEventListener('click', ()=>{
  const p=btn.dataset.preset;
  if(p==='red'){ setParams({lambda_nm:650, d_um:120, a_um:20, L_m:1.2, gamma:1}); }
  if(p==='green'){ setParams({lambda_nm:532, d_um:100, a_um:18, L_m:1.0, gamma:1}); }
  if(p==='blue'){ setParams({lambda_nm:450, d_um:90, a_um:16, L_m:0.9, gamma:1}); }
  if(p==='electron'){ // إلكترونات (تمثيليًا: طول موجي دي برولي صغير ⇒ هدبات متقاربة)
    setParams({lambda_nm:5, d_um:100, a_um:20, L_m:0.8, gamma:1}); // 5 nm (تعليمي)
  }
}));

// لوحة المفاتيح: Space/R/S/C/T
window.addEventListener('keydown',(e)=>{
  if(e.code==='Space'){ state.running=!state.running; e.preventDefault(); }
  else if(e.key==='r' || e.key==='R'){ resetHits(); }
  else if(e.key==='s' || e.key==='S'){ savePNG(); }
  else if(e.key==='c' || e.key==='C'){ exportCSV(); }
  else if(e.key==='t' || e.key==='T'){ els.themeBtn.click(); }
});

// تهيئة
updateLabels(); markDirty();

// ======= توابع مساعدة =======
function updateLabels(){
  els.lambdaVal.textContent=state.lambda_nm|0;
  els.dVal.textContent=state.d_um|0;
  els.aVal.textContent=state.a_um|0;
  els.LVal.textContent=state.L_m.toFixed(2);
  els.cohVal.textContent=state.gamma.toFixed(2);
  els.rateVal.textContent=state.particleRate|0;
  els.qualityVal.textContent=state.quality|0;
}
function checked(name){ return document.querySelector(`input[name="${name}"]:checked`).value; }
function getVar(name){ return getComputedStyle(document.body).getPropertyValue(name); }

function resetHits(){
  state.hits.fill(0);
}

function setParams(obj){
  // حدّث الحالة والـ UI معًا
  if('lambda_nm' in obj){ state.lambda_nm=obj.lambda_nm; els.lambda.value=obj.lambda_nm; }
  if('d_um' in obj){ state.d_um=obj.d_um; els.d.value=obj.d_um; }
  if('a_um' in obj){ state.a_um=obj.a_um; els.a.value=obj.a_um; }
  if('L_m' in obj){ state.L_m=obj.L_m; els.L.value=obj.L_m; }
  if('gamma' in obj){ state.gamma=obj.gamma; els.coh.value=obj.gamma; }
  updateLabels(); resetHits(); markDirty();
}

function savePNG(){
  const W = els.sideView.width + 16 + els.screen.width;
  const H = Math.max(els.sideView.height, els.screen.height);
  const tmp = document.createElement('canvas'); tmp.width=W; tmp.height=H;
  const c = tmp.getContext('2d'); c.fillStyle=getVar('--bg'); c.fillRect(0,0,W,H);
  c.drawImage(els.sideView,0,0); c.drawImage(els.screen,els.sideView.width+16,0);
  const a=document.createElement('a'); a.href=tmp.toDataURL('image/png'); a.download='double-slit-enhanced.png'; a.click();
}

function exportCSV(){
  const W=state.W, H=state.H, Xmax=state.Xmax;
  let csv='x_m,intensity,hits\n';
  for(let i=0;i<W;i++){
    const x=lerp(-Xmax,Xmax,i/(W-1));
    csv += `${x},${state.intensity[i]},${state.hits[i]}\n`;
  }
  const blob=new Blob([csv],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='double-slit-data.csv'; a.click();
  URL.revokeObjectURL(url);
}

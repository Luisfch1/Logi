
function $(id){ return document.getElementById(id); }



/* ===========================
   DOCX Sanitizer (JSZip)
   - Evita corrupción en Word cuando hay IDs repetidos en imágenes.
   - Si JSZip no está disponible, retorna el DOCX tal cual.
=========================== */
async function sanitizeDocxPackageArrayBuffer(ab){
  try{
    if (!window.JSZip) return ab;
    const zip = await JSZip.loadAsync(ab);

    const xmlPaths = Object.keys(zip.files)
      .filter(p => /^word\/(document|header\d+|footer\d+)\.xml$/i.test(p))
      .sort((a,b)=>a.localeCompare(b));

    let docPrCounter = 0;
    let picCounter = 0;

    for (const p of xmlPaths){
      let x = await zip.file(p).async("string");

      // Quitar bookmarks (pueden duplicarse)
      x = x
        .replace(/<w:bookmarkStart[^>]*?\/?>/g, "")
        .replace(/<w:bookmarkEnd[^>]*?\/?>/g, "");

      // Renumerar wp:docPr id (Word exige unicidad global)
      x = x.replace(/<wp:docPr([^>]*?)id="(\d+)"([^>]*?)(\/?)>/g, (m,a1,_old,a2,selfClose)=>{
        const newId = String(++docPrCounter);
        let attrs = `${a1}id="${newId}"${a2}`;
        attrs = attrs.replace(/name="(Imagen|Image|Picture)\s+\d+"/g, (_mm, kind) => `name="${kind} ${newId}"`);
        return `<wp:docPr${attrs}${selfClose}>`;
      });

      // Renumerar pic:cNvPr id (Word también exige unicidad)
      x = x.replace(/<pic:cNvPr([^>]*?)id="(\d+)"([^>]*?)(\/?)>/g, (m,a1,_old,a2,selfClose)=>{
        const newId = String(++picCounter);
        let attrs = `${a1}id="${newId}"${a2}`;
        attrs = attrs.replace(/name="(Picture|Image)\s+\d+"/g, (_mm, kind) => `name="${kind} ${newId}"`);
        return `<pic:cNvPr${attrs}${selfClose}>`;
      });

      zip.file(p, x);
    }

    return await zip.generateAsync({ type: "arraybuffer" });
  }catch(e){
    try{ console.warn("sanitizeDocxPackageArrayBuffer failed:", e); }catch{}
    return ab;
  }
}


/* ===========================
   🎙️ Dictado por voz (Web Speech API)
   - Funciona en Chrome/Android (webkitSpeechRecognition).
   - Requiere HTTPS para pedir micrófono.
   - Si no está disponible, usa el mic del teclado.
=========================== */
const _SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;

const dictation = {
  rec: null,
  active: false,
  btn: null,
  target: null,
  baseText: "",
  finalText: ""
};

function setDictateStatus(msg){
  const el = $("dictateStatus");
  if (el) el.textContent = msg || "—";
}

function stopDictation(){
  try { dictation.rec && dictation.rec.stop(); } catch {}
  dictation.active = false;
  dictation.rec = null;

  if (dictation.btn){
    dictation.btn.textContent = "🎙️";
    dictation.btn.classList.remove("btn-danger");
    dictation.btn.classList.add("btn-secondary");
  }
  setDictateStatus("—");
  dictation.btn = null;
  dictation.target = null;
  dictation.baseText = "";
  dictation.finalText = "";
}

function startDictation(targetEl, btnEl){
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);

  // iOS PWA/Safari: Web Speech dictation suele fallar o no estar disponible.
  if (isIOS){
    // iOS no soporta de forma confiable Web Speech API.
    // Aun así, intentamos disparar el prompt de permisos de micrófono (si aplica)
    // para que el usuario no quede bloqueado por permisos, y enfocamos el input
    // para que use el dictado nativo del teclado.
    try{
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(stream => { try{ stream.getTracks().forEach(t => t.stop()); }catch{} })
          .catch(() => {});
      }
    }catch{}
    try{ if (targetEl) targetEl.focus(); }catch{}
    setDictateStatus("ℹ️ En iPhone: usa el mic del teclado (dictado de iOS).");
    return;
  }

  if (!_SpeechRec){
    try{ if (targetEl) targetEl.focus(); }catch{}
    alert("Dictado por voz no disponible en este navegador.\n\nTip: usa el micrófono del teclado para dictar.");
    return;
  }
  if (!targetEl) return;

  // Si ya estaba dictando, detener
  if (dictation.active) {
    stopDictation();
    return;
  }

  const rec = new _SpeechRec();
  rec.lang = "es-CO";
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  // Preparar estado (sin marcar como 'activo' hasta que realmente arranque)
  dictation.rec = rec;
  dictation.btn = btnEl || null;
  dictation.target = targetEl;
  dictation.baseText = (targetEl.value || "").trimEnd();
  dictation.finalText = "";
  setDictateStatus("🎙️ Preparando…");

  if (dictation.btn){
    dictation.btn.textContent = "⏳";
    dictation.btn.classList.remove("btn-danger");
    dictation.btn.classList.add("btn-secondary");
  }

  let started = false;
  const startTimeout = setTimeout(() => {
    if (!started){
      // En algunos navegadores no lanza error, solo no arranca.
      stopDictation();
      setDictateStatus("⚠️ No se pudo iniciar el dictado. Tip: usa el mic del teclado.");
    }
  }, 900);

  rec.onstart = () => {
    started = true;
    clearTimeout(startTimeout);
    dictation.active = true;
    if (dictation.btn){
      dictation.btn.textContent = "⏹️";
      dictation.btn.classList.remove("btn-secondary");
      dictation.btn.classList.add("btn-danger");
    }
    setDictateStatus("🎙️ Dictando…");
  };

  rec.onresult = (event) => {
    const finals = [];
    const interims = [];

    for (let i = 0; i < event.results.length; i++){
      const res = event.results[i];
      const t = (res[0]?.transcript || "").trim();
      if (!t) continue;
      if (res.isFinal) finals.push(t);
      else interims.push(t);
    }

    const base = dictation.baseText ? (dictation.baseText.trimEnd() + " " ) : "";
    const composed = (base + [...finals, ...interims].join(" "))
      .replace(/\s+/g, " " )
      .trim();

    targetEl.value = composed;
    try { targetEl.setSelectionRange(targetEl.value.length, targetEl.value.length); } catch {}
    try { targetEl.dispatchEvent(new Event("input", { bubbles: true })); } catch {}
  };

  rec.onerror = (e) => {
    clearTimeout(startTimeout);
    setDictateStatus("⚠️ Dictado detenido (" + (e?.error || "error") + ")");
    stopDictation();
  };
  rec.onend = () => {
    clearTimeout(startTimeout);
    if (dictation.active) stopDictation();
  };

  try { rec.start(); }
  catch (err){
    clearTimeout(startTimeout);
    stopDictation();
    setDictateStatus("⚠️ No se pudo iniciar el dictado.");
  }
}


function applyTheme(theme){
  const t = (theme === "light") ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
  try{ localStorage.setItem(THEME_KEY, t); }catch{}
}

function syncThemeUI(){
  const t = localStorage.getItem(THEME_KEY) || "dark";
  const btn = $("btnThemeToggle");
  if (btn) btn.textContent = (t === "light") ? "☀️" : "🌙";
}

function toggleTheme(){
  const cur = localStorage.getItem(THEME_KEY) || "dark";
  applyTheme(cur === "dark" ? "light" : "dark");
  syncThemeUI();
}

function initTheme(){
  const saved = localStorage.getItem(THEME_KEY) || "dark";
  applyTheme(saved);
  syncThemeUI();
}


/* ===========================
   Service Worker (PWA) — Auto update (modo seguro)
   - Descarga updates sola
   - Se aplica al reiniciar (sin recargar en caliente)
=========================== */

async function checkForSWUpdate(){
  try{
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
  }catch{}
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try{
      await navigator.serviceWorker.register("./sw.js");
      // Revisión inmediata
      await checkForSWUpdate();
      // Revisión periódica (cada 60 min) mientras la app esté abierta
      setInterval(checkForSWUpdate, 60 * 60 * 1000);
    }catch(e){}
  });
}

// Si existe el botón (por compatibilidad), lo dejamos como “revisar update”, sin forzar recarga.
(() => {
  const btn = $("btnUpdateNow");
  if (btn) btn.onclick = checkForSWUpdate;
})();

/* ===========================
   ⚙️ Bottom sheet (config)
=========================== */

async function updateStorageUI(){
  const label = $("storageLabel");
  const fill  = $("storageFill");
  const hint  = $("storageHint");
  if (!label) return;

  // Estimación de cuota (depende del navegador/dispositivo)
  if (!(navigator.storage && navigator.storage.estimate)){
    label.textContent = "No disponible en este dispositivo.";
    if (hint) hint.textContent = "—";
    if (fill) fill.style.width = "0%";
    return;
  }

  try{
    const { usage, quota } = await navigator.storage.estimate();
    if (!quota){
      label.textContent = "No disponible en este dispositivo.";
      if (hint) hint.textContent = "—";
      if (fill) fill.style.width = "0%";
      return;
    }

    const usedMB  = (usage || 0) / (1024*1024);
    const quotaMB = quota / (1024*1024);
    const pct = quota ? Math.min(100, Math.max(0, (usage / quota) * 100)) : 0;

    label.textContent = `Usado ${usedMB.toFixed(1)} MB / ${quotaMB.toFixed(1)} MB (${pct.toFixed(0)}%)`;
    if (fill) fill.style.width = pct.toFixed(1) + "%";

    let msg = "Todo bien.";
    if (pct >= 95) msg = "⚠️ Muy lleno. Recomendado: hacer backup y borrar fotos viejas.";
    else if (pct >= 85) msg = "⚠️ Cerca del límite. Recomendado: hacer backup.";
    else if (pct >= 70) msg = "Sugerencia: haz backup periódicamente para evitar quedarte sin espacio.";

    if (hint) hint.textContent = msg;
  }catch(e){
    label.textContent = "No se pudo leer el almacenamiento.";
    if (hint) hint.textContent = "—";
    if (fill) fill.style.width = "0%";
  }
}

function openSheet(){
  $("sheetBackdrop").classList.add("open");
  $("sheet").classList.add("open");
  $("sheetBackdrop").setAttribute("aria-hidden","false");
  // Si había puntico de update, lo dejamos (es info útil). No lo quitamos.
  syncThemeUI();
  syncAccentUI();
  syncUpdateLabel();
  updateStorageUI();
}
function closeSheet(){
  $("sheet").classList.remove("open");
  // esperar transición
  setTimeout(() => {
    $("sheetBackdrop").classList.remove("open");
    $("sheetBackdrop").setAttribute("aria-hidden","true");
  }, 220);
}

$("btnSettings").onclick = openSheet;
$("btnSheetClose").onclick = closeSheet;
$("btnStorageRefresh").onclick = updateStorageUI;

$("sheetBackdrop").addEventListener("click", (e)=>{ if (e.target.id === "sheetBackdrop") closeSheet(); });

/* Gestos: arrastrar hacia abajo */
(function sheetGestures(){
  const sheet = $("sheet");
  let startY = 0;
  let curY = 0;
  let dragging = false;

  function onStart(e){
    const t = e.touches ? e.touches[0] : e;
    startY = t.clientY;
    curY = 0;
    dragging = true;
    sheet.style.transition = "none";
  }
  function onMove(e){
    if (!dragging) return;
    const t = e.touches ? e.touches[0] : e;
    const dy = t.clientY - startY;
    curY = Math.max(0, dy);
    sheet.style.transform = `translateY(${curY}px)`;
  }
  function onEnd(){
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = "transform .22s ease";
    if (curY > 120){
      sheet.style.transform = "translateY(110%)";
      closeSheet();
    } else {
      sheet.style.transform = "translateY(0)";
    }
  }

  $("sheetHandle").addEventListener("touchstart", onStart, { passive:true });
  $("sheetHandle").addEventListener("touchmove", onMove, { passive:true });
  $("sheetHandle").addEventListener("touchend", onEnd);

  sheet.addEventListener("touchstart", (e)=>{
    // Solo permitir gesto si el scroll está arriba (evita pelear con el scroll del contenido)
    if (sheet.scrollTop && sheet.scrollTop > 0) return;
    if (e.target.closest(".sheetBody")) return;
    onStart(e);
  }, { passive:true });
  sheet.addEventListener("touchmove", onMove, { passive:true });
  sheet.addEventListener("touchend", onEnd);
})();

/* ===========================
   🎨 Acento (por dispositivo)
=========================== */
// Keys de configuración (localStorage)
// Nota: THEME_KEY era usado en varias partes pero no estaba definido.
const THEME_KEY  = "logi_theme";
const ACCENT_KEY = "logi_accent";

const PROJECT_KEY = "logi_project";
const TEMPLATE_KEY = "logi_template";

const ACCENTS = [
  { key:"blue",   name:"Azul",   hex:"#3b82f6", hex2:"#60a5fa", rgb:"59,130,246" },
  { key:"teal",   name:"Teal",   hex:"#14b8a6", hex2:"#2dd4bf", rgb:"20,184,166" },
  { key:"green",  name:"Verde",  hex:"#22c55e", hex2:"#4ade80", rgb:"34,197,94" },
  { key:"purple", name:"Morado", hex:"#8b5cf6", hex2:"#a78bfa", rgb:"139,92,246" },
  { key:"orange", name:"Naranja",hex:"#f97316", hex2:"#fb923c", rgb:"249,115,22" },
  { key:"rose",   name:"Rosa",   hex:"#f43f5e", hex2:"#fb7185", rgb:"244,63,94" }
];

function applyAccent(key){
  const chosen = ACCENTS.find(a => a.key === key) || ACCENTS[0];
  localStorage.setItem(ACCENT_KEY, chosen.key);
  document.documentElement.style.setProperty("--accent", chosen.hex);
  document.documentElement.style.setProperty("--accent2", chosen.hex2);
  document.documentElement.style.setProperty("--accent-rgb", chosen.rgb);
  syncAccentUI();
}

function syncAccentUI(){
  const key = localStorage.getItem(ACCENT_KEY) || "blue";
  const dots = document.querySelectorAll(".accentDot");
  dots.forEach(d => d.classList.toggle("active", d.dataset.accent === key));
}

function initAccent(){
  const key = localStorage.getItem(ACCENT_KEY) || "blue";
  const pal = $("accentPalette");
  if (pal){
    pal.innerHTML = "";
    for (const a of ACCENTS){
      const dot = document.createElement("div");
      dot.className = "accentDot";
      dot.dataset.accent = a.key;
      dot.title = a.name;
      dot.style.background = a.hex;
      dot.onclick = () => applyAccent(a.key);
      pal.appendChild(dot);
    }
  }
  applyAccent(key);
}

/* ===========================
   Actualizar app (config)
=========================== */
function syncUpdateLabel(){
  const ul = $("updateLabel");
  if (!ul) return;
  if (waitingSW) ul.textContent = "✅ Hay una actualización lista";
  else ul.textContent = "Buscar / instalar actualización";
}
$("btnUpdateFromSheet").onclick = async () => {
  await triggerSWUpdate();
  // Feedback suave
  if (!waitingSW) $("updateLabel").textContent = "🔎 Revisando…";
  setTimeout(syncUpdateLabel, 1200);
};

$("btnThemeToggle").onclick = toggleTheme;

/* ===========================
   🧰 Reiniciar caché (NO borra fotos)
=========================== */
async function repairApp(){
  try{
    if ("serviceWorker" in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (window.caches){
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  }catch{}
  const base = location.origin + location.pathname;
  location.replace(base + "?r=" + Date.now());
}
$("btnResetCache").onclick = repairApp;
/* ===========================
   💾 Backup / Restore (ZIP) — NO requiere extraer manualmente
   - Incluye fotos + metadata + (opcional) logo + settings
   - Restore "mezcla": no borra lo existente, y evita duplicados por id
=========================== */
function isoNowSafe(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  return `${y}${m}${dd}_${hh}${mm}`;
}

async function dataUrlToBlob(dataUrl){
  const res = await fetch(dataUrl);
  return await res.blob();
}

// ===========================
// Robustez: blobs/miniaturas
// ===========================
// Cuando algún registro queda sin blob válido (por error de almacenamiento, permisos, etc.),
// una sola foto puede tumbar toda la Galería al hacer URL.createObjectURL().
// Esto normaliza el blob o entrega un placeholder sin romper el render.

const MISSING_THUMB_DATAURL = (() => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="rgba(255,255,255,0.08)"/>
        <stop offset="1" stop-color="rgba(0,0,0,0.25)"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="480" height="360" rx="28" fill="url(#g)" />
    <text x="50%" y="45%" text-anchor="middle" font-size="24" fill="rgba(255,255,255,0.8)" font-family="system-ui, -apple-system, Segoe UI, Roboto">SIN ARCHIVO</text>
    <text x="50%" y="58%" text-anchor="middle" font-size="16" fill="rgba(255,255,255,0.55)" font-family="system-ui, -apple-system, Segoe UI, Roboto">(revisar backup / borrar)</text>
  </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
})();

function normalizePhotoBlob(it){
  if (!it) return null;
  const b = it.blob;
  if (b instanceof Blob) return b;

  // ArrayBuffer / TypedArray
  if (b instanceof ArrayBuffer) return new Blob([b], { type: it.mime || "image/jpeg" });
  if (ArrayBuffer.isView(b)) return new Blob([b], { type: it.mime || "image/jpeg" });

  // Objeto serializado { data, type }
  if (b && typeof b === "object"){
    const data = b.data ?? b.bytes ?? b.buffer;
    const type = b.type || it.mime || "image/jpeg";
    if (data instanceof ArrayBuffer) return new Blob([data], { type });
    if (ArrayBuffer.isView(data)) return new Blob([data], { type });
  }

  // DataURL
  if (typeof b === "string" && b.startsWith("data:")){
    // dataUrlToBlob es async; acá preferimos fallback sync al placeholder.
    return null;
  }

  return null;
}

function safeObjectUrlFromBlob(blob){
  try{
    return trackUrl(URL.createObjectURL(blob));
  }catch(e){
    console.warn("[Logi] createObjectURL falló", e);
    return null;
  }
}

function getThumbSrc(it){
  const nb = normalizePhotoBlob(it);
  if (!nb) return { src: MISSING_THUMB_DATAURL, missing: true };
  const src = safeObjectUrlFromBlob(nb);
  if (!src) return { src: MISSING_THUMB_DATAURL, missing: true };
  return { src, missing: false };
}

function extFromMime(m){
  if (!m) return "bin";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  return "bin";
}

async function createBackupZip(){
  if (!window.JSZip){
    alert("JSZip no está disponible. Abre la app con internet (una vez) y prueba de nuevo.");
    return;
  }

  $("backupStatus").textContent = "Preparando backup…";
  const allItems = await dbGetAll();
  const activeId = getActiveProjectId() || ensureProjects().activeId;
  const { projects } = ensureProjects();
  const firstId = projects[0]?.id || activeId;
  const items = allItems.filter(it => (it.projectId ? it.projectId === activeId : activeId === firstId));

  // Catálogo y archivo fuente (xlsx/csv) del proyecto activo
  const catRows = await catGetByProject(activeId);
  const srcRec = await srcGet(activeId);

  const settings = {
    theme: localStorage.getItem(THEME_KEY) || "dark",
    accent: localStorage.getItem(ACCENT_KEY) || "blue",
    project: (getActiveProject() ? getActiveProject().name : getProjectDefault()),
    template: getTemplateId(),
    docxFit: localStorage.getItem("logi_docx_fit") || "stretch",
    logoEnabled: localStorage.getItem("logi_logo_enabled") === "1",
    logoCorner: localStorage.getItem("logi_logo_corner") || "br",
  };

  const backup = {
    schemaVersion: 3,
    app: "Logi",
    createdAt: new Date().toISOString(),
    settings,
    projectId: activeId,
    projectName: (projects.find(p => p.id === activeId)?.name) || "",
    // Catálogo parseado (fallback). La fuente real es itemsSource.
    catalog: (catRows || []).map(r => ({ item: r.item||"", descripcion: r.descripcion||"", unidad: r.unidad||"", createdAt: r.createdAt||Date.now() })),
    // Archivo fuente EXACTO (xlsx/csv) que el usuario cargó para este proyecto
    itemsSource: srcRec ? ({ filename: srcRec.filename||"items.xlsx", mime: srcRec.mime||"application/octet-stream", updatedAt: srcRec.updatedAt||Date.now() }) : null,
    items: items.map(it => ({
      id: it.id,
      fecha: it.fecha || "",
      proyecto: it.proyecto || "",
      descripcion: it.descripcion || "",
      done: !!it.done,
      mime: it.mime || "image/jpeg",
      createdAt: it.createdAt || Date.now(),
      hasLogo: !!it.hasLogo,
      itemCode: String(it.itemCode || "").trim()
    }))
  };

  const zip = new JSZip();
  zip.file("backup.json", JSON.stringify(backup, null, 2));

  // archivo fuente de ítems (si existe)
  if (srcRec && srcRec.blob){
    try{
      const f = zip.folder("items_source");
      f.file(srcRec.filename || "items.xlsx", srcRec.blob);
    }catch{}
  }

  // fotos
  const photos = zip.folder("photos");
  let i = 0;
  for (const it of items){
    i++;
    $("backupStatus").textContent = `Agregando fotos… (${i}/${items.length})`;
    const ext = extFromMime(it.mime || "image/jpeg");
    // guardamos por id (merge-friendly)
    photos.file(`${it.id}.${ext}`, it.blob);
  }

  // logo (si existe)
  const logoData = localStorage.getItem("logi_logo_dataurl");
  if (logoData){
    try{
      const lb = await dataUrlToBlob(logoData);
      const lfolder = zip.folder("logo");
      // intentamos preservar tipo
      const lExt = extFromMime(lb.type || "image/png");
      lfolder.file(`logo.${lExt}`, lb);
    }catch{}
  }

  $("backupStatus").textContent = "Comprimiendo ZIP…";
  const outBlob = await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true }, (meta) => {
    $("backupStatus").textContent = `Comprimiendo… ${Math.floor(meta.percent)}%`;
  });

  const name = `logi-backup-${isoNowSafe()}.zip`;
  const url = URL.createObjectURL(outBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  $("backupStatus").textContent = `Backup listo ✅ (${items.length} fotos)`;
  setTimeout(() => { $("backupStatus").textContent = "Consejo: haz backup al final del día o antes de actualizar."; }, 2500);
}

async function restoreBackupZip(file){
  if (!window.JSZip){
    alert("JSZip no está disponible. Abre la app con internet (una vez) y prueba de nuevo.");
    return;
  }
  $("backupStatus").textContent = "Leyendo ZIP…";

  const zip = await JSZip.loadAsync(file);
  const bj = zip.file("backup.json");
  if (!bj){
    alert("Ese ZIP no parece un backup de Logi (falta backup.json).");
    return;
  }

  const jsonText = await bj.async("string");
  let backup = null;
  try { backup = JSON.parse(jsonText); } catch { backup = null; }
  if (!backup || !Array.isArray(backup.items)){
    alert("Backup inválido: no encontré la lista de fotos.");
    return;
  }

  const importSettings = confirm("¿También quieres importar CONFIGURACIÓN (tema/acento/plantilla/proyecto/logo)?\n\nSi dices Cancelar, solo importo las fotos.");

  
  // 1) Restaurar catálogo desde el ARCHIVO fuente (xlsx/csv), si viene en el ZIP
  const activePid = getActiveProjectId() || ensureProjects().activeId;
  try{
    const srcFolder = zip.folder("items_source");
    let srcFileEntry = null;
    if (srcFolder){
      const candidates = Object.keys(srcFolder.files || {}).filter(p => p.startsWith("items_source/") && !srcFolder.files[p].dir);
      if (candidates.length) srcFileEntry = candidates[0];
    }
    if (srcFileEntry){
      const blob = await zip.file(srcFileEntry).async("blob");
      const filename = (backup.itemsSource && backup.itemsSource.filename) ? backup.itemsSource.filename : (srcFileEntry.split("/").pop() || "items.xlsx");
      const fileObj = new File([blob], filename, { type: (backup.itemsSource && backup.itemsSource.mime) ? backup.itemsSource.mime : blob.type });
      // Guardar archivo fuente en DB y reconstruir catálogo leyendo ese archivo
      await srcPut(activePid, fileObj);
      await catClearProject(activePid);
      const resCat = await importItemsFileToProject(fileObj, activePid);
      if (resCat && resCat.noXlsx){
        // Si no hay XLSX disponible, usamos fallback del backup (si existe)
        if (Array.isArray(backup.catalog) && backup.catalog.length){
          const rows = backup.catalog.map(r => ({
            key: `${activePid}::${String(r.item||"").trim()}`,
            projectId: activePid,
            item: String(r.item||"").trim(),
            descripcion: r.descripcion || "",
            unidad: r.unidad || "",
            createdAt: r.createdAt || Date.now()
          })).filter(x => x.item);
          if (rows.length) await catPutMany(rows);
        }
      }
    }else{
      // Fallback: catálogo parseado si venía (para backups antiguos)
      if (Array.isArray(backup.catalog) && backup.catalog.length){
        await catClearProject(activePid);
        const rows = backup.catalog.map(r => ({
          key: `${activePid}::${String(r.item||"").trim()}`,
          projectId: activePid,
          item: String(r.item||"").trim(),
          descripcion: r.descripcion || "",
          unidad: r.unidad || "",
          createdAt: r.createdAt || Date.now()
        })).filter(x => x.item);
        if (rows.length) await catPutMany(rows);
      }
    }
  }catch(e){ console.warn("restore catalog source failed", e); }

  // mapa de existentes (mezclar)
  const existing = new Set(cache.map(x => x.id));
  let added = 0;
  let skipped = 0;

  // intentamos importar logo primero (si se pidió)
  if (importSettings){
    try{
      const logoFolder = zip.folder("logo");
      if (logoFolder){
        const candidates = Object.keys(logoFolder.files || {}).filter(p => p.startsWith("logo/") && !logoFolder.files[p].dir);
        if (candidates.length){
          const lf = zip.file(candidates[0]);
          if (lf){
            const lb = await lf.async("blob");
            const fr = new FileReader();
            const dataUrl = await new Promise((res, rej)=>{
              fr.onload = () => res(fr.result);
              fr.onerror = rej;
              fr.readAsDataURL(lb);
            });
            localStorage.setItem("logi_logo_dataurl", dataUrl);
          }
        }
      }
    }catch{}
  }

  const total = backup.items.length;
  for (let idx=0; idx<total; idx++){
    const meta = backup.items[idx];
    const id = meta.id;

    if (existing.has(id)){
      skipped++;
      continue;
    }

    // localizar archivo de foto por id (puede tener ext distinta)
    const possible = [`photos/${id}.jpg`, `photos/${id}.jpeg`, `photos/${id}.png`, `photos/${id}.webp`, `photos/${id}.bin`];
    let f = null;
    for (const p of possible){
      const zf = zip.file(p);
      if (zf){ f = zf; break; }
    }
    // fallback: buscar por prefijo id.
    if (!f){
      const keys = Object.keys(zip.files);
      const match = keys.find(k => k.startsWith(`photos/${id}.`) && !zip.files[k].dir);
      if (match) f = zip.file(match);
    }

    if (!f){
      // no reventamos: saltamos
      skipped++;
      continue;
    }

    $("backupStatus").textContent = `Importando… (${idx+1}/${total})`;

    const blob = await f.async("blob");
    const activeP = getActiveProject();
    const it = {
      id,
      fecha: meta.fecha || "",
      proyecto: meta.proyecto || "",
      descripcion: meta.descripcion || "",
      done: !!meta.done,
      blob,
      mime: meta.mime || blob.type || "image/jpeg",
      createdAt: meta.createdAt || Date.now(),
      hasLogo: !!meta.hasLogo,
      projectId: activeP ? activeP.id : null
    };

    await dbPut(it);
    cache.push(it);
    existing.add(id);
    added++;
  }

  // settings (si se pidió)
  if (importSettings && backup.settings){
    try{
      if (backup.settings.theme) applyTheme(backup.settings.theme);
      if (backup.settings.accent) applyAccent(backup.settings.accent);
      if (typeof backup.settings.project === "string") setProjectDefault(backup.settings.project);
      if (backup.settings.template) setTemplateId(backup.settings.template);
      if (backup.settings.docxFit) localStorage.setItem("logi_docx_fit", backup.settings.docxFit);
      if (typeof backup.settings.logoEnabled === "boolean") localStorage.setItem("logi_logo_enabled", backup.settings.logoEnabled ? "1":"0");
      if (backup.settings.logoCorner) localStorage.setItem("logi_logo_corner", backup.settings.logoCorner);
      // refrescar UI dependiente
      if (proyectoInput) proyectoInput.value = getProjectDefault();
      syncTemplateUI();
      loadDocxFit();
      await loadLogoFromStorage();
      loadLogoCorner();
      syncThemeUI();
      syncAccentUI();
    }catch{}
  }

  // re-render
  try{ await loadCatalogForActiveProject(); }catch{}
  render();
  $("backupStatus").textContent = `Restauración completa ✅ (agregadas: ${added}, ya existían/omitidas: ${skipped})`;
  setTimeout(() => { $("backupStatus").textContent = "Consejo: haz backup al final del día o antes de actualizar."; }, 3500);
}

/* ===========================
   🌎 Backup TOTAL / Restore TOTAL (ZIP)
   - Incluye TODOS los proyectos + fotos + catálogo
   - Restore mezcla (no borra lo existente)
=========================== */

async function createBackupZipAll(){
  if (!window.JSZip){
    alert("JSZip no está disponible. Abre la app con internet (una vez) y prueba de nuevo.");
    return;
  }

  $("backupAllStatus").textContent = "Preparando backup TOTAL…";

  const { projects, activeId } = ensureProjects();
  const allItems = await dbGetAll();
  const allCatalog = await catGetAll();
  const allSources = await srcGetAll();

  const firstId = projects[0]?.id || activeId;

  const settings = {
    theme: localStorage.getItem(THEME_KEY) || "dark",
    accent: localStorage.getItem(ACCENT_KEY) || "blue",
    project: (getActiveProject() ? getActiveProject().name : getProjectDefault()),
    template: getTemplateId(),
    docxFit: localStorage.getItem("logi_docx_fit") || "stretch",
    logoEnabled: localStorage.getItem("logi_logo_enabled") === "1",
    logoCorner: localStorage.getItem("logi_logo_corner") || "br",
  };

  const backup = {
    schemaVersion: 2,
    type: "all",
    app: "Logi",
    createdAt: new Date().toISOString(),
    settings,
    projects,
    activeProjectId: activeId,
    // Archivos fuente EXACTOS (xlsx/csv) por proyecto
    itemsSources: (allSources || []).map(s => ({ projectId: s.projectId||s.key||"", filename: s.filename||"items.xlsx", mime: s.mime||"application/octet-stream", updatedAt: s.updatedAt||Date.now() })).filter(x=>x.projectId),
    catalog: (allCatalog || []).map(r => ({
      projectId: r.projectId || firstId,
      item: r.item || "",
      descripcion: r.descripcion || "",
      unidad: r.unidad || "",
      createdAt: r.createdAt || Date.now()
    })),
    items: (allItems || []).map(it => {
      const pid = it.projectId || firstId;
      const pName = (projects.find(p => p.id === pid)?.name) || "";
      return {
        id: it.id,
        fecha: it.fecha || "",
        proyecto: it.proyecto || pName || "",
        descripcion: it.descripcion || "",
        done: !!it.done,
        mime: it.mime || "image/jpeg",
        createdAt: it.createdAt || Date.now(),
        hasLogo: !!it.hasLogo,
        projectId: pid,
        projectName: pName,
        itemCode: String(it.itemCode || "").trim()
      };
    })
  };

  const zip = new JSZip();
  zip.file("backup.json", JSON.stringify(backup, null, 2));

  // archivos fuente de ítems
  try{
    const srcFolder = zip.folder("items_source");
    for (const s of (allSources || [])){
      if (!s || !(s.projectId||s.key) || !s.blob) continue;
      const pid = String(s.projectId||s.key);
      const pf = srcFolder.folder(pid);
      pf.file(s.filename || "items.xlsx", s.blob);
    }
  }catch{}

  const photos = zip.folder("photos");
  let i = 0;
  for (const it of (allItems || [])){
    i++;
    $("backupAllStatus").textContent = `Agregando fotos… (${i}/${allItems.length})`;
    const pid = it.projectId || firstId;
    const folder = photos.folder(pid);
    const ext = extFromMime(it.mime || "image/jpeg");
    folder.file(`${it.id}.${ext}`, it.blob);
    // Evita bloqueos en celulares durante backups grandes
    if (i % 10 === 0) await new Promise(r => setTimeout(r, 0));
  }

  const logoData = localStorage.getItem("logi_logo_dataurl");
  if (logoData){
    try{
      const lb = await dataUrlToBlob(logoData);
      const lfolder = zip.folder("logo");
      const lExt = extFromMime(lb.type || "image/png");
      lfolder.file(`logo.${lExt}`, lb);
    }catch{}
  }

  $("backupAllStatus").textContent = "Comprimiendo ZIP…";
  const outBlob = await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true }, (meta) => {
    $("backupAllStatus").textContent = `Comprimiendo… ${Math.floor(meta.percent)}%`;
  });

  const name = `logi-backup-TOTAL-${isoNowSafe()}.zip`;
  const url = URL.createObjectURL(outBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  $("backupAllStatus").textContent = `Backup TOTAL listo ✅ (${(allItems||[]).length} fotos)`;
}

async function restoreBackupZipAll(file){
  if (!window.JSZip){
    alert("JSZip no está disponible. Abre la app con internet (una vez) y prueba de nuevo.");
    return;
  }

  $("backupAllStatus").textContent = "Leyendo ZIP…";
  const zip = await JSZip.loadAsync(file);
  const bj = zip.file("backup.json");
  if (!bj){
    alert("Ese ZIP no parece un backup de Logi (falta backup.json).");
    return;
  }

  const jsonText = await bj.async("string");
  let backup = null;
  try { backup = JSON.parse(jsonText); } catch { backup = null; }

  if (!backup || backup.type !== "all" || !Array.isArray(backup.items) || !Array.isArray(backup.projects)){
    alert("Backup TOTAL inválido: no encontré estructura esperada.");
    return;
  }

  const ok = confirm(
    "Vas a RESTAURAR un backup TOTAL.\n\n" +
    "• No se borrará nada.\n" +
    "• Se mezclarán fotos nuevas.\n" +
    "• Se recrearán proyectos faltantes y su catálogo.\n\n" +
    "¿Continuar?"
  );
  if (!ok){ $("backupAllStatus").textContent = "Cancelado."; return; }

  const importSettings = confirm("¿También quieres importar CONFIGURACIÓN (tema/acento/plantilla/logo)?");

  const existingAll = new Set((await dbGetAll()).map(x => x.id));

  // map projects by name
  let { projects, activeId } = ensureProjects();
  const norm = s => String(s||"").trim().toLowerCase();
  const nameToId = {};
  for (const p of projects) nameToId[norm(p.name)] = p.id;

  const mapPid = {};
  for (const bp of backup.projects){
    const key = norm(bp.name);
    if (nameToId[key]){
      mapPid[bp.id] = nameToId[key];
    } else {
      const newId = genPid();
      projects.push({ id: newId, name: bp.name || "Proyecto", createdAt: Date.now() });
      nameToId[key] = newId;
      mapPid[bp.id] = newId;
    }
  }
  saveProjects(projects);

  if (backup.activeProjectId && mapPid[backup.activeProjectId]){
    setActiveProjectId(mapPid[backup.activeProjectId]);
    activeId = mapPid[backup.activeProjectId];
  }

  if (importSettings){
    // logo
    try{
      const logoFolder = zip.folder("logo");
      if (logoFolder){
        const candidates = Object.keys(logoFolder.files || {}).filter(p => p.startsWith("logo/") && !logoFolder.files[p].dir);
        if (candidates.length){
          const lf = zip.file(candidates[0]);
          if (lf){
            const lb = await lf.async("blob");
            const fr = new FileReader();
            const dataUrl = await new Promise((res, rej)=>{
              fr.onload = () => res(fr.result);
              fr.onerror = rej;
              fr.readAsDataURL(lb);
            });
            localStorage.setItem("logi_logo_dataurl", dataUrl);
          }
        }
      }
    }catch{}

    if (backup.settings){
      try{
        if (backup.settings.theme) applyTheme(backup.settings.theme);
        if (backup.settings.accent) applyAccent(backup.settings.accent);
        if (backup.settings.template) setTemplateId(backup.settings.template);
        if (backup.settings.docxFit) localStorage.setItem("logi_docx_fit", backup.settings.docxFit);
        if (typeof backup.settings.logoEnabled === "boolean") localStorage.setItem("logi_logo_enabled", backup.settings.logoEnabled ? "1":"0");
        if (backup.settings.logoCorner) localStorage.setItem("logi_logo_corner", backup.settings.logoCorner);
      }catch{}
    }
  }


  // 1) Restaurar catálogos desde ARCHIVOS fuente (items_source) si vienen en el ZIP
  try{
    const srcFolder = zip.folder("items_source");
    const srcKeys = Object.keys(zip.files || {});
    // Si vienen archivos fuente por proyecto, reconstruimos el catálogo leyendo esos archivos
    if (srcFolder){
      for (const bp of (backup.projects || [])){
        const bpid = bp.id;
        const targetPid = mapPid[bpid] || activeId;
        // buscar cualquier archivo dentro de items_source/<bpid>/
        const base = `items_source/${bpid}/`;
        const cand = srcKeys.find(k => k.startsWith(base) && !zip.files[k].dir);
        if (!cand) continue;

        const blob = await zip.file(cand).async("blob");
        const filename = (backup.itemsSources || []).find(s => String(s.projectId||"") === String(bpid))?.filename
          || cand.split("/").pop() || "items.xlsx";
        const mime = (backup.itemsSources || []).find(s => String(s.projectId||"") === String(bpid))?.mime
          || blob.type || "application/octet-stream";
        const fileObj = new File([blob], filename, { type: mime });

        // Guardar el archivo fuente y reconstruir catálogo leyendo el archivo
        try{ await srcPut(targetPid, fileObj); }catch{}
        await catClearProject(targetPid);
        const resCat = await importItemsFileToProject(fileObj, targetPid);

        // Si no se pudo leer (por falta de XLSX), dejamos fallback para el paso siguiente
        if (resCat && resCat.noXlsx){
          // no hacemos nada aquí; más abajo puede entrar fallback catalog si existe
        }
      }
    }
  }catch(e){ console.warn("restore all: catalog source failed", e); }

  // Import photos
  let added = 0, skipped = 0;
  const total = backup.items.length;
  const keys = Object.keys(zip.files);

  for (let idx=0; idx<total; idx++){
    const meta = backup.items[idx];
    const id = meta.id;
    if (!id){ skipped++; continue; }
    if (existingAll.has(id)){ skipped++; continue; }

    const bpid = meta.projectId || backup.projects?.[0]?.id;
    const targetPid = mapPid[bpid] || activeId;

    // find file photos/<backupPid>/<id>.*
    const base = `photos/${bpid}/${id}.`;
    const match = keys.find(k => k.startsWith(base) && !zip.files[k].dir);
    let f = match ? zip.file(match) : null;

    if (!f){
      // fallback anywhere under photos
      const any = keys.find(k => k.startsWith('photos/') && k.includes(`/${id}.`) && !zip.files[k].dir);
      if (any) f = zip.file(any);
    }

    if (!f){ skipped++; continue; }

    $("backupAllStatus").textContent = `Importando… (${idx+1}/${total})`;

    const blob = await f.async("blob");
    const projName = projects.find(p => p.id === targetPid)?.name || "";

    const it = {
      id,
      fecha: meta.fecha || "",
      proyecto: meta.proyecto || projName || "",
      descripcion: meta.descripcion || "",
      done: !!meta.done,
      mime: meta.mime || blob.type || "image/jpeg",
      createdAt: meta.createdAt || Date.now(),
      hasLogo: !!meta.hasLogo,
      itemCode: String(meta.itemCode || "").trim(),
      itemDesc: "",
      blob,
      projectId: targetPid
    };

    await dbPut(it);
    existingAll.add(id);
    added++;
  }

  // restore catalog (fallback cuando NO hay archivo fuente)
  if (Array.isArray(backup.catalog) && backup.catalog.length){
    const srcSet = new Set((backup.itemsSources || []).map(s => String(s.projectId||"")).filter(Boolean));
    const rows = backup.catalog.map(r => {
      if (srcSet.has(String(r.projectId||""))) return null;
      const pid = mapPid[r.projectId] || activeId;
      const item = String(r.item || "").trim();
      return {
        key: `${pid}::${item}`,
        projectId: pid,
        item,
        descripcion: r.descripcion || "",
        unidad: r.unidad || "",
        createdAt: r.createdAt || Date.now()
      };
    }).filter(x => x && x.item);
    if (rows.length) await catPutMany(rows);
  }

  // refresh UI
  refreshProjectUI();
  await loadCacheForActiveProject();
  await loadCatalogForActiveProject();
  render();
  updateStorageUI();

  $("backupAllStatus").textContent = `Restauración TOTAL ✅ (agregadas: ${added}, omitidas: ${skipped})`;
}

$("btnBackupAllCreate").onclick = async () => {
  try { await createBackupZipAll(); }
  catch (err) {
    console.error(err);
    const msg = (err && (err.message || String(err))) ? (err.message || String(err)) : "Error desconocido";
    alert("No pude crear el backup TOTAL.\n\nTip: cierra otras apps y reintenta.\n\nDetalle: " + msg);
    $("backupAllStatus").textContent = "—";
  }
};

$("btnBackupAllRestore").onclick = () => {
  $("backupAllInput").value = "";
  $("backupAllInput").click();
};

$("backupAllInput").onchange = async () => {
  const file = $("backupAllInput").files?.[0];
  if (!file) return;
  try { await restoreBackupZipAll(file); }
  catch { alert("No pude restaurar ese ZIP TOTAL."); $("backupAllStatus").textContent = "—"; }
  finally { $("backupAllInput").value = ""; updateStorageUI(); }
};


$("btnBackupCreate").onclick = async () => {
  try { await createBackupZip(); } catch (e){ alert("No pude crear el backup. Prueba cerrar apps y reintentar."); $("backupStatus").textContent = "—"; }
};

$("btnBackupRestore").onclick = () => {
  $("backupInput").value = "";
  $("backupInput").click();
};

$("backupInput").onchange = async () => {
  const file = $("backupInput").files?.[0];
  if (!file) return;
  const ok = confirm("Vas a RESTAURAR un backup.\n\n• No se borrará nada.\n• Se mezclarán fotos nuevas.\n\n¿Continuar?");
  if (!ok) { $("backupInput").value=""; return; }

  try{
    await restoreBackupZip(file);
  }catch(e){
    alert("No pude restaurar ese ZIP. ¿Seguro es un backup generado por Logi?");
    $("backupStatus").textContent = "—";
  }finally{
    $("backupInput").value = "";
    updateStorageUI();
  }
};

/* ===========================
   📋 Ítems: plantilla + carga (por proyecto)
=========================== */
$("btnItemsTemplate").onclick = () => {
  try{ downloadTemplateItems(); }catch{}
};

$("btnItemsUpload").onclick = () => {
  $("itemsInput").value = "";
  $("itemsInput").click();
};

$("btnItemsClear").onclick = async () => {
  const p = getActiveProject();
  if (!p) return;
  const ok = confirm(`Vas a borrar el LISTADO de ítems del proyecto:\n\n${p.name}\n\n(Esto NO borra fotos)\n\n¿Continuar?`);
  if (!ok) return;
  try{
    await catClearProject(p.id);
    try{ await srcClearProject(p.id); }catch{}
    await loadCatalogForActiveProject();
    render();
  }catch{
    alert("No pude borrar el listado. Intenta de nuevo.");
  }
};

$("itemsInput").onchange = async () => {
  const file = $("itemsInput").files?.[0];
  if (!file) return;

  $("itemsStatus").textContent = "Importando…";
  try{
    const res = await importItemsFile(file);
    // Guardar archivo fuente EXACTO por proyecto (para backup/restore)
    try{
      const p = getActiveProject();
      const pid = p ? p.id : (getActiveProjectId() || ensureProjects().activeId);
      if (pid) await srcPut(pid, file);
    }catch{}
    $("itemsStatus").textContent = `Importado ✅ (leídos: ${res.total}, cargados: ${res.added}, omitidos: ${res.skipped})`;
    setTimeout(()=> refreshCatalogStatus(), 2200);
  }catch(e){
    console.error(e);
    const ext = (file.name || "").toLowerCase();
  let wb;

  // CSV: lectura directa
  if (ext.endsWith(".csv")){
    const text = await file.text();
    wb = XLSX.read(text, { type:"string" });
  } else {
    // XLSX: lectura robusta (Android/PWA puede fallar con ArrayBuffer directo)
    const ab = await file.arrayBuffer();

    // Si el archivo no parece ZIP (xlsx) a veces es una página HTML descargada con nombre .xlsx
    const sig = String.fromCharCode.apply(null, Array.from(new Uint8Array(ab.slice(0,2))));
    // "PK" => zip
    if (sig !== "PK"){
      throw new Error("El archivo no parece un .xlsx válido (firma distinta a PK). Re-descarga la plantilla y vuelve a intentar.");
    }

    try{
      const u8 = new Uint8Array(ab);
      wb = XLSX.read(u8, { type:"array" });
    }catch(err1){
      // Fallback: lectura binaria con FileReader
      const bin = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(fr.error || new Error("No pude leer el archivo"));
        fr.readAsBinaryString(file);
      });
      wb = XLSX.read(bin, { type:"binary" });
    }
  }

  const sheetName = 
    refreshCatalogStatus();
  }finally{
    $("itemsInput").value = "";
  }
};


/* ===========================
   IndexedDB
=========================== */
const DB_NAME = "logi2_db_v1";
const DB_VERSION = 3;

const DB_STORE = "items";          // fotos (registros)
const DB_STORE_CATALOG = "catalog"; // listado de ítems por proyecto
const DB_STORE_CATALOG_SRC = "catalog_src"; // archivo fuente (xlsx/csv) por proyecto

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (ev) => {
      const db = req.result;

      // Store fotos (legacy)
      if (!db.objectStoreNames.contains(DB_STORE)){
        const store = db.createObjectStore(DB_STORE, { keyPath: "id" });
        store.createIndex("byDate", "fecha");
        store.createIndex("byCreated", "createdAt");
      } else {
        // Asegurar índices (por si el usuario viene de una versión rara)
        const tx = req.transaction;
        const store = tx.objectStore(DB_STORE);
        if (!store.indexNames.contains("byDate")) store.createIndex("byDate", "fecha");
        if (!store.indexNames.contains("byCreated")) store.createIndex("byCreated", "createdAt");
      }

      // Store catálogo ítems (nuevo)
      if (!db.objectStoreNames.contains(DB_STORE_CATALOG)){
        const cat = db.createObjectStore(DB_STORE_CATALOG, { keyPath: "key" });
        cat.createIndex("byProject", "projectId");
        cat.createIndex("byItem", "item");
      }

      // Store archivo fuente de ítems por proyecto
      if (!db.objectStoreNames.contains(DB_STORE_CATALOG_SRC)){
        const src = db.createObjectStore(DB_STORE_CATALOG_SRC, { keyPath: "key" });
        src.createIndex("byProject", "projectId");
      }

    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}


async function dbPut(item){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(item);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
async function dbGetAll(){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function dbDelete(id){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
async function dbClear(){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/* ===========================
   Catálogo de ítems (por proyecto)
=========================== */
let catalog = [];          // rows: {key, projectId, item, descripcion, unidad, createdAt}
let catalogMap = {};       // { itemCode: descripcion } para el proyecto activo

async function catGetByProject(projectId){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE_CATALOG, "readonly");
    const idx = tx.objectStore(DB_STORE_CATALOG).index("byProject");
    const req = idx.getAll(projectId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function catGetAll(){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE_CATALOG, "readonly");
    const req = tx.objectStore(DB_STORE_CATALOG).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/* ===========================
   Archivo fuente de ítems (xlsx/csv) por proyecto
   - Se guarda el archivo EXACTO que el usuario cargó.
   - El catálogo (DB_STORE_CATALOG) se reconstruye leyendo este archivo.
=========================== */
async function srcPut(projectId, file){
  if (!projectId || !file) return false;
  const db = await openDB();
  const key = String(projectId);
  const rec = {
    key,
    projectId: key,
    filename: file.name || "items.xlsx",
    mime: file.type || "application/octet-stream",
    blob: file,
    updatedAt: Date.now()
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE_CATALOG_SRC, "readwrite");
    tx.objectStore(DB_STORE_CATALOG_SRC).put(rec);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function srcGet(projectId){
  if (!projectId) return null;
  const db = await openDB();
  const key = String(projectId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE_CATALOG_SRC, "readonly");
    const req = tx.objectStore(DB_STORE_CATALOG_SRC).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function srcGetAll(){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE_CATALOG_SRC, "readonly");
    const req = tx.objectStore(DB_STORE_CATALOG_SRC).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function srcClearProject(projectId){
  if (!projectId) return false;
  const db = await openDB();
  const key = String(projectId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE_CATALOG_SRC, "readwrite");
    tx.objectStore(DB_STORE_CATALOG_SRC).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/* Importa un archivo de ítems hacia un proyecto específico (sin depender del "proyecto activo") */
async function importItemsFileToProject(file, projectId){
  if (!file) return { added:0, skipped:0, total:0 };
  if (!window.XLSX){
    // Sin XLSX no podemos reconstruir desde el archivo fuente
    return { added:0, skipped:0, total:0, noXlsx:true };
  }
  const ext = (file.name || "").toLowerCase();
  let wb;

  if (ext.endsWith(".csv")){
    const text = await file.text();
    wb = XLSX.read(text, { type:"string" });
  } else {
    const ab = await file.arrayBuffer();
    // Lectura robusta: algunos navegadores fallan con arrayBuffer directo
    try{
      wb = XLSX.read(new Uint8Array(ab), { type:"array" });
    }catch{
      wb = XLSX.read(ab, { type:"array" });
    }
  }

  const sheetName = wb.SheetNames.includes("ITEMS") ? "ITEMS" : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header:1, raw:false, defval:"" });

  if (!rows.length) return { added:0, skipped:0, total:0 };

  const header = rows[0].map(normalizeHeader);
  const idxItem = header.findIndex(h => h === "item" || h === "codigo" || h === "codigo_item");
  const idxDesc = header.findIndex(h => h === "descripcion" || h === "descripción" || h === "descripcion_item");
  const idxUnit = header.findIndex(h => h === "unidad" || h === "und" || h === "unit" || h === "unidad_item");

  if (idxItem === -1 || idxDesc === -1 || idxUnit === -1){
    return { added:0, skipped:0, total:0, badFormat:true };
  }

  if (!projectId) return { added:0, skipped:0, total:0, noProject:true };

  const batch = [];
  let added = 0, skipped = 0;

  for (let i=1; i<rows.length; i++){
    const r = rows[i] || [];
    const item = String(r[idxItem] || "").trim();
    const descripcion = String(r[idxDesc] || "").trim();
    const unidad = String(r[idxUnit] || "").trim();
    if (!item) { skipped++; continue; }
    const key = `${projectId}::${item}`;
    batch.push({ key, projectId, item, descripcion, unidad, createdAt: Date.now() });
    added++;
  }

  await catPutMany(batch);
  return { added, skipped, total: rows.length-1 };
}

async function catPutMany(rows){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE_CATALOG, "readwrite");
    const store = tx.objectStore(DB_STORE_CATALOG);
    for (const r of rows) store.put(r);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function catClearProject(projectId){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE_CATALOG, "readwrite");
    const store = tx.objectStore(DB_STORE_CATALOG);
    const idx = store.index("byProject");
    const req = idx.getAllKeys(projectId);
    req.onsuccess = () => {
      const keys = req.result || [];
      keys.forEach(k => store.delete(k));
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

function rebuildCatalogMap(){
  catalogMap = {};
  for (const r of catalog){
    if (r?.item) catalogMap[String(r.item).trim()] = (r.descripcion || "").trim();
  }
}

async function loadCatalogForActiveProject(){
  const activeId = getActiveProjectId() || ensureProjects().activeId;
  catalog = await catGetByProject(activeId);
  rebuildCatalogMap();
  refreshCatalogDatalist();
  refreshCatalogStatus();
  updateExportItemHint();
}

function refreshCatalogDatalist(){
  const dl = $("datalistItems");
  if (!dl) return;
  dl.innerHTML = "";
  const rows = (catalog || []).slice().sort((a,b) => String(a.item).localeCompare(String(b.item)));
  for (const r of rows){
    const opt = document.createElement("option");
    opt.value = String(r.item || "").trim();
    opt.textContent = r.descripcion ? `${r.item} — ${r.descripcion}${(r.unidad||'').trim() ? ' ['+(r.unidad||'').trim()+']' : ''}` : String(r.item || "");
    dl.appendChild(opt);
  }
}

function refreshCatalogStatus(){
  const lab = $("itemsLabel");
  const st  = $("itemsStatus");
  const p = getActiveProject();
  const pname = p ? p.name : "—";
  if (lab) lab.textContent = `Listado por proyecto: ${pname}`;
  if (st) st.textContent = (catalog && catalog.length) ? `Ítems cargados: ${catalog.length}` : "Sin ítems cargados (aún).";

}

function getExportItemCode(){
  return ($("exportItem")?.value || "").trim();
}

function updateExportItemHint(){
  const hintEl = $("exportItemHint");
  if (!hintEl) return;
  const code = getExportItemCode();
  const txt = code ? (catalogMap[code] || "") : "";
  hintEl.textContent = txt;
  hintEl.style.display = txt ? "block" : "none";
}

function getGalleryItemCode(){
  return ($("galleryItem")?.value || "").trim();
}

function updateGalleryItemHint(){
  const hintEl = $("galleryItemHint");
  if (!hintEl) return;
  const code = getGalleryItemCode();
  const txt = code ? (catalogMap[code] || "") : "";
  hintEl.textContent = txt;
  hintEl.style.display = txt ? "block" : "none";
}

function normalizeHeader(s){
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g,"")
    .replace(/\s+/g,"_");
}

async function importItemsFile(file){
  if (!file) return { added:0, skipped:0, total:0 };

  if (!window.XLSX){
    alert("No puedo leer Excel porque la librería XLSX no cargó. Abre con internet o prueba Chrome.");
    return { added:0, skipped:0, total:0 };
  }

  const ext = (file.name || "").toLowerCase();
  let wb;

  if (ext.endsWith(".csv")){
    const text = await file.text();
    wb = XLSX.read(text, { type:"string" });
  } else {
    const buf = await file.arrayBuffer();
    wb = XLSX.read(buf, { type:"array" });
  }

  const sheetName = wb.SheetNames.includes("ITEMS") ? "ITEMS" : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header:1, raw:false, defval:"" });

  if (!rows.length) return { added:0, skipped:0, total:0 };

  const header = rows[0].map(normalizeHeader);
  const idxItem = header.findIndex(h => h === "item" || h === "codigo" || h === "codigo_item");
  const idxDesc = header.findIndex(h => h === "descripcion" || h === "descripción" || h === "descripcion_item");
  const idxUnit = header.findIndex(h => h === "unidad" || h === "und" || h === "unit" || h === "unidad_item");

  if (idxItem === -1 || idxDesc === -1 || idxUnit === -1){
    alert("Ese archivo no tiene el formato correcto. Debe tener columnas: ITEM, DESCRIPCION y UNIDAD.");
    return { added:0, skipped:0, total:0 };
  }

  const p = getActiveProject();
  const projectId = p ? p.id : (getActiveProjectId() || "");
  if (!projectId){
    alert("No pude determinar el proyecto activo.");
    return { added:0, skipped:0, total:0 };
  }

  const batch = [];
  let added = 0, skipped = 0;

  for (let i=1; i<rows.length; i++){
    const r = rows[i] || [];
    const item = String(r[idxItem] || "").trim();
    const descripcion = String(r[idxDesc] || "").trim();
    const unidad = String(r[idxUnit] || "").trim();

    if (!item) { skipped++; continue; }

    const key = `${projectId}::${item}`;
    batch.push({
      key,
      projectId,
      item,
      descripcion,
      unidad,
      createdAt: Date.now()
    });
    added++;
  }

  await catPutMany(batch);
  await loadCatalogForActiveProject();

  return { added, skipped, total: rows.length-1 };
}

function downloadTemplateItems(){
  // Descarga la plantilla oficial desde el repo (más confiable en Android/PWA).
  // Si falla, genera una plantilla mínima.
  const url = `Logi2_Plantilla_Items.xlsx?v=${Date.now()}`;

  const forceDownload = async (blob, filename) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  (async () => {
    try{
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("No pude descargar la plantilla desde el servidor.");
      const blob = await res.blob();
      await forceDownload(blob, "Logi2_Plantilla_Items.xlsx");
      return;
    }catch(e){
      console.warn("Fallback plantilla (generada):", e);
      try{
        if (!window.XLSX) throw new Error("XLSX no cargó.");
        const wb = XLSX.utils.book_new();
        const data = [["ITEM","DESCRIPCION","UNIDAD"],["","",""]];
        const ws = XLSX.utils.aoa_to_sheet(data);
        ws["!cols"] = [{ wch: 18 }, { wch: 60 }, { wch: 12 }];
        XLSX.utils.book_append_sheet(wb, ws, "ITEMS");
        const out = XLSX.write(wb, { bookType:"xlsx", type:"array" });
        const blob = new Blob([out], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        await forceDownload(blob, "Logi2_Plantilla_Items.xlsx");
      }catch(err2){
        alert("No pude descargar/generar la plantilla.\n\nDetalle: " + (err2?.message || err2));
      }
    }
  })();
}


/* ===========================
   Utilidades
=========================== */
const fechaInput = $("fecha");
const proyectoInput = $("proyecto");
proyectoInput.addEventListener("input", () => setProjectDefault(proyectoInput.value));
const camInput = $("camInput");
const galInput = $("galInput");

const lista = $("lista");
const statusEl = $("status");
const rangeInfo = $("rangeInfo");
const zipInfo = $("zipInfo");

/* ===========================
   🧩 Multi-proyecto (Logi2)
   - Separa fotos por "projectId" (en la misma DB)
   - NO toca /Logi/ porque usa DB_NAME distinto + keys logi2_*
=========================== */
const PROJECTS_KEY = "logi2_projects";
const ACTIVE_PROJECT_KEY = "logi2_active_project";

function genPid(){
  return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,7);
}
function loadProjects(){
  try{ return JSON.parse(localStorage.getItem(PROJECTS_KEY) || "[]") || []; }catch{ return []; }
}
function saveProjects(arr){ localStorage.setItem(PROJECTS_KEY, JSON.stringify(arr)); }
function getActiveProjectId(){
  return localStorage.getItem(ACTIVE_PROJECT_KEY) || "";
}
function setActiveProjectId(id){
  localStorage.setItem(ACTIVE_PROJECT_KEY, id);
}
function ensureProjects(){
  let projects = loadProjects();
  if (!projects.length){
    const id = genPid();
    projects = [{ id, name: "Proyecto 1", createdAt: Date.now() }];
    saveProjects(projects);
    setActiveProjectId(id);
  }
  let activeId = getActiveProjectId();
  if (!activeId || !projects.some(p => p.id === activeId)){
    activeId = projects[0].id;
    setActiveProjectId(activeId);
  }
  return { projects, activeId };
}
function getActiveProject(){
  const { projects, activeId } = ensureProjects();
  return projects.find(p => p.id === activeId) || projects[0] || null;
}
function setProyectoInputFromActive(){
  // Mantener compatibilidad con UI vieja (campo "proyecto")
  const p = getActiveProject();
  if (proyectoInput && p){
    proyectoInput.value = p.name;
    proyectoInput.readOnly = true;   // el nombre se cambia con Renombrar
  }
}
function refreshProjectUI(){
  const sel = $("projectSelect");
  if (!sel) return;
  const { projects, activeId } = ensureProjects();
  sel.innerHTML = "";
  for (const p of projects){
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  sel.value = activeId;
  setProyectoInputFromActive();
}

let projModalMode = null; // "new" | "rename"
function openProjModal(mode){
  projModalMode = mode;
  const p = getActiveProject();
  const modal = $("projModal");
  const title = $("projModalTitle");
  const meta = $("projModalMeta");
  const input = $("projNameInput");
  if (!modal || !input) return;

  if (mode === "new"){
    title.textContent = "Nuevo proyecto";
    meta.textContent = "Crea un proyecto para separar las fotos.";
    input.value = "";
  } else {
    title.textContent = "Renombrar proyecto";
    meta.textContent = "Este cambio solo afecta el nombre (las fotos quedan en el mismo proyecto).";
    input.value = p ? p.name : "";
  }

  modal.classList.add("open");
  modal.setAttribute("aria-hidden","false");

  // Focus suave para abrir teclado
  setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 60);
}
function closeProjModal(){
  const modal = $("projModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden","true");
}

function onProjectChanged(){
  refreshProjectUI();

  // Limpia de inmediato para que NO se quede mostrando el proyecto anterior
  cache = [];
  render();
  updateStorageUI();

  (async () => {
    try{
      await loadCacheForActiveProject();
      await loadCatalogForActiveProject();
    }catch(e){
      console.error(e);
      alert("No pude actualizar la galería del proyecto. Si persiste, usa 'Reiniciar caché' en configuración.");
    }finally{
      render();
      updateStorageUI();
    }
  })();
}

async function loadCacheForActiveProject(){
  const activeId = getActiveProjectId() || ensureProjects().activeId;
  const all = await dbGetAll();
  const { projects } = ensureProjects();
  const firstId = projects[0]?.id || activeId;

  // Sin migración pesada: los legacy (sin projectId) se consideran del primer proyecto.
  cache = all.filter(it => (it.projectId ? it.projectId === activeId : activeId === firstId));
  setProyectoInputFromActive();
}

function attachProjectHandlers(){
  const sel = $("projectSelect");
  const btnNew = $("btnProjectNew");
  const btnRen = $("btnProjectRename");
  const btnClose = $("btnProjModalClose");
  const btnCancel = $("btnProjCancel");
  const btnSave = $("btnProjSave");
  const modal = $("projModal");

  if (sel){
    sel.addEventListener("change", () => {
      setActiveProjectId(sel.value);
      onProjectChanged();
    });
  }
  if (btnNew) btnNew.onclick = () => openProjModal("new");
  if (btnRen) btnRen.onclick = () => openProjModal("rename");
  if (btnClose) btnClose.onclick = closeProjModal;
  if (btnCancel) btnCancel.onclick = closeProjModal;

  if (modal){
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeProjModal();
    });
  }

  if (btnSave){
    btnSave.onclick = async () => {
      const input = $("projNameInput");
      if (!input) return;
      const name = (input.value || "").trim();
      if (!name){
        alert("Ponle un nombre al proyecto.");
        input.focus();
        return;
      }

      const { projects, activeId } = ensureProjects();

      if (projModalMode === "new"){
        const id = genPid();
        projects.push({ id, name, createdAt: Date.now() });
        saveProjects(projects);
        setActiveProjectId(id);
        refreshProjectUI();
        await loadCacheForActiveProject();
        render();
        updateStorageUI();
        closeProjModal();
        return;
      }

      // rename
      const p = projects.find(x => x.id === activeId);
      if (p){
        p.name = name;
        saveProjects(projects);

        // opcional: sincronizar campo "proyecto" en items del proyecto (para DOCX/nombres)
        // lo hacemos ligero: actualiza solo los del cache actual
        for (const it of cache){
          it.proyecto = name;
          await dbPut(it);
        }
      }
      refreshProjectUI();
      render();
      updateStorageUI();
      closeProjModal();
    };
  }
}


function hoyISO(){ return new Date().toISOString().slice(0,10); }
function ymdToNum(ymd){ return Number((ymd || "0000-00-00").replaceAll("-","")); }
function pad2(n){ return String(n).padStart(2,"0"); }

function sanitizeName(s){
  return (s || "")
    .trim()
    .replace(/[\/:*?"<>|]/g,"")
    .replace(/\s+/g,"_")
    .slice(0,60) || "Proyecto";
}


function escAttr(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll('"',"&quot;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}


function fmtBytes(bytes){
  if (bytes < 1024) return bytes + " B";
  const kb = bytes/1024;
  if (kb < 1024) return kb.toFixed(1) + " KB";
  const mb = kb/1024;
  return mb.toFixed(1) + " MB";
}

function filenameForItem(it, idxWithinDay, useTime){
  if (!useTime){
    return String(idxWithinDay).padStart(3,"0") + ".jpg";
  }
  const d = new Date(it.createdAt || Date.now());
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  const suf = pad2(idxWithinDay);
  return `${hh}${mm}${ss}_${suf}.jpg`;
}

function formatDateLongES(iso){
  try{
    const [y,m,d] = iso.split("-").map(Number);
    const dt = new Date(y, m-1, d);
    return new Intl.DateTimeFormat("es-CO", { day:"numeric", month:"long", year:"numeric" }).format(dt);
  }catch{
    return iso;
  }
}

function formatStampDateTime(it){
  const baseDate = it.fecha || "";
  const dt = new Date(it.createdAt || Date.now());
  const hh = pad2(dt.getHours());
  const mm = pad2(dt.getMinutes());
  return baseDate ? `${baseDate} ${hh}:${mm}` : `${hh}:${mm}`;
}

/* ===========================
   🧾 Plantillas de salida (por dispositivo)
=========================== */
const TEMPLATES = {
  classic:  { name: "Clásica (actual)", help: "Como siempre: DOCX usa 'FOTO N. descripción'. TXT solo descripción. (Sin texto sobre foto salvo que actives fecha/hora)." },
  minimal:  { name: "Minimal", help: "Descripción + fecha/hora (en DOCX/TXT).", },
  proyecto: { name: "Proyecto + descripción", help: "Incluye Proyecto (si existe) + descripción + fecha.", },
  fecha:    { name: "Solo fecha/hora", help: "Para fotos sin descripción: solo fecha y hora.", },
  clean:    { name: "Sin texto", help: "No agrega texto (DOCX deja 'FOTO N').", },
};

function getTemplateId(){
  return localStorage.getItem(TEMPLATE_KEY) || "classic";
}
function setTemplateId(id){
  localStorage.setItem(TEMPLATE_KEY, id);
  syncTemplateUI();
}

function getProjectDefault(){
  return (localStorage.getItem(PROJECT_KEY) || "").trim();
}
function setProjectDefault(v){
  localStorage.setItem(PROJECT_KEY, (v || "").trim());
}

function getTemplateMeta(it){
  const proj = (it.proyecto || "").trim() || (proyectoInput?.value || "").trim() || getProjectDefault();
  const desc = (it.descripcion || "").trim();
  const fecha = (it.fecha || "").trim();
  const longDate = fecha ? formatDateLongES(fecha) : "";
  const dt = new Date(it.createdAt || Date.now());
  const hh = pad2(dt.getHours());
  const mm = pad2(dt.getMinutes());
  const time = `${hh}:${mm}`;
  const stamp = fecha ? `${fecha} ${time}` : time;
  const itemCode = String(it.itemCode || "").trim();
  const itemDesc = String(it.itemDesc || (itemCode && catalogMap[itemCode]) || "").trim();
  return { proj, desc, fecha, longDate, time, stamp, itemCode, itemDesc };
}

function buildTemplateLines(meta, templateId){
  const id = templateId || "classic";
  if (id === "clean") return [];
  if (id === "fecha") return [meta.longDate || meta.fecha || "", meta.time].filter(Boolean);

  if (id === "minimal"){
    return [meta.desc || "—", meta.stamp].filter(Boolean);
  }

  if (id === "proyecto"){
    const lines = [];
    if (meta.proj) lines.push(meta.proj);
    if (meta.desc) lines.push(meta.desc);
    if (meta.longDate) lines.push(meta.longDate);
    return lines.length ? lines : ["—"];
  }

  // classic
  const lines = [];
  if (meta.desc) lines.push(meta.desc);
  else lines.push("—");
  return lines;
}

function buildDocxCaption(n, meta, templateId){
  // Formato solicitado (DOCX):
  // "Foto No. x, ítem: código - descripción de ítem. Descripción de foto."
  const code = String(meta.itemCode || "").trim();
  const descItem = String(meta.itemDesc || "").trim();

  let itemLabel = "";
  if (code && descItem) itemLabel = `${code} - ${descItem}`;
  else if (code) itemLabel = code;
  else if (descItem) itemLabel = descItem;
  else itemLabel = "SIN ASIGNAR";

  const photoDesc = String(meta.desc || "—").trim() || "—";

  return `Foto No. ${n}, ítem: ${itemLabel}. ${photoDesc}`;
}


function syncTemplateUI(){
  const sel = $("templateSelect");
  const help = $("templateHelp");
  if (!sel || !help) return;
  const id = getTemplateId();
  sel.value = id;
  help.textContent = (TEMPLATES[id]?.help || "");
}




/* ===========================
   📄 Plantilla de página (4/6/8)
=========================== */
const LAYOUT_KEY = "logi_page_layout";
const PAGE_LAYOUTS = {
  p4: { rows: 2, cols: 2, label: "4" },
  p6: { rows: 3, cols: 2, label: "6" },
  p8: { rows: 4, cols: 2, label: "8" },
};

function getLayoutKey(){
  return localStorage.getItem(LAYOUT_KEY) || "p6";
}
function setLayoutKey(k){
  if (!PAGE_LAYOUTS[k]) k = "p6";
  localStorage.setItem(LAYOUT_KEY, k);
  syncLayoutUI();
}
function layoutFromKey(k){
  return PAGE_LAYOUTS[k] || PAGE_LAYOUTS.p6;
}
function docxDimsForLayout(k){
  const rows = layoutFromKey(k).rows;
  const imgWcm = 7.6;      // 2 columnas (estable)
  const imgHcmBase = 4.6;  // base para 8 fotos (4 filas)
  const imgHcm = +(imgHcmBase * (4 / rows)).toFixed(2);
  const pairsPerPage = rows; // 1 fila = 1 par (2 fotos)
  return { imgWcm, imgHcm, pairsPerPage };
}
function syncLayoutUI(){
  const pick = $("layoutPick");
  if (!pick) return;
  const k = getLayoutKey();
  pick.querySelectorAll(".layoutBtn").forEach(btn => {
    const on = (btn.getAttribute("data-layout") === k);
    btn.classList.toggle("active", on);
  });
}
function initLayoutUI(){
  const pick = $("layoutPick");
  if (!pick) return;
  pick.addEventListener("click", (e) => {
    const btn = e.target.closest(".layoutBtn");
    if (!btn) return;
    setLayoutKey(btn.getAttribute("data-layout"));
  });
  syncLayoutUI();
}
/* ===========================
   Plantilla de informe (selector + preview)
   - Paso 1: solo UI / selección (sin cambiar motor de export)
=========================== */
const REPORT_TPL_KEY = "logi2_report_tpl_id_v1";
let _tplCatalog = null;
let _tplModalCurrent = null;

function getSelectedTemplateId(){
  try { return localStorage.getItem(REPORT_TPL_KEY) || "classic"; } catch { return "classic"; }
}
function setSelectedTemplateId(id){
  try { localStorage.setItem(REPORT_TPL_KEY, id); } catch {}
  syncTemplateUI();
  syncTemplateDependents();
}
async function loadTemplateCatalog(){
  // El usuario controla esto desde /templates/templates.json
  try{
    const res = await fetch("./templates/templates.json", { cache: "no-store" });
    if (!res.ok) throw new Error("templates.json not ok");
    const j = await res.json();
    if (j && Array.isArray(j.templates)) return j.templates;
  }catch{}
  // fallback
  return [
    { id:"classic", name:"Plantilla 1", subtitle:"", preview:"classic" },
    { id:"tags", name:"Plantilla 2", subtitle:"", preview:"tags" },
  ];
}

function buildPreviewHTML(id){
  if (id === "tags"){
    return `
      <div class="docMock">
        <div class="docTitle">Proyecto: Cementerio Local Restrepo</div>
        <div class="docMeta">Reporte fotográfico · Ejemplo</div>

        <div class="docGrid" style="gap:16px">
          ${buildTagsTableMock(1, 2)}
          ${buildTagsTableMock(3, 4)}
        </div>
      </div>
    `;
  }
  // classic default
  return `
    <div class="docMock">
      <div class="docTitle">Proyecto: Cementerio Local Restrepo</div>
      <div class="docMeta">Reporte fotográfico · Ejemplo</div>

      <div class="docGrid" style="grid-template-columns:repeat(2,1fr)">
        ${buildClassicPhotoMock(1)}
        ${buildClassicPhotoMock(2)}
        ${buildClassicPhotoMock(3)}
        ${buildClassicPhotoMock(4)}
        ${buildClassicPhotoMock(5)}
        ${buildClassicPhotoMock(6)}
      </div>
    </div>
  `;
}

function buildClassicPhotoMock(n){
  return `
    <div>
      <div class="docPhoto"></div>
      <div class="docCap"><b>FOTO ${n}</b> · Ítem: 4.2 · Reparcheo asfáltico. Descripción corta de ejemplo.</div>
    </div>
  `;
}
function buildTagsTableMock(n1, n2){
  return `
    <div>
      <table class="tagTable">
        <tr>
          <th style="width:16%">ÍTEM</th>
          <th>ACTIVIDAD</th>
          <th style="width:20%">UNIDAD</th>
        </tr>
        <tr>
          <td>4.2</td>
          <td>Reparcheo asfáltico en caliente</td>
          <td>m²</td>
        </tr>
      </table>

      <div class="docTwoCol" style="margin-top:10px">
        <div>
          <div class="tagPhotoBox"></div>
          <div class="tagCaption"><b>FOTO ${n1}</b>. Descripción de ejemplo.</div>
        </div>
        <div>
          <div class="tagPhotoBox"></div>
          <div class="tagCaption"><b>FOTO ${n2}</b>. Descripción de ejemplo.</div>
        </div>
      </div>
    </div>
  `;
}

function renderTemplateCards(list){
  const pick = $("tplPick");
  if (!pick) return;

  const current = getSelectedTemplateId();
  pick.innerHTML = "";

  const all = [
    ...list,
    { id:"soon", name:"Plantilla 3", subtitle:"Próximamente", preview:"soon", disabled:true }
  ];

  for (const t of all){
    const card = document.createElement("div");
    card.className = "tplCard" + (t.disabled ? " disabled" : "") + ((t.id === current) ? " active" : "");
    card.setAttribute("data-tpl", t.id);
    card.setAttribute("role", "button");
    card.tabIndex = t.disabled ? -1 : 0;

    if (t.id === "soon"){
      const b = document.createElement("div");
      b.className = "tplBadge";
      b.textContent = "PRONTO";
      card.appendChild(b);
    }

    const top = document.createElement("div");
    top.className = "tplTop";

    const left = document.createElement("div");
    left.innerHTML = `<div class="tplName">${tplEscapeHtml(t.name)}</div><div class="tplSub muted">${tplEscapeHtml(t.subtitle || "")}</div>`;

    const right = document.createElement("div");
    right.className = "tplRadioWrap";
    if (!t.disabled){
      right.innerHTML = `
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0">
          <input type="radio" name="reportTpl" value="${tplEscapeAttr(t.id)}" ${t.id===current ? "checked":""} />
          <span class="tplRadio" aria-hidden="true"><span class="tplRadioDot"></span></span>
        </label>
      `;
    } else {
      right.innerHTML = `<span class="tplRadio" aria-hidden="true"></span>`;
    }

    top.appendChild(left);
    top.appendChild(right);
    card.appendChild(top);

    pick.appendChild(card);
  }
}

function syncTemplateUI(){
  const pick = $("tplPick");
  if (!pick) return;
  const current = getSelectedTemplateId();
  pick.querySelectorAll(".tplCard").forEach(card => {
    card.classList.toggle("active", card.getAttribute("data-tpl") === current);
    const radio = card.querySelector('input[type="radio"][name="reportTpl"]');
    if (radio) radio.checked = (radio.value === current);
  });
}

function syncTemplateDependents(){
  const tpl = getSelectedTemplateId();
  const wrap = $("layoutWrap");
  if (wrap) wrap.style.display = (tpl === "classic") ? "" : "none";

  // Formato de salida: Ítems-Tabla por ahora SOLO PDF
  const fmtSel = $("expressFormat");
  if (fmtSel){
    const optDocx = fmtSel.querySelector('option[value="docx"]');
    if (tpl === "tags"){
      if (optDocx) optDocx.disabled = true;
      if (fmtSel.value === "docx") fmtSel.value = "pdf";
    } else {
      if (optDocx) optDocx.disabled = false;
    }
  }

  const msg = $("exportTplMsg");
  if (msg){
    if (tpl === "tags") msg.textContent = "Nota: Plantilla 2 exporta en PDF (por ahora).";
    else msg.textContent = "";
  }
}


function openTplModal(id){
  const modal = $("tplModal");
  const body = $("tplModalBody");
  const title = $("tplModalTitle");
  const choose = $("tplModalChoose");
  if (!modal || !body || !title || !choose) return;

  _tplModalCurrent = id;

  title.textContent = (id === "tags") ? "Plantilla 2" :
                      (id === "classic") ? "Plantilla 1" :
                      "Plantilla";
  body.innerHTML = buildPreviewHTML(id);

  modal.style.display = "block";
  modal.setAttribute("aria-hidden", "false");
}

function closeTplModal(){
  const modal = $("tplModal");
  if (!modal) return;
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
  _tplModalCurrent = null;
}

async function initTemplateUI(){
  const pick = $("tplPick");
  if (!pick) return;

  _tplCatalog = await loadTemplateCatalog();
  renderTemplateCards(_tplCatalog);

  // Interacciones
  pick.addEventListener("change", (e) => {
    const radio = e.target.closest('input[type="radio"][name="reportTpl"]');
    if (!radio) return;
    setSelectedTemplateId(radio.value);
  });

  pick.addEventListener("click", (e) => {
    const card = e.target.closest(".tplCard");
    if (!card) return;
    // Si clickeó el radio, no abrir preview
    if (e.target && (e.target.tagName === "INPUT")) return;

    const id = card.getAttribute("data-tpl");
    if (card.classList.contains("disabled") || id === "soon"){
      alert("Próximamente ✅");
      return;
    }
    openTplModal(id);
  });

  pick.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const card = e.target.closest(".tplCard");
    if (!card || card.classList.contains("disabled")) return;
    const id = card.getAttribute("data-tpl");
    if (id === "soon") return;
    openTplModal(id);
  });

  // Modal events
  $("tplModalClose")?.addEventListener("click", closeTplModal);
  $("tplModalBackdrop")?.addEventListener("click", closeTplModal);
  $("tplModalChoose")?.addEventListener("click", () => {
    if (!_tplModalCurrent) return;
    setSelectedTemplateId(_tplModalCurrent);
    closeTplModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeTplModal();
  });

  // defaults
  syncTemplateUI();
  syncTemplateDependents();
}

/* helpers */
function tplEscapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function tplEscapeAttr(s){ return tplEscapeHtml(s).replace(/"/g, "&quot;"); }

/* ===========================
   URLs temporales
=========================== */
let activeUrls = [];
function trackUrl(u){ activeUrls.push(u); return u; }
function revokeActiveUrls(){
  for (const u of activeUrls) {
    try { URL.revokeObjectURL(u); } catch {}
  }
  activeUrls = [];
}

/* ===========================
   Preferencias (DOCX fit)
=========================== */
function loadDocxFit(){
  const v = localStorage.getItem("logi_docx_fit") || "stretch";
  $("docxFit").value = v;
}
$("docxFit").onchange = () => localStorage.setItem("logi_docx_fit", $("docxFit").value);

$("templateSelect")?.addEventListener("change", () => setTemplateId($("templateSelect").value));

/* ===========================
   LOGO
=========================== */
let logoDataUrl = null;
let logoBitmap = null;

async function dataUrlToBitmap(dataUrl){
  try{
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    if (window.createImageBitmap) return await createImageBitmap(blob);
  }catch{}
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function syncLogoButtons(){
  const has = !!logoDataUrl;
  const q = document.getElementById("btnQuitarLogo");
  if (q) q.style.display = has ? "inline-flex" : "none";
}

async function loadLogoFromStorage(){
  // Nota: el logo NO se incrusta en la foto al capturar. Solo se aplica al exportar/compartir.
  localStorage.setItem("logi_logo_enabled","0");
  logoDataUrl = localStorage.getItem("logi_logo_dataurl");
if (logoDataUrl){
    $("logoPreview").src = logoDataUrl;
    $("logoPreview").style.display = "inline-block";
    try { logoBitmap = await dataUrlToBitmap(logoDataUrl); } catch { logoBitmap = null; }
  } else {
    $("logoPreview").style.display = "none";
    logoBitmap = null;
  }
  syncLogoButtons();
}

function loadLogoCorner(){
  const v = localStorage.getItem("logi_logo_corner") || "br";
  const el = document.getElementById("logoCorner");
  if (el) el.value = v;
}
{
  const el = document.getElementById("logoCorner");
  if (el) el.onchange = () => localStorage.setItem("logi_logo_corner", el.value);
}
{ const b = document.getElementById("btnCargarLogo"); if (b) b.onclick = () => document.getElementById("logoInput")?.click(); }
{ const inp = document.getElementById("logoInput"); if (inp) inp.onchange = async () => {
  const file = $("logoInput").files?.[0];
  if (!file) return;

  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });

  localStorage.setItem("logi_logo_dataurl", dataUrl);
  logoDataUrl = dataUrl;

  $("logoPreview").src = dataUrl;
  $("logoPreview").style.display = "inline-block";

  try {
    logoBitmap = await dataUrlToBitmap(dataUrl);
    syncLogoButtons();
    alert("Logo cargado ✅");
  } catch {
    alert("No pude cargar el logo. Prueba con un PNG.");
  } finally {
    $("logoInput").value = "";
  }
}; } 

{ const bq = document.getElementById("btnQuitarLogo"); if (bq) bq.onclick = async () => {
  if (!confirm("¿Quitar el logo cargado?")) return;
  localStorage.removeItem("logi_logo_dataurl");
  logoDataUrl = null;
  logoBitmap = null;
  $("logoPreview").src = "";
  $("logoPreview").style.display = "none";
  syncLogoButtons();
  alert("Logo quitado ✅");
}; } 

/* ===========================
   Helpers esquina
=========================== */
function oppositeCorner(c){
  if (c === "br") return "tl";
  if (c === "tl") return "br";
  if (c === "bl") return "tr";
  if (c === "tr") return "bl";
  return "bl";
}

/* ===========================
   Compresión (captura)
=========================== */
function drawLogoAtCorner(ctx, W, H, corner, alpha=0.85){
  if (!logoBitmap) return false;

  const margin = Math.round(Math.min(W, H) * 0.02);
  const targetW = Math.round(W * 0.18);

  const lw = logoBitmap.width || logoBitmap.naturalWidth;
  const lh = logoBitmap.height || logoBitmap.naturalHeight;
  if (!lw || !lh) return false;

  const s = targetW / lw;
  const targetH = Math.round(lh * s);

  let x = W - targetW - margin;
  let y = H - targetH - margin;
  if (corner === "bl") { x = margin; y = H - targetH - margin; }
  if (corner === "tr") { x = W - targetW - margin; y = margin; }
  if (corner === "tl") { x = margin; y = margin; }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(logoBitmap, x, y, targetW, targetH);
  ctx.restore();

  return true;
}

function drawStampAtCorner(ctx, W, H, text, corner){
  const pad = Math.round(Math.min(W, H) * 0.02);
  const fontSize = Math.max(18, Math.round(Math.min(W, H) * 0.035));

  ctx.save();
  ctx.font = `700 ${fontSize}px Calibri, Arial, sans-serif`;
  ctx.textBaseline = "bottom";

  const metrics = ctx.measureText(text);
  const boxW = Math.round(metrics.width + pad * 1.4);
  const boxH = Math.round(fontSize + pad * 1.2);

  let x = pad;
  let y = H - pad;
  if (corner === "br") { x = W - pad; y = H - pad; }
  if (corner === "tr") { x = W - pad; y = pad + boxH; }
  if (corner === "tl") { x = pad; y = pad + boxH; }

  let boxX, boxY;
  if (corner === "bl"){
    boxX = x - Math.round(pad*0.6);
    boxY = y - boxH;
  } else if (corner === "br"){
    boxX = x - boxW + Math.round(pad*0.6);
    boxY = y - boxH;
  } else if (corner === "tr"){
    boxX = x - boxW + Math.round(pad*0.6);
    boxY = y - boxH;
  } else {
    boxX = x - Math.round(pad*0.6);
    boxY = y - boxH;
  }

  ctx.fillStyle = "rgba(2, 6, 23, 0.55)";
  ctx.fillRect(boxX, boxY, boxW, boxH);

  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.textAlign = (corner === "br" || corner === "tr") ? "right" : "left";
  ctx.fillText(text, x, y - Math.round(pad*0.3));

  ctx.restore();
}

async function compressImage(file, maxSide=1600, quality=0.82){
  if (!file.type.startsWith("image/")) return { blob: file, hasLogo: false };

  const img = new Image();
  const url = URL.createObjectURL(file);

  await new Promise((res, rej) => {
    img.onload = () => res();
    img.onerror = rej;
    img.src = url;
  });

  const w = img.naturalWidth, h = img.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(w,h));
  const nw = Math.round(w * scale);
  const nh = Math.round(h * scale);

  const canvas = document.createElement("canvas");
  canvas.width = nw; canvas.height = nh;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, nw, nh);

  URL.revokeObjectURL(url);

  const enabled = false; // nunca incrustamos logo en captura
  const corner = localStorage.getItem("logi_logo_corner") || "br";
  const hadLogo = false;

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  return { blob: blob || file, hasLogo: !!hadLogo };
}

/* ===========================
   Overlays (logo + fecha/hora)
=========================== */
function roundRectPath(ctx, x, y, w, h, r){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}

function wrapLine(ctx, text, maxW){
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const out = [];
  let cur = words[0];
  for (let i=1;i<words.length;i++){
    const test = cur + " " + words[i];
    if (ctx.measureText(test).width <= maxW) cur = test;
    else { out.push(cur); cur = words[i]; }
  }
  out.push(cur);
  return out;
}

function chooseTextCornerForLogo(logoCorner){
  // Preferimos la esquina inferior opuesta horizontalmente al logo
  if (logoCorner === "bl" || logoCorner === "tl") return "br";
  return "bl";
}

function drawTemplateBlock(ctx, W, H, lines, logoCorner){
  const clean = (lines || []).map(s => String(s || "").trim()).filter(Boolean);
  if (!clean.length) return;

  const corner = chooseTextCornerForLogo(logoCorner || "br");
  const pad = Math.round(Math.min(W, H) * 0.02);
  const maxW = Math.round(W * 0.86);

  // Tipografía
  const base = Math.max(18, Math.round(Math.min(W, H) * 0.035));
  const titleSize = base + 2;
  const bodySize = base;

  // Pre-medición con wrapping
  const temp = [];
  ctx.save();
  ctx.textBaseline = "top";

  // línea 1 (más fuerte)
  ctx.font = `900 ${titleSize}px Calibri, Arial, sans-serif`;
  const first = wrapLine(ctx, clean[0], maxW);
  temp.push(...first.map(t => ({ t, size: titleSize, weight: 900 })));

  // resto
  ctx.font = `700 ${bodySize}px Calibri, Arial, sans-serif`;
  for (let i=1;i<clean.length;i++){
    const wrapped = wrapLine(ctx, clean[i], maxW);
    temp.push(...wrapped.map(t => ({ t, size: bodySize, weight: 700 })));
  }

  const lineGap = Math.round(bodySize * 0.35);
  let textW = 0;
  temp.forEach(L => {
    ctx.font = `${L.weight} ${L.size}px Calibri, Arial, sans-serif`;
    textW = Math.max(textW, ctx.measureText(L.t).width);
  });

  const textH = temp.reduce((sum, L) => sum + L.size + lineGap, 0) - lineGap;
  const boxW = Math.round(textW + pad * 1.6);
  const boxH = Math.round(textH + pad * 1.4);

  let x = pad, y = H - pad - boxH;
  if (corner === "br") x = W - pad - boxW;

  // fondo
  ctx.fillStyle = "rgba(2, 6, 23, 0.58)";
  roundRectPath(ctx, x, y, boxW, boxH, Math.round(pad*0.8));
  ctx.fill();

  // texto
  let cy = y + Math.round(pad*0.7);
  for (const L of temp){
    ctx.font = `${L.weight} ${L.size}px Calibri, Arial, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.fillText(L.t, x + Math.round(pad*0.8), cy);
    cy += L.size + lineGap;
  }

  ctx.restore();
}

async function applyExportOverlaysToBlob(originalBlob, options){
  const { addLogo, addStamp, stampText, avoidDoubleLogo, addTemplate, templateLines, logoCornerHint } = options;

  const bmp = await createImageBitmap(originalBlob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0);

  const logoCorner = localStorage.getItem("logi_logo_corner") || "br";

  const willHaveLogo =
    (addLogo && logoBitmap && !avoidDoubleLogo) ||
    (avoidDoubleLogo === true);

  if (addLogo && logoBitmap && !avoidDoubleLogo){
    drawLogoAtCorner(ctx, canvas.width, canvas.height, logoCorner, 0.85);
  }

  if (addStamp && stampText){
    let stampCorner = willHaveLogo ? oppositeCorner(logoCorner) : "tr";
    // si hay plantilla, preferimos arriba para evitar choque con el bloque inferior
    if (addTemplate) stampCorner = (logoCorner === "bl" || logoCorner === "tl") ? "tr" : "tl";
    if (stampCorner === "bl" || stampCorner === "br") stampCorner = "tr";
    drawStampAtCorner(ctx, canvas.width, canvas.height, stampText, stampCorner);
  }


  // Plantilla (bloque de texto) — se dibuja al final para que quede legible
  if (addTemplate && Array.isArray(templateLines) && templateLines.length){
    const lc = logoCornerHint || logoCorner;
    drawTemplateBlock(ctx, canvas.width, canvas.height, templateLines, lc);
  }

  const out = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.9));
  return out || originalBlob;
}

/* ===========================
   Estado / Datos
=========================== */
let cache = [];
let viewMode = "captura";

function setStatus(){
  const count = cache.length;
  const doneCount = cache.filter(x => x.done).length;
  const totalBytes = cache.reduce((a,i)=>a+(i.blob?.size||0),0);

  let minDate = null, maxDate = null;
  for (const it of cache){
    if (!it.fecha) continue;
    if (!minDate || it.fecha < minDate) minDate = it.fecha;
    if (!maxDate || it.fecha > maxDate) maxDate = it.fecha;
  }
  rangeInfo.textContent = minDate ? `Rango: ${minDate} → ${maxDate}` : "Rango: —";

  statusEl.innerHTML =
    `<span class="${count? 'ok':''}">${count} foto(s)</span>` +
    ` · <span class="muted">${doneCount} listas</span>` +
    ` · <span class="muted">${fmtBytes(totalBytes)}</span>`;
}

function groupByDate(items){
  const map = new Map();
  for (const it of items){
    const d = it.fecha || "Sin_fecha";
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(it);
  }
  const dates = Array.from(map.keys()).sort((a,b)=> b.localeCompare(a));
  return dates.map(d => {
    const arr = map.get(d).slice().sort((x,y)=> (x.createdAt - y.createdAt));
    return [d, arr];
  });
}

/* ===========================
   Render: Captura
=========================== */
function renderCaptura(){
  lista.innerHTML = "";
  setStatus();

  const fecha = fechaInput.value || hoyISO();
  const items = cache
    .filter(x => x.fecha === fecha)
    .sort((a,b)=> (a.done === b.done ? (a.createdAt - b.createdAt) : (a.done - b.done)));

  if (!items.length){
    lista.innerHTML = `<div class="muted">No hay fotos guardadas para ${fecha}.</div>`;
    return;
  }

  items.forEach((item, idx) => {
    const div = document.createElement("div");
    div.className = "item" + (item.done ? " done" : "");

    const thumbUrl = trackUrl(URL.createObjectURL(item.blob));
    const shareDisabled = !item.done;

    div.innerHTML = `
      <div class="itemTop">
        <img class="thumb ${String(item.itemCode||"").trim() ? "" : "thumbMissing"}" src="${thumbUrl}" data-open="${item.id}" alt="foto">
        <div class="grow">
          <div class="mini">
            <span>#${idx+1} · ${item.fecha}</span>
            ${item.proyecto ? `<span>· ${item.proyecto}</span>` : `<span>· —</span>`}
            ${item.itemCode ? `<span>· ${item.itemCode}</span>` : ``}
            ${item.done ? `<span class="chip-done">LISTO</span>` : ``}
          </div>

          <label style="margin-top:6px">Ítem (opcional)</label>
          <input data-id="${item.id}" class="itSel" type="text" list="datalistItems" placeholder="Código o busca en el listado…" ${item.done ? "disabled" : ""} value="${escAttr(item.itemCode || "")}"/>
          <div class="muted" style="margin-top:4px" data-ithint="${item.id}">${item.itemCode ? (catalogMap[item.itemCode] ? catalogMap[item.itemCode] : "") : ""}</div>

          <label style="margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:10px">
  <span>Descripción</span>
  <button class="btn btn-secondary smallBtn dictate" data-id="${item.id}" title="Dictar (voz)" ${item.done ? "disabled" : ""}>🎙️</button>
</label>
<textarea data-id="${item.id}" class="desc" ${item.done ? "disabled" : ""}>${item.descripcion || ""}</textarea>

          <div class="row" style="margin-top:8px;justify-content:space-between;">
            <div class="row">
              <button class="btn btn-secondary smallBtn toggleDone" data-id="${item.id}">
                ${item.done ? "✏️ Editar" : "✅ Listo"}
              </button>

              <button class="btn btn-secondary smallBtn shareOne ${shareDisabled ? "btn-disabled" : ""}" data-id="${item.id}" ${shareDisabled ? "disabled" : ""}>
                📤 WhatsApp
              </button>
            </div>

            <div class="right">
              <button class="btn btn-danger smallBtn del" data-id="${item.id}">🗑️</button>
            </div>
          </div>
        </div>
      </div>
    `;
    lista.appendChild(div);
  });

  wireEventsCaptura();
}


function wireEventsCaptura(){
  document.querySelectorAll("textarea.desc").forEach(t => {
    t.oninput = async () => {
      const id = Number(t.dataset.id);
      const obj = cache.find(x => x.id === id);
      if (!obj) return;
      obj.descripcion = t.value;
      await dbPut(obj);
    };
  });

  // 🎙️ Dictado por voz: botón por foto (captura)
  document.querySelectorAll("button.dictate").forEach(b => {
    b.onclick = () => {
      const id = Number(b.dataset.id);
      const t = document.querySelector(`textarea.desc[data-id="${id}"]`);
      startDictation(t, b);
    };
  });
  document.querySelectorAll("input.itSel").forEach(inp => {
    inp.oninput = async () => {
      const id = Number(inp.dataset.id);
      const obj = cache.find(x => x.id === id);
      if (!obj || obj.done) return;
      const code = (inp.value || "").trim();
      obj.itemCode = code;
      obj.itemDesc = (code && catalogMap[code]) ? catalogMap[code] : "";
      await dbPut(obj);
      const h = document.querySelector(`[data-ithint="${id}"]`);
      if (h) h.textContent = obj.itemDesc || "";
    };
  });

  document.querySelectorAll("button.del").forEach(b => {
    b.onclick = async () => {
      const id = Number(b.dataset.id);
      if (!confirm("¿Eliminar esta foto?")) return;
      await dbDelete(id);
      cache = cache.filter(x => x.id !== id);
      render();
    };
  });

  document.querySelectorAll("button.toggleDone").forEach(b => {
    b.onclick = async () => {
      const id = Number(b.dataset.id);
      const obj = cache.find(x => x.id === id);
      if (!obj) return;
      obj.done = !obj.done;
      await dbPut(obj);
      render();
    };
  });

  document.querySelectorAll("button.shareOne").forEach(b => {
    b.onclick = async () => {
      const id = Number(b.dataset.id);
      const obj = cache.find(x => x.id === id);
      if (!obj) return;
      await shareOnlyImage(obj);
    };
  });

  document.querySelectorAll("img.thumb").forEach(img => {
    img.onclick = () => openModal(Number(img.dataset.open));
  });
}

/* ===========================
   Render: Galería
=========================== */
function renderGaleria(){
  setStatus();
  const wrap = $("galleryWrap");
  wrap.innerHTML = "";
  const gcode = getGalleryItemCode();
  let source = cache;
  if (gcode) source = cache.filter(x => String(x.itemCode || "").trim() === gcode);

  const groups = groupByDate(source);

  const ri = $("rangeInfo");
  if (ri && gcode){
    const base = ri.textContent || "Rango: —";
    ri.textContent = base.includes("Ítem:") ? base : (base + ` · Ítem: ${gcode}`);
  }
if (!groups.length){
    wrap.innerHTML = `<div style="padding:12px" class="muted">Aún no hay fotos guardadas.</div>`;
    return;
  }

  for (const [date, items] of groups){
    const day = document.createElement("div");
    const doneCount = items.filter(x => x.done).length;
    const bytes = items.reduce((a,i)=>a+(i.blob?.size||0),0);
    const missItemCount = items.filter(x => !(String(x.itemCode || "").trim())).length;

    day.innerHTML = `
      <div class="dayHeader">
        <div class="dayTitle"><span class="dayChip">${formatDateLongES(date)}</span></div>
        <div class="dayMeta">· ${items.length} foto(s) · ${doneCount} listas${missItemCount ? ` · ${missItemCount} sin ítem` : ``} · ${fmtBytes(bytes)}</div>
      </div>
      <div class="gridThumbs" data-day="${date}"></div>
    `;
    wrap.appendChild(day);

    const grid = day.querySelector(".gridThumbs");
    items.forEach(it => {
      const box = document.createElement("div");
      box.className = "gThumbBox";
	  const t = getThumbSrc(it);
      const hasItem = !!String(it.itemCode || "").trim();
      const codeShort = hasItem ? String(it.itemCode || "").trim().slice(0, 14) : "";
      box.innerHTML = `
	    <img class="gThumb ${hasItem ? "" : "gThumbMissing"} ${t.missing ? "gThumbNoFile" : ""}" src="${t.src}" data-open="${it.id}" alt="foto">
        <div class="badge ${it.done ? "badgeDone" : ""}">${it.done ? "LISTO" : "PEND"}</div>
        <div class="badge badgeItem ${hasItem ? "badgeItemOk" : "badgeItemMiss"}">${hasItem ? escAttr(codeShort) : "ÍTEM?"}</div>
        <div class="badge badgeShare">📤</div>
      `;
      grid.appendChild(box);
    });
  }

  wrap.querySelectorAll("img.gThumb").forEach(img => {
    img.onclick = () => openModal(Number(img.dataset.open));
  });
}

/* ===========================
   Modal
=========================== */
let modalId = null;

function openModal(id){
  const it = cache.find(x => x.id === id);
  if (!it) return;

  modalId = id;
  $("modal").classList.add("open");

  const t = getThumbSrc(it);
  $("modalImg").src = t.src;

  $("modalTitle").textContent = it.proyecto ? it.proyecto : "Foto";
  $("modalMeta").textContent = `${it.fecha} · ${it.done ? "LISTA" : "PENDIENTE"}${t.missing ? " · ⚠️ sin archivo" : ""}`;

  $("modalItem").value = it.itemCode || "";
  $("modalItem").disabled = !!it.done;
  $("modalItemHint").textContent = (it.itemCode && catalogMap[it.itemCode]) ? catalogMap[it.itemCode] : "—";

  $("modalDesc").value = it.descripcion || "";
  $("modalDesc").disabled = !!it.done;

  $("btnModalDone").textContent = it.done ? "✏️ Editar" : "✅ Listo";
  // Si no hay archivo, no se puede compartir (aunque esté "lista").
  $("btnModalShare").disabled = !it.done || t.missing;
  $("btnModalShare").classList.toggle("btn-disabled", !it.done);
}

function closeModal(){
  if (typeof dictation !== "undefined" && dictation.active) stopDictation();
  $("modal").classList.remove("open");
  $("modalImg").src = "";
  modalId = null;
}

$("btnModalClose").onclick = closeModal;
$("modal").addEventListener("click", (e) => {
  if (dictation.active) stopDictation();
  if (e.target.id === "modal") closeModal();
});


$("modalItem").oninput = async () => {
  if (modalId == null) return;
  const it = cache.find(x => x.id === modalId);
  if (!it || it.done) return;
  const code = ($("modalItem").value || "").trim();
  it.itemCode = code;
  it.itemDesc = (code && catalogMap[code]) ? catalogMap[code] : "";
  $("modalItemHint").textContent = it.itemDesc || "—";
  await dbPut(it);
  // refrescar hints en captura
  const h = document.querySelector(`[data-ithint="${it.id}"]`);
  if (h) h.textContent = it.itemDesc || "";
};

$("modalDesc").oninput = async () => {
  if (modalId == null) return;
  const it = cache.find(x => x.id === modalId);
  if (!it || it.done) return;
  it.descripcion = $("modalDesc").value;
  await dbPut(it);
};

$("btnModalDone").onclick = async () => {
  if (modalId == null) return;
  const it = cache.find(x => x.id === modalId);
  if (!it) return;
  it.done = !it.done;
  await dbPut(it);
  render();
  openModal(it.id);
};

$("btnModalDelete").onclick = async () => {
  if (modalId == null) return;
  const it = cache.find(x => x.id === modalId);
  if (!it) return;
  if (!confirm("¿Eliminar esta foto?")) return;
  await dbDelete(it.id);
  cache = cache.filter(x => x.id !== it.id);
  closeModal();
  render();
};


// 🎙️ Dictado por voz en modal
$("btnModalDictate").onclick = () => {
  startDictation($("modalDesc"), $("btnModalDictate"));
};
$("btnModalShare").onclick = async () => {
  if (modalId == null) return;
  const it = cache.find(x => x.id === modalId);
  if (!it) return;
  await shareOnlyImage(it);
};

/* ===========================
   WhatsApp (solo imagen)
=========================== */
async function shareOnlyImage(it){
  const safeProject = sanitizeName(it.proyecto || "Foto");
  const name = `${it.fecha}_${safeProject}.jpg`;

  let blobToShare = it.blob;

  const wantLogo = !!$("waAddLogo")?.checked;
  const wantTemplate = !!$("waAddTemplate")?.checked;
  const wantStamp = !!$("waAddStamp")?.checked;

    if (wantLogo || wantStamp || (wantTemplate && (getTemplateId() !== "classic") && (getTemplateId() !== "clean"))){
    blobToShare = await applyExportOverlaysToBlob(it.blob, {
      addLogo: wantLogo && !!logoBitmap,
      addStamp: wantStamp,
      stampText: wantStamp ? formatStampDateTime(it) : "",
      avoidDoubleLogo: wantLogo && !!it.hasLogo,
      addTemplate: wantTemplate && (getTemplateId() !== "classic") && (getTemplateId() !== "clean"),
      templateLines: (wantTemplate && (getTemplateId() !== "classic") && (getTemplateId() !== "clean")) ? buildTemplateLines(getTemplateMeta(it), getTemplateId()) : [],
      logoCornerHint: localStorage.getItem("logi_logo_corner") || "br"
    });
  }

  const file = new File([blobToShare], name, { type: "image/jpeg" });

  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))){
    try { await navigator.share({ files: [file], title: "Foto" }); return; }
    catch { return; }
  }

  const url = URL.createObjectURL(blobToShare);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  alert("Tu navegador no permite compartir archivos directo.\nSe descargó la foto para que la envíes por WhatsApp.");
}

/* ===========================
   Captura
=========================== */
$("btnTomarFoto").onclick = () => {
  camInput.value = "";
  camInput.click();
};

$("btnGaleria").onclick = () => {
  galInput.value = "";
  galInput.click();
};

async function ingestPhotos(fileList){
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const fecha = fechaInput.value || hoyISO();
  const activeProject = getActiveProject();
  const proyecto = activeProject ? activeProject.name : (proyectoInput.value || "").trim();
  const projectId = activeProject ? activeProject.id : null;

  zipInfo.textContent = `Procesando ${files.length} foto(s)...`;
  for (const file of files){
    const { blob, hasLogo } = await compressImage(file);

    const item = {
      id: Date.now() + Math.floor(Math.random()*1000),
      fecha,
      proyecto,
      descripcion: "",
      done: false,
      blob,
      mime: "image/jpeg",
      createdAt: Date.now(),
      hasLogo: !!hasLogo,
      projectId: projectId
    };

    await dbPut(item);
    cache.push(item);
  }

  zipInfo.textContent = "";
  render();
  updateStorageUI();
}

camInput.onchange = async () => {
  await ingestPhotos(camInput.files);
  camInput.value = "";
};

galInput.onchange = async () => {
  await ingestPhotos(galInput.files);
  galInput.value = "";
};



/* ===========================
   DOCX helpers + DOCX builder
=========================== */
function cmToPx(cm){ return Math.round((cm / 2.54) * 96); }

function computeRangeForTitle(modo, desde, hasta){
  if (modo === "mes"){
    const ym = (desde || hoyISO()).slice(0,7);
    const [y, m] = ym.split("-").map(Number);
    const start = `${ym}-01`;
    const last = new Date(y, m, 0).getDate();
    const end = `${ym}-${String(last).padStart(2,"0")}`;
    return { start, end };
  }
  if (modo === "dia") return { start: desde, end: desde };
  return { start: desde, end: hasta };
}

async function normalizeToFixedFrameJpg(blob, frameW=1600, frameH=1000, quality=0.9, fit="stretch"){
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = frameW;
  canvas.height = frameH;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0,0,frameW,frameH);

  const bw = bmp.width, bh = bmp.height;

  if (fit === "stretch"){
    ctx.drawImage(bmp, 0, 0, frameW, frameH);
  } else if (fit === "cover"){
    const scale = Math.max(frameW / bw, frameH / bh);
    const nw = Math.round(bw * scale);
    const nh = Math.round(bh * scale);
    const x = Math.round((frameW - nw) / 2);
    const y = Math.round((frameH - nh) / 2);
    ctx.drawImage(bmp, x, y, nw, nh);
  } else {
    const scale = Math.min(frameW / bw, frameH / bh);
    const nw = Math.round(bw * scale);
    const nh = Math.round(bh * scale);
    const x = Math.round((frameW - nw) / 2);
    const y = Math.round((frameH - nh) / 2);
    ctx.drawImage(bmp, x, y, nw, nh);
  }

  const out = await new Promise(res => canvas.toBlob(res, "image/jpeg", quality));
  return out || blob;
}

async function loadLogiLogoArrayBuffer(){
  // Cache-first + timeout para que NUNCA cuelgue el export (PWA/Android)
  // Nota: el nombre de los íconos cambia por versión, por eso leemos el manifest.
  const candidates = [];

  // 0) intentar tomar el icono 192 desde manifest (más confiable)
  try{
    const mReq = new Request("./manifest.webmanifest", { cache: "force-cache" });
    let mRes = null;
    if (window.caches && caches.match) mRes = await caches.match(mReq);
    if (!mRes) mRes = await fetch(mReq);
    if (mRes && mRes.ok){
      const m = await mRes.json();
      const icons = (m && Array.isArray(m.icons)) ? m.icons : [];
      const best = icons.find(i => String(i.sizes||"").includes("192")) || icons[0];
      if (best && best.src){
        const src = String(best.src).replace(/^\.\/?/, "");
        candidates.push("./" + src);
      }
    }
  }catch{}

  // 1) fallbacks conocidos
  candidates.push("./icon-192.png");
  candidates.push("./icon-192.v0.8.7.33.7.png");
  candidates.push("./apple-touch-icon.v0.8.7.33.7.png");
  candidates.push("./favicon.v0.8.7.33.7.png");

  const uniq = Array.from(new Set(candidates.filter(Boolean)));

  // 2) cache-first (offline)
  for (const url of uniq){
    try{
      if (window.caches && caches.match){
        const cached = await caches.match(url);
        if (cached) return await cached.arrayBuffer();
      }
    }catch{}
  }

  // 3) fetch con timeout
  for (const url of uniq){
    try{
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const r = await fetch(url, { cache: "force-cache", signal: ctrl.signal });
      clearTimeout(t);
      if (r && r.ok) return await r.arrayBuffer();
    }catch{}
  }

  return null;
}



// ===========================
// Ajuste automático de fuente (DOCX captions)
// Mantiene 8 fotos/página sin que el texto "reviente" la caja
// ===========================
const _CAPTION_MAX_LINES = 4;
const _CAPTION_FONT_PT_BASE = 9.5;
const _CAPTION_FONT_PT_MIN  = 6.5;

// Ancho útil aproximado del texto dentro de cada caption (cm)
// A4 (21cm) - márgenes (1.27cm*2) = 18.46cm; /2 columnas = 9.23cm
// menos márgenes internos del cell (~0.5cm) => ~8.7cm
const _CAPTION_TEXT_W_CM = 8.7;

let _measureCanvas = null;
function _getMeasureCtx(fontPx){
  if (!_measureCanvas) _measureCanvas = document.createElement("canvas");
  const ctx = _measureCanvas.getContext("2d");
  ctx.font = `${fontPx}px Calibri, Arial, sans-serif`;
  return ctx;
}
function _cmToPx96(cm){ return (cm / 2.54) * 96; }

function _wrapCountLines(text, fontPx, maxWidthPx){
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return 0;

  const ctx = _getMeasureCtx(fontPx);
  // para medir el prefijo en negrita
  if (!_measureCanvas) _measureCanvas = document.createElement("canvas");
  const ctxB = _measureCanvas.getContext("2d");
  ctxB.font = `bold ${fontPx}px Calibri, Arial, sans-serif`;

  const fits = (s, w) => ctx.measureText(s).width <= w;

  // Rompe un token sin espacios en trozos que quepan en 'wPx'
  const splitToken = (tok, wPx) => {
    const out = [];
    let chunk = "";
    for (const ch of tok){
      const t = chunk + ch;
      if (fits(t, wPx) || !chunk){
        chunk = t;
      } else {
        out.push(chunk);
        chunk = ch;
      }
    }
    if (chunk) out.push(chunk);
    return out;
  };

  // Consume tokens para armar UNA línea con límite 'wPx'. Devuelve { line, restTokens }
  const takeLine = (tokens, wPx) => {
    let line = "";
    let i = 0;
    while (i < tokens.length){
      let tok = tokens[i];

      // token gigante al inicio -> partirlo
      if (!line && !fits(tok, wPx)){
        const parts = splitToken(tok, wPx);
        line = parts[0] || "";
        const rest = parts.slice(1).concat(tokens.slice(i+1));
        return { line, restTokens: rest };
      }

      const test = line ? (line + " " + tok) : tok;
      if (fits(test, wPx)){
        line = test;
        i++;
      } else {
        break;
      }
    }
    return { line, restTokens: tokens.slice(i) };
  };

  // Wrap de tokens en múltiples líneas con límite 'wPx'
  const wrapTokens = (tokens, wPx) => {
    const lines = [];
    let rest = tokens.slice();
    while (rest.length){
      const r = takeLine(rest, wPx);
      if (r.line) lines.push(r.line);
      rest = r.restTokens;
      // safety: evita loops raros
      if (!r.line && rest.length) { lines.push(rest.shift()); }
    }
    return lines;
  };

  // Detecta prefijo real (como en el DOCX / PDF)
  const m = clean.match(/^(Foto No\. \d+,|FOTO \d+\.)\s*/);
  if (m){
    const prefix = m[1];
    const rest = clean.slice(m[0].length).trimStart();

    const spaceW = ctx.measureText(" ").width;
    const prefixW = ctxB.measureText(prefix).width;
    const firstMax = Math.max(20, maxWidthPx - prefixW - spaceW);

    const restTokens = rest ? rest.split(" ") : [];
    const first = takeLine(restTokens, firstMax);
    const other = wrapTokens(first.restTokens, maxWidthPx);

    // 1 línea inicial siempre existe por el prefijo
    return 1 + other.length;
  }

  // Sin prefijo: wrap normal
  const tokens = clean.split(" ");
  return wrapTokens(tokens, maxWidthPx).length;
}

function _fitCaptionFontPt(text){
  const maxWidthPx = _cmToPx96(_CAPTION_TEXT_W_CM);

  // búsqueda binaria de fontPx (pt -> px)
  const ptToPx = (pt) => (pt * 96) / 72;

  let lo = _CAPTION_FONT_PT_MIN;
  let hi = _CAPTION_FONT_PT_BASE;
  let best = lo;

  for (let i = 0; i < 10; i++){
    const mid = (lo + hi) / 2;
    const lines = _wrapCountLines(text, ptToPx(mid), maxWidthPx);
    if (lines <= _CAPTION_MAX_LINES){
      best = mid;
      lo = mid;
    }else{
      hi = mid;
    }
  }
  // redondeo a .1pt para estabilidad visual
  return Math.max(_CAPTION_FONT_PT_MIN, Math.min(_CAPTION_FONT_PT_BASE, Math.round(best*10)/10));
}

function buildCaptionRunsSized(n, caption, sizeHp){
  const prefixNew = `Foto No. ${n},`;
  const prefixOld = `FOTO ${n}.`;
  let prefix = prefixNew;
  if (caption.startsWith(prefixNew)) prefix = prefixNew;
  else if (caption.startsWith(prefixOld)) prefix = prefixOld;
  else prefix = "";

  const rest = prefix ? caption.slice(prefix.length).trimStart() : caption;
  const { TextRun } = window.docx;

  if (!prefix){
    return [ new TextRun({ text: caption, size: sizeHp }) ];
  }

  return [
    new TextRun({ text: prefix, bold: true, size: sizeHp }),
    new TextRun({ text: rest ? (" " + rest) : "", size: sizeHp })
  ];
}

// Compat: si algún otro lugar llama buildCaptionRuns, queda igual (9.5pt aprox)
function buildCaptionRuns(n, meta, templateId){
  const caption = buildDocxCaption(n, meta, templateId);
  return buildCaptionRunsSized(n, caption, Math.round(_CAPTION_FONT_PT_BASE*2));
}

async function buildRegistroFotograficoDocxBuffer(
  selected, tituloProyecto, startISO, endISO, imgWcm, imgHcm,
  pairsPerPage = 4,
  exportOpts=null
){
  const {
    Document, Packer, Paragraph, TextRun,
    AlignmentType, Table, TableRow, TableCell, WidthType,
    ImageRun, PageBreak, BorderStyle, Header, VerticalAlign, HeightRule
  } = window.docx;

  const docDefaultStyles = {
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 18 },
          paragraph: { spacing: { before: 0, after: 0 } }
        }
      }
    }
  };

  const BRAND_DARK = "0B1220";
  const BRAND_MID  = "111B2E";
  const BRAND_ACC  = "3B82F6";
  const GRID_COL   = "2F6FED"; // bordes un poquito más sobrios
  const CAPTION_ROW_H = 1120; // twips (~2.1cm) -> 4 líneas sin desbordar

  const noneBorders = {
    top:    { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    left:   { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    right:  { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  };

  const gridBorders = {
    top:    { style: BorderStyle.SINGLE, size: 2, color: GRID_COL },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: GRID_COL },
    left:   { style: BorderStyle.SINGLE, size: 2, color: GRID_COL },
    right:  { style: BorderStyle.SINGLE, size: 2, color: GRID_COL },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: GRID_COL },
    insideVertical:   { style: BorderStyle.SINGLE, size: 2, color: GRID_COL },
  };

  const IMG_W = cmToPx(imgWcm);
  const IMG_H = cmToPx(imgHcm);

  const ratio = IMG_W / IMG_H;
  let frameW = 1600;
  if ((selected?.length || 0) > 240) frameW = 1000;
  else if ((selected?.length || 0) > 120) frameW = 1200;
  const frameH = Math.round(frameW / ratio);
  const fitMode = localStorage.getItem("logi_docx_fit") || "stretch";

  const startLong = formatDateLongES(startISO);
  const endLong = formatDateLongES(endISO);
  const sameDay = (startISO === endISO);

  const titleLine = sameDay
    ? `Reporte fotográfico · ${startLong}`
    : `Reporte fotográfico · ${startLong} — ${endLong}`;

  const projText = (tituloProyecto || "").trim();

  // Proyecto en encabezado (máx 2 líneas, con "…" si recorta)
  function wrapProjectHeaderText(text, maxCharsPerLine=30, maxLines=2){
    const s = String(text || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    const words = s.split(" ").filter(Boolean);
    const lines = [];
    let line = "";

    for (const w of words){
      const test = line ? (line + " " + w) : w;
      if (test.length <= maxCharsPerLine){
        line = test;
      } else {
        if (line) lines.push(line);
        line = w;
        if (maxLines && lines.length >= maxLines) break;
      }
    }
    if ((!maxLines || lines.length < maxLines) && line) lines.push(line);

    // Si recortó, agrega "…" al final de la última línea
    if (maxLines && lines.length === maxLines && words.length){
      const joined = lines.join(" ");
      if (joined.length < s.length){
        let last = lines[lines.length - 1];
        if (!last.endsWith("…")){
          // intenta agregar sin pasarse del máximo
          if ((last + "…").length <= maxCharsPerLine) lines[lines.length - 1] = last + "…";
          else {
            // recorta un poco y pone elipsis
            const cut = Math.max(0, maxCharsPerLine - 1);
            lines[lines.length - 1] = last.slice(0, cut) + "…";
          }
        }
      }
    }

    return lines.slice(0, maxLines).join("\n");
  }

  const projHeaderText = wrapProjectHeaderText(projText, 30, 2);
  // Unique IDs for Word drawings (fix wp:docPr / pic:cNvPr duplicates)
  let __drawingId = 0;


  // Logo (opcional)
  const logoAb = await loadLogiLogoArrayBuffer();
  const logoRun = logoAb ? new ImageRun({
    data: logoAb,
    transformation: { width: 38, height: 38 },
    docProperties: { id: ++__drawingId, name: `Logo ${__drawingId}` }
  }) : null;
  // Header moderno (tabla con 2 tonos + línea de acento)
  const headerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noneBorders,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 18, type: WidthType.PERCENTAGE },
            borders: noneBorders,
            shading: { fill: BRAND_DARK },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 140, bottom: 140, left: 160, right: 120 },
            children: [
              new Paragraph({
                children: logoRun ? [logoRun] : [new TextRun({ text: " ", color: "FFFFFF" })],
                alignment: AlignmentType.LEFT,
              })
            ]
          }),
          new TableCell({
            width: { size: 82, type: WidthType.PERCENTAGE },
            borders: noneBorders,
            shading: { fill: BRAND_MID },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 140, bottom: 140, left: 120, right: 220 },
            children: [
              // Fila superior: Proyecto (izquierda) + Logi (derecha)
              new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                borders: noneBorders,
                rows: [
                  new TableRow({
                    children: [
                      new TableCell({
                        width: { size: 70, type: WidthType.PERCENTAGE },
                        borders: noneBorders,
                        margins: { top: 0, bottom: 0, left: 0, right: 0 },
                        children: [
                          new Paragraph({
                            children: projHeaderText
                              ? [new TextRun({ text: projHeaderText, bold: true, color: "FFFFFF", size: 36 })]
                              : [new TextRun({ text: "", color: "FFFFFF" })],
                            alignment: AlignmentType.LEFT,
                            spacing: { before: 0, after: 0 }
                          })
                        ]
                      }),
                      new TableCell({
                        width: { size: 30, type: WidthType.PERCENTAGE },
                        borders: noneBorders,
                        margins: { top: 0, bottom: 0, left: 0, right: 0 },
                        children: [
                          new Paragraph({
                            children: [new TextRun({ text: "Logi", bold: true, color: "FFFFFF", size: 44 })],
                            alignment: AlignmentType.RIGHT,
                            spacing: { before: 0, after: 0 }
                          })
                        ]
                      })
                    ]
                  })
                ]
              }),

              // Segunda fila: rango/fecha del reporte
              new Paragraph({
                children: [new TextRun({ text: titleLine, bold: true, color: "E5E7EB" })],
                alignment: AlignmentType.RIGHT,
                spacing: { before: 40, after: 0 }
              })
            ]
          })
        ]
      }),
      new TableRow({
        children: [
          new TableCell({
            borders: noneBorders,
            shading: { fill: BRAND_ACC },
            columnSpan: 2,
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            children: [ new Paragraph({ children: [new TextRun({ text: " " })] }) ]
          })
        ]
      })
    ]
  });

  const header = new Header({ children: [headerTable] });

  // Construcción de tabla: por cada par de fotos => 2 filas
  let pageRows = [];
  let pairCount = 0;
  let photoN = 1;
  const pages = [];

  const onProgress = exportOpts && exportOpts.onProgress ? exportOpts.onProgress : null;
  const _docxTotal = selected.length;
  let _docxDone = 0;

  async function makeImageCell(it){
    if (!it){
      return new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: gridBorders, children: [new Paragraph("")] });
    }

    const fixedBlob = await normalizeToFixedFrameJpg(it.blob, frameW, frameH, 0.9, fitMode);

    let finalBlob = fixedBlob;
    if (exportOpts?.applyLogo || exportOpts?.applyStamp || exportOpts?.applyTemplate){
      finalBlob = await applyExportOverlaysToBlob(fixedBlob, {
        addLogo: !!exportOpts.applyLogo,
        addStamp: !!exportOpts.applyStamp,
        stampText: exportOpts.applyStamp ? formatStampDateTime(it) : "",
        avoidDoubleLogo: !!(it.hasLogo && exportOpts.applyLogo),
        addTemplate: !!exportOpts.applyTemplate && (exportOpts.templateId !== "classic") && (exportOpts.templateId !== "clean"),
        templateLines: (!!exportOpts.applyTemplate && (exportOpts.templateId !== "classic") && (exportOpts.templateId !== "clean")) ? buildTemplateLines(getTemplateMeta(it), exportOpts.templateId) : [],
        logoCornerHint: localStorage.getItem("logi_logo_corner") || "br"
      });
    }

    const ab = await finalBlob.arrayBuffer();

    const img = new ImageRun({

      data: ab,

      transformation: { width: IMG_W, height: IMG_H },

      docProperties: { id: ++__drawingId, name: `Picture ${__drawingId}` }

    });
    if (it) {
      _docxDone++;
      if (onProgress) await onProgress(_docxDone, _docxTotal);
    }

    return new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders: gridBorders,
      margins: { top: 80, bottom: 80, left: 80, right: 80 },
      children: [
        new Paragraph({
          children: [img],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 0 }
        })
      ]
    });
  }

  function makeCaptionCell(it, n){
    if (!it){
      return new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: gridBorders, children: [new Paragraph("")] });
    }
    const meta = getTemplateMeta(it);
    const templateId = (exportOpts && exportOpts.templateId) ? exportOpts.templateId : "classic";
    const caption = buildDocxCaption(n, meta, templateId);
    const fontPt = _fitCaptionFontPt(caption);
    const sizeHp = Math.round(fontPt * 2);
    const runs = buildCaptionRunsSized(n, caption, sizeHp);

    return new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders: gridBorders,
      margins: { top: 120, bottom: 120, left: 160, right: 120 },
      children: [
        new Paragraph({
          children: runs,
          spacing: { before: 0, after: 0 }
        })
      ]
    });
  }

  for (let i = 0; i < selected.length; i += 2){
    const left = selected[i] || null;
    const right = selected[i+1] || null;

    const nLeft = left ? photoN++ : null;
    const nRight = right ? photoN++ : null;

    const imageRow = new TableRow({
      children: [ await makeImageCell(left), await makeImageCell(right) ]
    });
    const captionRow = new TableRow({
      height: { value: CAPTION_ROW_H, rule: HeightRule.EXACT },
      children: [ makeCaptionCell(left, nLeft), makeCaptionCell(right, nRight) ]
    });

    pageRows.push(imageRow, captionRow);
    pairCount++;

    if (pairCount >= pairsPerPage){
      pages.push(pageRows);
      pageRows = [];
      pairCount = 0;
    }
  }
  if (pageRows.length) pages.push(pageRows);

  const children = [];
  pages.forEach((rows, idx) => {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: gridBorders,
      rows
    }));
});

  const doc = new Document({
    ...docDefaultStyles,
    sections: [{
      headers: { default: header },
      properties: {
        page: { margin: { top: 720, bottom: 720, left: 720, right: 720, header: 260 } }
      },
      children
    }]
  });

  const blob = await Packer.toBlob(doc);
  let ab = await blob.arrayBuffer();
  ab = await sanitizeDocxPackageArrayBuffer(ab);
  return ab;
  }

/* ===========================
   CSV + XLS
=========================== */
function buildManifestCsv(registros){
  const header = ["fecha","archivo","item","item_desc","descripcion","proyecto","listo"].join(";");
  const lines = [header];
  registros.forEach(r => {
    const desc = (r.descripcion || "").replaceAll('"','""');
    const proj = (r.proyecto || "").replaceAll('"','""');
    const item = (r.itemCode || "").replaceAll('"','""');
    const itemd = (r.itemDesc || "").replaceAll('"','""');
    lines.push([
      r.fecha,
      r.archivo,
      `"${item}"`,
      `"${itemd}"`,
      `"${desc}"`,
      `"${proj}"`,
      r.done ? "SI" : "NO"
    ].join(";"));
  });
  return lines.join("\n");
}

function buildManifestXlsHtml(registros){
  const esc = (s)=> String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
  const rows = registros.map(r => `
    <tr>
      <td>${esc(r.fecha)}</td>
      <td>${esc(r.archivo)}</td>
      <td>${esc(r.itemCode)}</td>
      <td>${esc(r.itemDesc)}</td>
      <td>${esc(r.descripcion)}</td>
      <td>${esc(r.proyecto)}</td>
      <td>${r.done ? "SI" : "NO"}</td>
    </tr>
  `).join("");

  return `
  <html><head><meta charset="utf-8"></head><body>
  <table border="1">
    <tr><th>fecha</th><th>archivo</th><th>item</th><th>item_desc</th><th>descripcion</th><th>proyecto</th><th>listo</th></tr>
    ${rows}
  </table>
  </body></html>`;
}

const DOCX_IMG_W_CM = 7.6;
const DOCX_IMG_H_CM = 4.6;
const DOCX_PAIRS_PER_PAGE = 4; // 4 pares = 8 fotos por página

/* ===========================
   Export ZIP (incluye DOCX)
=========================== */
async function exportZipByMode(modo, desde, hasta){
  if (!window.JSZip){ alert("JSZip no cargó. Abre con internet o en Chrome."); return; }
  if (!window.docx){ alert("La librería DOCX no cargó. Abre con internet o en Chrome."); return; }

  const useTime = !!$("useTimeNames")?.checked;
  const onlyDone = !!$("onlyDone")?.checked;

  const exportLogo = !!$("exportLogo")?.checked;
  const exportStampDT = !!$("exportStampDT")?.checked;
  const exportTemplate = !!$("exportTemplate")?.checked;
  const overlayTemplateId = getTemplateId();

  let selected = [];
  if (modo === "dia"){
    selected = cache.filter(x => x.fecha === desde);
  } else if (modo === "mes"){
    const ym = (desde || hoyISO()).slice(0,7);
    selected = cache.filter(x => (x.fecha || "").startsWith(ym));
  } else {
    const a = ymdToNum(desde);
    const b = ymdToNum(hasta);
    const lo = Math.min(a,b), hi = Math.max(a,b);
    selected = cache.filter(x => {
      const n = ymdToNum(x.fecha);
      return n >= lo && n <= hi;
    });
  }

  const itemFilter = getExportItemCode();
  if (itemFilter) selected = selected.filter(x => String(x.itemCode || "").trim() === itemFilter);

  if (onlyDone) selected = selected.filter(x => !!x.done);

  if (!selected.length){
    alert("No hay fotos en ese periodo" + (onlyDone ? " (o ninguna marcada como LISTA)." : "."));
    return;
  }

  selected.sort((a,b)=> (a.fecha.localeCompare(b.fecha) || a.createdAt - b.createdAt));

  const proyecto = sanitizeName(proyectoInput.value);
  let packName =
    (modo==="dia") ? `${desde}_${proyecto}` :
    (modo==="mes") ? `${(desde||hoyISO()).slice(0,7)}_${proyecto}` :
    `${desde}_a_${hasta}_${proyecto}`;
  const itemTag = itemFilter ? `_ITEM_${sanitizeName(itemFilter)}` : "";
  if (itemTag) packName = packName + itemTag;

  const zip = new JSZip();
  const root = zip.folder(packName);

  const perDayCounter = new Map();
  const manifestRows = [];

  zipInfo.textContent = `Armando ZIP (${selected.length} foto(s))...`;

  for (const it of selected){
    const folder = root.folder(it.fecha);

    const n = (perDayCounter.get(it.fecha) || 0) + 1;
    perDayCounter.set(it.fecha, n);

    const filename = filenameForItem(it, n, useTime);

    let outBlob = it.blob;
        if (exportLogo || exportStampDT || (exportTemplate && (templateId !== "classic") && (templateId !== "clean"))){
      outBlob = await applyExportOverlaysToBlob(it.blob, {
        addLogo: exportLogo && !!logoBitmap,
        addStamp: exportStampDT,
        stampText: exportStampDT ? formatStampDateTime(it) : "",
        avoidDoubleLogo: exportLogo && !!it.hasLogo,
        addTemplate: exportTemplate && (templateId !== "classic") && (templateId !== "clean"),
        templateLines: (exportTemplate && (templateId !== "classic") && (templateId !== "clean")) ? buildTemplateLines(getTemplateMeta(it), templateId) : [],
        logoCornerHint: localStorage.getItem("logi_logo_corner") || "br"
      });
    }

    folder.file(filename, outBlob);

    const descText = (it.descripcion || "").trim();
    folder.file(filename.replace(/\.jpg$/i,".txt"), descText || "");

    manifestRows.push({
      fecha: it.fecha,
      archivo: `${it.fecha}/${filename}`,
      itemCode: it.itemCode || "",
      itemDesc: it.itemDesc || "",
      descripcion: descText,
      proyecto: it.proyecto || "",
      done: !!it.done
    });
  }

  root.file("manifest.csv", buildManifestCsv(manifestRows));
  root.file("manifest.xls", buildManifestXlsHtml(manifestRows));
  const layoutKey = getLayoutKey();
  const { imgWcm: IMG_W_CM, imgHcm: IMG_H_CM, pairsPerPage: PAIRS_PER_PAGE } = docxDimsForLayout(layoutKey);

  const { start, end } = computeRangeForTitle(modo, desde, hasta);
  const activeP = (typeof getActiveProject === "function") ? getActiveProject() : null;
  const tituloProyecto = ((activeP && activeP.name) ? activeP.name : (proyectoInput.value || "")).trim();

  const zi = zipInfo;
  const totalDocx = selected.length;
  const nextPaint = () => new Promise(res => requestAnimationFrame(() => setTimeout(res, 0)));

  if (zi){ zi.textContent = `Generando DOCX... 0/${totalDocx}`; await nextPaint(); }

  const onProgress = async (done, tot) => {
    if (!zi) return;
    zi.textContent = `Generando DOCX... ${done}/${tot}`;
    await nextPaint();
  };

  const docxBuffer = await buildRegistroFotograficoDocxBuffer(
    selected, tituloProyecto, start, end, IMG_W_CM, IMG_H_CM, PAIRS_PER_PAGE,
    { applyLogo: exportLogo && !!logoBitmap, applyStamp: exportStampDT, applyTemplate: exportTemplate, templateId: overlayTemplateId, onProgress }
  );

  const itemTag2 = itemFilter ? `_ITEM_${sanitizeName(itemFilter)}` : "";
  root.file(`Logi_Reporte_${start}_a_${end}${itemTag2}.docx`, docxBuffer);

  const outZipBlob = await zip.generateAsync({ type:"blob" }, (meta) => {
    zipInfo.textContent = `Comprimiendo... ${Math.floor(meta.percent)}%`;
  });

  const url = URL.createObjectURL(outZipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = packName + ".zip";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  zipInfo.textContent = "ZIP descargado ✅";
  setTimeout(()=> zipInfo.textContent = "", 1800);
}

/* =========================
   Export Express (Paso 2D)
   PDF robusto con pdf-lib
   ========================= */

let _isExpressing = false;

async function shareBlobAsFile(blob, filename, mime, title) {
  const file = new File([blob], filename, { type: mime });

  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    try { await navigator.share({ files: [file], title: title || filename }); return true; }
    catch (e) { /* fallback */ }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2500);
  return false;
}

function wrapTextPdf(text, font, size, maxWidth, maxLines=0) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const words = clean.split(" ");
  const lines = [];
  let line = "";

  for (const w of words) {
    const test = line ? (line + " " + w) : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = w;
      if (maxLines && lines.length >= maxLines) break;
    }
  }
  if ((!maxLines || lines.length < maxLines) && line) lines.push(line);

  if (maxLines && lines.length === maxLines && words.length > 0) {
    // si recorta, añade "…" al final si cabe
    const last = lines[lines.length - 1];
    const ell = last.endsWith("…") ? last : (last + "…");
    if (font.widthOfTextAtSize(ell, size) <= maxWidth) lines[lines.length - 1] = ell;
  }
  return lines;
}

async function buildRegistroFotograficoPdfBlob(selected, tituloProyecto, start, end, opts) {
  if (!window.PDFLib) {
    alert("PDFLib no cargó. Abre con internet o en Chrome y vuelve a intentar.");
    return null;
  }

  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // A4 en puntos
  const pageW = 595.28;
  const pageH = 841.89;

  // === Estilo Logi (igual al DOCX) ===
  const BRAND_DARK = rgb(0x0B / 255, 0x12 / 255, 0x20 / 255);
  const BRAND_MID  = rgb(0x11 / 255, 0x1B / 255, 0x2E / 255);
  const BRAND_ACC  = rgb(0x3B / 255, 0x82 / 255, 0xF6 / 255);
  const GRID_COL   = rgb(0x2F / 255, 0x6F / 255, 0xED / 255);

  // === Header (dos tonos + línea acento) ===
  const headerMainH = 74;
  const headerAccH  = 6;
  const headerH     = headerMainH + headerAccH;
  const leftW       = pageW * 0.18;
  const rightW      = pageW - leftW;

  // === Márgenes / grilla (2 columnas) ===
  const layoutKey = (opts && opts.layoutKey) ? opts.layoutKey : getLayoutKey();
  const { rows } = layoutFromKey(layoutKey);
  const cols = 2;

  const marginX = 36;
  const colGap  = 12;

  const gridLeft = marginX;
  const gridRight = pageW - marginX;
  const cellW = (gridRight - gridLeft - colGap) / cols;

  const gridTop = pageH - headerH - 18;  // espacio bajo el membrete
  const gridBottom = 36;                 // espacio inferior (paginación)

  const captionH = 34; // similar a la fila de caption del DOCX
  const imgBoxH = Math.max(120, (gridTop - gridBottom - rows * captionH) / rows);
  const pad = 6;

  // Normalización (misma relación que DOCX)
  const IMG_W_CM = 7.6;
  const IMG_H_CM = 4.6;
  const ratio = IMG_W_CM / IMG_H_CM;
  const frameW = 1600;
  const frameH = Math.round(frameW / ratio);
  const fitMode = localStorage.getItem("logi_docx_fit") || "stretch";

  const startLong = (typeof formatDateLongES === "function") ? formatDateLongES(start) : start;
  const endLong   = (typeof formatDateLongES === "function") ? formatDateLongES(end) : end;
  const sameDay = (start === end);
  const titleLine = sameDay
    ? `Reporte fotográfico · ${startLong}`
    : `Reporte fotográfico · ${startLong} — ${endLong}`;

  const projText = (tituloProyecto || "").trim();

  // Logo (opcional)
  let logoImg = null;
  try{
    const logoAb = await loadLogiLogoArrayBuffer();
    if (logoAb){
      const u8 = new Uint8Array(logoAb);
      const isPng = (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47);
      logoImg = isPng ? await pdfDoc.embedPng(u8) : await pdfDoc.embedJpg(u8);
    }
  }catch{ logoImg = null; }

  // Paginación: 8 fotos por página (como DOCX)
  const MODULES_PER_PAGE = rows * cols;
  const totalPages = Math.max(1, Math.ceil(selected.length / MODULES_PER_PAGE));

  let done = 0;
  let photoN = 1;

  function drawRightText(page, txt, y, size, bold=false, color=rgb(1,1,1), padRight=28){
    const f = bold ? fontB : font;
    const w = f.widthOfTextAtSize(txt, size);
    page.drawText(txt, { x: pageW - padRight - w, y, size, font: f, color });
  }

  function splitWords(s){ return (s || "").trim().split(/\s+/).filter(Boolean); }

  function wrapRestLines(restText, fnt, size, maxWidth, maxLines){
    const words = splitWords(restText);
    const lines = [];
    let line = "";
    for (const w of words){
      const test = line ? (line + " " + w) : w;
      if (fnt.widthOfTextAtSize(test, size) <= maxWidth){
        line = test;
      } else {
        if (line) lines.push(line);
        line = w;
        if (maxLines && lines.length >= maxLines) break;
      }
    }
    if ((!maxLines || lines.length < maxLines) && line) lines.push(line);

    if (maxLines && lines.length === maxLines && words.length){
      const last = lines[lines.length-1];
      const ell = last.endsWith("…") ? last : (last + "…");
      if (fnt.widthOfTextAtSize(ell, size) <= maxWidth) lines[lines.length-1] = ell;
    }
    return lines;
  }

  function drawCaption(page, captionText, x, yTop, w){
    // Ajuste automático + partición de tokens largos (para que NUNCA se salga del recuadro)
    const maxW = w - pad*2;
    const boxH = captionH - pad*2;

    // Detecta prefijo real
    const prefixNew = `Foto No. ${photoN-1},`;
    const prefixOld = `FOTO ${photoN-1}.`;
    let prefix = "";
    if (captionText.startsWith(prefixNew)) prefix = prefixNew;
    else if (captionText.startsWith(prefixOld)) prefix = prefixOld;

    const restRaw = prefix ? captionText.slice(prefix.length).trimStart() : captionText;

    const splitWords = (s) => (String(s||"").replace(/\s+/g," ").trim().split(" ").filter(Boolean));

    const splitTokenByWidth = (tok, fnt, size, wLim) => {
      const parts = [];
      let chunk = "";
      for (const ch of tok){
        const t = chunk + ch;
        if (fnt.widthOfTextAtSize(t, size) <= wLim || !chunk){
          chunk = t;
        } else {
          parts.push(chunk);
          chunk = ch;
        }
      }
      if (chunk) parts.push(chunk);
      return parts;
    };

    const takeLine = (tokens, fnt, size, wLim) => {
      let line = "";
      let i = 0;
      while (i < tokens.length){
        let tok = tokens[i];

        // token gigante al inicio -> partirlo
        if (!line && fnt.widthOfTextAtSize(tok, size) > wLim){
          const parts = splitTokenByWidth(tok, fnt, size, wLim);
          line = parts[0] || "";
          const rest = parts.slice(1).concat(tokens.slice(i+1));
          return { line, restTokens: rest };
        }

        const test = line ? (line + " " + tok) : tok;
        if (fnt.widthOfTextAtSize(test, size) <= wLim){
          line = test;
          i++;
        } else {
          break;
        }
      }
      return { line, restTokens: tokens.slice(i) };
    };

    const wrapTokens = (tokens, fnt, size, wLim, maxLines) => {
      const lines = [];
      let rest = tokens.slice();
      while (rest.length && (!maxLines || lines.length < maxLines)){
        const r = takeLine(rest, fnt, size, wLim);
        if (r.line) lines.push(r.line);
        rest = r.restTokens;
        if (!r.line && rest.length) { lines.push(rest.shift()); }
      }
      return lines;
    };

    const layoutAtSize = (size) => {
      const lineH = size + 1.5; // ~11 cuando size=9.5
      const spaceW = prefix ? font.widthOfTextAtSize(" ", size) : 0;
      const prefixW = prefix ? fontB.widthOfTextAtSize(prefix, size) : 0;
      const firstMax = prefix ? Math.max(20, maxW - prefixW - spaceW) : maxW;

      const restTokens = splitWords(restRaw);
      // 1ra línea (resto) con ancho reducido si hay prefijo
      const first = takeLine(restTokens, font, size, firstMax);
      const otherLines = wrapTokens(first.restTokens, font, size, maxW, 3); // total 4 líneas

      const reqH = lineH * (1 + otherLines.length);
      return { size, lineH, spaceW, prefixW, firstRest: first.line || "", otherLines, reqH };
    };

    // Búsqueda binaria del tamaño máximo que quepa en altura (y respete 4 líneas)
    let lo = _CAPTION_FONT_PT_MIN;
    let hi = _CAPTION_FONT_PT_BASE;
    let best = layoutAtSize(lo);

    for (let i=0; i<10; i++){
      const mid = (lo + hi) / 2;
      const L = layoutAtSize(mid);
      if (L.reqH <= boxH){
        best = L;
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const size = Math.max(_CAPTION_FONT_PT_MIN, Math.min(_CAPTION_FONT_PT_BASE, Math.round(best.size*10)/10));
    const L = layoutAtSize(size);

    // Dibujo
    let y = yTop - pad - (size + 0.5);

    if (prefix){
      page.drawText(prefix, { x: x + pad, y, size, font: fontB, color: rgb(0,0,0) });
      const xRest = x + pad + L.prefixW + L.spaceW;
      if (L.firstRest) page.drawText(L.firstRest, { x: xRest, y, size, font, color: rgb(0,0,0) });
    } else {
      if (L.firstRest) page.drawText(L.firstRest, { x: x + pad, y, size, font, color: rgb(0,0,0) });
    }

    y -= L.lineH;
    for (const line of L.otherLines){
      page.drawText(line, { x: x + pad, y, size, font, color: rgb(0,0,0) });
      y -= L.lineH;
    }
  }

  for (let p = 0; p < totalPages; p++) {
    const page = pdfDoc.addPage([pageW, pageH]);

    // ===== Header =====
    const headerY = pageH - headerMainH;

    page.drawRectangle({ x: 0, y: headerY, width: leftW, height: headerMainH, color: BRAND_DARK });
    page.drawRectangle({ x: leftW, y: headerY, width: rightW, height: headerMainH, color: BRAND_MID });
    page.drawRectangle({ x: 0, y: pageH - headerH, width: pageW, height: headerAccH, color: BRAND_ACC });

    // Logo centrado en bloque izquierdo
    if (logoImg){
      const s = 38;
      const xLogo = (leftW - s) / 2;
      const yLogo = headerY + (headerMainH - s) / 2;
      page.drawImage(logoImg, { x: xLogo, y: yLogo, width: s, height: s });
    }

    // Textos a la derecha (alineados a la derecha)
    // Proyecto (visible, a la izquierda del bloque derecho)
    if (projText){
      const projSize = 16;
      const padL = 24;
      const reserveRight = 220; // deja espacio para "Logi" + márgenes a la derecha
      const maxW = Math.max(120, rightW - padL - reserveRight);
      const lines = wrapRestLines(projText, fontB, projSize, maxW, 2);
      let yProj = pageH - 26;
      for (let i=0; i<lines.length; i++){
        page.drawText(lines[i], {
          x: leftW + padL,
          y: yProj - i * (projSize + 2),
          size: projSize,
          font: fontB,
          color: rgb(1,1,1)
        });
      }
    }

    // Textos a la derecha (alineados a la derecha)
    drawRightText(page, "Logi", pageH - 30, 22, true, rgb(1,1,1));
    drawRightText(page, titleLine, pageH - 50, 10.5, true, rgb(0xE5/255,0xE7/255,0xEB/255));

    // ===== Grid =====
    for (let row = 0; row < rows; row++){
      for (let col = 0; col < cols; col++){
        const idx = p * MODULES_PER_PAGE + row*cols + col;
        if (idx >= selected.length) break;

        const it = selected[idx];
        done++;

        // aplica overlays si están activados (logo/sello/plantilla)
        let imgBlob = it.blob;

        const wantsTemplate = !!(opts.applyTemplate && (opts.templateId !== "classic") && (opts.templateId !== "clean"));

        if (opts.applyLogo || opts.applyStamp || wantsTemplate) {
          imgBlob = await applyExportOverlaysToBlob(it.blob, {
            addLogo: opts.applyLogo && !!logoBitmap,
            addStamp: opts.applyStamp,
            stampText: opts.applyStamp ? formatStampDateTime(it) : "",
            avoidDoubleLogo: opts.applyLogo && !!it.hasLogo,
            addTemplate: wantsTemplate,
            templateLines: wantsTemplate ? buildTemplateLines(getTemplateMeta(it), opts.templateId) : [],
            logoCornerHint: localStorage.getItem("logi_logo_corner") || "br"
          });
        }

        // normaliza a marco fijo (como en DOCX) para que todo quede consistente
        try{ imgBlob = await normalizeToFixedFrameJpg(imgBlob, frameW, frameH, 0.9, fitMode); }catch{}

        const ab = await imgBlob.arrayBuffer();
        const u8 = new Uint8Array(ab);

        const isPng = (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47);
        const img = isPng ? await pdfDoc.embedPng(u8) : await pdfDoc.embedJpg(u8);

        const cellX = gridLeft + col * (cellW + colGap);

        const rowTop = gridTop - row * (imgBoxH + captionH);
        const imgY = rowTop - imgBoxH;
        const capTop = imgY;
        const capY = capTop - captionH;

        // Bordes (imagen + caption) — mismo color del DOCX
        page.drawRectangle({ x: cellX, y: imgY, width: cellW, height: imgBoxH, borderColor: GRID_COL, borderWidth: 1 });
        page.drawRectangle({ x: cellX, y: capY, width: cellW, height: captionH, borderColor: GRID_COL, borderWidth: 1 });

        // Dibuja imagen centrada dentro de su caja
        const maxImgW = cellW - pad * 2;
        const maxImgH = imgBoxH - pad * 2;

        const scale = Math.min(maxImgW / img.width, maxImgH / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;

        const xImg = cellX + pad + (maxImgW - drawW) / 2;
        const yImg = imgY + pad + (maxImgH - drawH) / 2;

        page.drawImage(img, { x: xImg, y: yImg, width: drawW, height: drawH });

        // Caption (mismo constructor que DOCX)
        const meta = getTemplateMeta(it);
        const capText = buildDocxCaption(photoN, meta, opts.templateId);
        photoN++;

        // Fondo blanco para caption (por si el PDF queda con transparencia)
        page.drawRectangle({ x: cellX+1, y: capY+1, width: cellW-2, height: captionH-2, color: rgb(1,1,1) });

        drawCaption(page, capText, cellX, capTop, cellW);

        // progreso UI
        if ($("zipInfo")) $("zipInfo").textContent = `Generando PDF... ${done}/${selected.length}`;
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // ===== Footer =====
    page.drawText(`${p + 1}/${totalPages}`, {
      x: pageW - marginX - 45,
      y: 16,
      size: 9,
      font,
      color: rgb(0.35,0.4,0.5)
    });
  }

  const bytes = await pdfDoc.save();
  return new Blob([bytes], { type: "application/pdf" });
}


// === Plantilla PDF: Ítems-Tabla (2 fotos por tabla) ===
// Reglas:
// - Cada 2 fotos = 1 tabla completa (ÍTEM/ACTIVIDAD/UNIDAD + 2 fotos + caption)
// - Si queda impar: celda derecha vacía
// - Numeración global (no reinicia por ítem)
// - Actividad/Unidad vienen del listado del proyecto (catalog); si no existe, queda en blanco
// - Objetivo: 2 tablas por página (Carta). Si para lograrlo toca aplastar demasiado, baja a 1 tabla por página.
async function buildTagsTablaPdfBlob(selected, tituloProyecto, start, end, opts){
  if (!window.PDFLib) {
    alert("PDFLib no cargó. Abre con internet o en Chrome y vuelve a intentar.");
    return null;
  }

  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Carta (US Letter) en puntos
  const pageW = 612;
  const pageH = 792;

  // Márgenes
  const marginX = 36;
  const marginB = 36;

  // Colores Logi (igual al clásico)
  const BRAND_DARK = rgb(0x0B/255, 0x12/255, 0x20/255);
  const BRAND_MID  = rgb(0x11/255, 0x1B/255, 0x2E/255);
  const BRAND_ACC  = rgb(0x3B/255, 0x82/255, 0xF6/255);

  // Header (similar al clásico pero optimizado para 2 tablas/página)
  const headerMainH = 64;
  const headerAccH  = 6;
  const headerH     = headerMainH + headerAccH;
  const leftW       = pageW * 0.18;
  const rightW      = pageW - leftW;

  // Logo Logi (para el header)
  let logoImg = null;
  try{
    const logoAb = await loadLogiLogoArrayBuffer();
    if (logoAb){
      const u8 = new Uint8Array(logoAb);
      const isPng = (u8[0]===0x89 && u8[1]===0x50 && u8[2]===0x4E && u8[3]===0x47);
      logoImg = isPng ? await pdfDoc.embedPng(u8) : await pdfDoc.embedJpg(u8);
    }
  }catch{ logoImg = null; }

  // Anchos
  const contentW = pageW - marginX*2;
  const gapCol = 14;
  const colW = (contentW - gapCol) / 2;

  // Tabla (proporciones similares al DOCX)
  const itemW = Math.round(contentW * 0.16);
  const unitW = Math.round(contentW * 0.20);
  const actW  = contentW - itemW - unitW;

  const rowH = 22;
  const tableH = rowH * 2;
  const gapAfterTable = 0; // sin renglones entre tabla y fotos
  const gapBetweenBlocks = 18;

  // Foto
  const MAX_PH = 220;
  const MIN_PH = 120;
  const padImg = 6;

  // Caption
  const capSize = 11;
  const capLineH = capSize + 3;

  // Header text
  const proj = String(tituloProyecto || "").trim();
  const startLong = (typeof formatDateLongES === "function") ? formatDateLongES(start) : String(start||"");
  const endLong   = (typeof formatDateLongES === "function") ? formatDateLongES(end) : String(end||"");
  const same = (String(start||"") === String(end||""));
  const periodLine = same ? startLong : `${startLong} — ${endLong}`;

  // lookup unidad
  function getUnidad(code){
    const c = String(code || "").trim();
    if (!c) return "";
    try{
      const row = (catalog || []).find(r => String(r.item || "").trim() === c);
      return row ? String(row.unidad || "").trim() : "";
    }catch{ return ""; }
  }
  function getActividad(code){
    const c = String(code || "").trim();
    if (!c) return "";
    try{
      return String((catalogMap && catalogMap[c]) ? catalogMap[c] : "").trim();
    }catch{ return ""; }
  }

  // Orden: por ítem (para que al pasar al siguiente ítem siga la numeración global)
  const groups = new Map();
  const sorted = (selected || []).slice().sort((a,b)=> (String(a.itemCode||"").localeCompare(String(b.itemCode||"")) || (a.fecha||"").localeCompare(b.fecha||"") || (a.createdAt||0)-(b.createdAt||0)));
  for (const it of sorted){
    const k = String(it.itemCode || "").trim();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }

  const keys = Array.from(groups.keys()).sort((a,b)=>{
    if (a && !b) return -1;
    if (!a && b) return 1;
    return String(a).localeCompare(String(b));
  });

  // Construye bloques (cada 2 fotos)
  const blocks = [];
  let photoNo = 1;
  for (const k of keys){
    const arr = (groups.get(k) || []).slice().sort((a,b)=> (a.fecha||"").localeCompare(b.fecha||"") || (a.createdAt||0)-(b.createdAt||0));
    const actividad = getActividad(k);
    const unidad = getUnidad(k);
    for (let i=0;i<arr.length;i+=2){
      const left = arr[i];
      const right = (i+1 < arr.length) ? arr[i+1] : null;
      const n1 = photoNo++;
      const n2 = right ? photoNo++ : null;

      // precompute caption heights (sin recortar; si es MUY largo, igual se paginará)
      const cap1Lines = wrapTextPdf(`FOTO ${n1}. ${(left?.descripcion||"").trim()}`, font, capSize, colW - 8, 0);
      const cap2Lines = right ? wrapTextPdf(`FOTO ${n2}. ${(right?.descripcion||"").trim()}`, font, capSize, colW - 8, 0) : [];
      // caption row: deja respiración arriba/abajo para que el texto no quede pegado a las líneas
      const capH = Math.max(1, cap1Lines.length, cap2Lines.length) * capLineH + 18;

      blocks.push({ itemCode:k, actividad, unidad, left, right, n1, n2, cap1Lines, cap2Lines, capH });
    }
  }

  // helpers de dibujo
  const tableBorder = rgb(0x0F/255,0x17/255,0x2A/255);
  const headerFill  = rgb(0xE2/255,0xE8/255,0xF0/255);

  function drawRightText(page, txt, y, size, bold=false, color=rgb(1,1,1), padRight=28){
    const f = bold ? fontB : font;
    const w = f.widthOfTextAtSize(txt, size);
    page.drawText(txt, { x: pageW - padRight - w, y, size, font: f, color });
  }

  function drawHeader(page){
    const headerY = pageH - headerMainH;

    page.drawRectangle({ x: 0, y: headerY, width: leftW, height: headerMainH, color: BRAND_DARK });
    page.drawRectangle({ x: leftW, y: headerY, width: rightW, height: headerMainH, color: BRAND_MID });
    page.drawRectangle({ x: 0, y: pageH - headerH, width: pageW, height: headerAccH, color: BRAND_ACC });

    if (logoImg){
      const s = 36;
      const xLogo = (leftW - s) / 2;
      const yLogo = headerY + (headerMainH - s) / 2;
      page.drawImage(logoImg, { x: xLogo, y: yLogo, width: s, height: s });
    }

    // Proyecto a la izquierda del bloque derecho
    if (proj){
      const projSize = 15;
      const padL = 24;
      const reserveRight = 190;
      const maxW = Math.max(120, rightW - padL - reserveRight);
      const lines = wrapTextPdf(proj, fontB, projSize, maxW, 2);
      let yProj = pageH - 26;
      for (let i=0; i<lines.length; i++){
        page.drawText(lines[i], { x: leftW + padL, y: yProj - i*(projSize + 2), size: projSize, font: fontB, color: rgb(1,1,1) });
      }
    }

    drawRightText(page, "Logi", pageH - 30, 20, true, rgb(1,1,1));
    drawRightText(page, `Reporte fotográfico · ${periodLine}`, pageH - 49, 10.5, true, rgb(0xE5/255,0xE7/255,0xEB/255));
  }


  function drawTable(page, topY, blk){
    const x0 = marginX;
    const y0 = topY - tableH;

    // outer
    page.drawRectangle({ x: x0, y: y0, width: contentW, height: tableH, borderColor: tableBorder, borderWidth: 1 });

    // header row fill
    page.drawRectangle({ x: x0+1, y: topY - rowH + 1, width: contentW-2, height: rowH-2, color: headerFill });

    // vertical lines
    page.drawRectangle({ x: x0 + itemW, y: y0, width: 1, height: tableH, color: tableBorder });
    page.drawRectangle({ x: x0 + itemW + actW, y: y0, width: 1, height: tableH, color: tableBorder });

    // horizontal line
    page.drawRectangle({ x: x0, y: topY - rowH, width: contentW, height: 1, color: tableBorder });

    // headers
    page.drawText("ÍTEM", { x: x0 + 8, y: topY - 16, size: 11.5, font: fontB, color: rgb(0,0,0) });
    page.drawText("ACTIVIDAD", { x: x0 + itemW + 8, y: topY - 16, size: 11.5, font: fontB, color: rgb(0,0,0) });
    page.drawText("UNIDAD", { x: x0 + itemW + actW + 8, y: topY - 16, size: 11.5, font: fontB, color: rgb(0,0,0) });

    // data row
    const code = String(blk.itemCode || "").trim();
    const act = String(blk.actividad || "").trim();
    const und = String(blk.unidad || "").trim();

    page.drawText(code, { x: x0 + 8, y: y0 + 6, size: 11, font, color: rgb(0,0,0) });

    // wrap actividad to max 2 lines
    const actLines = wrapTextPdf(act, font, 10.8, actW - 16, 2);
    let yAct = y0 + 14;
    for (const line of actLines){
      page.drawText(line, { x: x0 + itemW + 8, y: yAct, size: 10.8, font, color: rgb(0,0,0) });
      yAct -= 12.6;
    }

    page.drawText(und, { x: x0 + itemW + actW + 8, y: y0 + 6, size: 11, font, color: rgb(0,0,0) });
  }

  async function embedImg(pdfDoc, blob){
    const ab = await blob.arrayBuffer();
    const u8 = new Uint8Array(ab);
    const isPng = (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47);
    return isPng ? await pdfDoc.embedPng(u8) : await pdfDoc.embedJpg(u8);
  }

  async function drawPhotoBox(page, x, y, w, h, it, lines, n){
    // marco
    page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.70,0.74,0.80), borderWidth: 1 });

    if (!it || !(it.blob instanceof Blob)){
      page.drawRectangle({ x: x+1, y: y+1, width: w-2, height: h-2, color: rgb(0.94,0.95,0.97) });
      page.drawText("SIN ARCHIVO", { x: x + 10, y: y + h/2 - 6, size: 12, font: fontB, color: rgb(0.45,0.5,0.6) });
    } else {
      let imgBlob = it.blob;

      // overlays (si están activos)
      const wantsTemplate = !!(opts && opts.applyTemplate && (opts.templateId !== "classic") && (opts.templateId !== "clean"));
      if ((opts && (opts.applyLogo || opts.applyStamp || wantsTemplate))){
        try{
          imgBlob = await applyExportOverlaysToBlob(it.blob, {
            addLogo: !!(opts.applyLogo && logoBitmap),
            addStamp: !!opts.applyStamp,
            stampText: (opts.applyStamp ? formatStampDateTime(it) : ""),
            avoidDoubleLogo: !!(opts.applyLogo && it.hasLogo),
            addTemplate: wantsTemplate,
            templateLines: wantsTemplate ? buildTemplateLines(getTemplateMeta(it), opts.templateId) : [],
            logoCornerHint: localStorage.getItem("logi_logo_corner") || "br"
          });
        }catch{}
      }

      // normaliza para reducir peso / homogeneizar
      try{
        const fitMode = localStorage.getItem("logi_docx_fit") || "stretch";
        imgBlob = await normalizeToFixedFrameJpg(imgBlob, 1400, 900, 0.88, fitMode);
      }catch{}

      try{
        const img = await embedImg(pdfDoc, imgBlob);
        const maxW = w - padImg*2;
        const maxH = h - padImg*2;
        const scale = Math.min(maxW / img.width, maxH / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const ix = x + padImg + (maxW - dw)/2;
        const iy = y + padImg + (maxH - dh)/2;
        page.drawImage(img, { x: ix, y: iy, width: dw, height: dh });
      }catch{
        page.drawRectangle({ x: x+1, y: y+1, width: w-2, height: h-2, color: rgb(0.94,0.95,0.97) });
        page.drawText("SIN ARCHIVO", { x: x + 10, y: y + h/2 - 6, size: 12, font: fontB, color: rgb(0.45,0.5,0.6) });
      }
    }

    // caption
    const capYTop = y - 6;
    let yTxt = capYTop - capSize;
    for (const line of (lines || [])){
      page.drawText(line, { x: x + 4, y: yTxt, size: capSize, font, color: rgb(0,0,0) });
      yTxt -= capLineH;
    }
  }

  // Dibuja un bloque completo como UNA sola tabla (sin renglones de por medio):
  // - 2 filas superiores: encabezados + datos (ÍTEM/ACTIVIDAD/UNIDAD)
  // - 1 fila de fotos (2 celdas)
  // - 1 fila de captions (2 celdas)
  function drawCenteredText(page, txt, x, y, w, h, fnt, size){
    const t = String(txt || "");
    if (!t) return;
    const tw = fnt.widthOfTextAtSize(t, size);
    const tx = x + Math.max(0, (w - tw) / 2);
    const ty = y + (h - size) / 2 + 2; // ajuste visual
    page.drawText(t, { x: tx, y: ty, size, font: fnt, color: rgb(0,0,0) });
  }

  async function drawImageInCell(page, x, y, w, h, it){
    // y = bottom
    const pad = 6;
    if (!it || !(it.blob instanceof Blob)){
      page.drawRectangle({ x: x+1, y: y+1, width: w-2, height: h-2, color: rgb(0.94,0.95,0.97) });
      const msg = "SIN ARCHIVO";
      const sw = fontB.widthOfTextAtSize(msg, 12);
      page.drawText(msg, { x: x + (w - sw)/2, y: y + h/2 - 6, size: 12, font: fontB, color: rgb(0.45,0.5,0.6) });
      return;
    }

    let imgBlob = it.blob;
    // overlays (si están activos)
    const wantsTemplate = !!(opts && opts.applyTemplate && (opts.templateId !== "classic") && (opts.templateId !== "clean"));
    if ((opts && (opts.applyLogo || opts.applyStamp || wantsTemplate))){
      try{
        imgBlob = await applyExportOverlaysToBlob(it.blob, {
          addLogo: !!(opts.applyLogo && logoBitmap),
          addStamp: !!opts.applyStamp,
          stampText: (opts.applyStamp ? formatStampDateTime(it) : ""),
          avoidDoubleLogo: !!(opts.applyLogo && it.hasLogo),
          addTemplate: wantsTemplate,
          templateLines: wantsTemplate ? buildTemplateLines(getTemplateMeta(it), opts.templateId) : [],
          logoCornerHint: localStorage.getItem("logi_logo_corner") || "br"
        });
      }catch{}
    }

    // normaliza para reducir peso / homogeneizar
    try{
      const fitMode = localStorage.getItem("logi_docx_fit") || "stretch";
      imgBlob = await normalizeToFixedFrameJpg(imgBlob, 1400, 900, 0.88, fitMode);
    }catch{}

    try{
      const img = await embedImg(pdfDoc, imgBlob);
      const maxW = w - pad*2;
      const maxH = h - pad*2;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const ix = x + pad + (maxW - dw)/2;
      const iy = y + pad + (maxH - dh)/2;
      page.drawImage(img, { x: ix, y: iy, width: dw, height: dh });
    }catch{
      page.drawRectangle({ x: x+1, y: y+1, width: w-2, height: h-2, color: rgb(0.94,0.95,0.97) });
      const msg = "SIN ARCHIVO";
      const sw = fontB.widthOfTextAtSize(msg, 12);
      page.drawText(msg, { x: x + (w - sw)/2, y: y + h/2 - 6, size: 12, font: fontB, color: rgb(0.45,0.5,0.6) });
    }
  }

  function drawCaptionCell(page, x, y, w, h, lines){
    const topPad = 10; // para que no quede pegado a la línea superior
    const leftPad = 6;
    const capTop = y + h;
    let yTxt = capTop - topPad - capSize;
    for (const line of (lines || [])){
      page.drawText(line, { x: x + leftPad, y: yTxt, size: capSize, font, color: rgb(0,0,0) });
      yTxt -= capLineH;
    }
  }

  async function drawBlock(page, topY, blk, photoH){
    const capH = blk.capH;
    const blockH = tableH + gapAfterTable + photoH + capH;

    const x0 = marginX;
    const y0 = topY - blockH;

    const yHeaderBottom = topY - rowH;
    const yDataBottom = topY - rowH*2;
    const yPhotoBottom = yDataBottom - photoH;

    // Outer border (una sola tabla)
    page.drawRectangle({ x: x0, y: y0, width: contentW, height: blockH, borderColor: tableBorder, borderWidth: 1 });

    // Header fill
    page.drawRectangle({ x: x0+1, y: yHeaderBottom+1, width: contentW-2, height: rowH-2, color: headerFill });

    // Horizontal lines
    page.drawRectangle({ x: x0, y: yHeaderBottom, width: contentW, height: 1, color: tableBorder });
    page.drawRectangle({ x: x0, y: yDataBottom, width: contentW, height: 1, color: tableBorder });
    page.drawRectangle({ x: x0, y: yPhotoBottom, width: contentW, height: 1, color: tableBorder });

    // Vertical lines (top rows)
    page.drawRectangle({ x: x0 + itemW, y: yDataBottom, width: 1, height: rowH*2, color: tableBorder });
    page.drawRectangle({ x: x0 + itemW + actW, y: yDataBottom, width: 1, height: rowH*2, color: tableBorder });

    // Vertical midline (fotos + captions)
    const midX = x0 + contentW/2;
    page.drawRectangle({ x: midX, y: y0, width: 1, height: photoH + capH, color: tableBorder });

    // Headers (centrados)
    drawCenteredText(page, "ÍTEM", x0, yHeaderBottom, itemW, rowH, fontB, 11.5);
    drawCenteredText(page, "ACTIVIDAD", x0 + itemW, yHeaderBottom, actW, rowH, fontB, 11.5);
    drawCenteredText(page, "UNIDAD", x0 + itemW + actW, yHeaderBottom, unitW, rowH, fontB, 11.5);

    // Data row
    const code = String(blk.itemCode || "").trim();
    const act = String(blk.actividad || "").trim();
    const und = String(blk.unidad || "").trim();

    drawCenteredText(page, code, x0, yDataBottom, itemW, rowH, font, 11);
    drawCenteredText(page, und, x0 + itemW + actW, yDataBottom, unitW, rowH, font, 11);

    // actividad wrap (máx 2 líneas)
    const actLines = wrapTextPdf(act, font, 10.8, actW - 16, 2);
    // alineación vertical agradable dentro de la fila
    const actLineH = 12.6;
    const actBlockH = actLines.length * actLineH;
    let yAct = yDataBottom + (rowH + actBlockH)/2 - 9;
    for (const line of actLines){
      page.drawText(line, { x: x0 + itemW + 8, y: yAct, size: 10.8, font, color: rgb(0,0,0) });
      yAct -= actLineH;
    }

    // Fotos (dentro de la tabla)
    const cellW = contentW/2;
    const leftX = x0;
    const rightX = x0 + cellW;

    await drawImageInCell(page, leftX, yPhotoBottom, cellW, photoH, blk.left);
    if (blk.right){
      await drawImageInCell(page, rightX, yPhotoBottom, cellW, photoH, blk.right);
    } else {
      // derecha vacía
      page.drawRectangle({ x: rightX+1, y: yPhotoBottom+1, width: cellW-2, height: photoH-2, color: rgb(1,1,1) });
    }

    // Captions (dentro de la tabla)
    drawCaptionCell(page, leftX, y0, cellW, capH, blk.cap1Lines);
    drawCaptionCell(page, rightX, y0, cellW, capH, blk.right ? blk.cap2Lines : []);

    return y0;
  }

  // Paginar
  const pages = [];
  let page = null;
  let yCursor = 0;
  let i = 0;

  const newPage = () => {
    page = pdfDoc.addPage([pageW, pageH]);
    pages.push(page);
    drawHeader(page);
    yCursor = pageH - headerH - 14; // top content
  };

  while (i < blocks.length){
    if (!page) newPage();

    const remaining = yCursor - marginB;
    if (remaining < 200){
      page = null;
      continue;
    }

    // intenta 2 bloques
    const b1 = blocks[i];
    const b2 = (i+1 < blocks.length) ? blocks[i+1] : null;

    if (b2){
      const overhead1 = tableH + gapAfterTable + b1.capH;
      const overhead2 = tableH + gapAfterTable + b2.capH;
      const photoH = Math.min(MAX_PH, Math.floor((remaining - overhead1 - overhead2 - gapBetweenBlocks) / 2));

      if (photoH >= MIN_PH){
        const after1 = await drawBlock(page, yCursor, b1, photoH);
        yCursor = after1 - gapBetweenBlocks;
        const after2 = await drawBlock(page, yCursor, b2, photoH);
        yCursor = after2;
        i += 2;
        continue;
      }
    }

    // 1 bloque
    const overhead = tableH + gapAfterTable + b1.capH;
    let photoH1 = Math.min(MAX_PH, Math.floor(remaining - overhead));
    if (photoH1 < MIN_PH){
      // no cabe con altura mínima => nueva página
      page = null;
      continue;
    }
    const after = await drawBlock(page, yCursor, b1, photoH1);
    yCursor = after;
    i += 1;
  }

  // Footer page numbers
  const totalPages = pages.length || 1;
  for (let p=0; p<pages.length; p++){
    pages[p].drawText(`${p+1}/${totalPages}`, { x: pageW - marginX - 45, y: 16, size: 9, font, color: rgb(0.35,0.4,0.5) });
  }

  const bytes = await pdfDoc.save();
  return new Blob([bytes], { type: "application/pdf" });
}




async function exportExpressByMode(modo, desde, hasta, fmt) {
  if (_isExpressing) return;
  _isExpressing = true;

  // Plantilla seleccionada (defensivo):
  // En algunos builds anteriores se referenciaba `reportTpl` sin declararla,
  // lo que congelaba la app al hacer click en Exportar.
  const reportTpl = (typeof getSelectedTemplateId === "function")
    ? (getSelectedTemplateId() || "classic")
    : "classic";

  const btn = $("btnExpress");
  const btnZip = $("btnZip");
  const btnZipHoy = $("btnZipHoy");
  if (btn) btn.disabled = true;
  if (btnZip) btnZip.disabled = true;
  if (btnZipHoy) btnZipHoy.disabled = true;

  try {
    if (fmt === "zip"){
      await exportZipByMode(modo, desde, hasta);
      const zi = $("zipInfo");
      if (zi) { zi.textContent = "ZIP descargado ✅"; setTimeout(()=> zi.textContent = "", 1800); }
      return;
    }

    const useTime = !!$("useTimeNames")?.checked;
    const onlyDone = !!$("onlyDone")?.checked;

    const exportLogo = !!$("exportLogo")?.checked;
    const exportStampDT = !!$("exportStampDT")?.checked;
    const exportTemplate = !!$("exportTemplate")?.checked;
    const overlayTemplateId = getTemplateId();


    let selected = [];
    if (modo === "dia") {
      selected = cache.filter(x => x.fecha === desde);
    } else if (modo === "mes") {
      selected = cache.filter(x => (x.fecha || "").startsWith(desde.slice(0,7)));
    } else {
      selected = cache.filter(x => x.fecha >= desde && x.fecha <= hasta);
    }

    const itemFilter = getExportItemCode();
  if (itemFilter) selected = selected.filter(x => String(x.itemCode || "").trim() === itemFilter);

  if (onlyDone) selected = selected.filter(x => !!x.done);

    if (!selected.length) {
      alert("No hay fotos en ese rango / filtro.");
      return;
    }

    const start = (modo === "mes") ? desde.slice(0,7) : desde;
    const end   = (modo === "rango") ? hasta : ((modo === "mes") ? desde.slice(0,7) : desde);

    const activeP = (typeof getActiveProject === "function") ? getActiveProject() : null;
    const tituloProyecto = ((activeP && activeP.name) ? activeP.name : (proyectoInput.value || "")).trim();

    if (fmt === "docx" && reportTpl === "tags") {
      alert("La Plantilla 2 exporta solo en PDF (por ahora).");
      return;
    }

    if (fmt === "docx") {
      if (!window.docx) {
        alert("La librería DOCX no cargó. Abre con internet o en Chrome.");
        return;
      }
      const layoutKey = getLayoutKey();
      const { imgWcm: IMG_W_CM, imgHcm: IMG_H_CM, pairsPerPage: PAIRS_PER_PAGE } = docxDimsForLayout(layoutKey);

      const zi = $("zipInfo");
      const total = selected.length;
      const nextPaint = () => new Promise(res => requestAnimationFrame(() => setTimeout(res, 0)));

      if (zi){ zi.textContent = `Generando Word... 0/${total}`; await nextPaint(); }

      const onProgress = async (done, tot) => {
        if (!zi) return;
        zi.textContent = `Generando Word... ${done}/${tot}`;
        await nextPaint();
      };

      const docxBuffer = await buildRegistroFotograficoDocxBuffer(
        selected, tituloProyecto, start, end, IMG_W_CM, IMG_H_CM, PAIRS_PER_PAGE,
        { applyLogo: exportLogo && !!logoBitmap, applyStamp: exportStampDT, applyTemplate: exportTemplate, templateId: overlayTemplateId, onProgress }
      );

      const blob = new Blob([docxBuffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const itemTag = itemFilter ? `_ITEM_${sanitizeName(itemFilter)}` : "";
      await shareBlobAsFile(blob, `Logi_Reporte_${start}_a_${end}${itemTag}.docx`, blob.type, "Logi - Word");
      $("zipInfo").textContent = "Word listo ✅";
      setTimeout(()=> $("zipInfo").textContent = "", 1800);
      return;
    }

    // PDF
    $("zipInfo").textContent = (reportTpl === "tags") ? "Generando PDF (Plantilla 2)..." : "Generando PDF...";

    const pdfBlob = (reportTpl === "tags")
      ? await buildTagsTablaPdfBlob(selected, tituloProyecto, start, end, {
          applyLogo: exportLogo && !!logoBitmap,
          applyStamp: exportStampDT,
          applyTemplate: exportTemplate,
          templateId: overlayTemplateId
        })
      : await buildRegistroFotograficoPdfBlob(selected, tituloProyecto, start, end, {
          applyLogo: exportLogo && !!logoBitmap,
          applyStamp: exportStampDT,
          applyTemplate: exportTemplate,
          templateId: overlayTemplateId,
          layoutKey: getLayoutKey()
        });

    if (!pdfBlob) return;

    const itemTag = itemFilter ? `_ITEM_${sanitizeName(itemFilter)}` : "";
    await shareBlobAsFile(pdfBlob, `Logi_Reporte_${start}_a_${end}${itemTag}.pdf`, "application/pdf", "Logi - PDF");
    $("zipInfo").textContent = "PDF listo ✅";
    setTimeout(()=> $("zipInfo").textContent = "", 1800);

  } finally {
    _isExpressing = false;
    if (btn) btn.disabled = false;
    if (btnZip) btnZip.disabled = false;
    if (btnZipHoy) btnZipHoy.disabled = false;
  }
}

if ($("btnExpress")) {
  $("btnExpress").onclick = async () => {
    // La plantilla seleccionada se consulta aquí para evitar ReferenceError
    // y garantizar que el botón Exportar siempre tenga una plantilla válida.
    const reportTpl = getSelectedTemplateId();
    if (reportTpl === "soon") { alert("Próximamente ✅"); return; }

    let fmt = $("expressFormat")?.value || "docx";
    if (reportTpl === "tags") fmt = "pdf"; // por ahora solo PDF

    const modo = $("modoExport").value;
    const desde = $("desde").value || (fechaInput.value || hoyISO());
    let hasta = $("hasta").value || (fechaInput.value || hoyISO());
    if (modo !== "rango") hasta = desde;

    try {
      await exportExpressByMode(modo, desde, hasta, fmt);
    } catch (err) {
      console.error("[EXPORT]", err);
      const msg = (err && err.message) ? err.message : String(err);
      alert("Error al exportar: " + msg);
      if ($("zipInfo")) $("zipInfo").textContent = "";
    }
  };
}





function updateExportUI(){
  const modo = $("modoExport").value;
  const hastaWrap = $("hastaWrap");
  const desdeLabel = $("desdeLabel");
  const desdeEl = $("desde");

  // Cambia el picker según el modo:
  // - Día/Rango: type=date (YYYY-MM-DD)
  // - Mes: type=month (YYYY-MM)
  const toMonth = () => {
    const current = String(desdeEl.value || "");
    const ym = (current.length >= 7 ? current.slice(0,7) : hoyISO().slice(0,7));
    if (desdeEl.type !== "month") {
      try { desdeEl.type = "month"; } catch(e) {}
    }
    desdeEl.value = ym;
  };
  const toDate = () => {
    const current = String(desdeEl.value || "");
    const ymd = (current.length === 7 ? `${current}-01` : (current || hoyISO()));
    if (desdeEl.type !== "date") {
      try { desdeEl.type = "date"; } catch(e) {}
    }
    desdeEl.value = ymd;
  };

  if (modo === "rango"){
    toDate();
    hastaWrap.style.display = "block";
    desdeLabel.textContent = "Desde";
  } else if (modo === "dia"){
    toDate();
    hastaWrap.style.display = "none";
    desdeLabel.textContent = "Día";
    $("hasta").value = $("desde").value; // día usa solo "desde"
  } else { // mes
    hastaWrap.style.display = "none";
    desdeLabel.textContent = "Mes";
    toMonth();
    // Mantener "hasta" como fecha válida por si luego cambian a rango.
    const ym = String($("desde").value || hoyISO()).slice(0,7);
    $("hasta").value = `${ym}-01`;
  }
}

$("modoExport").addEventListener("change", updateExportUI);
$("desde").addEventListener("change", () => {
  const modo = $("modoExport").value;
  if (modo !== "rango") {
    if (modo === "mes") {
      const ym = String($("desde").value || hoyISO()).slice(0,7);
      $("hasta").value = `${ym}-01`;
    } else {
      $("hasta").value = $("desde").value;
    }
  }
  updateExportUI();


// Preferencias persistentes
  if (proyectoInput) proyectoInput.value = getProjectDefault();
  syncTemplateUI();
});

$("btnBorrarTodo").onclick = async () => {
  if (!confirm("¿Borrar TODO (todas las fotos y descripciones del dispositivo)?")) return;
  await dbClear();
  cache = [];
  render();
};

/* ===========================
   Tabs + render
=========================== */
function setTab(mode){
  viewMode = mode;

  $("tabCaptura").classList.toggle("active", mode === "captura");
  $("tabGaleria").classList.toggle("active", mode === "galeria");
  $("tabExport")?.classList.toggle("active", mode === "export");

  $("capturaView").style.display = mode === "captura" ? "block" : "none";
  $("galeriaView").style.display = mode === "galeria" ? "block" : "none";
  const cc = $("capturaControls");
  if (cc) cc.style.display = mode === "captura" ? "block" : "none";
  const ev = $("exportView");
  if (ev) ev.style.display = mode === "export" ? "block" : "none";

  const ri = $("rangeInfo");
  if (ri) ri.style.display = (mode === "galeria") ? "block" : "none";

  render();
}
$("tabCaptura").onclick = () => setTab("captura");
$("tabGaleria").onclick = () => setTab("galeria");
$("tabExport").onclick = () => setTab("export");

function initSwipeTabs(){
  const order = ["captura","galeria","export"];
  let startX = null;
  let startY = null;
  let started = false;

  const isFormEl = (el) => {
    if (!el) return false;
    const t = (el.tagName||"").toLowerCase();
    return ["input","textarea","select","button","label"].includes(t) || el.closest?.("input,textarea,select,button,label");
  };

  document.addEventListener("touchstart", (e) => {
    const t = e.touches && e.touches[0];
    if (!t) return;
    if (isFormEl(e.target)) { started = false; startX = startY = null; return; }
    started = true;
    startX = t.clientX;
    startY = t.clientY;
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    if (!started || startX == null) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    startX = startY = null;
    started = false;

    // Ignora gestos verticales
    if (Math.abs(dy) > Math.abs(dx)) return;

    if (Math.abs(dx) < 70) return;

    const i = Math.max(0, order.indexOf(viewMode));
    if (dx < 0){ // izquierda
      const next = order[Math.min(order.length-1, i+1)];
      setTab(next);
    } else { // derecha
      const prev = order[Math.max(0, i-1)];
      setTab(prev);
    }
  }, { passive: true });
}

function render(){
  revokeActiveUrls();
  setStatus();
  if (viewMode === "captura") renderCaptura();
  else if (viewMode === "galeria") renderGaleria();
  else renderExport();
}

function renderExport(){
  // En exportación solo necesitamos estado; el resto ya está en el DOM
}


/* ===========================
   Init
=========================== */
(async function init(){

(async function migrateFromRFIfNeeded(){
  try{
    // Si ya hay data en Logi, no hacemos nada
    const current = await dbGetAll();
    if (current && current.length) return;

    // Intentar leer DB legacy (RF)
    const legacyName = "rf_db_v1";
    const legacy = await (async () => new Promise((resolve) => {
      const req = indexedDB.open(legacyName, 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    }))();
    if (!legacy) return;

    const legacyItems = await new Promise((resolve) => {
      try{
        const tx = legacy.transaction("items", "readonly");
        const req = tx.objectStore("items").getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      }catch{ resolve([]); }
    });

    if (!legacyItems.length) return;

    const ok = confirm(`Encontré ${legacyItems.length} foto(s) de una versión anterior (RF).\n\n¿Quieres IMPORTARLAS a Logi? (No borra nada de RF)`);
    if (!ok) return;

    for (const it of legacyItems){
      await dbPut(it);
      cache.push(it);
    }

    // Migrar settings (solo si Logi no tiene nada aún)
    const mapKeys = [
      ["rf_theme","logi_theme"],
      ["rf_accent","logi_accent"],
      ["rf_project","logi_project"],
      ["rf_template","logi_template"],
      ["rf_logo_enabled","logi_logo_enabled"],
      ["rf_logo_dataurl","logi_logo_dataurl"],
      ["rf_logo_corner","logi_logo_corner"],
      ["rf_docx_fit","logi_docx_fit"],
    ];
    for (const [oldK,newK] of mapKeys){
      if (localStorage.getItem(newK) == null && localStorage.getItem(oldK) != null){
        localStorage.setItem(newK, localStorage.getItem(oldK));
      }
    }

    render();
    alert("Listo ✅ Importé las fotos y ajustes desde RF hacia Logi.");
  }catch{}
})(); 

  const today = hoyISO();
  fechaInput.value = today;
  $("desde").value = today;
  $("hasta").value = today;

  updateExportUI();

  initLayoutUI();
  await initTemplateUI();

  // Export: filtro por ítem (opcional)
  if ($("exportItem")) {
    $("exportItem").addEventListener("input", updateExportItemHint);
  }
  if ($("btnClearExportItem")) {
    $("btnClearExportItem").onclick = () => {
      if ($("exportItem")) $("exportItem").value = "";
      updateExportItemHint();
    };
  }
  updateExportItemHint();

  // Filtro por ítem en Galería
  if ($("galleryItem")){
    $("galleryItem").addEventListener("input", () => {
      updateGalleryItemHint();
      if (viewMode === "galeria") render();
    });
    $("galleryItem").addEventListener("change", () => {
      updateGalleryItemHint();
      if (viewMode === "galeria") render();
    });
  }
  if ($("btnGalleryItemClear")){
    $("btnGalleryItemClear").onclick = () => {
      if ($("galleryItem")) $("galleryItem").value = "";
      updateGalleryItemHint();
      if (viewMode === "galeria") render();
    };
  }
  updateGalleryItemHint();

  // Multi-proyecto (Logi2)
  ensureProjects();
  refreshProjectUI();
  attachProjectHandlers();

  initSwipeTabs();

  initTheme();
  initAccent();

  loadDocxFit();
  await loadLogoFromStorage();
  loadLogoCorner();

  try{
    await loadCacheForActiveProject();
    await loadCatalogForActiveProject();
    const ri = $("rangeInfo");
    if (ri) ri.style.display = "none";
    render();
  }catch(e){
    console.error("Init/IndexedDB error:", e);
    const st = document.getElementById("status");
    if (st) st.innerHTML = `<span style="color:#f87171;font-weight:800">⚠️ Error de almacenamiento local</span> · Cierra y abre la app. Si persiste: revisa modo privado y espacio libre.`;
  }

  fechaInput.onchange = () => render();
})();

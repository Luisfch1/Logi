
function $(id){ return document.getElementById(id); }

/* ===========================
   🎨 Tema (por dispositivo)
=========================== */
const THEME_KEY = "logi_theme";

function setMetaThemeColor(color){
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", color);
}

function applyTheme(theme){
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  setMetaThemeColor(theme === "light" ? "#f5f7fb" : "#0b1220");
}

function syncThemeUI(){
  const theme = document.documentElement.dataset.theme || "dark";
  const label = $("themeLabel");
  if (label) label.textContent = (theme === "light") ? "Claro" : "Oscuro";
  const btn = $("btnThemeToggle");
  if (btn) btn.textContent = (theme === "light") ? "☀️" : "🌙";
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
   Service Worker (PWA) + Update UI
=========================== */
let waitingSW = null;

function showUpdateUI(){
  $("updateBar").classList.add("show");
  const sbtn = $("btnSettings");
  if (sbtn) sbtn.classList.add("hasUpdate");
  const ul = $("updateLabel");
  if (ul) ul.textContent = "✅ Hay una actualización lista";
}

async function triggerSWUpdate(){
  try{
    if (waitingSW){
      waitingSW.postMessage({ type: "SKIP_WAITING" });
    } else {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    }
  }catch{}
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try{
      const reg = await navigator.serviceWorker.register("./sw.js");

      if (reg.waiting){
        waitingSW = reg.waiting;
        showUpdateUI();
      }

      reg.addEventListener("updatefound", () => {
        const newSW = reg.installing;
        if (!newSW) return;

        newSW.addEventListener("statechange", () => {
          if (newSW.state === "installed" && navigator.serviceWorker.controller){
            waitingSW = reg.waiting;
            showUpdateUI();
          }
        });
      });

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.location.reload();
      });

    }catch(e){}
  });
}

$("btnUpdateNow").onclick = triggerSWUpdate;

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
    schemaVersion: 1,
    app: "Logi",
    createdAt: new Date().toISOString(),
    settings,
    items: items.map(it => ({
      id: it.id,
      fecha: it.fecha || "",
      proyecto: it.proyecto || "",
      descripcion: it.descripcion || "",
      done: !!it.done,
      mime: it.mime || "image/jpeg",
      createdAt: it.createdAt || Date.now(),
      hasLogo: !!it.hasLogo
    }))
  };

  const zip = new JSZip();
  zip.file("backup.json", JSON.stringify(backup, null, 2));

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
  const outBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
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
  render();
  $("backupStatus").textContent = `Restauración completa ✅ (agregadas: ${added}, ya existían/omitidas: ${skipped})`;
  setTimeout(() => { $("backupStatus").textContent = "Consejo: haz backup al final del día o antes de actualizar."; }, 3500);
}

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
    $("itemsStatus").textContent = `Importado ✅ (leídos: ${res.total}, cargados: ${res.added}, omitidos: ${res.skipped})`;
    setTimeout(()=> refreshCatalogStatus(), 2200);
  }catch(e){
    console.error(e);
    alert("No pude importar ese archivo. Asegúrate de usar la plantilla.");
    refreshCatalogStatus();
  }finally{
    $("itemsInput").value = "";
  }
};


/* ===========================
   IndexedDB
=========================== */
const DB_NAME = "logi2_db_v1";
const DB_VERSION = 2;

const DB_STORE = "items";          // fotos (registros)
const DB_STORE_CATALOG = "catalog"; // listado de ítems por proyecto

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

/* ===========================
   Catálogo de ítems (por proyecto)
=========================== */
let catalog = [];          // rows: {key, projectId, item, descripcion, createdAt}
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
}

function refreshCatalogDatalist(){
  const dl = $("datalistItems");
  if (!dl) return;
  dl.innerHTML = "";
  const rows = (catalog || []).slice().sort((a,b) => String(a.item).localeCompare(String(b.item)));
  for (const r of rows){
    const opt = document.createElement("option");
    opt.value = String(r.item || "").trim();
    opt.textContent = r.descripcion ? `${r.item} — ${r.descripcion}` : String(r.item || "");
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

  if (idxItem === -1 || idxDesc === -1){
    alert("Ese archivo no tiene el formato correcto. Debe tener columnas: ITEM y DESCRIPCION.");
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

    if (!item) { skipped++; continue; }

    const key = `${projectId}::${item}`;
    batch.push({
      key,
      projectId,
      item,
      descripcion,
      createdAt: Date.now()
    });
    added++;
  }

  await catPutMany(batch);
  await loadCatalogForActiveProject();

  return { added, skipped, total: rows.length-1 };
}

function downloadTemplateItems(){
  // Archivo estático dentro del repo (también puede abrirse offline si está cacheado)
  const url = "Logi2_Plantilla_Items.xlsx";
  const a = document.createElement("a");
  a.href = url;
  a.download = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
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

async function onProjectChanged(){
  refreshProjectUI();
  // Evitar que la galería quede mostrando el proyecto anterior mientras carga
  cache = [];
  render();
  updateStorageUI();

  try{
    await loadCacheForActiveProject();
    await loadCatalogForActiveProject();
  }catch(e){
    console.error(e);
  }

  render();
  updateStorageUI();
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
  return { proj, desc, fecha, longDate, time, stamp };
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
  const id = templateId || "classic";
  if (id === "clean") return `FOTO ${n}.`;
  if (id === "fecha") return `FOTO ${n}. ${meta.stamp}`;
  if (id === "minimal") return `FOTO ${n}. ${(meta.desc || "—")} · ${meta.stamp}`;
  if (id === "proyecto"){
    const parts = [];
    if (meta.proj) parts.push(meta.proj);
    if (meta.desc) parts.push(meta.desc);
    if (meta.stamp) parts.push(meta.stamp);
    return `FOTO ${n}. ${parts.join(" · ") || "—"}`;
  }
  // classic
  return `FOTO ${n}. ${(meta.desc || "—")}`;
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
  $("btnQuitarLogo").style.display = has ? "inline-flex" : "none";
}

async function loadLogoFromStorage(){
  logoDataUrl = localStorage.getItem("logi_logo_dataurl");
  const enabled = localStorage.getItem("logi_logo_enabled") === "1";
  $("logoEnabled").checked = enabled;

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
  $("logoCorner").value = v;
}
$("logoCorner").onchange = () => localStorage.setItem("logi_logo_corner", $("logoCorner").value);

$("btnCargarLogo").onclick = () => $("logoInput").click();

$("logoInput").onchange = async () => {
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
};

$("btnQuitarLogo").onclick = async () => {
  if (!confirm("¿Quitar el logo cargado?")) return;
  localStorage.removeItem("logi_logo_dataurl");
  logoDataUrl = null;
  logoBitmap = null;
  $("logoPreview").src = "";
  $("logoPreview").style.display = "none";
  syncLogoButtons();
  alert("Logo quitado ✅");
};

$("logoEnabled").onchange = () => localStorage.setItem("logi_logo_enabled", $("logoEnabled").checked ? "1" : "0");

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

  const enabled = localStorage.getItem("logi_logo_enabled") === "1";
  const corner = localStorage.getItem("logi_logo_corner") || "br";
  const hadLogo = (enabled && logoBitmap) ? drawLogoAtCorner(ctx, nw, nh, corner, 0.85) : false;

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
        <img class="thumb" src="${thumbUrl}" data-open="${item.id}" alt="foto">
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

          <label style="margin-top:6px">Descripción</label>
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

  const groups = groupByDate(cache);
  if (!groups.length){
    wrap.innerHTML = `<div style="padding:12px" class="muted">Aún no hay fotos guardadas.</div>`;
    return;
  }

  for (const [date, items] of groups){
    const day = document.createElement("div");
    const doneCount = items.filter(x => x.done).length;
    const bytes = items.reduce((a,i)=>a+(i.blob?.size||0),0);

    day.innerHTML = `
      <div class="dayHeader">
        <div class="dayTitle"><span class="dayChip">${formatDateLongES(date)}</span></div>
        <div class="dayMeta">· ${items.length} foto(s) · ${doneCount} listas · ${fmtBytes(bytes)}</div>
      </div>
      <div class="gridThumbs" data-day="${date}"></div>
    `;
    wrap.appendChild(day);

    const grid = day.querySelector(".gridThumbs");
    items.forEach(it => {
      const box = document.createElement("div");
      box.className = "gThumbBox";
      const url = trackUrl(URL.createObjectURL(it.blob));
      box.innerHTML = `
        <img class="gThumb" src="${url}" data-open="${it.id}" alt="foto">
        <div class="badge ${it.done ? "badgeDone" : ""}">${it.done ? "LISTO" : "PEND"}</div>
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

  const url = trackUrl(URL.createObjectURL(it.blob));
  $("modalImg").src = url;

  $("modalTitle").textContent = it.proyecto ? it.proyecto : "Foto";
  $("modalMeta").textContent = `${it.fecha} · ${it.done ? "LISTA" : "PENDIENTE"}`;

  $("modalItem").value = it.itemCode || "";
  $("modalItem").disabled = !!it.done;
  $("modalItemHint").textContent = (it.itemCode && catalogMap[it.itemCode]) ? catalogMap[it.itemCode] : "—";

  $("modalDesc").value = it.descripcion || "";
  $("modalDesc").disabled = !!it.done;

  $("btnModalDone").textContent = it.done ? "✏️ Editar" : "✅ Listo";
  $("btnModalShare").disabled = !it.done;
  $("btnModalShare").classList.toggle("btn-disabled", !it.done);
}

function closeModal(){
  $("modal").classList.remove("open");
  $("modalImg").src = "";
  modalId = null;
}

$("btnModalClose").onclick = closeModal;
$("modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });


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
  try{
    const r = await fetch("./icon-192.png", { cache: "no-store" });
    if (r && r.ok) return await r.arrayBuffer();
  }catch{}
  return null;
}

function buildCaptionRuns(n, meta, templateId){
  const caption = buildDocxCaption(n, meta, templateId);
  const prefix = `FOTO ${n}.`;
  const rest = caption.startsWith(prefix) ? caption.slice(prefix.length).trimStart() : caption;
  const { TextRun } = window.docx;

  return [
    new TextRun({ text: prefix, bold: true }),
    new TextRun({ text: rest ? (" " + rest) : "" })
  ];
}

async function buildRegistroFotograficoDocxBuffer(
  selected, tituloProyecto, startISO, endISO, imgWcm, imgHcm,
  pairsPerPage = 4,
  exportOpts=null
){
  const {
    Document, Packer, Paragraph, TextRun,
    AlignmentType, Table, TableRow, TableCell, WidthType,
    ImageRun, PageBreak, BorderStyle, Header, VerticalAlign
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
  const frameW = 1600;
  const frameH = Math.round(frameW / ratio);
  const fitMode = localStorage.getItem("logi_docx_fit") || "stretch";

  const startLong = formatDateLongES(startISO);
  const endLong = formatDateLongES(endISO);
  const sameDay = (startISO === endISO);

  const titleLine = sameDay
    ? `Reporte fotográfico · ${startLong}`
    : `Reporte fotográfico · ${startLong} — ${endLong}`;

  const projText = (tituloProyecto || "").trim();

  // Logo (opcional)
  const logoAb = await loadLogiLogoArrayBuffer();
  const logoRun = logoAb ? new ImageRun({ data: logoAb, transformation: { width: 38, height: 38 } }) : null;

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
                            children: projText
                              ? [new TextRun({ text: projText, bold: true, color: "FFFFFF", size: 32 })]
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
      transformation: { width: IMG_W, height: IMG_H }
    });

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
    const runs = buildCaptionRuns(n, meta, templateId);

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
    if (idx !== pages.length - 1){
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
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
  return await blob.arrayBuffer();
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
  const templateId = getTemplateId();

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

  if (onlyDone) selected = selected.filter(x => !!x.done);

  if (!selected.length){
    alert("No hay fotos en ese periodo" + (onlyDone ? " (o ninguna marcada como LISTA)." : "."));
    return;
  }

  selected.sort((a,b)=> (a.fecha.localeCompare(b.fecha) || a.createdAt - b.createdAt));

  const proyecto = sanitizeName(proyectoInput.value);
  const packName =
    (modo==="dia") ? `${desde}_${proyecto}` :
    (modo==="mes") ? `${(desde||hoyISO()).slice(0,7)}_${proyecto}` :
    `${desde}_a_${hasta}_${proyecto}`;

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

  const IMG_W_CM = 7.6;
  const IMG_H_CM = 4.6;
  const MODULES_PER_PAGE = 4;

  const { start, end } = computeRangeForTitle(modo, desde, hasta);
  const tituloProyecto = (proyectoInput.value || "").trim();

  zipInfo.textContent = "Generando DOCX...";
  const docxBuffer = await buildRegistroFotograficoDocxBuffer(
    selected, tituloProyecto, start, end, IMG_W_CM, IMG_H_CM, MODULES_PER_PAGE,
    { applyLogo: exportLogo && !!logoBitmap, applyStamp: exportStampDT, applyTemplate: exportTemplate, templateId }
  );

  root.file(`Logi_Reporte_${start}_a_${end}.docx`, docxBuffer);

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

$("btnZip").onclick = async () => {
  const modo = $("modoExport").value;
  const desde = $("desde").value || (fechaInput.value || hoyISO());
  let hasta = $("hasta").value || (fechaInput.value || hoyISO());
  if (modo !== "rango") hasta = desde; // Día/Mes ignoran "hasta"
  await exportZipByMode(modo, desde, hasta);
};

$("btnZipHoy").onclick = async () => {
  const hoy = hoyISO();
  await exportZipByMode("dia", hoy, hoy);
};


function updateExportUI(){
  const modo = $("modoExport").value;
  const hastaWrap = $("hastaWrap");
  const desdeLabel = $("desdeLabel");

  if (modo === "rango"){
    hastaWrap.style.display = "block";
    desdeLabel.textContent = "Desde";
  } else if (modo === "dia"){
    hastaWrap.style.display = "none";
    desdeLabel.textContent = "Día";
    $("hasta").value = $("desde").value; // día usa solo "desde"
  } else { // mes
    hastaWrap.style.display = "none";
    desdeLabel.textContent = "Mes (elige un día)";
    $("hasta").value = $("desde").value;
  }
}

$("modoExport").addEventListener("change", updateExportUI);
$("desde").addEventListener("change", () => {
  if ($("modoExport").value !== "rango") $("hasta").value = $("desde").value;
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
  $("capturaView").style.display = mode === "captura" ? "block" : "none";
  $("galeriaView").style.display = mode === "galeria" ? "block" : "none";
  const ri = $("rangeInfo");
  if (ri) ri.style.display = (mode === "galeria") ? "block" : "none";
  render();
}
$("tabCaptura").onclick = () => setTab("captura");
$("tabGaleria").onclick = () => setTab("galeria");

function render(){
  revokeActiveUrls();
  setStatus();
  if (viewMode === "captura") renderCaptura();
  else renderGaleria();
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

  // Multi-proyecto (Logi2)
  ensureProjects();
  refreshProjectUI();
  attachProjectHandlers();

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
  }catch{
    alert("No se pudo abrir la base local (IndexedDB). Prueba Chrome.");
  }

  fechaInput.onchange = () => render();
})();

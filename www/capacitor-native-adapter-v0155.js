/**
 * Logi Native Storage Adapter (Diagnostic Resurrection Edition)
 * Version: 2026.03.20.0155 (DEEP SCAN + DIAGNOSTICS)
 * This version uses ALERTS to provide feedback on the recovery process.
 */
(function() {
  const Capacitor = window.Capacitor;
  const Plugins = Capacitor ? Capacitor.Plugins : {};
  const Filesystem = Plugins.Filesystem;
  const Share = Plugins.Share;
  const FileOpener = Plugins.FileOpener;
  const SpeechRecognition = Plugins.SpeechRecognition;

  if (window.__logiDebug) window.__logiDebug("!!! ADAPTER v0155 INIT !!!");
  console.log("DEBUG: capacitor-native-adapter (v0155) deep scan start");
  
  // ALERTA DE INICIO PARA EL USUARIO
  // alert("Logi v155: Iniciando recuperación de datos...");

  const Directory = { Data: 'DATA', Cache: 'CACHE', Documents: 'DOCUMENTS' };
  const DIRS = [Directory.Data, Directory.Documents]; 
  const PROJECT_FOLDERS = ['Logi', 'data', 'metadata', '']; // Broadest search!
  
  const WRITE_DIR = Directory.Data; 
  const WRITE_FOLDER = 'Logi';

  let _totalPhotosFound = 0;
  let _totalReportsFound = 0;

  async function ensureDir() {
    if (!Filesystem) return;
    try { await Filesystem.mkdir({ path: WRITE_FOLDER, directory: WRITE_DIR, recursive: true }); } catch (e) { }
  }

  // --- DIAGNOSTIC HELPERS ---
  async function deepReadFile(storePath) {
    for (const folder of PROJECT_FOLDERS) {
       for (const dir of DIRS) {
          try {
             const path = (folder ? folder + '/' : '') + storePath;
             return await Filesystem.readFile({ path, directory: dir, encoding: 'utf8' });
          } catch(e){}
       }
    }
    throw new Error("404: " + storePath);
  }

  async function deepGetUri(storePath) {
    for (const folder of PROJECT_FOLDERS) {
       for (const dir of DIRS) {
          try {
             const path = (folder ? folder + '/' : '') + storePath;
             const res = await Filesystem.getUri({ path, directory: dir });
             if (res && res.uri) return res;
          } catch(e){}
       }
    }
    throw new Error("404: " + storePath);
  }

  async function deepReaddir(storeSubPath) {
    let allFiles = [];
    let seenNames = new Set();
    for (const folder of PROJECT_FOLDERS) {
       for (const dir of DIRS) {
          try {
             const path = (folder ? folder + '/' : '') + storeSubPath;
             const res = await Filesystem.readdir({ path, directory: dir });
             if (res && res.files) {
                for (const f of res.files) {
                   const name = (typeof f === 'string') ? f : f.name;
                   if (!seenNames.has(name)) { allFiles.push(f); seenNames.add(name); }
                }
             }
          } catch(e){}
       }
    }
    return { files: allFiles };
  }

  // --- METADATA MASTER ---
  const MASTER_FILENAME = 'metadata_db.json';
  let _nativeMetaCache = null;

  async function saveMetaDb() {
    if (!Filesystem || !_nativeMetaCache || _nativeMetaCache.length === 0) return;
    try {
      await Filesystem.writeFile({
        path: WRITE_FOLDER + '/' + MASTER_FILENAME,
        data: JSON.stringify(_nativeMetaCache),
        directory: WRITE_DIR,
        encoding: 'utf8',
        recursive: true
      });
    } catch (e) { }
  }

  let _cachedBlobBaseUrl = "";

  async function loadMetaDb() {
    if (!Filesystem) return [];
    if (!_cachedBlobBaseUrl) {
       try {
         const result = await deepGetUri('blobs');
         let base = result.uri;
         if (!base.endsWith('/')) base += '/';
         _cachedBlobBaseUrl = (window.Capacitor ? window.Capacitor.convertFileSrc(base) : base);
       } catch(e){ }
    }
    if (_nativeMetaCache && _nativeMetaCache.length > 0) return _nativeMetaCache;

    let merged = [];
    for (const folder of PROJECT_FOLDERS) {
       for (const dir of DIRS) {
          try {
             const path = (folder ? folder + '/' : '') + MASTER_FILENAME;
             const r = await Filesystem.readFile({ path, directory: dir, encoding: 'utf8' });
             const items = JSON.parse(r.data);
             if (Array.isArray(items) && items.length > 0) {
                for (const it of items) {
                   if (!merged.find(x => x.id === it.id)) merged.push(it);
                }
             }
          } catch(e){}
       }
    }

    if (merged.length > 0) {
       _nativeMetaCache = merged;
       _totalPhotosFound = merged.length;
       return _nativeMetaCache;
    }

    // Repair from individual files SEQUENTIALLY (Safe)
    const items1 = await scanDeepSequential('meta');
    const items2 = await scanDeepSequential('items_meta');
    _nativeMetaCache = [...items1, ...items2];
    _totalPhotosFound = _nativeMetaCache.length;
    
    if (_nativeMetaCache.length > 0) {
       // alert("¡Recuperadas " + _nativeMetaCache.length + " fotos!");
       await saveMetaDb();
    }
    return _nativeMetaCache;
  }

  async function scanDeepSequential(storeName) {
    if (!Filesystem) return [];
    try {
      const res = await deepReaddir(storeName);
      const names = (res.files || []).map(f => (typeof f === 'string') ? f : f.name).filter(n => n.endsWith('.json'));
      const items = [];
      // Sequential to avoid bridge overload
      for (const name of names) {
         try {
            const id = name.replace('.json', '');
            const r = await deepReadFile(storeName + '/' + name);
            items.push(JSON.parse(r.data));
         } catch(e){}
      }
      return items;
    } catch(e) { return []; }
  }

  async function nativeDbPut(storeName, item) {
    if (!Filesystem) return false;
    await ensureDir();
    const path = WRITE_FOLDER + '/' + storeName + '/' + item.id + '.json';
    try {
      await Filesystem.writeFile({ path, data: JSON.stringify(item), directory: WRITE_DIR, encoding: 'utf8', recursive: true });
      const isMeta = (storeName === 'meta' || storeName === 'items_meta');
      if (isMeta) {
        if (!_nativeMetaCache) await loadMetaDb();
        const idx = _nativeMetaCache.findIndex(x => x.id === item.id);
        if (idx >= 0) _nativeMetaCache[idx] = item;
        else _nativeMetaCache.push(item);
        saveMetaDb();
      }
      return true;
    } catch(e) { return false; }
  }

  async function nativeDbGet(storeName, id) {
    if (!Filesystem) return null;
    const isMeta = (storeName === 'meta' || storeName === 'items_meta');
    if (isMeta && _nativeMetaCache && _nativeMetaCache.length > 0) {
       return _nativeMetaCache.find(x => x.id === id) || null;
    }
    try {
      const result = await deepReadFile(storeName + '/' + id + '.json');
      return JSON.parse(result.data);
    } catch (e) { return null; }
  }

  async function nativeDbGetAll(storeName) {
    if (storeName === 'meta' || storeName === 'items_meta') return await loadMetaDb();
    const items = await scanDeepSequential(storeName);
    if (storeName === 'reports') _totalReportsFound = items.length;
    return items;
  }

  async function nativeDbDelete(storeName, id) {
    if (!Filesystem) return false;
    let deleted = false;
    for (const folder of PROJECT_FOLDERS) {
       for (const dir of DIRS) {
          try { 
             const path = (folder ? folder + '/' : '') + storeName + '/' + id + '.json';
             await Filesystem.deleteFile({ path, directory: dir }); 
             deleted = true; 
          } catch(e){}
       }
    }
    const isMeta = (storeName === 'meta' || storeName === 'items_meta');
    if (isMeta) {
      if (!_nativeMetaCache) await loadMetaDb();
      _nativeMetaCache = _nativeMetaCache.filter(x => x.id !== id);
      saveMetaDb();
    }
    return deleted;
  }

  async function nativeSaveBlob(id, blob) {
    if (!Filesystem) return false;
    await ensureDir();
    const CHUNK_SIZE = 1024 * 1024 * 5; 
    try {
      const path = WRITE_FOLDER + '/blobs/' + id + '.jpg';
      let offset = 0; let first = true;
      while (offset < blob.size) {
        const chunk = blob.slice(offset, offset + CHUNK_SIZE);
        const reader = new FileReader();
        const base64 = await new Promise(r => { reader.onloadend = () => r(reader.result.split(',')[1]); reader.readAsDataURL(chunk); });
        if (first) { await Filesystem.writeFile({ path, data: base64, directory: WRITE_DIR, recursive: true }); first = false; }
        else { await Filesystem.appendFile({ path, data: base64, directory: WRITE_DIR }); }
        offset += CHUNK_SIZE;
      }
      return true;
    } catch (e) { return false; }
  }

  async function nativeGetBlob(id) {
    if (!Filesystem) return null;
    try {
      const result = await deepReadFile('blobs/' + id + '.jpg');
      const b64 = result.data;
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for(let i=0; i<bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: 'image/jpeg' });
    } catch (e) { return null; }
  }

  async function nativeShare(blob, filename, mime, title, id) {
    if (!Plugins.Share || !Filesystem) return;
    try {
      let finalUri = null;
      if (id) {
          const ext = (mime || "").includes("word") || (filename || "").toLowerCase().endsWith(".docx") ? ".docx" : ".pdf";
          try { const res = await deepGetUri('reports/' + String(id).replace(/[^a-z0-9_-]/gi, '_') + ext); finalUri = res.uri; } catch(e){}
      }
      if (!finalUri) {
          const reader = new FileReader();
          const base64 = await new Promise(r => { reader.onloadend = () => r(reader.result.split(',')[1]); reader.readAsDataURL(blob); });
          const res = await Filesystem.writeFile({ path: 'tmp/' + (filename||"file").replace(/[^a-z0-9\.]/gi,'_'), data: base64, directory: Directory.Cache, recursive: true });
          finalUri = res.uri;
      }
      await Plugins.Share.share({ title: title || "Logi", files: [finalUri] });
    } catch (e) { alert("Error: " + e.message); }
  }

  async function nativeOpenFile(blob, filename, mimeType) {
    if (!Plugins.FileOpener) return false;
    try {
      const reader = new FileReader();
      const base64 = await new Promise(r => { reader.onloadend = () => r(reader.result.split(',')[1]); reader.readAsDataURL(blob); });
      const res = await Filesystem.writeFile({ path: 'tmp_' + filename, data: base64, directory: Directory.Cache, recursive: true });
      await Plugins.FileOpener.open({ filePath: res.uri, contentType: mimeType || "application/pdf" });
      return true;
    } catch (e) { return false; }
  }

  async function nativeGetBlobUrl(id) {
    if (!Filesystem) return null;
    try {
      const result = await deepGetUri('blobs/' + id + '.jpg');
      return (window.Capacitor ? window.Capacitor.convertFileSrc(result.uri) : result.uri);
    } catch (e) { return null; }
  }

  async function nativeGetBlobBaseUrl() {
    if (!Filesystem) return "";
    try {
      const result = await deepGetUri('blobs');
      let base = result.uri;
      if (!base.endsWith('/')) base += '/';
      return (window.Capacitor ? window.Capacitor.convertFileSrc(base) : base);
    } catch (e) { return ""; }
  }

  async function nativeCheckSpeechPermissions() {
    if (!SpeechRecognition) return false;
    try { const p = await SpeechRecognition.checkPermissions(); return p.speechRecognition === 'granted'; } catch (e) { return false; }
  }

  async function nativeStartDictation(onResult) {
    if (!SpeechRecognition) return;
    try {
      SpeechRecognition.addListener('partialResults', (data) => { if (data.matches && onResult) onResult(data.matches[0], !!data.isFinal); });
      await SpeechRecognition.start({ language: "es-CO", partialResults: true, continuous: true, popup: false });
    } catch (e) { }
  }

  async function nativeStopDictation() {
    if (!SpeechRecognition) return;
    try { await SpeechRecognition.stop(); SpeechRecognition.removeAllListeners(); } catch (e) {}
  }

  async function nativeSaveReport(id, blob) {
    await ensureDir(); 
    const CHUNK_SIZE = 1024 * 1024 * 10;
    try {
      const ext = (blob.type || "").includes("word") || id.toLowerCase().endsWith(".docx") ? ".docx" : ".pdf";
      const path = WRITE_FOLDER + '/reports/' + String(id).replace(/[^a-z0-9_-]/gi, '_') + ext;
      let offset = 0; let first = true;
      while (offset < blob.size) {
        const chunk = blob.slice(offset, offset + CHUNK_SIZE);
        const reader = new FileReader();
        const base64 = await new Promise(r => { reader.onloadend = () => r(reader.result.split(',')[1]); reader.readAsDataURL(chunk); });
        if (first) { await Filesystem.writeFile({ path, data: base64, directory: WRITE_DIR, recursive: true }); first = false; }
        else { await Filesystem.appendFile({ path, data: base64, directory: WRITE_DIR }); }
        offset += CHUNK_SIZE;
        if (window.__logiProgress) window.__logiProgress("Guardando...", Math.round((offset/blob.size)*100));
      }
      const res = await Filesystem.getUri({ path, directory: WRITE_DIR });
      return res.uri;
    } catch (e) { return null; }
  }

  async function nativeGetReport(id) {
    if (!Filesystem) return null;
    try {
      const safeId = String(id).replace(/[^a-z0-9_-]/gi, '_');
      const types = [{p: 'reports/'+safeId+'.pdf', t: "application/pdf"}, {p: 'reports/'+safeId+'.docx', t: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}];
      for (const ty of types) { try { const res = await deepReadFile(ty.p); return new Blob([atob(res.data)], {type:ty.t}); } catch(e){} }
      return null;
    } catch (e) { return null; }
  }

  window.LogiNative = {
    isNative: function() { return (window.Capacitor && window.Capacitor.getPlatform() !== 'web'); },
    dbPut: nativeDbPut, dbGet: nativeDbGet, dbGetAll: nativeDbGetAll, dbDelete: nativeDbDelete,
    saveBlob: nativeSaveBlob, getBlob: nativeGetBlob, dbGetBlob: nativeGetBlob,
    getBlobUrl: nativeGetBlobUrl, getBlobBaseUrl: nativeGetBlobBaseUrl,
    getBlobBaseUrlSync: function() { return _cachedBlobBaseUrl; },
    share: nativeShare, openFile: nativeOpenFile, saveReport: nativeSaveReport, getReport: nativeGetReport,
    startDictation: nativeStartDictation, stopDictation: nativeStopDictation, checkSpeechPermissions: nativeCheckSpeechPermissions,
    getStats: function() { return { photos: _totalPhotosFound, reports: _totalReportsFound }; }
  };
})();

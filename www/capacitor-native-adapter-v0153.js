/**
 * Logi Native Storage Adapter (Unified Healing Edition)
 * Version: 2026.03.20.0153 (FINAL UNIFICATION)
 * This version treats DATA and DOCUMENTS as a single storage space to recover all lost data.
 */
(function() {
  if (window.__logiDebug) window.__logiDebug("!!! ADAPTER v0153 LOADED !!!");
  console.log("DEBUG: capacitor-native-adapter (v0153) execution start");
  
  const Capacitor = window.Capacitor;
  const Plugins = Capacitor ? Capacitor.Plugins : {};
  const Filesystem = Plugins.Filesystem;
  const Share = Plugins.Share;
  const FileOpener = Plugins.FileOpener;
  const SpeechRecognition = Plugins.SpeechRecognition;
  
  const Directory = { Data: 'DATA', Cache: 'CACHE', Documents: 'DOCUMENTS' };
  const DIRS = [Directory.Data, Directory.Documents]; // The "Unified" search path
  const DATA_DIR = 'Logi'; 
  const WRITE_DIR = Directory.Data; // All new data goes to Private Storage (Fast & Safe)

  async function ensureDir(dType = WRITE_DIR) {
    if (!Filesystem) return;
    try { await Filesystem.mkdir({ path: DATA_DIR, directory: dType, recursive: true }); } catch (e) { }
  }

  // --- UNIFIED HELPERS ---
  async function unifiedReadFile(path) {
    for (const d of DIRS) {
      try { return await Filesystem.readFile({ path, directory: d, encoding: 'utf8' }); } catch(e){}
    }
    throw new Error("File not found in any directory: " + path);
  }

  async function unifiedGetUri(path) {
    for (const d of DIRS) {
      try { 
        const res = await Filesystem.getUri({ path, directory: d }); 
        if (res && res.uri) return res;
      } catch(e){}
    }
    throw new Error("Uri not found in any directory: " + path);
  }

  async function unifiedReaddir(path) {
    let allFiles = [];
    let seen = new Set();
    for (const d of DIRS) {
      try { 
        const res = await Filesystem.readdir({ path, directory: d });
        if (res && res.files) {
           for (const f of res.files) {
              const name = (typeof f === 'string') ? f : f.name;
              if (!seen.has(name)) { allFiles.push(f); seen.add(name); }
           }
        }
      } catch(e){}
    }
    return { files: allFiles };
  }

  // --- METADATA MASTER ---
  const META_DB_PATH = DATA_DIR + '/metadata_db.json';
  let _nativeMetaCache = null;

  async function saveMetaDb() {
    if (!Filesystem || !_nativeMetaCache) return;
    try {
      await Filesystem.writeFile({
        path: META_DB_PATH,
        data: JSON.stringify(_nativeMetaCache),
        directory: WRITE_DIR,
        encoding: 'utf8',
        recursive: true
      });
    } catch (e) { console.warn("saveMetaDb failed", e); }
  }

  let _cachedBlobBaseUrl = "";

  async function loadMetaDb() {
    if (!Filesystem) return [];
    if (!_cachedBlobBaseUrl) {
       try {
         const result = await unifiedGetUri(DATA_DIR + '/blobs');
         let base = result.uri;
         if (!base.endsWith('/')) base += '/';
         _cachedBlobBaseUrl = (window.Capacitor ? window.Capacitor.convertFileSrc(base) : base);
       } catch(e){ }
    }
    if (_nativeMetaCache) return _nativeMetaCache;

    let merged = [];
    let foundAny = false;
    for (const d of DIRS) {
       try {
          const r = await Filesystem.readFile({ path: META_DB_PATH, directory: d, encoding: 'utf8' });
          const items = JSON.parse(r.data);
          if (Array.isArray(items)) {
             foundAny = true;
             for (const it of items) {
                if (!merged.find(x => x.id === it.id)) merged.push(it);
             }
          }
       } catch(e){}
    }

    if (foundAny && merged.length > 0) {
       _nativeMetaCache = merged;
       return _nativeMetaCache;
    }

    // Repair from individual files if master is missing or empty
    const items1 = await scanIndividualFiles('meta');
    const items2 = await scanIndividualFiles('items_meta');
    _nativeMetaCache = [...items1, ...items2];
    if (_nativeMetaCache.length > 0) await saveMetaDb();
    return _nativeMetaCache;
  }

  async function scanIndividualFiles(storeName) {
    if (!Filesystem) return [];
    try {
      const res = await unifiedReaddir(DATA_DIR + '/' + storeName);
      const files = res.files || [];
      const items = [];
      const queue = files.map(f => (typeof f === 'string') ? f : f.name).filter(n => n.endsWith('.json'));
      const concurrency = 20;
      const workers = [];
      for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
        workers.push((async () => {
          while (queue.length > 0) {
            const name = queue.shift();
            const id = name.replace('.json', '');
            const item = await nativeDbGet(storeName, id);
            if (item) items.push(item);
          }
        })());
      }
      await Promise.all(workers);
      return items;
    } catch(e) { return []; }
  }

  async function nativeDbPut(storeName, item) {
    if (!Filesystem) return false;
    await ensureDir(WRITE_DIR);
    const path = DATA_DIR + '/' + storeName + '/' + item.id + '.json';
    try {
      await Filesystem.writeFile({ path, data: JSON.stringify(item), directory: WRITE_DIR, encoding: 'utf8', recursive: true });
      const isMeta = (storeName === 'meta' || storeName === 'items_meta');
      if (isMeta) {
        if (!_nativeMetaCache) await loadMetaDb();
        const idx = _nativeMetaCache.findIndex(x => x.id === item.id);
        if (idx >= 0) _nativeMetaCache[idx] = item;
        else _nativeMetaCache.push(item);
        saveMetaDb(); // No timer for safety in healing phase
      }
      return true;
    } catch(e) { return false; }
  }

  async function nativeDbGet(storeName, id) {
    if (!Filesystem) return null;
    const isMeta = (storeName === 'meta' || storeName === 'items_meta');
    if (isMeta && _nativeMetaCache) {
       return _nativeMetaCache.find(x => x.id === id) || null;
    }
    try {
      const result = await unifiedReadFile(DATA_DIR + '/' + storeName + '/' + id + '.json');
      return JSON.parse(result.data);
    } catch (e) { return null; }
  }

  async function nativeDbGetAll(storeName) {
    if (storeName === 'meta' || storeName === 'items_meta') return await loadMetaDb();
    return await scanIndividualFiles(storeName);
  }

  async function nativeDbDelete(storeName, id) {
    if (!Filesystem) return false;
    let deleted = false;
    for (const d of DIRS) {
       try { await Filesystem.deleteFile({ path: DATA_DIR + '/' + storeName + '/' + id + '.json', directory: d }); deleted = true; } catch(e){}
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
    await ensureDir(WRITE_DIR);
    const CHUNK_SIZE = 1024 * 1024 * 5; 
    try {
      const path = DATA_DIR + '/blobs/' + id + '.jpg';
      const totalSize = blob.size;
      let offset = 0;
      let first = true;
      while (offset < totalSize) {
        const chunk = blob.slice(offset, offset + CHUNK_SIZE);
        const base64 = await blobToBase64(chunk);
        if (first) {
          await Filesystem.writeFile({ path, data: base64, directory: WRITE_DIR, recursive: true });
          first = false;
        } else {
          await Filesystem.appendFile({ path, data: base64, directory: WRITE_DIR });
        }
        offset += CHUNK_SIZE;
      }
      return true;
    } catch (e) { return false; }
  }

  async function nativeGetBlob(id) {
    if (!Filesystem) return null;
    try {
      const result = await unifiedReadFile(DATA_DIR + '/blobs/' + id + '.jpg');
      return base64ToBlob(result.data, 'image/jpeg');
    } catch (e) { return null; }
  }

  async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(base64, contentType) {
    const byteCharacters = atob(base64);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i);
      byteArrays.push(new Uint8Array(byteNumbers));
    }
    return new Blob(byteArrays, { type: contentType });
  }

  async function nativeShare(blob, filename, mime, title, id) {
    if (!Share || !Filesystem) return;
    const isDocx = (mime || "").includes("word") || (filename || "").toLowerCase().endsWith(".docx");
    try {
      let finalUri = null;
      if (id) {
          const safeId = String(id).replace(/[^a-z0-9_-]/gi, '_');
          const ext = isDocx ? ".docx" : ".pdf";
          try {
             const res = await unifiedGetUri(DATA_DIR + '/reports/' + safeId + ext);
             finalUri = res.uri;
          } catch(e){}
      }
      if (!finalUri) {
          const cleanName = (filename || "informe").replace(/[^a-z0-9\._-]/gi, '_');
          const path = 'tmp/' + cleanName;
          const base64 = await blobToBase64(blob);
          const res = await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache, recursive: true });
          finalUri = res.uri;
      }
      await Share.share({ title: title || filename || "Logi Report", files: [finalUri] });
    } catch (e) { alert("Error: " + e.message); }
  }

  async function nativeOpenFile(blob, filename, mimeType) {
    if (!FileOpener || !Filesystem) return false;
    try {
      const base64 = await blobToBase64(blob);
      const path = 'tmp_preview_' + filename;
      const writeResult = await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache, recursive: true });
      await FileOpener.open({ filePath: writeResult.uri, contentType: mimeType || blob.type || "application/pdf" });
      return true;
    } catch (e) { return false; }
  }

  async function nativeGetBlobUrl(id) {
    if (!Filesystem) return null;
    try {
      const result = await unifiedGetUri(DATA_DIR + '/blobs/' + id + '.jpg');
      return (window.Capacitor ? window.Capacitor.convertFileSrc(result.uri) : result.uri);
    } catch (e) { return null; }
  }

  async function nativeGetBlobBaseUrl() {
    if (!Filesystem) return "";
    try {
      const result = await unifiedGetUri(DATA_DIR + '/blobs');
      let base = result.uri;
      if (!base.endsWith('/')) base += '/';
      return (window.Capacitor ? window.Capacitor.convertFileSrc(base) : base);
    } catch (e) { return ""; }
  }

  async function nativeCheckSpeechPermissions() {
    if (!SpeechRecognition) return false;
    try {
      const p = await SpeechRecognition.checkPermissions();
      return p.speechRecognition === 'granted';
    } catch (e) { return false; }
  }

  async function nativeStartDictation(onResult, onError) {
    if (!SpeechRecognition) return;
    try {
      SpeechRecognition.addListener('partialResults', (data) => {
        if (data.matches && data.matches.length > 0 && onResult) onResult(data.matches[0], !!data.isFinal);
      });
      await SpeechRecognition.start({ language: "es-CO", partialResults: true, continuous: true, popup: false });
    } catch (e) { if (onError) onError(e); }
  }

  async function nativeStopDictation() {
    if (!SpeechRecognition) return;
    try { await SpeechRecognition.stop(); SpeechRecognition.removeAllListeners(); } catch (e) {}
  }

  async function nativeSaveReport(id, blob) {
    if (!Filesystem) return null;
    const CHUNK_SIZE = 1024 * 1024 * 10;
    try {
      const ext = (blob.type || "").includes("word") || id.toLowerCase().endsWith(".docx") ? ".docx" : ".pdf";
      const path = DATA_DIR + '/reports/' + String(id).replace(/[^a-z0-9_-]/gi, '_') + ext;
      let offset = 0;
      let first = true;
      while (offset < blob.size) {
        const chunk = blob.slice(offset, offset + CHUNK_SIZE);
        const base64 = await blobToBase64(chunk);
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
      const tries = [
          {p: DATA_DIR + '/reports/' + safeId + '.pdf', t: "application/pdf"},
          {p: DATA_DIR + '/reports/' + safeId + '.docx', t: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
      ];
      for (const t of tries) {
         try {
            const res = await unifiedReadFile(t.p);
            return base64ToBlob(res.data, t.t);
         } catch(e){}
      }
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
    startDictation: nativeStartDictation, stopDictation: nativeStopDictation, checkSpeechPermissions: nativeCheckSpeechPermissions
  };
})();

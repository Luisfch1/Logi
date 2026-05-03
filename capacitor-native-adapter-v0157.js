/**
 * Logi Native Storage Adapter (Physical Healer v157)
 * This version performs a physical migration from Documents to Data on start,
 * and cleans bad metadata paths to return to the Golden Era speed.
 */
(function() {
  if (window.__logiDebug) window.__logiDebug("!!! ADAPTER v0157 LOADED !!!");
  console.log("DEBUG: capacitor-native-adapter (v0157) healing start");
  
  const Capacitor = window.Capacitor;
  const Plugins = Capacitor ? Capacitor.Plugins : {};
  const Filesystem = Plugins.Filesystem;
  const Share = Plugins.Share;
  const FileOpener = Plugins.FileOpener;
  const SpeechRecognition = Plugins.SpeechRecognition;
  
  const Directory = { Data: 'DATA', Cache: 'CACHE', Documents: 'DOCUMENTS' };
  const DATA_DIR = 'Logi'; 
  const PRIMARY_DIR = Directory.Data; // PRIVATE (The fast one)
  const FALLBACK_DIR = Directory.Documents; // PUBLIC (Where files might be stuck)

  let _migrationDone = false;
  async function ensureDir(dir = PRIMARY_DIR) {
    if (!Filesystem) return;
    try { await Filesystem.mkdir({ path: DATA_DIR, directory: dir, recursive: true }); } catch (e) { }
  }

  // --- PHYSICAL HEALING ENGINE ---
  async function healStorageSplit() {
    if (_migrationDone || !Filesystem) return;
    try {
      console.log("Physical Healing: Checking for files in Fallback (Documents)...");
      const stores = ['blobs', 'meta', 'items_meta', 'reports', 'projects'];
      for (const store of stores) {
        try {
          const res = await Filesystem.readdir({ path: DATA_DIR + '/' + store, directory: FALLBACK_DIR });
          const files = (res.files || []).map(f => (typeof f === 'string') ? f : f.name);
          if (files.length > 0) {
            console.log(`Physical Healing: Moving ${files.length} files from ${store} in Documents to Data...`);
            await Filesystem.mkdir({ path: DATA_DIR + '/' + store, directory: PRIMARY_DIR, recursive: true });
            for (const name of files) {
               try {
                  await Filesystem.copy({
                    from: DATA_DIR + '/' + store + '/' + name, directory: FALLBACK_DIR,
                    to: DATA_DIR + '/' + store + '/' + name, toDirectory: PRIMARY_DIR
                  });
               } catch(e){}
            }
          }
        } catch(e){}
      }
      _migrationDone = true;
      console.log("Physical Healing: COMPLETED.");
    } catch (e) { console.error("Physical Healing FAILED", e); }
  }

  // --- METADATA ENGINE ---
  const META_DB_PATH = DATA_DIR + '/metadata_db.json';
  let _nativeMetaCache = null;
  let _cachedBlobBaseUrl = "";

  async function saveMetaDb() {
    if (!Filesystem || !_nativeMetaCache || _nativeMetaCache.length === 0) return;
    try {
      await Filesystem.writeFile({
        path: META_DB_PATH,
        data: JSON.stringify(_nativeMetaCache),
        directory: PRIMARY_DIR,
        encoding: 'utf8',
        recursive: true
      });
    } catch (e) { }
  }

  async function loadMetaDb() {
    if (!Filesystem) return [];
    
    // 1. PHYSICAL HEAL FIRST
    if (!_migrationDone) await healStorageSplit();

    // 2. Proactive BaseUrl initialization (For speed)
    if (!_cachedBlobBaseUrl) {
       try {
         await ensureDir(PRIMARY_DIR);
         const result = await Filesystem.getUri({ path: DATA_DIR + '/blobs', directory: PRIMARY_DIR });
         let base = result.uri;
         if (!base.endsWith('/')) base += '/';
         _cachedBlobBaseUrl = (window.Capacitor ? window.Capacitor.convertFileSrc(base) : base);
       } catch(e){ }
    }

    if (_nativeMetaCache && _nativeMetaCache.length > 0) return _nativeMetaCache;

    // 3. Try Primary Index
    try {
      const r = await Filesystem.readFile({ path: META_DB_PATH, directory: PRIMARY_DIR, encoding: 'utf8' });
      const items = JSON.parse(r.data);
      if (Array.isArray(items) && items.length > 0) {
        // CLEANUP: Reset bad nativeUrls to force re-prediction from correct BaseUrl
        _nativeMetaCache = items.map(it => { delete it.nativeUrl; return it; });
        return _nativeMetaCache;
      }
    } catch (e) {}

    // 4. Manual repair (Individual files) in Primary
    const items1 = await scanFiles(PRIMARY_DIR, 'meta');
    const items2 = await scanFiles(PRIMARY_DIR, 'items_meta');
    const total = [...items1, ...items2];
    
    if (total.length > 0) {
       _nativeMetaCache = total.map(it => { delete it.nativeUrl; return it; });
       await saveMetaDb();
    } else {
       _nativeMetaCache = [];
    }
    return _nativeMetaCache;
  }

  async function scanFiles(dirType, storeName) {
    if (!Filesystem) return [];
    try {
      const path = DATA_DIR + '/' + storeName;
      const res = await Filesystem.readdir({ path, directory: dirType });
      const names = (res.files || []).map(f => (typeof f === 'string') ? f : f.name).filter(n => n.endsWith('.json'));
      const items = [];
      for (const name of names) {
         try {
            const r = await Filesystem.readFile({ path: path + '/' + name, directory: dirType, encoding: 'utf8' });
            items.push(JSON.parse(r.data));
         } catch(e){}
      }
      return items;
    } catch(e) { return []; }
  }

  async function nativeDbPut(storeName, item) {
    if (!Filesystem) return false;
    await ensureDir(PRIMARY_DIR);
    const path = DATA_DIR + '/' + storeName + '/' + item.id + '.json';
    try {
      const it = Object.assign({}, item);
      delete it.nativeUrl; // Never persist predicted URLs to Master DB
      await Filesystem.writeFile({ path, data: JSON.stringify(it), directory: PRIMARY_DIR, encoding: 'utf8', recursive: true });
      if (storeName === 'meta' || storeName === 'items_meta') {
        if (!_nativeMetaCache) await loadMetaDb();
        const idx = _nativeMetaCache.findIndex(x => x.id === it.id);
        if (idx >= 0) _nativeMetaCache[idx] = it;
        else _nativeMetaCache.push(it);
        await saveMetaDb();
      }
      return true;
    } catch(e) { return false; }
  }

  async function nativeDbGet(storeName, id) {
    if (!Filesystem) return null;
    if ((storeName === 'meta' || storeName === 'items_meta') && _nativeMetaCache) {
       return _nativeMetaCache.find(x => x.id === id) || null;
    }
    const path = DATA_DIR + '/' + storeName + '/' + id + '.json';
    try {
      const r = await Filesystem.readFile({ path, directory: PRIMARY_DIR, encoding: 'utf8' });
      return JSON.parse(r.data);
    } catch (e) { return null; }
  }

  async function nativeDbGetAll(storeName) {
    if (storeName === 'meta' || storeName === 'items_meta') return await loadMetaDb();
    return await scanFiles(PRIMARY_DIR, storeName);
  }

  async function nativeDbDelete(storeName, id) {
    if (!Filesystem) return false;
    const path = DATA_DIR + '/' + storeName + '/' + id + '.json';
    let deleted = false;
    try { await Filesystem.deleteFile({ path, directory: PRIMARY_DIR }); deleted = true; } catch(e){}
    if (storeName === 'meta' || storeName === 'items_meta') {
      if (!_nativeMetaCache) await loadMetaDb();
      _nativeMetaCache = _nativeMetaCache.filter(x => x.id !== id);
      await saveMetaDb();
    }
    return deleted;
  }

  async function nativeSaveBlob(id, blob) {
    if (!Filesystem) return false;
    await ensureDir(PRIMARY_DIR);
    const CHUNK_SIZE = 1024 * 1024 * 5; 
    try {
      const path = DATA_DIR + '/blobs/' + id + '.jpg';
      let offset = 0; let first = true;
      while (offset < blob.size) {
        const chunk = blob.slice(offset, offset + CHUNK_SIZE);
        const reader = new FileReader();
        const b64 = await new Promise(r => { reader.onloadend = () => r(reader.result.split(',')[1]); reader.readAsDataURL(chunk); });
        if (first) { await Filesystem.writeFile({ path, data: b64, directory: PRIMARY_DIR, recursive: true }); first = false; }
        else { await Filesystem.appendFile({ path, data: b64, directory: PRIMARY_DIR }); }
        offset += CHUNK_SIZE;
      }
      return true;
    } catch (e) { return false; }
  }

  async function nativeGetBlob(id) {
    if (!Filesystem) return null;
    const path = DATA_DIR + '/blobs/' + id + '.jpg';
    try {
      const r = await Filesystem.readFile({ path, directory: PRIMARY_DIR });
      return new Blob([Uint8Array.from(atob(r.data), c => c.charCodeAt(0))], { type: 'image/jpeg' });
    } catch (e) { return null; }
  }

  async function nativeGetBlobUrl(id) {
    if (!Filesystem) return null;
    try {
      const res = await Filesystem.getUri({ path: DATA_DIR + '/blobs/' + id + '.jpg', directory: PRIMARY_DIR });
      return (window.Capacitor ? window.Capacitor.convertFileSrc(res.uri) : res.uri);
    } catch (e) { return null; }
  }

  async function nativeGetBlobBaseUrl() {
    if (!Filesystem) return "";
    try {
      const res = await Filesystem.getUri({ path: DATA_DIR + '/blobs', directory: PRIMARY_DIR });
      let base = res.uri; if (!base.endsWith('/')) base += '/';
      return (window.Capacitor ? window.Capacitor.convertFileSrc(base) : base);
    } catch (e) { return ""; }
  }

  async function nativeShare(blob, filename, mime, title, id) {
    if (!Share || !Filesystem) return;
    try {
      let finalUri = null;
      if (id) {
          const safeId = String(id).replace(/[^a-z0-9_-]/gi, '_');
          const ext = (mime||"").includes("word") || (filename||"").toLowerCase().endsWith(".docx") ? ".docx" : ".pdf";
          const path = DATA_DIR + '/reports/' + safeId + ext;
          try { 
            const res = await Filesystem.getUri({ path, directory: PRIMARY_DIR }); 
            if (res && res.uri) finalUri = res.uri;
          } catch(e){}
      }
      if (!finalUri) {
          const reader = new FileReader();
          const b64 = await new Promise(r => { reader.onloadend = () => r(reader.result.split(',')[1]); reader.readAsDataURL(blob); });
          const res = await Filesystem.writeFile({ path: 'tmp/' + (filename||"file").replace(/[^a-z0-9\.]/gi,'_'), data: b64, directory: Directory.Cache, recursive: true });
          finalUri = res.uri;
      }
      await Share.share({ title: title || "Logi", files: [finalUri] });
    } catch (e) { alert("Error: " + e.message); }
  }

  async function nativeOpenFile(blob, filename, mimeType) {
    if (!FileOpener) return false;
    try {
      const reader = new FileReader();
      const b64 = await new Promise(r => { reader.onloadend = () => r(reader.result.split(',')[1]); reader.readAsDataURL(blob); });
      const res = await Filesystem.writeFile({ path: 'tmp_' + filename, data: b64, directory: Directory.Cache, recursive: true });
      await FileOpener.open({ filePath: res.uri, contentType: mimeType || "application/pdf" });
      return true;
    } catch (e) { return false; }
  }

  async function nativeSaveReport(id, blob) {
    await ensureDir(PRIMARY_DIR);
    const CHUNK_SIZE = 1024 * 1024 * 10;
    try {
      const ext = (blob.type || "").includes("word") || id.toLowerCase().endsWith(".docx") ? ".docx" : ".pdf";
      const path = DATA_DIR + '/reports/' + String(id).replace(/[^a-z0-9_-]/gi, '_') + ext;
      let offset = 0; let first = true;
      while (offset < blob.size) {
        const chunk = blob.slice(offset, offset + CHUNK_SIZE);
        const reader = new FileReader();
        const b64 = await new Promise(r => { reader.onloadend = () => r(reader.result.split(',')[1]); reader.readAsDataURL(chunk); });
        if (first) { await Filesystem.writeFile({ path, data: b64, directory: PRIMARY_DIR, recursive: true }); first = false; }
        else { await Filesystem.appendFile({ path, data: b64, directory: PRIMARY_DIR }); }
        offset += CHUNK_SIZE;
        if (window.__logiProgress) window.__logiProgress("Guardando...", Math.round((offset/blob.size)*100));
      }
      const res = await Filesystem.getUri({ path, directory: PRIMARY_DIR });
      return res.uri;
    } catch (e) { return null; }
  }

  async function nativeGetReport(id) {
    if (!Filesystem) return null;
    try {
      const safeId = String(id).replace(/[^a-z0-9_-]/gi, '_');
      const types = [{p: DATA_DIR + '/reports/'+safeId+'.pdf', t: "application/pdf"}, {p: DATA_DIR + '/reports/'+safeId+'.docx', t: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}];
      for (const ty of types) { 
        try { 
          const res = await Filesystem.readFile({ path: ty.p, directory: PRIMARY_DIR }); 
          return new Blob([Uint8Array.from(atob(res.data), c => c.charCodeAt(0))], {type:ty.t});
        } catch(e){}
      }
      return null;
    } catch (e) { return null; }
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

  async function nativeStopDictation() { if (SpeechRecognition) { try { await SpeechRecognition.stop(); SpeechRecognition.removeAllListeners(); } catch (e) {} } }

  window.LogiNative = {
    isNative: function() { return (window.Capacitor && window.Capacitor.getPlatform() !== 'web'); },
    dbPut: nativeDbPut, dbGet: nativeDbGet, dbGetAll: nativeDbGetAll, dbDelete: nativeDbDelete,
    saveBlob: nativeSaveBlob, getBlob: nativeGetBlob, dbGetBlob: nativeGetBlob,
    getBlobUrl: nativeGetBlobUrl, getBlobBaseUrl: nativeGetBlobBaseUrl,
    getBlobBaseUrlSync: function() { return _cachedBlobBaseUrl; },
    share: nativeShare, openFile: nativeOpenFile, saveReport: nativeSaveReport, getReport: nativeGetReport,
    getFileInfo: async (id) => {
       try {
         const res = await Filesystem.getUri({ path: DATA_DIR + '/blobs/' + id + '.jpg', directory: PRIMARY_DIR });
         const stat = await Filesystem.stat({ path: DATA_DIR + '/blobs/' + id + '.jpg', directory: PRIMARY_DIR });
         return { uri: (window.Capacitor ? window.Capacitor.convertFileSrc(res.uri) : res.uri), size: stat.size };
       } catch(e) { return null; }
    },
    startDictation: nativeStartDictation, stopDictation: nativeStopDictation, checkSpeechPermissions: nativeCheckSpeechPermissions
  };
})();

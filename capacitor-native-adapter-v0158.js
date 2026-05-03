/**
 * Logi Native Storage Adapter (Visible Progress Healer v158)
 * - Non-blocking migration: App starts immediately while files move in background.
 * - Progress tracking: Logs every 25 files to LOGI_DEBUG.
 * - Cleans metadata memory to restore Golden speed and visible photos.
 */
(function() {
  const VERSION = "v0158";
  if (window.__logiDebug) window.__logiDebug(`!!! ADAPTER ${VERSION} LOADED !!!`);
  console.log(`DEBUG: capacitor-native-adapter (${VERSION}) start`);
  
  const Capacitor = window.Capacitor;
  const Plugins = Capacitor ? Capacitor.Plugins : {};
  const Filesystem = Plugins.Filesystem;
  const Share = Plugins.Share;
  const FileOpener = Plugins.FileOpener;
  const SpeechRecognition = Plugins.SpeechRecognition;
  
  const Directory = { Data: 'DATA', Cache: 'CACHE', Documents: 'DOCUMENTS' };
  const DATA_DIR = 'Logi'; 
  const PRIMARY_DIR = Directory.Data; // PRIVATE
  const FALLBACK_DIR = Directory.Documents; // PUBLIC

  let _migrationActive = false;
  let _migrationDone = false;

  function __debug(msg) {
    if (window.__logiDebug) window.__logiDebug(`[Healer] ${msg}`);
    console.log(`LogiNative: ${msg}`);
  }

  async function ensureDir(dir = PRIMARY_DIR) {
    if (!Filesystem) return;
    try { await Filesystem.mkdir({ path: DATA_DIR, directory: dir, recursive: true }); } catch (e) { }
  }

  // --- NON-BLOCKING HEALING ENGINE ---
  async function healStorageSplit() {
    if (_migrationActive || _migrationDone || !Filesystem) return;
    _migrationActive = true;
    __debug("Starting Background Migration (Documents -> Data)...");
    
    try {
      const stores = ['blobs', 'meta', 'items_meta', 'reports', 'projects'];
      let totalMoved = 0;
      
      for (const store of stores) {
        try {
          const res = await Filesystem.readdir({ path: DATA_DIR + '/' + store, directory: FALLBACK_DIR });
          const files = (res.files || []).map(f => (typeof f === 'string') ? f : f.name);
          
          if (files.length > 0) {
            __debug(`Processing ${files.length} files in ${store}...`);
            await Filesystem.mkdir({ path: DATA_DIR + '/' + store, directory: PRIMARY_DIR, recursive: true });
            
            let count = 0;
            for (const name of files) {
               try {
                  // Optimization: only copy if missing
                  // (Skip stat check for blobs to save time, copy handles it)
                  await Filesystem.copy({
                    from: DATA_DIR + '/' + store + '/' + name, directory: FALLBACK_DIR,
                    to: DATA_DIR + '/' + store + '/' + name, toDirectory: PRIMARY_DIR
                  });
                  totalMoved++;
               } catch(e){
                 // Error usually means it's already there, which is fine
               }
               count++;
               if (count % 25 === 0) __debug(`${store}: ${count}/${files.length} ready...`);
            }
          }
        } catch(e){}
      }
      _migrationDone = true;
      __debug(`Migration COMPLETED. Total files processed: ${totalMoved}`);
    } catch (e) { 
      __debug(`Migration ERROR: ${e.message}`);
    } finally {
      _migrationActive = false;
    }
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
    
    // 1. Kick off background heal (DON'T AWAIT)
    if (!_migrationDone && !_migrationActive) {
       healStorageSplit(); 
    }

    // 2. BaseUrl initialization
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

    // 3. Load Master DB
    try {
      const r = await Filesystem.readFile({ path: META_DB_PATH, directory: PRIMARY_DIR, encoding: 'utf8' });
      let items = JSON.parse(r.data);
      if (Array.isArray(items)) {
        // ALWAYS clean in-memory URLs to force correct path prediction
        _nativeMetaCache = items.map(it => { delete it.nativeUrl; return it; });
        return _nativeMetaCache;
      }
    } catch (e) {}

    // 4. Manual scan if DB missing
    const items1 = await scanFiles(PRIMARY_DIR, 'meta');
    const items2 = await scanFiles(PRIMARY_DIR, 'items_meta');
    const total = [...items1, ...items2];
    
    _nativeMetaCache = total.map(it => { delete it.nativeUrl; return it; });
    await saveMetaDb();
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
      delete it.nativeUrl;
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
    try { await Filesystem.deleteFile({ path, directory: PRIMARY_DIR }); } catch(e){}
    if (storeName === 'meta' || storeName === 'items_meta') {
      if (!_nativeMetaCache) await loadMetaDb();
      _nativeMetaCache = _nativeMetaCache.filter(x => x.id !== id);
      await saveMetaDb();
    }
    return true;
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
    } catch (e) {
      // Fallback read from Documents
      try {
        const r2 = await Filesystem.readFile({ path: path, directory: FALLBACK_DIR });
        return new Blob([Uint8Array.from(atob(r2.data), c => c.charCodeAt(0))], { type: 'image/jpeg' });
      } catch(e2){ return null; }
    }
  }

  async function nativeGetBlobUrl(id) {
    if (!Filesystem) return null;
    try {
      const res = await Filesystem.getUri({ path: DATA_DIR + '/blobs/' + id + '.jpg', directory: PRIMARY_DIR });
      return (window.Capacitor ? window.Capacitor.convertFileSrc(res.uri) : res.uri);
    } catch (e) {
      try {
        const res2 = await Filesystem.getUri({ path: DATA_DIR + '/blobs/' + id + '.jpg', directory: FALLBACK_DIR });
        return (window.Capacitor ? window.Capacitor.convertFileSrc(res2.uri) : res2.uri);
      } catch(e2){ return null; }
    }
  }

  async function nativeGetBlobBaseUrl() {
    if (!Filesystem) return "";
    try {
      const res = await Filesystem.getUri({ path: DATA_DIR + '/blobs', directory: PRIMARY_DIR });
      let base = res.uri; if (!base.endsWith('/')) base += '/';
      return (window.Capacitor ? window.Capacitor.convertFileSrc(base) : base);
    } catch (e) { return ""; }
  }

  async function nativeShare(blob, filename, mime, title, opt) {
    if (!Share || !Filesystem) return;
    try {
      const reader = new FileReader();
      const b64 = await new Promise(r => { reader.onloadend = () => r(reader.result.split(',')[1]); reader.readAsDataURL(blob); });
      const res = await Filesystem.writeFile({ path: 'tmp_' + (filename||"file"), data: b64, directory: Directory.Cache, recursive: true });
      await Share.share({ title: title || "Logi", files: [res.uri] });
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
      }
      const res = await Filesystem.getUri({ path, directory: PRIMARY_DIR });
      return res.uri;
    } catch (e) { return null; }
  }

  async function nativeGetReport(id) {
    if (!Filesystem) return null;
    try {
      const safeId = String(id).replace(/[^a-z0-9_-]/gi, '_');
      const paths = [
        {p: DATA_DIR + '/reports/'+safeId+'.pdf', d: PRIMARY_DIR},
        {p: DATA_DIR + '/reports/'+safeId+'.docx', d: PRIMARY_DIR},
        {p: DATA_DIR + '/reports/'+safeId+'.pdf', d: FALLBACK_DIR},
        {p: DATA_DIR + '/reports/'+safeId+'.docx', d: FALLBACK_DIR}
      ];
      for (const t of paths) { 
        try { 
          const res = await Filesystem.readFile({ path: t.p, directory: t.d }); 
          const mime = t.p.endsWith('.pdf') ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          return new Blob([Uint8Array.from(atob(res.data), c => c.charCodeAt(0))], {type:mime});
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
    getFileInfo: async (id) => {
       try {
         const res = await Filesystem.getUri({ path: DATA_DIR + '/blobs/' + id + '.jpg', directory: PRIMARY_DIR });
         const stat = await Filesystem.stat({ path: DATA_DIR + '/blobs/' + id + '.jpg', directory: PRIMARY_DIR });
         return { uri: (window.Capacitor ? window.Capacitor.convertFileSrc(res.uri) : res.uri), size: stat.size };
       } catch(e) { 
          // Check fallback for repair logic
          try {
             const res2 = await Filesystem.getUri({ path: DATA_DIR + '/blobs/' + id + '.jpg', directory: FALLBACK_DIR });
             const stat2 = await Filesystem.stat({ path: DATA_DIR + '/blobs/' + id + '.jpg', directory: FALLBACK_DIR });
             return { uri: (window.Capacitor ? window.Capacitor.convertFileSrc(res2.uri) : res2.uri), size: stat2.size };
          } catch(e2){ return null; }
       }
    },
    startDictation: (cb) => { if (SpeechRecognition) SpeechRecognition.start({ language: "es-CO", partialResults: true }).then(cb); },
    stopDictation: () => { if (SpeechRecognition) SpeechRecognition.stop(); },
    checkSpeechPermissions: async () => { if (!SpeechRecognition) return false; const p = await SpeechRecognition.checkPermissions(); return p.speechRecognition === 'granted'; }
  };
})();

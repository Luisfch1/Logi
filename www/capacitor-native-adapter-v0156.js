/**
 * Logi Native Storage Adapter (Ultimate Stability v156)
 * This version restores the exact structure of the "fast and stable" era.
 */
(function() {
  if (window.__logiDebug) window.__logiDebug("!!! ADAPTER v0156 LOADED !!!");
  console.log("DEBUG: capacitor-native-adapter (v0156) stability start");
  
  const Capacitor = window.Capacitor;
  const Plugins = Capacitor ? Capacitor.Plugins : {};
  const Filesystem = Plugins.Filesystem;
  const Share = Plugins.Share;
  const FileOpener = Plugins.FileOpener;
  const SpeechRecognition = Plugins.SpeechRecognition;
  
  const Directory = { Data: 'DATA', Cache: 'CACHE', Documents: 'DOCUMENTS' };
  const DATA_DIR = 'Logi'; 
  const PRIMARY_DIR = Directory.Data; // PRIVATE (The fast one)
  const FALLBACK_DIR = Directory.Documents; // PUBLIC (Where reports might be)

  let _dirChecked = false;
  async function ensureDir(dir = PRIMARY_DIR) {
    if (!Filesystem) return;
    try { await Filesystem.mkdir({ path: DATA_DIR, directory: dir, recursive: true }); } catch (e) { }
  }

  // --- STABILITY ENGINE ---
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
    } catch (e) { console.warn("saveMetaDb failed", e); }
  }

  async function loadMetaDb() {
    if (!Filesystem) return [];
    
    // Proactive BaseUrl initialization (For speed)
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

    // 1. Try Primary (Fast)
    try {
      const r = await Filesystem.readFile({ path: META_DB_PATH, directory: PRIMARY_DIR, encoding: 'utf8' });
      const items = JSON.parse(r.data);
      if (Array.isArray(items) && items.length > 0) {
        _nativeMetaCache = items;
        return _nativeMetaCache;
      }
    } catch (e) {}

    // 2. Try Fallback (Documents)
    try {
      const r = await Filesystem.readFile({ path: META_DB_PATH, directory: FALLBACK_DIR, encoding: 'utf8' });
      const items = JSON.parse(r.data);
      if (Array.isArray(items) && items.length > 0) {
        _nativeMetaCache = items;
        // Optional: Migration to Primary would happen here, but let's just keep it in memory
        return _nativeMetaCache;
      }
    } catch (e) {}

    // 3. Last Resort: Scan individual files in Primary
    const items1 = await scanFiles(PRIMARY_DIR, 'meta');
    const items2 = await scanFiles(PRIMARY_DIR, 'items_meta');
    let total = [...items1, ...items2];
    
    // 4. Try scanning Fallback too if still empty
    if (total.length === 0) {
        const items3 = await scanFiles(FALLBACK_DIR, 'meta');
        const items4 = await scanFiles(FALLBACK_DIR, 'items_meta');
        total = [...items3, ...items4];
    }

    if (total.length > 0) {
       _nativeMetaCache = total;
       await saveMetaDb();
    } else {
       _nativeMetaCache = []; // Truly empty
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
      await Filesystem.writeFile({ path, data: JSON.stringify(item), directory: PRIMARY_DIR, encoding: 'utf8', recursive: true });
      if (storeName === 'meta' || storeName === 'items_meta') {
        if (!_nativeMetaCache) await loadMetaDb();
        const idx = _nativeMetaCache.findIndex(x => x.id === item.id);
        if (idx >= 0) _nativeMetaCache[idx] = item;
        else _nativeMetaCache.push(item);
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
    } catch (e) {
      try {
        const r = await Filesystem.readFile({ path, directory: FALLBACK_DIR, encoding: 'utf8' });
        return JSON.parse(r.data);
      } catch(e2) { return null; }
    }
  }

  async function nativeDbGetAll(storeName) {
    if (storeName === 'meta' || storeName === 'items_meta') return await loadMetaDb();
    if (storeName === 'reports') {
        const primary = await scanFiles(PRIMARY_DIR, 'reports');
        const fallback = await scanFiles(FALLBACK_DIR, 'reports');
        const merged = [...primary];
        for (const f of fallback) { if (!merged.find(x => x.id === f.id)) merged.push(f); }
        return merged;
    }
    return await scanFiles(PRIMARY_DIR, storeName);
  }

  async function nativeDbDelete(storeName, id) {
    if (!Filesystem) return false;
    const path = DATA_DIR + '/' + storeName + '/' + id + '.json';
    let deleted = false;
    try { await Filesystem.deleteFile({ path, directory: PRIMARY_DIR }); deleted = true; } catch(e){}
    try { await Filesystem.deleteFile({ path, directory: FALLBACK_DIR }); deleted = true; } catch(e){}
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
    } catch (e) {
      try {
        const r = await Filesystem.readFile({ path, directory: FALLBACK_DIR });
        return new Blob([Uint8Array.from(atob(r.data), c => c.charCodeAt(0))], { type: 'image/jpeg' });
      } catch(e2) { return null; }
    }
  }

  async function nativeGetBlobUrl(id) {
    if (!Filesystem) return null;
    const path = DATA_DIR + '/blobs/' + id + '.jpg';
    try {
      const res = await Filesystem.getUri({ path, directory: PRIMARY_DIR });
      return (window.Capacitor ? window.Capacitor.convertFileSrc(res.uri) : res.uri);
    } catch (e) {
      try {
        const res = await Filesystem.getUri({ path, directory: FALLBACK_DIR });
        return (window.Capacitor ? window.Capacitor.convertFileSrc(res.uri) : res.uri);
      } catch(e2) { return null; }
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
          } catch(e){
            try { 
              const res = await Filesystem.getUri({ path, directory: FALLBACK_DIR }); 
              if (res && res.uri) finalUri = res.uri;
            } catch(e2){}
          }
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
        } catch(e){
          try { 
            const res = await Filesystem.readFile({ path: ty.p, directory: FALLBACK_DIR }); 
            return new Blob([Uint8Array.from(atob(res.data), c => c.charCodeAt(0))], {type:ty.t});
          } catch(e2){}
        }
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
    startDictation: nativeStartDictation, stopDictation: nativeStopDictation, checkSpeechPermissions: nativeCheckSpeechPermissions
  };
})();

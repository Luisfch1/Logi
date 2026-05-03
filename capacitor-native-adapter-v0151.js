/**
 * Logi Native Storage Adapter (Capacitor Global Edition)
 * Emergency Fix: v0151 - Restore Private Data Storage
 */

// Version: 2026.03.20.0151 (RESTORE PRIVATE DATA)
(function() {
  if (window.__logiDebug) window.__logiDebug("!!! ADAPTER v0151 LOADED !!!");
  console.log("DEBUG: capacitor-native-adapter (v0151) execution start");
  
  const Capacitor = window.Capacitor;
  const Plugins = Capacitor ? Capacitor.Plugins : {};
  const Filesystem = Plugins.Filesystem;
  const Share = Plugins.Share;
  const FileOpener = Plugins.FileOpener;
  const SpeechRecognition = Plugins.SpeechRecognition;
  
  const Directory = {
    Data: 'DATA',
    Cache: 'CACHE',
    Documents: 'DOCUMENTS'
  };

  const DATA_DIR = 'Logi'; 
  const DIR_TYPE = Directory.Data; // VOLVEMOS A DATA (Privado) para evitar el lag y pérdida de datos

  let _dirChecked = false;
  async function ensureDir(dType = DIR_TYPE) {
    if (!Filesystem) return;
    try {
      await Filesystem.mkdir({ path: DATA_DIR, directory: dType, recursive: true });
      _dirChecked = true;
    } catch (e) { _dirChecked = true; }
  }

  const META_DB_PATH = DATA_DIR + '/metadata_db.json';
  let _nativeMetaCache = null;

  let _saveTimer = null;
  async function saveMetaDb() {
    if (!Filesystem || !_nativeMetaCache) return;
    if (_saveTimer) return; 
    _saveTimer = setTimeout(async () => {
      try {
        await Filesystem.writeFile({
          path: META_DB_PATH,
          data: JSON.stringify(_nativeMetaCache),
          directory: DIR_TYPE,
          encoding: 'utf8',
          recursive: true
        });
      } catch (e) { console.warn("saveMetaDb failed", e); }
      finally { _saveTimer = null; }
    }, 500);
  }

  let _cachedBlobBaseUrl = "";

  async function loadMetaDb() {
    if (!Filesystem) return [];
    if (!_cachedBlobBaseUrl) {
       try {
         await ensureDir(); 
         const result = await Filesystem.getUri({ path: DATA_DIR + '/blobs', directory: DIR_TYPE });
         let base = result.uri;
         if (!base.endsWith('/')) base += '/';
         _cachedBlobBaseUrl = (window.Capacitor ? window.Capacitor.convertFileSrc(base) : base);
       } catch(e){ }
    }
    if (_nativeMetaCache) return _nativeMetaCache;
    try {
      const result = await Filesystem.readFile({ path: META_DB_PATH, directory: DIR_TYPE, encoding: 'utf8' });
      _nativeMetaCache = JSON.parse(result.data);
      return _nativeMetaCache;
    } catch (e) {
      // Intento FALLBACK a Documents si acabamos de migrar
      try {
         const result2 = await Filesystem.readFile({ path: META_DB_PATH, directory: Directory.Documents, encoding: 'utf8' });
         _nativeMetaCache = JSON.parse(result2.data);
         return _nativeMetaCache;
      } catch(e2) {
        const items = await scanIndividualFiles('meta');
        const items2 = await scanIndividualFiles('items_meta');
        _nativeMetaCache = [...items, ...items2];
        await saveMetaDb();
        return _nativeMetaCache;
      }
    }
  }

  async function scanIndividualFiles(storeName) {
    if (!Filesystem) return [];
    try {
      const path = DATA_DIR + '/' + storeName;
      const res = await Filesystem.readdir({ path: path, directory: DIR_TYPE });
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
    await ensureDir();
    const path = DATA_DIR + '/' + storeName + '/' + item.id + '.json';
    try {
      await Filesystem.writeFile({ path, data: JSON.stringify(item), directory: DIR_TYPE, encoding: 'utf8', recursive: true });
      const isMeta = (storeName === 'meta' || storeName === 'items_meta');
      if (isMeta) {
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
    const isMeta = (storeName === 'meta' || storeName === 'items_meta');
    if (isMeta && _nativeMetaCache) {
       return _nativeMetaCache.find(x => x.id === id) || null;
    }
    try {
      const path = DATA_DIR + '/' + storeName + '/' + id + '.json';
      const result = await Filesystem.readFile({ path, directory: DIR_TYPE, encoding: 'utf8' });
      return JSON.parse(result.data);
    } catch (e) { return null; }
  }

  async function nativeDbGetAll(storeName) {
    if (storeName === 'meta' || storeName === 'items_meta') return await loadMetaDb();
    if (storeName === 'reports') {
        const meta = await scanIndividualFiles('reports');
        // FALLBACK: También buscar en Documents para informes compartidos previamente
        try {
           const path = DATA_DIR + '/reports';
           const res = await Filesystem.readdir({ path, directory: Directory.Documents });
           const files = res.files || [];
           const docJsons = files.map(f => (typeof f === 'string') ? f : f.name).filter(n => n.endsWith('.json'));
           for (const n of docJsons) {
              const id = n.replace('.json', '');
              if (!meta.find(x => x.id === id)) {
                 try {
                    const r = await Filesystem.readFile({ path: path + '/' + n, directory: Directory.Documents, encoding: 'utf8' });
                    meta.push(JSON.parse(r.data));
                 } catch(err){}
              }
           }
        } catch(e){}
        return meta;
    }
    return await scanIndividualFiles(storeName);
  }

  async function nativeDbDelete(storeName, id) {
    if (!Filesystem) return false;
    try {
      await Filesystem.deleteFile({ path: DATA_DIR + '/' + storeName + '/' + id + '.json', directory: DIR_TYPE });
      const isMeta = (storeName === 'meta' || storeName === 'items_meta');
      if (isMeta) {
        if (!_nativeMetaCache) await loadMetaDb();
        _nativeMetaCache = _nativeMetaCache.filter(x => x.id !== id);
        await saveMetaDb();
      }
      return true;
    } catch (e) { return false; }
  }

  async function nativeSaveBlob(id, blob) {
    if (!Filesystem) return false;
    await ensureDir();
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
          await Filesystem.writeFile({ path, data: base64, directory: DIR_TYPE, recursive: true });
          first = false;
        } else {
          await Filesystem.appendFile({ path, data: base64, directory: DIR_TYPE });
        }
        offset += CHUNK_SIZE;
      }
      return true;
    } catch (e) { return false; }
  }

  async function nativeGetBlob(id) {
    if (!Filesystem) return null;
    try {
      const path = DATA_DIR + '/blobs/' + id + '.jpg';
      const result = await Filesystem.readFile({ path, directory: DIR_TYPE });
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
          // Try Data then Documents
          const tries = [{d: DIR_TYPE, p: DATA_DIR + '/reports/' + safeId + ext}, {d: Directory.Documents, p: DATA_DIR + '/reports/' + safeId + ext}];
          for (const t of tries) {
             try {
                const res = await Filesystem.getUri({ path: t.p, directory: t.d });
                if (res && res.uri) { finalUri = res.uri; break; }
             } catch(e){}
          }
      }

      if (!finalUri) {
          const cleanName = (filename || "informe").replace(/[^a-z0-9\._-]/gi, '_');
          const path = 'tmp/' + cleanName;
          const base64 = await blobToBase64(blob); // Simplified for rollback
          const res = await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache, recursive: true });
          finalUri = res.uri;
      }
      
      await Share.share({
        title: title || filename || "Logi Report",
        files: [finalUri]
      });
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
      const path = DATA_DIR + '/blobs/' + id + '.jpg';
      const result = await Filesystem.getUri({ path, directory: DIR_TYPE });
      return (window.Capacitor ? window.Capacitor.convertFileSrc(result.uri) : result.uri);
    } catch (e) { return null; }
  }

  async function nativeGetBlobBaseUrl() {
    if (!Filesystem) return "";
    try {
      const result = await Filesystem.getUri({ path: DATA_DIR + '/blobs', directory: DIR_TYPE });
      let base = result.uri;
      if (!base.endsWith('/')) base += '/';
      return (window.Capacitor ? window.Capacitor.convertFileSrc(base) : base);
    } catch (e) { return ""; }
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
        if (first) { await Filesystem.writeFile({ path, data: base64, directory: DIR_TYPE, recursive: true }); first = false; }
        else { await Filesystem.appendFile({ path, data: base64, directory: DIR_TYPE }); }
        offset += CHUNK_SIZE;
        if (window.__logiProgress) window.__logiProgress("Guardando...", Math.round((offset/blob.size)*100));
      }
      const res = await Filesystem.getUri({ path, directory: DIR_TYPE });
      return res.uri;
    } catch (e) { return null; }
  }

  async function nativeGetReport(id) {
    if (!Filesystem) return null;
    try {
      const safeId = String(id).replace(/[^a-z0-9_-]/gi, '_');
      const tries = [
          {d: DIR_TYPE, p: DATA_DIR + '/reports/' + safeId + '.pdf', t: "application/pdf"},
          {d: DIR_TYPE, p: DATA_DIR + '/reports/' + safeId + '.docx', t: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
          {d: Directory.Documents, p: DATA_DIR + '/reports/' + safeId + '.pdf', t: "application/pdf"},
          {d: Directory.Documents, p: DATA_DIR + '/reports/' + safeId + '.docx', t: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
      ];
      for (const t of tries) {
         try {
            const res = await Filesystem.readFile({ path: t.p, directory: t.d });
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

/**
 * Logi Native Storage Adapter (Capacitor Global Edition)
 * This version uses global window.Capacitor to avoid ES module issues in WebView.
 */

// Version: 2026.03.20.0150 (DUAL DIRECTORY SCANNING)
(function() {
  if (window.__logiDebug) window.__logiDebug("!!! ADAPTER v0150 LOADED !!!");
  // Check if Capacitor is available (injected by Capacitor WebView)
  console.log("DEBUG: capacitor-native-adapter (v0150) execution start");
  
  const Capacitor = window.Capacitor;
  const Plugins = Capacitor ? Capacitor.Plugins : {};
  
  const Filesystem = Plugins.Filesystem;
  const Share = Plugins.Share;
  const FileOpener = Plugins.FileOpener;
  const SpeechRecognition = Plugins.SpeechRecognition;
  
  // Directory constants (Capacitor 6 standard)
  const Directory = {
    Data: 'DATA',
    Cache: 'CACHE',
    Documents: 'DOCUMENTS',
    External: 'EXTERNAL',
    ExternalStorage: 'EXTERNAL_STORAGE'
  };

  const IS_NATIVE = (window.Capacitor && window.Capacitor.getPlatform() !== 'web');
  const DATA_DIR = 'Logi'; 
  const DIR_TYPE = Directory.Documents; // Preferred for reports

  let _dirCheckedMain = false;
  async function ensureDir(dirType = DIR_TYPE) {
    if (!Filesystem) return;
    try {
      await Filesystem.mkdir({
        path: DATA_DIR,
        directory: dirType,
        recursive: true
      });
    } catch (e) { }
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
         await ensureDir(DIR_TYPE); 
         const result = await Filesystem.getUri({ path: DATA_DIR + '/blobs', directory: DIR_TYPE });
         let base = result.uri;
         if (!base.endsWith('/')) base += '/';
         _cachedBlobBaseUrl = (window.Capacitor ? window.Capacitor.convertFileSrc(base) : base);
       } catch(e){ }
    }

    if (_nativeMetaCache) return _nativeMetaCache;

    // Dual Load Strategy
    try {
      const result = await Filesystem.readFile({
        path: META_DB_PATH,
        directory: DIR_TYPE,
        encoding: 'utf8'
      });
      _nativeMetaCache = JSON.parse(result.data);
      return _nativeMetaCache;
    } catch (e) {
      try {
        const result2 = await Filesystem.readFile({
          path: META_DB_PATH,
          directory: Directory.Data,
          encoding: 'utf8'
        });
        _nativeMetaCache = JSON.parse(result2.data);
        return _nativeMetaCache;
      } catch(e2){
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
    const items = [];
    const dirsToScan = [DIR_TYPE, Directory.Data]; // Scan both shared and private
    
    for (const dirType of dirsToScan) {
      try {
        const path = DATA_DIR + '/' + storeName;
        const res = await Filesystem.readdir({ path: path, directory: dirType });
        const files = res.files || [];
        const queue = files.map(f => (typeof f === 'string') ? f : f.name).filter(n => n.endsWith('.json'));
        
        const concurrency = 20;
        const workers = [];
        for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
          workers.push((async () => {
            while (queue.length > 0) {
              const name = queue.shift();
              const id = name.replace('.json', '');
              const item = await nativeDbGet(storeName, id, dirType);
              if (item) items.push(item);
            }
          })());
        }
        await Promise.all(workers);
      } catch(e) { }
    }
    // De-duplicate if same ID appears in both
    const unique = [];
    const seen = new Set();
    for (const it of items) {
      if (!seen.has(it.id)) {
        unique.push(it);
        seen.add(it.id);
      }
    }
    return unique;
  }

  async function nativeDbPut(storeName, item) {
    if (!Filesystem) return false;
    await ensureDir(DIR_TYPE);
    const path = DATA_DIR + '/' + storeName + '/' + item.id + '.json';
    try {
      await Filesystem.writeFile({
        path: path,
        data: JSON.stringify(item),
        directory: DIR_TYPE,
        encoding: 'utf8',
        recursive: true
      });
      
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

  async function nativeDbGet(storeName, id, preferredDir = DIR_TYPE) {
    if (!Filesystem) return null;
    const isMeta = (storeName === 'meta' || storeName === 'items_meta');
    if (isMeta && _nativeMetaCache) {
       return _nativeMetaCache.find(x => x.id === id) || null;
    }
    
    const tryDirs = [preferredDir, preferredDir === DIR_TYPE ? Directory.Data : DIR_TYPE];
    for (const dirType of tryDirs) {
      try {
        const path = DATA_DIR + '/' + storeName + '/' + id + '.json';
        const result = await Filesystem.readFile({ path, directory: dirType, encoding: 'utf8' });
        return JSON.parse(result.data);
      } catch (e) { }
    }
    return null;
  }

  async function nativeDbGetAll(storeName) {
    if (storeName === 'meta' || storeName === 'items_meta') return await loadMetaDb();
    return await scanIndividualFiles(storeName);
  }

  async function nativeDbDelete(storeName, id) {
    if (!Filesystem) return false;
    const dirsToDelete = [DIR_TYPE, Directory.Data];
    let success = false;
    for (const dirType of dirsToDelete) {
      try {
        const path = DATA_DIR + '/' + storeName + '/' + id + '.json';
        await Filesystem.deleteFile({ path, directory: dirType });
        success = true;
      } catch (e) { }
    }
    const isMeta = (storeName === 'meta' || storeName === 'items_meta');
    if (isMeta) {
      if (!_nativeMetaCache) await loadMetaDb();
      _nativeMetaCache = _nativeMetaCache.filter(x => x.id !== id);
      await saveMetaDb();
    }
    return success;
  }

  async function nativeSaveBlob(id, blob) {
    if (!Filesystem) return false;
    await ensureDir(DIR_TYPE);
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
    const tryDirs = [DIR_TYPE, Directory.Data];
    for (const dirType of tryDirs) {
      try {
        const path = DATA_DIR + '/blobs/' + id + '.jpg';
        const result = await Filesystem.readFile({ path, directory: dirType });
        return base64ToBlob(result.data, 'image/jpeg');
      } catch (e) { }
    }
    return null;
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
    if (window.__logiDebug) __logiDebug("nativeShare: --- BEGIN SHARE ---");
    if (!Share || !Filesystem) return;
    
    const isDocx = (mime || "").includes("word") || (filename || "").toLowerCase().endsWith(".docx");
    const sizeMB = (blob?.size || 0) / 1024 / 1024;

    try {
      let finalUri = null;
      if (id) {
          const safeId = String(id).replace(/[^a-z0-9_-]/gi, '_');
          const ext = isDocx ? ".docx" : ".pdf";
          const tryDirs = [DIR_TYPE, Directory.Data];
          for (const dirType of tryDirs) {
            try {
              const res = await Filesystem.getUri({ path: DATA_DIR + '/reports/' + safeId + ext, directory: dirType });
              if (res && res.uri) { finalUri = res.uri; break; }
            } catch(e) {}
          }
      }

      if (!finalUri) {
          const CHUNK_SIZE_SHARE = 1024 * 1024 * 10;
          const cleanName = (filename || "informe").replace(/[^a-z0-9\._-]/gi, '_');
          const path = 'tmp/' + cleanName;
          let offsetShare = 0;
          let firstWrite = true;
          while (offsetShare < blob.size) {
            const chunk = blob.slice(offsetShare, offsetShare + CHUNK_SIZE_SHARE);
            const base64 = await blobToBase64(chunk);
            if (firstWrite) {
              await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache, recursive: true });
              firstWrite = false;
            } else {
              await Filesystem.appendFile({ path, data: base64, directory: Directory.Cache });
            }
            offsetShare += CHUNK_SIZE_SHARE;
          }
          const writeRes = await Filesystem.getUri({ path, directory: Directory.Cache });
          finalUri = writeRes.uri;
      }
      
      const cleanId = (id || Date.now()).toString().replace(/[^a-z0-9_-]/gi, '_');
      const cachePath = 'share_file' + (isDocx ? ".docx" : ".pdf");
      let bridgeSuccess = false;
      
      if (finalUri && id) {
          const filenameId = cleanId.endsWith(".docx") || cleanId.endsWith(".pdf") ? 
                            cleanId.substring(0, cleanId.lastIndexOf('.')) : cleanId;
          const tryDirs = [DIR_TYPE, Directory.Data];
          for (const dirType of tryDirs) {
            try {
              await Filesystem.copy({
                  from: DATA_DIR + '/reports/' + filenameId + (isDocx ? ".docx" : ".pdf"), directory: dirType,
                  to: cachePath, toDirectory: Directory.Cache
              });
              bridgeSuccess = true;
              break;
            } catch(e) { }
          }
      }

      if (bridgeSuccess) {
          const cacheUriRes = await Filesystem.getUri({ path: cachePath, directory: Directory.Cache });
          finalUri = cacheUriRes.uri;
      }

      await Share.share({
        title: title || filename || "Logi Report",
        text: title || filename || "Logi Report",
        files: [finalUri],
        dialogTitle: title || filename || "Compartir Informe"
      });
    } catch (e) {
      alert("Error al compartir: " + (e.message || String(e)));
    }
  }

  async function nativeOpenFile(blob, filename, mimeType) {
    if (!FileOpener || !Filesystem) return false;
    try {
      const base64 = await blobToBase64(blob);
      const path = 'tmp_preview_' + filename;
      const writeResult = await Filesystem.writeFile({
        path: path,
        data: base64,
        directory: Directory.Cache,
        recursive: true
      });
      await FileOpener.open({ filePath: writeResult.uri, contentType: mimeType || blob.type || "application/pdf" });
      return true;
    } catch (e) { return false; }
  }

  async function nativeGetBlobUrl(id) {
    if (!Filesystem) return null;
    const tryDirs = [DIR_TYPE, Directory.Data];
    for (const dirType of tryDirs) {
      try {
        const path = DATA_DIR + '/blobs/' + id + '.jpg';
        const result = await Filesystem.getUri({ path: path, directory: dirType });
        return (window.Capacitor ? window.Capacitor.convertFileSrc(result.uri) : result.uri);
      } catch (e) { }
    }
    return null;
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

  async function nativeCheckSpeechPermissions() {
    if (!SpeechRecognition) return false;
    try {
      const p = await SpeechRecognition.checkPermissions();
      if (p.speechRecognition === 'granted') return true;
      const r = await SpeechRecognition.requestPermissions();
      return r.speechRecognition === 'granted';
    } catch (e) { return false; }
  }

  async function nativeStartDictation(onResult, onError) {
    if (!SpeechRecognition) return;
    const hasPerm = await nativeCheckSpeechPermissions();
    if (!hasPerm) return;
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
      const isDocx = (blob.type || "").includes("word") || id.toLowerCase().endsWith(".docx");
      const ext = isDocx ? ".docx" : ".pdf";
      const safeId = String(id).replace(/[^a-z0-9_-]/gi, '_');
      const path = DATA_DIR + '/reports/' + safeId + ext;
      const totalSize = blob.size;
      let offset = 0;
      let first = true;
      if (window.__logiProgress) window.__logiProgress(`Guardando ${Math.round(totalSize/1024/1024)}MB...`, 0);
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
        if (window.__logiProgress) {
          const pct = Math.min(100, Math.round((offset / totalSize) * 100));
          window.__logiProgress(`Guardando ${Math.round(totalSize/1024/1024)}MB...`, pct);
        }
      }
      const result = await Filesystem.getUri({ path: path, directory: DIR_TYPE });
      return result.uri;
    } catch (e) { return null; }
  }

  async function nativeGetReport(id) {
    if (!Filesystem) return null;
    try {
      const safeId = String(id).replace(/[^a-z0-9_-]/gi, '_');
      let data = null;
      let contentType = "application/pdf";
      const tryDirs = [DIR_TYPE, Directory.Data];
      for (const dirType of tryDirs) {
        try {
          const r1 = await Filesystem.readFile({ path: DATA_DIR + '/reports/' + safeId + '.pdf', directory: dirType });
          data = r1.data;
          break;
        } catch(e) {
          try {
            const r2 = await Filesystem.readFile({ path: DATA_DIR + '/reports/' + safeId + '.docx', directory: dirType });
            data = r2.data;
            contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            break;
          } catch(e2){ }
        }
      }
      if (!data) return null;
      return base64ToBlob(data, contentType);
    } catch (e) { return null; }
  }

  window.LogiNative = {
    isNative: function() { return (window.Capacitor && window.Capacitor.getPlatform() !== 'web'); },
    dbPut: nativeDbPut,
    dbGet: nativeDbGet,
    dbGetAll: nativeDbGetAll,
    dbDelete: nativeDbDelete,
    saveBlob: nativeSaveBlob,
    getBlob: nativeGetBlob,
    dbGetBlob: nativeGetBlob,
    getBlobUrl: nativeGetBlobUrl,
    getBlobBaseUrl: nativeGetBlobBaseUrl,
    getBlobBaseUrlSync: function() { return _cachedBlobBaseUrl; },
    share: nativeShare,
    openFile: nativeOpenFile,
    saveReport: nativeSaveReport,
    getReport: nativeGetReport,
    startDictation: nativeStartDictation,
    stopDictation: nativeStopDictation,
    checkSpeechPermissions: nativeCheckSpeechPermissions
  };
})();

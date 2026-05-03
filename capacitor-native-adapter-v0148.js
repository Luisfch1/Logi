/**
 * Logi Native Storage Adapter (Capacitor Global Edition)
 * This version uses global window.Capacitor to avoid ES module issues in WebView.
 */

// Version: 2026.03.20.0148 (FRIENDLY FILENAME SHARING)
(function() {
  if (window.__logiDebug) window.__logiDebug("!!! ADAPTER v0148 LOADED !!!");
  // Check if Capacitor is available (injected by Capacitor WebView)
  console.log("DEBUG: capacitor-native-adapter (v0148) execution start");
  console.log("DEBUG: window.Capacitor exists:", !!window.Capacitor);
  if (window.Capacitor) console.log("DEBUG: Capacitor platform:", window.Capacitor.getPlatform());
  
  const Capacitor = window.Capacitor;
  const Plugins = Capacitor ? Capacitor.Plugins : {};
  console.log("DEBUG: Registered Capacitor Plugins:", Object.keys(Plugins));
  
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
  console.log("DEBUG: IS_NATIVE calculated as:", IS_NATIVE);
  const DATA_DIR = 'Logi'; // Simplified folder name
  const DIR_TYPE = Directory.Documents; // Switching to Documents for user visibility

  let _dirChecked = false;
  async function ensureDir() {
    if (_dirChecked || !Filesystem) return;
    try {
      await Filesystem.mkdir({
        path: DATA_DIR,
        directory: DIR_TYPE,
        recursive: true
      });
      _dirChecked = true;
    } catch (e) {
      _dirChecked = true;
    }
  }

  const META_DB_PATH = DATA_DIR + '/metadata_db.json';
  let _nativeMetaCache = null;

  let _saveTimer = null;
  async function saveMetaDb() {
    if (!Filesystem || !_nativeMetaCache) return;
    if (_saveTimer) return; // Already scheduled
    
    _saveTimer = setTimeout(async () => {
      try {
        await Filesystem.writeFile({
          path: META_DB_PATH,
          data: JSON.stringify(_nativeMetaCache),
          directory: DIR_TYPE,
          encoding: 'utf8',
          recursive: true
        });
        // console.log("DEBUG: Metadata master file saved (debounced)");
      } catch (e) { console.warn("saveMetaDb failed", e); }
      finally { _saveTimer = null; }
    }, 500);
  }

  let _cachedBlobBaseUrl = "";

  async function loadMetaDb() {
    if (!Filesystem) return [];
    
    // Proactive: get blob base URL once
    if (!_cachedBlobBaseUrl) {
       if (window.__logiDebug) window.__logiDebug("Meta: Initializing BaseURL...");
       try {
         await ensureDir(); // Crucial!
         const result = await Filesystem.getUri({ path: DATA_DIR + '/blobs', directory: DIR_TYPE });
         let base = result.uri;
         if (!base.endsWith('/')) base += '/';
         _cachedBlobBaseUrl = (window.Capacitor ? window.Capacitor.convertFileSrc(base) : base);
         console.log("DEBUG: _cachedBlobBaseUrl set to:", _cachedBlobBaseUrl);
         if (window.__logiDebug) window.__logiDebug("BaseURL: " + (_cachedBlobBaseUrl||'EMPTY').slice(-40));
       } catch(e){
         console.warn("Failed to get blob base URL", e);
         if (window.__logiDebug) window.__logiDebug("BaseURL ERROR: " + String(e.message || e));
       }
    }

    if (_nativeMetaCache) return _nativeMetaCache;

    try {
      // 1. Try to read the master file
      const result = await Filesystem.readFile({
        path: META_DB_PATH,
        directory: DIR_TYPE,
        encoding: 'utf8'
      });
      _nativeMetaCache = JSON.parse(result.data);
      console.log("DEBUG: Metadata loaded from master file (" + _nativeMetaCache.length + ")");
      if (window.__logiDebug) window.__logiDebug("Meta Master Load: " + _nativeMetaCache.length + " items");
      return _nativeMetaCache;
    } catch (e) {
      // 2. Fallback: Scan individual files (Legacy/Migration)
      console.log("DEBUG: Metadata master file not found, scanning individual files...");
      if (window.__logiDebug) window.__logiDebug("Meta scanning individual files (slow)...");
      
      const items = await scanIndividualFiles('meta');
      const items2 = await scanIndividualFiles('items_meta');
      _nativeMetaCache = [...items, ...items2];
      
      // 3. Save the master file for next time
      await saveMetaDb();
      return _nativeMetaCache;
    }
  }

  async function scanIndividualFiles(storeName) {
    try {
      const path = DATA_DIR + '/' + storeName;
      const res = await Filesystem.readdir({ path: path, directory: DIR_TYPE });
      const files = res.files || [];
      const items = [];
      const queue = files.map(f => (typeof f === 'string') ? f : f.name).filter(n => n.endsWith('.json'));
      
      const concurrency = 30;
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
      await Filesystem.writeFile({
        path: path,
        data: JSON.stringify(item),
        directory: DIR_TYPE,
        encoding: 'utf8',
        recursive: true
      });
      
      const isMeta = (storeName === 'meta' || storeName === 'items_meta');
      if (isMeta) {
        // Update memory cache
        if (!_nativeMetaCache) await loadMetaDb();
        const idx = _nativeMetaCache.findIndex(x => x.id === item.id);
        if (idx >= 0) _nativeMetaCache[idx] = item;
        else _nativeMetaCache.push(item);
        // Persist master file
        await saveMetaDb();
      }
      return true;
    } catch(e) {
      console.error("Native DB Put failed", e);
      return false;
    }
  }

  async function nativeDbGet(storeName, id) {
    if (!Filesystem) return null;
    const isMeta = (storeName === 'meta' || storeName === 'items_meta');
    if (isMeta && _nativeMetaCache) {
       return _nativeMetaCache.find(x => x.id === id) || null;
    }
    try {
      const path = DATA_DIR + '/' + storeName + '/' + id + '.json';
      const result = await Filesystem.readFile({
        path: path,
        directory: DIR_TYPE,
        encoding: 'utf8'
      });
      return JSON.parse(result.data);
    } catch (e) { return null; }
  }

  async function nativeDbGetAll(storeName) {
    const isMeta = (storeName === 'meta' || storeName === 'items_meta');
    if (isMeta) {
      return await loadMetaDb();
    }
    // For other stores (like reports which are few), we can still use readdir or similar
    // But for now, let's keep it simple
    return await scanIndividualFiles(storeName);
  }

  async function nativeDbDelete(storeName, id) {
    if (!Filesystem) return false;
    try {
      const path = DATA_DIR + '/' + storeName + '/' + id + '.json';
      await Filesystem.deleteFile({
        path: path,
        directory: DIR_TYPE
      });
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
    const CHUNK_SIZE = 1024 * 1024 * 5; // 5MB chunks for photos
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
    } catch (e) {
      console.error("nativeSaveBlob failed", e);
      return false;
    }
  }

  async function nativeGetBlob(id) {
    if (!Filesystem) return null;
    try {
      const path = DATA_DIR + '/blobs/' + id + '.jpg';
      const result = await Filesystem.readFile({
        path: path,
        directory: DIR_TYPE
      });
      return base64ToBlob(result.data, 'image/jpeg');
    } catch (e) {
      return null;
    }
  }

  async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      };
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
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, { type: contentType });
  }

  async function nativeShare(blob, filename, mime, title, id) {
    if (window.__logiDebug) __logiDebug("nativeShare: --- BEGIN SHARE ---");
    if (!Share || !Filesystem) {
      if (window.__logiDebug) __logiDebug("nativeShare: FAIL - Plugins missing");
      alert("Error: Plugins de compartir/archivos no disponibles.");
      return;
    }
    
    const sizeMB = (blob?.size || 0) / 1024 / 1024;
    const filenameLower = (filename || "").toLowerCase();
    const isDocxByExt = filenameLower.endsWith(".docx");
    const isPdfByExt  = filenameLower.endsWith(".pdf");
    const isDocx = isDocxByExt || (mime || "").includes("word");
    const mimeToUse = isDocx ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : (isPdfByExt ? "application/pdf" : (mime || "application/pdf"));

    if (window.__logiDebug) __logiDebug(`nativeShare: "${filename}" (${sizeMB.toFixed(1)}MB)`);

    try {
      let finalUri = null;
      
      if (id) {
          try {
              const safeId = String(id).replace(/[^a-z0-9_-]/gi, '_');
              const primaryExt = isDocx ? ".docx" : ".pdf";
              const secondaryExt = isDocx ? ".pdf" : ".docx"; // Alternate lookup
              
              const reportPath = DATA_DIR + '/reports/' + safeId + primaryExt;
              const secondaryPath = DATA_DIR + '/reports/' + safeId + secondaryExt;
              
              let exists = null;
              try { exists = await Filesystem.getUri({ path: reportPath, directory: DIR_TYPE }); } catch(e){}
              
              if (!exists) {
                  try { 
                      exists = await Filesystem.getUri({ path: secondaryPath, directory: DIR_TYPE }); 
                      if (window.__logiDebug) __logiDebug("nativeShare: Found via ALTERNATE ext lookup");
                  } catch(e){}
              }

              if (exists && exists.uri) {
                  finalUri = exists.uri;
                  if (window.__logiDebug) __logiDebug("nativeShare: Found disk file: " + safeId);
              }
          } catch(e) { }
      }

      if (!finalUri) {
          if (window.__logiDebug) __logiDebug(`nativeShare: No disk file. Writing chunked cache file (${sizeMB.toFixed(1)}MB)...`);
          
          const CHUNK_SIZE_SHARE = 1024 * 1024 * 10; // 10MB chunks
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
          if (window.__logiDebug) __logiDebug("nativeShare: Cache write success.");
      }
      
      if (window.__logiDebug) __logiDebug("nativeShare: Preparing Friendly Cache File...");
      
      const cleanId = (id || Date.now()).toString().replace(/[^a-z0-9_-]/gi, '_');
      
      // Sanitized friendly name for the shared file
      let friendlyName = (filename || "informe").replace(/[^a-z0-9\._-]/gi, '_');
      if (isDocx && !friendlyName.toLowerCase().endsWith(".docx")) friendlyName += ".docx";
      if (!isDocx && !friendlyName.toLowerCase().endsWith(".pdf"))  friendlyName += ".pdf";
      
      const cachePath = 'share/' + friendlyName;
      let bridgeSuccess = false;
      
      if (finalUri && id) {
          // Robust source path construction (Dual lookup was already done to get finalUri, 
          // but we still need the relative path for Filesystem.copy if we want to be safe)
          
          const filenameId = cleanId.endsWith(".docx") || cleanId.endsWith(".pdf") ? 
                            cleanId.substring(0, cleanId.lastIndexOf('.')) : cleanId;
          const sourcePathPrimary = DATA_DIR + '/reports/' + filenameId + (isDocx ? ".docx" : ".pdf");
          const sourcePathSecondary = DATA_DIR + '/reports/' + filenameId + (!isDocx ? ".docx" : ".pdf");
          
          const tryCopy = async (src) => {
              try {
                  await Filesystem.stat({ path: src, directory: DIR_TYPE });
                  if (window.__logiDebug) __logiDebug("nativeShare: Copying " + src + " -> " + cachePath);
                  await Filesystem.copy({
                      from: src, directory: DIR_TYPE,
                      to: cachePath, toDirectory: Directory.Cache
                  });
                  return true;
              } catch(e) { return false; }
          };

          bridgeSuccess = await tryCopy(sourcePathPrimary);
          if (!bridgeSuccess) bridgeSuccess = await tryCopy(sourcePathSecondary);
      }

      if (bridgeSuccess) {
          const cacheUriRes = await Filesystem.getUri({ path: cachePath, directory: Directory.Cache });
          finalUri = cacheUriRes.uri;
      } else if (finalUri && !finalUri.includes("cache")) {
          // If bridge failed but we have a Documents URI, try to copy it manually to Cache
          // This handles edge cases where the path reconstruction failed but getUri worked
          try {
             if (window.__logiDebug) __logiDebug("nativeShare: Bridge failed, but DocURI exists. Forced copy attempt...");
             // finalUri from getUri is absolute. Filesystem.copy 'from' expects relative if possible,
             // but we will try writing it to Cache if it's already a Blob path? No, let's just use finalUri as is
             // but it was reported that rep_... names are bad.
          } catch(e){}
      }

      if (window.__logiDebug) __logiDebug("nativeShare: Final URI for Share: " + (finalUri||'EMPTY'));
      
      // Smart MIME for the Intent
      const mimeToShare = (finalUri && finalUri.toLowerCase().endsWith(".docx")) ? 
                          "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : 
                          (mimeToUse || "application/pdf");

      await Share.share({
        title: title || filename || "Logi Report",
        text: title || filename || "Logi Report",
        files: [finalUri],
        dialogTitle: title || filename || "Compartir Informe"
      });
      if (window.__logiDebug) __logiDebug("nativeShare: --- Intent Dispatched ---");
    } catch (e) {
      console.error("nativeShare failed", e);
      if (window.__logiDebug) __logiDebug("nativeShare CRASH/ERROR: " + String(e.message || e));
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
      
      await FileOpener.open({
        filePath: writeResult.uri,
        contentType: mimeType || blob.type || "application/pdf"
      });
      return true;
    } catch (e) {
      console.warn("nativeOpenFile failed", e);
      return false;
    }
  }

  async function migrateAllToNative(items, getBlobFn, onProgress) {
    console.log("Starting parallel native migration of " + items.length + " items...");
    let migrated = 0;
    const total = items.length;
    const CONCURRENCY = 5;

    async function processItem(idx) {
      const it = items[idx];
      try {
        await nativeDbPut('items', it);
        const blob = await getBlobFn(it.id);
        if (blob) {
          await nativeSaveBlob(it.id, blob);
        }
        migrated++;
        
        if (migrated % 10 === 0 || idx === total - 1) {
          if (onProgress) onProgress(migrated, total);
        }
      } catch (e) {
        console.warn("Migration failed for item " + it.id, e);
      }
    }

    const queue = [...Array(total).keys()];
    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      workers.push((async () => {
        while (queue.length > 0) {
          const idx = queue.shift();
          await processItem(idx);
        }
      })());
    }
    await Promise.all(workers);
    return migrated;
  }

  async function nativeGetBlobUrl(id) {
    if (!Filesystem) return null;
    try {
      const path = DATA_DIR + '/blobs/' + id + '.jpg';
      const result = await Filesystem.getUri({
        path: path,
        directory: DIR_TYPE
      });
      return (window.Capacitor ? window.Capacitor.convertFileSrc(result.uri) : result.uri);
    } catch (e) {
      return null;
    }
  }

  async function nativeGetFileInfo(id) {
    if (!Filesystem) return null;
    try {
      const path = DATA_DIR + '/blobs/' + id + '.jpg';
      const [uriRes, statRes] = await Promise.all([
        Filesystem.getUri({ path, directory: DIR_TYPE }),
        Filesystem.stat({ path, directory: DIR_TYPE })
      ]);
      return {
        uri: (window.Capacitor ? window.Capacitor.convertFileSrc(uriRes.uri) : uriRes.uri),
        size: statRes.size
      };
    } catch (e) {
      return null;
    }
  }

  async function nativeGetBlobBaseUrl() {
    if (!Filesystem) return "";
    try {
      const result = await Filesystem.getUri({
        path: DATA_DIR + '/blobs',
        directory: DIR_TYPE
      });
      let base = result.uri;
      if (!base.endsWith('/')) base += '/';
      return (window.Capacitor ? window.Capacitor.convertFileSrc(base) : base);
    } catch (e) {
      return "";
    }
  }

  // --- Dictation (Speech Recognition) ---
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
    if (!SpeechRecognition) return alert("Plugin de dictádo no disponible.");
    const hasPerm = await nativeCheckSpeechPermissions();
    if (!hasPerm) return alert("Permiso de micrófono denegado.");

    try {
      SpeechRecognition.addListener('partialResults', (data) => {
        if (data.matches && data.matches.length > 0 && onResult) {
          // Some vendors stop early if we don't handle isFinal correctly
          const isFinal = !!data.isFinal; 
          onResult(data.matches[0], isFinal);
        }
      });
      
      await SpeechRecognition.start({
        language: "es-CO",
        maxAlternatives: 1,
        partialResults: true,
        continuous: true, // Try to keep listening
        popup: false
      });
    } catch (e) {
      if (onError) onError(e);
    }
  }

  async function nativeStopDictation() {
    if (!SpeechRecognition) return;
    try {
      await SpeechRecognition.stop();
      SpeechRecognition.removeAllListeners();
    } catch (e) {}
  }

  async function nativeSaveReport(id, blob) {
    if (!Filesystem) return null;
    const CHUNK_SIZE = 1024 * 1024 * 10; // 10MB chunks
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
          await Filesystem.writeFile({
            path: path,
            data: base64,
            directory: DIR_TYPE,
            recursive: true
          });
          first = false;
        } else {
          await Filesystem.appendFile({
            path: path,
            data: base64,
            directory: DIR_TYPE
          });
        }
        offset += CHUNK_SIZE;
        if (window.__logiProgress) {
          const pct = Math.min(100, Math.round((offset / totalSize) * 100));
          window.__logiProgress(`Guardando ${Math.round(totalSize/1024/1024)}MB...`, pct);
        }
      }
      
      const result = await Filesystem.getUri({ path: path, directory: DIR_TYPE });
      return result.uri;
    } catch (e) {
      console.warn("nativeSaveReport failed", e);
      return null;
    }
  }

  async function nativeGetReport(id) {
    if (!Filesystem) return null;
    try {
      const safeId = String(id).replace(/[^a-z0-9_-]/gi, '_');
      let data = null;
      let contentType = null;
      
      const paths = [
        { p: DATA_DIR + '/reports/' + safeId + '.docx', t: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
        { p: DATA_DIR + '/reports/' + safeId + '.pdf',  t: "application/pdf" },
        { p: DATA_DIR + '/reports/' + safeId,           t: "application/pdf" }
      ];

      for (const entry of paths) {
        try {
          const res = await Filesystem.readFile({ path: entry.p, directory: DIR_TYPE });
          data = res.data;
          contentType = entry.t;
          if (window.__logiDebug) __logiDebug("nativeGetReport: Found " + entry.p);
          break;
        } catch(e) {}
      }

      if (!data) return null;
      return base64ToBlob(data, contentType || "application/pdf");
    } catch (e) {
      return null;
    }
  }

  // Globally expose window.LogiNative
  window.LogiNative = {
    isNative: function() { 
      return (window.Capacitor && window.Capacitor.getPlatform() !== 'web');
    },
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
    getBlobBaseUrlParams: nativeGetBlobBaseUrl, 
    getFileInfo: nativeGetFileInfo,
    share: nativeShare,
    shareFile: nativeShare,
    openFile: nativeOpenFile,
    saveReport: nativeSaveReport,
    getReport: nativeGetReport,
    migrateAll: migrateAllToNative,
    // Dictation
    startDictation: nativeStartDictation,
    stopDictation: nativeStopDictation,
    checkSpeechPermissions: nativeCheckSpeechPermissions
  };

  if (IS_NATIVE) {
    console.log("LogiNative Adapter initialized (Native). Keys:", Object.keys(window.LogiNative));
  } else {
    console.log("LogiNative Adapter initialized (Bridge/Web).");
  }
})();
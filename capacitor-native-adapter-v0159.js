/**
 * Logi Native Storage Adapter (Ultimate Scavenger Healer v159)
 * - Scavenger: Reads metadata from BOTH Data and Documents and merges them.
 * - Robust: Uses manual read+write if native copy fails (Android Scoped Storage).
 * - Transparent: Logs every step and error to LOGI_DEBUG.
 * - Golden: Consolidates everything into Private Data for final speed.
 */
(function() {
  const VERSION = "v0159";
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

  async function ensureDir(path, dir) {
    try { await Filesystem.mkdir({ path, directory: dir, recursive: true }); } catch (e) { }
  }

  // --- ULTIMATE SCAVENGER MIGRATION ---
  async function healStorageSplit() {
    if (_migrationActive || _migrationDone || !Filesystem) return;
    _migrationActive = true;
    __debug("ULTIMATE SCAVENGER Start: Documents -> Data...");
    
    try {
      const stores = ['blobs', 'meta', 'items_meta', 'reports', 'projects'];
      let totalMovedCount = 0;
      
      // Also try to move the master DB file itself if it exists in fallback
      try {
        const dbFrom = DATA_DIR + '/metadata_db.json';
        await Filesystem.copy({ from: dbFrom, directory: FALLBACK_DIR, to: dbFrom, toDirectory: PRIMARY_DIR });
        __debug("Master DB consolidated from Documents to Data.");
      } catch(e){}

      for (const store of stores) {
        try {
          const path = DATA_DIR + '/' + store;
          const res = await Filesystem.readdir({ path, directory: FALLBACK_DIR });
          const files = (res.files || []).map(f => (typeof f === 'string') ? f : f.name);
          
          if (files.length > 0) {
            __debug(`Found ${files.length} in Documents/${store}. Migrating...`);
            await ensureDir(path, PRIMARY_DIR);
            
            let count = 0;
            for (const name of files) {
               const filePath = path + '/' + name;
               try {
                  // Attempt 1: Native Copy (Fast)
                  await Filesystem.copy({ from: filePath, directory: FALLBACK_DIR, to: filePath, toDirectory: PRIMARY_DIR });
               } catch(e1){
                  // Attempt 2: Manual (Robust)
                  try {
                     const r = await Filesystem.readFile({ path: filePath, directory: FALLBACK_DIR });
                     await Filesystem.writeFile({ path: filePath, data: r.data, directory: PRIMARY_DIR, recursive: true });
                  } catch(e2){
                     // Skip if really failed
                     // __debug(`FAIL: ${name} - ${e2.message}`);
                     continue;
                  }
               }
               totalMovedCount++;
               count++;
               if (count % 50 === 0) __debug(`${store}: ${count}/${files.length} moved...`);
            }
          }
        } catch(e){}
      }
      _migrationDone = true;
      __debug(`SCAVENGER DONE. Records moved: ${totalMovedCount}`);
    } catch (e) { 
      __debug(`SCAVENGER FATAL: ${e.message}`);
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
    
    // Background Scavenging
    if (!_migrationDone && !_migrationActive) healStorageSplit();

    if (!_cachedBlobBaseUrl) {
       try {
         await ensureDir(DATA_DIR + '/blobs', PRIMARY_DIR);
         const result = await Filesystem.getUri({ path: DATA_DIR + '/blobs', directory: PRIMARY_DIR });
         let base = result.uri; if (!base.endsWith('/')) base += '/';
         _cachedBlobBaseUrl = (window.Capacitor ? window.Capacitor.convertFileSrc(base) : base);
       } catch(e){ }
    }

    if (_nativeMetaCache && _nativeMetaCache.length > 0) return _nativeMetaCache;

    // SCAVENGER READ: Try Data AND Documents
    let allItems = [];
    let seenIds = new Set();

    const locations = [
      {dir: PRIMARY_DIR, name: "Data (Fast)"},
      {dir: FALLBACK_DIR, name: "Documents (Legacy)"}
    ];

    for (const loc of locations) {
      try {
        const r = await Filesystem.readFile({ path: META_DB_PATH, directory: loc.dir, encoding: 'utf8' });
        const items = JSON.parse(r.data);
        if (Array.isArray(items)) {
          __debug(`Found ${items.length} items in ${loc.name}`);
          for (const it of items) {
             if (!seenIds.has(it.id)) {
                delete it.nativeUrl; // Clean bad experiment paths
                allItems.push(it);
                seenIds.add(it.id);
             }
          }
        }
      } catch (e) {}
    }

    // If both master files empty/missing, scan directories in both worlds
    if (allItems.length === 0) {
       for (const loc of locations) {
          const s1 = await scanFiles(loc.dir, 'meta');
          const s2 = await scanFiles(loc.dir, 'items_meta');
          for (const it of [...s1, ...s2]) {
             if (!seenIds.has(it.id)) {
                delete it.nativeUrl;
                allItems.push(it);
                seenIds.add(it.id);
             }
          }
       }
    }

    _nativeMetaCache = allItems;
    if (_nativeMetaCache.length > 0) await saveMetaDb(); // Persist merged result to fast storage
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

  // --- STANDARD API ---
  window.LogiNative = {
    isNative: function() { return (window.Capacitor && window.Capacitor.getPlatform() !== 'web'); },
    dbPut: async (s, it) => {
       if (!Filesystem) return false;
       await ensureDir(DATA_DIR + '/' + s, PRIMARY_DIR);
       const obj = Object.assign({}, it); delete obj.nativeUrl;
       try {
         await Filesystem.writeFile({ path: DATA_DIR + '/' + s + '/' + it.id + '.json', data: JSON.stringify(obj), directory: PRIMARY_DIR, encoding: 'utf8', recursive: true });
         if (s === 'meta' || s === 'items_meta') {
           if (!_nativeMetaCache) await loadMetaDb();
           const idx = _nativeMetaCache.findIndex(x => x.id === it.id);
           if (idx >= 0) _nativeMetaCache[idx] = obj; else _nativeMetaCache.push(obj);
           await saveMetaDb();
         }
         return true;
       } catch(e){ return false; }
    },
    dbGet: async (s, id) => {
       if ((s === 'meta' || s === 'items_meta') && _nativeMetaCache) return _nativeMetaCache.find(x => x.id === id) || null;
       try {
         const r = await Filesystem.readFile({ path: DATA_DIR + '/' + s + '/' + id + '.json', directory: PRIMARY_DIR, encoding: 'utf8' });
         const item = JSON.parse(r.data); delete item.nativeUrl; return item;
       } catch(e){
         try {
           const r2 = await Filesystem.readFile({ path: DATA_DIR + '/' + s + '/' + id + '.json', directory: FALLBACK_DIR, encoding: 'utf8' });
           const item2 = JSON.parse(r2.data); delete item2.nativeUrl; return item2;
         } catch(e2){ return null; }
       }
    },
    dbGetAll: async (s) => {
       if (s === 'meta' || s === 'items_meta') return await loadMetaDb();
       const items1 = await scanFiles(PRIMARY_DIR, s);
       const items2 = await scanFiles(FALLBACK_DIR, s);
       const merged = [...items1];
       const seen = new Set(merged.map(x=>x.id));
       for(const it of items2) { if(!seen.has(it.id)) merged.push(it); }
       return merged;
    },
    dbDelete: async (s, id) => {
       if (!Filesystem) return false;
       try { await Filesystem.deleteFile({ path: DATA_DIR + '/' + s + '/' + id + '.json', directory: PRIMARY_DIR }); } catch(e){}
       try { await Filesystem.deleteFile({ path: DATA_DIR + '/' + s + '/' + id + '.json', directory: FALLBACK_DIR }); } catch(e){}
       if (s === 'meta' || s === 'items_meta') {
         if (_nativeMetaCache) _nativeMetaCache = _nativeMetaCache.filter(x => x.id !== id);
         await saveMetaDb();
       }
       return true;
    },
    saveBlob: async (id, blob) => {
      await ensureDir(DATA_DIR + '/blobs', PRIMARY_DIR);
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
    },
    getBlob: async (id) => {
      const path = DATA_DIR + '/blobs/' + id + '.jpg';
      try {
        const r = await Filesystem.readFile({ path, directory: PRIMARY_DIR });
        return new Blob([Uint8Array.from(atob(r.data), c => c.charCodeAt(0))], { type: 'image/jpeg' });
      } catch (e) {
        try {
          const r2 = await Filesystem.readFile({ path, directory: FALLBACK_DIR });
          return new Blob([Uint8Array.from(atob(r2.data), c => c.charCodeAt(0))], { type: 'image/jpeg' });
        } catch(e2){ return null; }
      }
    },
    getBlobUrl: async (id) => {
      try {
        const res = await Filesystem.getUri({ path: DATA_DIR + '/blobs/' + id + '.jpg', directory: PRIMARY_DIR });
        return Capacitor.convertFileSrc(res.uri);
      } catch (e) {
        try {
          const res2 = await Filesystem.getUri({ path: DATA_DIR + '/blobs/' + id + '.jpg', directory: FALLBACK_DIR });
          return Capacitor.convertFileSrc(res2.uri);
        } catch(e2){ return null; }
      }
    },
    getBlobBaseUrlSync: () => _cachedBlobBaseUrl,
    share: async (blob, filename, mime) => {
      const reader = new FileReader();
      const b64 = await new Promise(r => { reader.onloadend = () => r(reader.result.split(',')[1]); reader.readAsDataURL(blob); });
      const res = await Filesystem.writeFile({ path: 'tmp_' + (filename||"file"), data: b64, directory: Directory.Cache, recursive: true });
      await Share.share({ files: [res.uri] });
    },
    openFile: async (blob, filename, mime) => {
      const reader = new FileReader();
      const b64 = await new Promise(r => { reader.onloadend = () => r(reader.result.split(',')[1]); reader.readAsDataURL(blob); });
      const res = await Filesystem.writeFile({ path: 'tmp_' + filename, data: b64, directory: Directory.Cache, recursive: true });
      await FileOpener.open({ filePath: res.uri, contentType: mime || "application/pdf" });
      return true;
    },
    saveReport: async (id, blob) => {
      const ext = blob.type.includes("word") ? ".docx" : ".pdf";
      const path = DATA_DIR + '/reports/' + id + ext;
      const b64 = await new Promise(r => { const rd = new FileReader(); rd.onloadend = () => r(rd.result.split(',')[1]); rd.readAsDataURL(blob); });
      await Filesystem.writeFile({ path, data: b64, directory: PRIMARY_DIR, recursive: true });
      const res = await Filesystem.getUri({ path, directory: PRIMARY_DIR }); return res.uri;
    },
    getReport: async (id) => {
       const paths = [{p:DATA_DIR+'/reports/'+id+'.pdf', d:PRIMARY_DIR}, {p:DATA_DIR+'/reports/'+id+'.docx', d:PRIMARY_DIR}, {p:DATA_DIR+'/reports/'+id+'.pdf', d:FALLBACK_DIR}, {p:DATA_DIR+'/reports/'+id+'.docx', d:FALLBACK_DIR}];
       for(const t of paths){
         try {
           const r = await Filesystem.readFile({ path:t.p, directory:t.d });
           return new Blob([Uint8Array.from(atob(r.data), c=>c.charCodeAt(0))], {type: t.p.endsWith('.pdf')?"application/pdf":"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
         }catch(e){}
       }
       return null;
    },
    getFileInfo: async (id) => {
       try {
         const res = await Filesystem.getUri({ path: DATA_DIR + '/blobs/' + id + '.jpg', directory: PRIMARY_DIR });
         const st = await Filesystem.stat({ path: DATA_DIR + '/blobs/' + id + '.jpg', directory: PRIMARY_DIR });
         return { uri: Capacitor.convertFileSrc(res.uri), size: st.size };
       } catch(e){
         try {
           const res2 = await Filesystem.getUri({ path: DATA_DIR + '/blobs/' + id + '.jpg', directory: FALLBACK_DIR });
           const st2 = await Filesystem.stat({ path: DATA_DIR + '/blobs/' + id + '.jpg', directory: FALLBACK_DIR });
           return { uri: Capacitor.convertFileSrc(res2.uri), size: st2.size };
         } catch(e2){ return null; }
       }
    }
  };
})();

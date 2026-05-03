/**
 * Logi Native Storage Adapter (Master Healer v163)
 * - Master Healer: Fixed UI click handler to force blob retrieval.
 * - Bridge Master: Fixed index.html early-return bug.
 * - Blob Master: Uses getUri + fetch for high-performance asset loading.
 * - Migration Priority: Moves metadata and reports BEFORE large photo blobs.
 * - Scoped Storage: Manual block transfer for all assets.
 */
(function() {
  const VERSION = "v0163";
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
  const PRIMARY_DIR = Directory.Data; 
  const FALLBACK_DIR = Directory.Documents; 

  let _migrationActive = false;
  let _migrationDone = false;

  function __debug(msg) {
    if (window.__logiDebug) window.__logiDebug(`[Master] ${msg}`);
    console.log(`LogiNative: ${msg}`);
  }

  async function ensureDir(path, dir) {
    try { await Filesystem.mkdir({ path, directory: dir, recursive: true }); } catch (e) { }
  }

  // --- MIGRATION ENGINE ---
  async function healStorageSplit() {
    if (_migrationActive || _migrationDone || !Filesystem) return;
    _migrationActive = true;
    __debug("Master Scavenger Start...");
    
    try {
      const stores = ['reports', 'projects', 'meta', 'items_meta', 'blobs'];
      let totalMovedCount = 0;
      
      for (const store of stores) {
        try {
          const path = DATA_DIR + '/' + store;
          const res = await Filesystem.readdir({ path, directory: FALLBACK_DIR });
          const files = (res.files || []).map(f => (typeof f === 'string') ? f : f.name);
          
          if (files.length > 0) {
            __debug(`Moving ${files.length} in ${store}...`);
            await ensureDir(path, PRIMARY_DIR);
            
            let count = 0;
            for (const name of files) {
               const filePath = path + '/' + name;
               try {
                  const r = await Filesystem.readFile({ path: filePath, directory: FALLBACK_DIR });
                  await Filesystem.writeFile({ path: filePath, data: r.data, directory: PRIMARY_DIR, recursive: true });
                  totalMovedCount++;
               } catch(e1){}
               count++;
               if (count % 100 === 0) __debug(`${store}: ${count}/${files.length} ready...`);
            }
          }
        } catch(e){}
      }
      _migrationDone = true;
      __debug(`Master Migration DONE. Assets moved: ${totalMovedCount}`);
    } catch (e) { 
      __debug(`FATAL: ${e.message}`);
    } finally {
      _migrationActive = false;
    }
  }

  // --- DATA ENGINE ---
  const META_DB_PATH = DATA_DIR + '/metadata_db.json';
  let _nativeMetaCache = null;
  let _cachedBlobBaseUrl = "";

  async function loadMetaDb() {
    if (!Filesystem) return [];
    if (!_migrationDone && !_migrationActive) healStorageSplit();

    if (!_cachedBlobBaseUrl) {
       try {
         await ensureDir(DATA_DIR + '/blobs', PRIMARY_DIR);
         const res = await Filesystem.getUri({ path: DATA_DIR + '/blobs', directory: PRIMARY_DIR });
         _cachedBlobBaseUrl = Capacitor.convertFileSrc(res.uri + (res.uri.endsWith('/') ? '' : '/'));
       } catch(e){ }
    }

    if (_nativeMetaCache) return _nativeMetaCache;

    let all = []; let seen = new Set();
    const locs = [PRIMARY_DIR, FALLBACK_DIR];
    for (const loc of locs) {
      try {
        const r = await Filesystem.readFile({ path: META_DB_PATH, directory: loc, encoding: 'utf8' });
        const items = JSON.parse(r.data);
        if (Array.isArray(items)) {
          for (const it of items) { if (!seen.has(it.id)) { delete it.nativeUrl; all.push(it); seen.add(it.id); } }
        }
      } catch (e) {}
    }

    if (all.length === 0) {
       for (const loc of locs) {
          const s1 = await scanFiles(loc, 'meta', '.json');
          const s2 = await scanFiles(loc, 'items_meta', '.json');
          for (const it of [...s1, ...s2]) { if (!seen.has(it.id)) { delete it.nativeUrl; all.push(it); seen.add(it.id); } }
       }
    }
    _nativeMetaCache = all;
    return _nativeMetaCache;
  }

  async function scanFiles(dirType, storeName, ext) {
    if (!Filesystem) return [];
    try {
      const path = DATA_DIR + '/' + storeName;
      const res = await Filesystem.readdir({ path, directory: dirType });
      const names = (res.files || []).map(f => (typeof f === 'string') ? f : f.name).filter(n => n.endsWith(ext));
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

  async function scanBinaryReports(dirType, filterPid) {
    if (!Filesystem) return [];
    try {
      const path = DATA_DIR + '/reports';
      const res = await Filesystem.readdir({ path, directory: dirType });
      const files = (res.files || []).map(f => (typeof f === 'string') ? f : f.name);
      
      const reports = [];
      for (const name of files) {
         if (name.endsWith('.pdf') || name.endsWith('.docx')) {
            const id = name.replace(/\.(pdf|docx)$/i, '');
            let meta = { id, name, createdAt: Date.now(), projectId: filterPid || 'unknown', scavenged: true };
            try {
               const r = await Filesystem.readFile({ path: path + '/' + id + '.json', directory: dirType, encoding: 'utf8' });
               meta = Object.assign(meta, JSON.parse(r.data));
            } catch(e){}
            
            if (!filterPid || meta.projectId === filterPid || meta.projectId === 'unknown') {
               reports.push(meta);
            }
         }
      }
      return reports;
    } catch(e){ return []; }
  }

  window.LogiNative = {
    isNative: () => true,
    dbPut: async (s, it) => {
       await ensureDir(DATA_DIR + '/' + s, PRIMARY_DIR);
       const obj = Object.assign({}, it); delete obj.nativeUrl;
       await Filesystem.writeFile({ path: DATA_DIR + '/' + s + '/' + it.id + (s.includes('reports')?'':'.json'), data: JSON.stringify(obj), directory: PRIMARY_DIR, encoding: 'utf8', recursive: true });
       if (s === 'meta' || s === 'items_meta') {
         if (!_nativeMetaCache) await loadMetaDb();
         const idx = _nativeMetaCache.findIndex(x => x.id === it.id);
         if (idx >= 0) _nativeMetaCache[idx] = obj; else _nativeMetaCache.push(obj);
       }
       return true;
    },
    dbGet: async (s, id) => {
       if ((s === 'meta' || s === 'items_meta') && _nativeMetaCache) return _nativeMetaCache.find(x => x.id === id) || null;
       const ext = (s === 'reports') ? '' : '.json';
       const searchId = id.replace(/\.(pdf|docx)$/i, '');
       try {
         const r = await Filesystem.readFile({ path: DATA_DIR + '/' + s + '/' + searchId + ext, directory: PRIMARY_DIR, encoding: 'utf8' });
         const obj = JSON.parse(r.data); if(s==='reports') obj.scavenged = true;
         return obj;
       } catch(e){
         try {
           const r2 = await Filesystem.readFile({ path: DATA_DIR + '/' + s + '/' + searchId + ext, directory: FALLBACK_DIR, encoding: 'utf8' });
           const obj = JSON.parse(r2.data); if(s==='reports') obj.scavenged = true;
           return obj;
         } catch(e2){ 
            if (s === 'reports') return { id: searchId, name: searchId, scavenged: true, projectId: 'unknown' };
            return null; 
         }
       }
    },
    dbGetAll: async (s, filterPid) => {
       if (s === 'meta' || s === 'items_meta') return await loadMetaDb();
       if (s === 'reports') {
          const r1 = await scanBinaryReports(PRIMARY_DIR, filterPid);
          const r2 = await scanBinaryReports(FALLBACK_DIR, filterPid);
          const merged = [...r1]; const seen = new Set(merged.map(x=>x.id));
          for(const it of r2) { if(!seen.has(it.id)) merged.push(it); }
          return merged;
       }
       const items1 = await scanFiles(PRIMARY_DIR, s, '.json');
       const items2 = await scanFiles(FALLBACK_DIR, s, '.json');
       const merged = [...items1]; const seen = new Set(merged.map(x=>x.id));
       for(const it of items2) { if(!seen.has(it.id)) merged.push(it); }
       return merged;
    },
    getBlob: async (id) => {
      const paths = [{path: DATA_DIR + '/blobs/' + id + '.jpg', dir: PRIMARY_DIR}, {path: DATA_DIR + '/blobs/' + id + '.jpg', dir: FALLBACK_DIR}];
      for (const t of paths) {
        try {
          const res = await Filesystem.getUri({ path: t.path, directory: t.dir });
          const url = Capacitor.convertFileSrc(res.uri);
          const response = await fetch(url);
          if (response.ok) return await response.blob();
        } catch(e){}
      }
      return null;
    },
    getBlobUrl: async (id) => {
       try {
         const res = await Filesystem.getUri({ path: DATA_DIR + '/blobs/' + id + '.jpg', directory: PRIMARY_DIR });
         return Capacitor.convertFileSrc(res.uri);
       } catch(e){
         try {
           const res2 = await Filesystem.getUri({ path: DATA_DIR + '/blobs/' + id + '.jpg', directory: FALLBACK_DIR });
           return Capacitor.convertFileSrc(res2.uri);
         }catch(e2){ return null; }
       }
    },
    getBlobBaseUrlSync: () => _cachedBlobBaseUrl,
    saveReport: async (id, blob) => {
      await ensureDir(DATA_DIR + '/reports', PRIMARY_DIR);
      const ext = blob.type.includes("word") ? ".docx" : ".pdf";
      const path = DATA_DIR + '/reports/' + id + ext;
      const b64 = await new Promise(r => { const rd = new FileReader(); rd.onloadend = () => r(rd.result.split(',')[1]); rd.readAsDataURL(blob); });
      await Filesystem.writeFile({ path, data: b64, directory: PRIMARY_DIR, recursive: true });
      const res = await Filesystem.getUri({ path, directory: PRIMARY_DIR }); 
      return Capacitor.convertFileSrc(res.uri);
    },
    getReport: async (id) => {
       const searchId = id.replace(/\.(pdf|docx)$/i, '');
       const paths = [
         {p:DATA_DIR+'/reports/'+searchId+'.pdf', d:PRIMARY_DIR}, {p:DATA_DIR+'/reports/'+searchId+'.docx', d:PRIMARY_DIR},
         {p:DATA_DIR+'/reports/'+searchId+'.pdf', d:FALLBACK_DIR}, {p:DATA_DIR+'/reports/'+searchId+'.docx', d:FALLBACK_DIR}
       ];
       __debug(`getReport: Request ID ${searchId}`);
       for(const t of paths){
         try {
           const res = await Filesystem.getUri({ path: t.p, directory: t.d });
           const url = Capacitor.convertFileSrc(res.uri);
           __debug(`  Trying ${t.d}: ${t.p}`);
           const response = await fetch(url);
           if (response.ok) {
              const b = await response.blob();
              __debug(`  -> SUCCESS: ${b.size} bytes`);
              return b;
           }
         }catch(e){}
       }
       __debug(`  -> FAILURE: Report not found.`);
       return null;
    },
    share: async (blob, filename, mime) => {
      const b64 = await new Promise(r => { const rd = new FileReader(); rd.onloadend = () => r(rd.result.split(',')[1]); rd.readAsDataURL(blob); });
      const res = await Filesystem.writeFile({ path: 'tmp_' + (filename||"file"), data: b64, directory: Directory.Cache, recursive: true });
      await Share.share({ files: [res.uri] });
    },
    openFile: async (blob, filename, mime) => {
      const b64 = await new Promise(r => { const rd = new FileReader(); rd.onloadend = () => r(rd.result.split(',')[1]); rd.readAsDataURL(blob); });
      const res = await Filesystem.writeFile({ path: 'tmp_' + filename, data: b64, directory: Directory.Cache, recursive: true });
      await FileOpener.open({ filePath: res.uri, contentType: mime || "application/pdf" });
      return true;
    }
  };
})();

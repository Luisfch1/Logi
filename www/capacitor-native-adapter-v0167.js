/**
 * Logi Native Storage Adapter (Titan Shield v167)
 * - Titan Shield: Direct URI sharing (fixes 139MB OOM crashes).
 * - Name Guardian+: Cross-store metadata naming (restores titles).
 * - Ultimate Scavenger: Scans both /reports and /blobs for documents.
 */
(function() {
  const VERSION = "v0167";
  if (window.__logiDebug) window.__logiDebug(`!!! ADAPTER ${VERSION} LOADED (Shield Activated) !!!`);
  console.log(`DEBUG: capacitor-native-adapter (${VERSION}) start`);
  
  const Capacitor = window.Capacitor;
  const Plugins = Capacitor ? Capacitor.Plugins : {};
  const Filesystem = Plugins.Filesystem;
  const Share = Plugins.Share;
  const FileOpener = Plugins.FileOpener;
  
  const Directory = { Data: 'DATA', Cache: 'CACHE', Documents: 'DOCUMENTS' };
  const DATA_DIR = 'Logi'; 
  const PRIMARY_DIR = Directory.Data; 
  const FALLBACK_DIR = Directory.Documents; 

  let _migrationActive = false;
  let _migrationDone = false;
  let _projectMap = null; // { id: prettyName }

  function __debug(msg) {
    if (window.__logiDebug) window.__logiDebug(`[Master] ${msg}`);
    console.log(`LogiNative: ${msg}`);
  }

  async function ensureDir(path, dir) {
    try { await Filesystem.mkdir({ path, directory: dir, recursive: true }); } catch (e) { }
  }

  // --- MIGRATION ENGINE (v167: Document-Safe Scavenger) ---
  async function healStorageSplit() {
    if (_migrationActive || _migrationDone || !Filesystem) return;
    _migrationActive = true;
    __debug("Titan Shield Scavenger Start...");
    
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
            
            for (const name of files) {
               const filePath = path + '/' + name;
               try {
                  // v166/167: Using Filesystem.copy (100% memory safe)
                  await Filesystem.copy({ from: filePath, to: filePath, directory: FALLBACK_DIR, toDirectory: PRIMARY_DIR });
                  totalMovedCount++;

                  // Scavenger v167: If a document is found in 'blobs', also copy it to 'reports'
                  if (store === 'blobs' && (name.endsWith('.pdf') || name.endsWith('.docx'))) {
                     await ensureDir(DATA_DIR + '/reports', PRIMARY_DIR);
                     await Filesystem.copy({ from: filePath, to: DATA_DIR + '/reports/' + name, directory: FALLBACK_DIR, toDirectory: PRIMARY_DIR });
                  }
               } catch(e1){}
            }
          }
        } catch(e){}
      }
      _migrationDone = true;
      __debug(`Titan Migration DONE. Assets moved: ${totalMovedCount}`);
    } catch (e) { 
      __debug(`FATAL: ${e.message}`);
    } finally {
      _migrationActive = false;
    }
  }

  // --- DATA ENGINE ---
  const META_DB_PATH = DATA_DIR + '/metadata_db.json';
  let _nativeMetaCache = null;

  async function loadMetaDb() {
    if (!Filesystem) return [];
    if (!_migrationDone && !_migrationActive) healStorageSplit();

    if (_nativeMetaCache) return _nativeMetaCache;

    let all = []; let seen = new Set();
    const locs = [PRIMARY_DIR, FALLBACK_DIR];
    for (const loc of locs) {
      try {
        const r = await Filesystem.readFile({ path: META_DB_PATH, directory: loc, encoding: 'utf8' });
        const items = JSON.parse(r.data);
        if (Array.isArray(items)) {
          for (const it of items) { if (!seen.has(it.id)) { all.push(it); seen.add(it.id); } }
        }
      } catch (e) {}
    }
    
    // Build Project Map for Naming Restoration
    _projectMap = {};
    for(const it of all) {
       if (it.id && it.id.startsWith('p_') && (it.nombre || it.title)) {
          _projectMap[it.id] = it.nombre || it.title;
       }
    }

    _nativeMetaCache = all;
    return _nativeMetaCache;
  }

  async function scanBinaryReports(dirType, filterPid) {
    if (!Filesystem) return [];
    try {
      const folders = ['reports', 'blobs']; // Scavenger v167: Search both
      const reports = [];
      const seenIds = new Set();

      for (const folder of folders) {
        const path = DATA_DIR + '/' + folder;
        try {
          const res = await Filesystem.readdir({ path, directory: dirType });
          const files = (res.files || []).map(f => (typeof f === 'string') ? f : f.name);
          
          for (const name of files) {
            if (name.endsWith('.pdf') || name.endsWith('.docx')) {
                const id = name.replace(/\.(pdf|docx)$/i, '');
                if (seenIds.has(id)) continue;
                seenIds.add(id);

                const ext = name.endsWith('.pdf') ? '.pdf' : '.docx';
                const mime = (ext === '.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                
                let meta = { id, name: name, createdAt: Date.now(), projectId: filterPid || 'unknown', scavenged: true, mime: mime };
                
                // Try to find JSON metadata
                try {
                   const r = await Filesystem.readFile({ path: DATA_DIR + '/reports/' + id + '.json', directory: dirType, encoding: 'utf8' });
                   const jsonMeta = JSON.parse(r.data);
                   if (jsonMeta.name && jsonMeta.name !== id) meta.name = jsonMeta.name.includes('.') ? jsonMeta.name : jsonMeta.name + ext;
                   if (jsonMeta.projectId) meta.projectId = jsonMeta.projectId;
                } catch(e){}

                // V167: If name is still the ID, try to lookup Project Name
                if (meta.name.startsWith('rep_') && !meta.name.includes(' ') && _projectMap && _projectMap[meta.projectId]) {
                   meta.name = `${_projectMap[meta.projectId]} - ${meta.id}${ext}`;
                }
                
                if (!filterPid || meta.projectId === filterPid || meta.projectId === 'unknown') reports.push(meta);
            }
          }
        } catch(e){}
      }
      return reports;
    } catch(e){ return []; }
  }

  window.LogiNative = {
    isNative: () => true,
    dbPut: async (s, it) => {
       await ensureDir(DATA_DIR + '/' + s, PRIMARY_DIR);
       const obj = Object.assign({}, it); delete obj.nativeUrl; delete obj.blob;
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
       if (!_projectMap) await loadMetaDb();

       const ext = (s === 'reports') ? '' : '.json';
       const searchId = id.replace(/\.(pdf|docx)$/i, '');
       const isWord = id.includes('docx') || searchId.includes('docx');
       const fallbackExt = isWord ? '.docx' : '.pdf';

       try {
         const r = await Filesystem.readFile({ path: DATA_DIR + '/' + s + '/' + searchId + ext, directory: PRIMARY_DIR, encoding: 'utf8' });
         const obj = JSON.parse(r.data); 
         if(s==='reports') { 
            obj.scavenged = true; 
            if (obj.name && obj.name.startsWith('rep_') && _projectMap && _projectMap[obj.projectId]) obj.name = `${_projectMap[obj.projectId]} - ${obj.id}${fallbackExt}`;
            if (obj.name && !obj.name.includes('.')) obj.name += fallbackExt;
         }
         return obj;
       } catch(e){
         if (s === 'reports') {
            const prettyName = (_projectMap && _projectMap['unknown']) ? `${_projectMap['unknown']} - ${searchId}${fallbackExt}` : `${searchId}${fallbackExt}`;
            return { id: searchId, name: prettyName, scavenged: true, projectId: 'unknown', mime: isWord ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf' };
         }
         return null; 
       }
    },
    dbGetAll: async (s, filterPid) => {
       if (s === 'meta' || s === 'items_meta') return await loadMetaDb();
       if (s === 'reports') {
          if (!_projectMap) await loadMetaDb();
          const r1 = await scanBinaryReports(PRIMARY_DIR, filterPid);
          const r2 = await scanBinaryReports(FALLBACK_DIR, filterPid);
          const merged = [...r1]; const seen = new Set(merged.map(x=>x.id));
          for(const it of r2) { if(!seen.has(it.id)) merged.push(it); }
          return merged;
       }
       return await scanFiles(PRIMARY_DIR, s, '.json');
    },
    getReport: async (id) => {
       const searchId = id.replace(/\.(pdf|docx)$/i, '');
       const folders = ['reports', 'blobs'];
       const locs = [PRIMARY_DIR, FALLBACK_DIR];

       for(const f of folders) {
         for(const d of locs) {
           for(const ext of ['.pdf', '.docx']) {
             try {
               const p = DATA_DIR + '/' + f + '/' + searchId + ext;
               const res = await Filesystem.getUri({ path: p, directory: d });
               const response = await fetch(Capacitor.convertFileSrc(res.uri));
               if (response.ok) return await response.blob();
             } catch(e){}
           }
         }
       }
       return null;
    },
    share: async (blob, filename, mime) => {
       // Titan Shield: Attempt direct file URI sharing if possible
       const searchId = filename.replace(/📄 \[RECUPERADO\] /g, '').replace(/\.(pdf|docx)$/i, '');
       try {
          const res = await Filesystem.getUri({ path: DATA_DIR + '/reports/' + (searchId.includes('rep_') ? searchId : filename), directory: PRIMARY_DIR });
          await Share.share({ files: [res.uri] });
          return;
       } catch(e) {
          // Fallback to memory-safe small chunks or tmp file
          __debug("Direct share failed, using tmp file...");
          const b64 = await new Promise(r => { const rd = new FileReader(); rd.onloadend = () => r(rd.result.split(',')[1]); rd.readAsDataURL(blob); });
          const tmp = await Filesystem.writeFile({ path: 'share_tmp.pdf', data: b64, directory: Directory.Cache });
          await Share.share({ files: [tmp.uri] });
       }
    },
    openFile: async (blob, filename, mime) => {
       const searchId = filename.replace(/📄 \[RECUPERADO\] /g, '').replace(/\.(pdf|docx)$/i, '');
       try {
          const res = await Filesystem.getUri({ path: DATA_DIR + '/reports/' + (searchId.includes('rep_') ? searchId : filename), directory: PRIMARY_DIR });
          await FileOpener.open({ filePath: res.uri, contentType: mime || "application/pdf" });
       } catch(e) {
          const b64 = await new Promise(r => { const rd = new FileReader(); rd.onloadend = () => r(rd.result.split(',')[1]); rd.readAsDataURL(blob); });
          const tmp = await Filesystem.writeFile({ path: 'open_tmp.pdf', data: b64, directory: Directory.Cache });
          await FileOpener.open({ filePath: tmp.uri, contentType: mime || "application/pdf" });
       }
    }
  };
})();

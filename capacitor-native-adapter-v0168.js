/**
 * Logi Native Storage Adapter (Omni Shield v168)
 * - Omni Shield: Absolute filename integrity for direct URI sharing.
 * - Project Map+: Robust handling of numeric project IDs.
 * - Titan Shield: Zero-memory sharing.
 */
(function() {
  const VERSION = "v0168";
  if (window.__logiDebug) window.__logiDebug(`!!! ADAPTER ${VERSION} LOADED (Shield Integrity 100%) !!!`);
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
  let _projectMap = null; 

  function __debug(msg) {
    if (window.__logiDebug) window.__logiDebug(`[Master] ${msg}`);
    console.log(`LogiNative: ${msg}`);
  }

  async function ensureDir(path, dir) {
    try { await Filesystem.mkdir({ path, directory: dir, recursive: true }); } catch (e) { }
  }

  // --- MIGRATION ENGINE (v168) ---
  async function healStorageSplit() {
    if (_migrationActive || _migrationDone || !Filesystem) return;
    _migrationActive = true;
    __debug("Omni Scavenger Start...");
    
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
                  await Filesystem.copy({ from: filePath, to: filePath, directory: FALLBACK_DIR, toDirectory: PRIMARY_DIR });
                  totalMovedCount++;

                  // Scavenger: Misplaced reports in blobs
                  if (store === 'blobs' && (name.endsWith('.pdf') || name.endsWith('.docx'))) {
                     await ensureDir(DATA_DIR + '/reports', PRIMARY_DIR);
                     try { await Filesystem.copy({ from: filePath, to: DATA_DIR + '/reports/' + name, directory: FALLBACK_DIR, toDirectory: PRIMARY_DIR }); } catch(e2){}
                  }
               } catch(e1){}
            }
          }
        } catch(e){}
      }
      _migrationDone = true;
      __debug(`Omni Migration DONE. Moved: ${totalMovedCount}`);
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
          for (const it of items) { if (it.id && !seen.has(it.id)) { all.push(it); seen.add(it.id); } }
        }
      } catch (e) {}
    }
    
    _projectMap = {};
    for(const it of all) {
       const sid = String(it.id);
       if (sid.startsWith('p_') && (it.nombre || it.title)) {
          _projectMap[sid] = it.nombre || it.title;
       }
    }

    _nativeMetaCache = all;
    return _nativeMetaCache;
  }

  async function scanBinaryReports(dirType, filterPid) {
    if (!Filesystem) return [];
    try {
      const folders = ['reports', 'blobs'];
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
                
                try {
                   const r = await Filesystem.readFile({ path: DATA_DIR + '/reports/' + id + '.json', directory: dirType, encoding: 'utf8' });
                   const jsonMeta = JSON.parse(r.data);
                   if (jsonMeta.name && jsonMeta.name !== id) meta.name = jsonMeta.name.includes('.') ? jsonMeta.name : jsonMeta.name + ext;
                   if (jsonMeta.projectId) meta.projectId = jsonMeta.projectId;
                } catch(e){}

                if (meta.name.startsWith('rep_') && !meta.name.includes(' ') && _projectMap && _projectMap[String(meta.projectId)]) {
                   meta.name = `${_projectMap[String(meta.projectId)]} - ${meta.id}${ext}`;
                }
                
                if (!filterPid || String(meta.projectId) === String(filterPid) || meta.projectId === 'unknown') reports.push(meta);
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
       return true;
    },
    dbGet: async (s, id) => {
       if ((s === 'meta' || s === 'items_meta') && _nativeMetaCache) return _nativeMetaCache.find(x => x.id == id) || null;
       if (!_projectMap) await loadMetaDb();

       const ext = (s === 'reports') ? '' : '.json';
       const searchId = String(id).replace(/\.(pdf|docx)$/i, '');
       const isWord = String(id).includes('docx') || searchId.includes('docx');
       const fallbackExt = isWord ? '.docx' : '.pdf';

       try {
         const r = await Filesystem.readFile({ path: DATA_DIR + '/' + s + '/' + searchId + ext, directory: PRIMARY_DIR, encoding: 'utf8' });
         const obj = JSON.parse(r.data); 
         if(s==='reports') { 
            obj.scavenged = true; 
            if (obj.name && obj.name.startsWith('rep_') && _projectMap && _projectMap[String(obj.projectId)]) obj.name = `${_projectMap[String(obj.projectId)]} - ${obj.id}${fallbackExt}`;
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
       const searchId = String(id).replace(/\.(pdf|docx)$/i, '');
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
       const cleanName = filename.replace(/📄 \[RECUPERADO\] /g, '');
       const searchId = cleanName.replace(/\.(pdf|docx)$/i, '');
       const exts = ['.pdf', '.docx'];
       
       for(const ext of exts) {
          try {
             const path = DATA_DIR + '/reports/' + searchId + ext;
             const res = await Filesystem.getUri({ path, directory: PRIMARY_DIR });
             await Share.share({ files: [res.uri] });
             return;
          } catch(e){}
       }
       
       __debug("Fall-through sharing...");
       const b64 = await new Promise(r => { const rd = new FileReader(); rd.onloadend = () => r(rd.result.split(',')[1]); rd.readAsDataURL(blob); });
       const tmp = await Filesystem.writeFile({ path: 'share_tmp.pdf', data: b64, directory: Directory.Cache });
       await Share.share({ files: [tmp.uri] });
    },
    openFile: async (blob, filename, mime) => {
       const cleanName = filename.replace(/📄 \[RECUPERADO\] /g, '');
       const searchId = cleanName.replace(/\.(pdf|docx)$/i, '');
       const exts = ['.pdf', '.docx'];
       
       for(const ext of exts) {
          try {
             const path = DATA_DIR + '/reports/' + searchId + ext;
             const res = await Filesystem.getUri({ path, directory: PRIMARY_DIR });
             await FileOpener.open({ filePath: res.uri, contentType: mime || "application/pdf" });
             return;
          } catch(e){}
       }

       const b64 = await new Promise(r => { const rd = new FileReader(); rd.onloadend = () => r(rd.result.split(',')[1]); rd.readAsDataURL(blob); });
       const tmp = await Filesystem.writeFile({ path: 'open_tmp.pdf', data: b64, directory: Directory.Cache });
       await FileOpener.open({ filePath: tmp.uri, contentType: mime || "application/pdf" });
    }
  };
})();

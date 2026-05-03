/**
 * SUPABASE PWA BRIDGE (Legacy Logi -> CONTROL)
 * 
 * Este puente permite que la versión PWA de Logi (iPhone) sincronice
 * fotos directamente con Supabase sin usar adaptadores nativos.
 */

window.SupabasePwaSync = (function() {
    let supabaseClient = null;
    const STORAGE_KEY = 'logi_supabase_config';

    function getConfig() {
        return {
            url: localStorage.getItem('supabase_url') || '',
            key: localStorage.getItem('supabase_key') || '',
            projectId: localStorage.getItem('supabase_project_id') || ''
        };
    }

    function saveConfig(config) {
        if (config.url) localStorage.setItem('supabase_url', config.url);
        if (config.key) localStorage.setItem('supabase_key', config.key);
        if (config.projectId) localStorage.setItem('supabase_project_id', config.projectId);
        initClient(); // Reiniciar cliente con nueva config
    }

    function initClient() {
        const config = getConfig();
        console.log("Supabase Bridge: Intentando inicializar con:", config);
        
        if (!config.url || !config.key) {
            console.warn("Supabase Bridge: Configuración incompleta.");
            return;
        }

        if (!window.supabase) {
            console.error("Supabase Bridge: SDK de Supabase no encontrado en window.supabase");
            alert("⚠️ Error crítico: El SDK de Supabase no cargó. Revisa tu conexión a internet.");
            return;
        }

        try {
            supabaseClient = window.supabase.createClient(config.url, config.key);
            console.log("Supabase Bridge: Cliente inicializado ✅");
        } catch (e) {
            console.error("Supabase Bridge: Error en createClient:", e);
            alert("⚠️ Error al crear cliente Supabase: " + e.message);
        }
    }

    async function uploadPhoto(item) {
        if (!supabaseClient) {
            console.warn("Supabase Bridge: Cliente no inicializado, saltando subida.");
            return;
        }

        const config = getConfig();
        const projectId = config.projectId;

        if (!projectId) {
            console.warn("Supabase Bridge: No hay ID de proyecto configurado.");
            return;
        }

        try {
            // 1. Obtener el blob si no está presente (por si acaso)
            let blob = item.blob;
            if (!blob && typeof dbGetBlob === 'function') {
                blob = await dbGetBlob(item.id);
            }

            if (!blob) {
                console.error("Supabase Bridge: No se encontró el blob para el item", item.id);
                return;
            }

            // 2. Subir al Storage (Bucket: logi_evidences)
            const fileName = `${projectId}/${item.id}.jpg`;
            const { data: storageData, error: storageError } = await supabaseClient
                .storage
                .from('logi_evidences')
                .upload(fileName, blob, {
                    contentType: 'image/jpeg',
                    upsert: true
                });

            if (storageError) throw storageError;

            // 3. Insertar Metadata en la tabla logi_evidences
            const { error: dbError } = await supabaseClient
                .from('logi_evidences')
                .upsert({
                    id: item.id.toString(),
                    project_id: projectId,
                    photo_url: fileName,
                    description: item.descripcion || "",
                    metadata: {
                        fecha: item.fecha,
                        proyecto_local: item.proyecto,
                        createdAt: item.createdAt,
                        hasLogo: item.hasLogo,
                        local_projectId: item.projectId
                    },
                    synced_at: new Date().toISOString()
                });

            if (dbError) throw dbError;

            console.log(`Supabase Bridge: Item ${item.id} sincronizado con éxito ✅`);
            
            // Marcar como sincronizado localmente si existe la función
            if (typeof dbPut === 'function') {
                item.synced = true;
                await dbPut(item);
            }

        } catch (error) {
            console.error("Supabase Bridge: Error en la sincronización:", error);
            // Aquí podríamos implementar una cola de reintentos
        }
    }

    async function syncAll() {
        const btn = document.getElementById('btnCloudSync');
        if (!supabaseClient) {
            alert("⚠️ Supabase no configurado. Ve a Ajustes.");
            return;
        }

        const config = getConfig();
        const projectId = config.projectId;
        if (!projectId) {
            alert("⚠️ ID de Proyecto no configurado.");
            return;
        }

        if (btn) btn.classList.add('syncing');

        try {
            if (typeof dbGetAll !== 'function') {
                alert("⚠️ Error de base de datos local (dbGetAll no definida).");
                if (btn) btn.classList.remove('syncing');
                return;
            }

            const items = await dbGetAll();
            const activeId = (typeof getActiveProjectId === 'function') ? getActiveProjectId() : null;
            
            // Filtrar items: deben tener el mismo projectId (CONTROL)
            const projectItems = items.filter(it => (activeId ? it.projectId === activeId : true));

            if (projectItems.length === 0) {
                alert("No hay fotos en el proyecto activo para sincronizar.");
                if (btn) btn.classList.remove('syncing');
                return;
            }

            console.log(`Supabase Bridge: Sincronizando ${projectItems.length} fotos...`);
            
            let success = 0;
            let errors = 0;

            for (const item of projectItems) {
                try {
                    await uploadPhoto(item);
                    success++;
                } catch (err) {
                    console.error("Error subiendo item:", item.id, err);
                    errors++;
                }
            }

            alert(`✅ Sincronización terminada.\n\nÉxito: ${success}\nErrores: ${errors}`);
        } catch (e) {
            console.error("Supabase Bridge: Error fatal en syncAll:", e);
            alert("Error crítico durante la sincronización: " + e.message);
        } finally {
            if (btn) btn.classList.remove('syncing');
        }
    }

    // Inicializar al cargar
    initClient();

    return {
        upload: uploadPhoto,
        saveConfig: saveConfig,
        getConfig: getConfig,
        reinit: initClient,
        syncAll: syncAll
    };
})();

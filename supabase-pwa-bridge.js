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
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        } catch (e) {
            return {};
        }
    }

    function saveConfig(config) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        initClient(); // Reiniciar cliente con nueva config
    }

    function initClient() {
        const config = getConfig();
        if (config.url && config.key) {
            try {
                // El SDK se carga via CDN en el index.html
                supabaseClient = window.supabase.createClient(config.url, config.key);
                console.log("Supabase Bridge: Cliente inicializado ✅");
            } catch (e) {
                console.error("Supabase Bridge: Error inicializando cliente:", e);
            }
        } else {
            console.warn("Supabase Bridge: Falta configuración de URL/Key");
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

    // Inicializar al cargar
    initClient();

    return {
        upload: uploadPhoto,
        saveConfig: saveConfig,
        getConfig: getConfig,
        reinit: initClient
    };
})();

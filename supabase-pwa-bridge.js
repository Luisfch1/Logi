/**
 * SUPABASE PWA BRIDGE (Legacy Logi -> CONTROL)
 * 
 * Este puente permite que la versión PWA de Logi (iPhone) sincronice
 * fotos directamente con Supabase sin usar adaptadores nativos.
 */

window.SupabasePwaSync = (function () {
    let supabaseClient = null;
    const STORAGE_KEY = 'logi_supabase_config';

    function getConfig() {
        return {
            url: (localStorage.getItem('supabase_url') || '').trim(),
            key: (localStorage.getItem('supabase_key') || '').trim(),
            projectId: (localStorage.getItem('supabase_project_id') || '').trim()
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

    function toUUID(str) {
        // Generar un UUID determinista a partir del ID de Logi (string/numero)
        // El formato debe ser 8-4-4-4-12 hex
        let s = str.toString();
        // Hacemos un hash simple para completar 32 caracteres hex
        let hash = 0;
        for (let i = 0; i < s.length; i++) {
            hash = ((hash << 5) - hash) + s.charCodeAt(i);
            hash |= 0;
        }
        let hex = Math.abs(hash).toString(16).padEnd(32, 'f');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    }

    async function uploadPhoto(item) {
        if (!supabaseClient) return;

        const config = getConfig();
        const projectId = config.projectId;
        if (!projectId) return;

        try {
            let blob = item.blob;
            if (!blob && typeof dbGetBlob === 'function') {
                blob = await dbGetBlob(item.id);
            }

            if (!blob) throw new Error("No hay imagen");

            // Asegurar que sea un Blob con el tipo correcto para que no salga octet-stream (v2026-05-03)
            const imageBlob = new Blob([blob], { type: 'image/jpeg' });

            const fileName = `${projectId}/${item.id}.jpg`;
            let publicUrl = "";

            // 2. Subir al Storage (SOLO si no está sincronizado aún o si queremos forzar resubida)
            if (!item.synced) {
                console.log(`Supabase Bridge: Subiendo binario para ${item.id}...`);
                let { data: storageData, error: storageError } = await supabaseClient
                    .storage
                    .from('logi_evidences')
                    .upload(fileName, imageBlob, {
                        contentType: 'image/jpeg',
                        upsert: true
                    });

                // Fallback: Si falla porque "ya existe" (a veces el upsert:true falla por RLS), intentamos .update() directamente
                if (storageError && (storageError.message?.includes('already exist') || storageError.error === 'Duplicate')) {
                    console.log("Supabase Bridge: El recurso ya existe, intentando actualización directa (.update())...");
                    const { data: updateData, error: updateError } = await supabaseClient
                        .storage
                        .from('logi_evidences')
                        .update(fileName, imageBlob, {
                            contentType: 'image/jpeg'
                        });
                    storageData = updateData;
                    storageError = updateError;
                }

                if (storageError) {
                    console.error("Supabase Bridge: Error de STORAGE:", storageError);
                    throw new Error(`Error de Almacenamiento (Storage): ${storageError.message || storageError.error_description || 'Acceso Denegado'}`);
                }
            } else {
                console.log(`Supabase Bridge: Binario ya existe para ${item.id}, saltando subida a Storage.`);
            }

            // 3. Obtener URL Pública (v2026-05-03: CONTROL requiere link completo)
            const { data: publicUrlData } = supabaseClient.storage
                .from('logi_evidences')
                .getPublicUrl(fileName);
            
            publicUrl = publicUrlData.publicUrl;

            // 4. Insertar/Actualizar Metadata en la tabla logi_evidences
            console.log(`Supabase Bridge: Actualizando metadata para ${item.id}...`);
            const { error: dbError } = await supabaseClient
                .from('logi_evidences')
                .upsert({
                    id: toUUID(item.id),
                    project_id: projectId,
                    fecha: item.fecha || new Date().toISOString().split('T')[0],
                    item_code: item.itemCode || "",
                    description: item.descripcion || "",
                    image_url: publicUrl,
                    sync_id: item.id.toString()
                    // v2026-05-03: Quitamos created_at del upsert para evitar conflictos de RLS en columnas protegidas
                });

            if (dbError) {
                console.error("Supabase Bridge: Error de BASE DE DATOS:", dbError);
                throw new Error(`Error de Base de Datos (Table): ${dbError.message || dbError.details || 'Violación de RLS'}`);
            }

            console.log(`Supabase Bridge: Item ${item.id} sincronizado ✅`);

            if (typeof dbPut === 'function') {
                item.synced = true;
                item.needsSync = false;
                await dbPut(item);
            }

        } catch (error) {
            console.error("Supabase Bridge: Error en item", item.id, error);
            throw error; // Lanzar para que syncAll lo cuente
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

            // Filtrar items: deben tener el mismo projectId (CONTROL) y estar pendientes de sincronización
            const projectItems = items.filter(it => (activeId ? it.projectId === activeId : true) && (!it.synced || it.needsSync));

            if (projectItems.length === 0) {
                alert("No hay fotos en el proyecto activo para sincronizar.");
                if (btn) btn.classList.remove('syncing');
                return;
            }

            // FEEDBACK INICIAL
            alert(`🔍 Detectadas ${projectItems.length} fotos.\nIniciando subida acelerada (en lotes de 3).\n\nEste proceso puede tardar. Por favor, no cierres la app.`);
            console.log(`Supabase Bridge: Sincronizando ${projectItems.length} fotos en lotes...`);

            let success = 0;
            let errors = 0;
            let firstError = null;

            // v2026-05-03: Sincronización serial con pausas y reintento para máxima estabilidad en iPhone
            for (let i = 0; i < projectItems.length; i++) {
                const item = projectItems[i];
                let attempt = 0;
                let done = false;

                while (attempt < 2 && !done) {
                    try {
                        if (attempt > 0) {
                            console.log(`Reintentando item ${item.id} (intento ${attempt + 1})...`);
                            await new Promise(r => setTimeout(r, 2000)); // Esperar 2s antes de reintentar
                        }

                        await Promise.race([
                            uploadPhoto(item),
                            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout (30s)")), 30000))
                        ]);
                        
                        success++;
                        done = true;
                    } catch (err) {
                        attempt++;
                        if (attempt >= 2) {
                            console.error("Error definitivo subiendo item:", item.id, err);
                            if (!firstError) firstError = err;
                            errors++;
                        }
                    }
                }

                // Pausa de cortesía entre fotos para no saturar la radio del móvil
                if (i < projectItems.length - 1) {
                    await new Promise(r => setTimeout(r, 500));
                }
                
                if (success % 5 === 0) {
                    console.log(`Progreso: ${success}/${projectItems.length}`);
                }
            }

            if (errors > 0) {
                alert(`⚠️ Sincronización con errores.\n\nÉxito: ${success}\nErrores: ${errors}\n\nMotivo del primer error:\n${firstError?.message || JSON.stringify(firstError)}`);
            } else {
                alert(`✅ Sincronización terminada con éxito.\n\nTotal: ${success} fotos.`);
            }
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

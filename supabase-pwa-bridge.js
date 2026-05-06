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
            const fileName = `${projectId}/${item.id}.jpg`;
            let publicUrl = "";

            // 2. Subir al Storage (v2026-05-05: Con lógica de auto-retry para errores 502/transitorios)
            if (!item.synced) {
                let blob = item.blob;
                if (!blob && typeof dbGetBlob === 'function') {
                    blob = await dbGetBlob(item.id);
                }

                if (!blob) throw new Error("No hay imagen");

                const imageBlob = new Blob([blob], { type: 'image/jpeg' });
                console.log(`Supabase Bridge: Subiendo binario para ${item.id}...`);

                let storageData = null;
                let storageError = null;
                let attempts = 0;
                const MAX_ATTEMPTS = 3;

                while (attempts < MAX_ATTEMPTS) {
                    attempts++;
                    const { data, error } = await supabaseClient
                        .storage
                        .from('logi_evidences')
                        .upload(fileName, imageBlob, {
                            contentType: 'image/jpeg',
                            upsert: true
                        });

                    storageData = data;
                    storageError = error;

                    // v2026-05-05: Si no hay error, salimos del bucle
                    if (!storageError) break;

                    // Fallback: Si falla porque "ya existe" (a veces el upsert:true falla por RLS), intentamos .update() directamente
                    if (storageError.message?.includes('already exist') || storageError.error === 'Duplicate') {
                        console.log("Supabase Bridge: El recurso ya existe, intentando actualización directa (.update())...");
                        const { data: updateData, error: updateError } = await supabaseClient
                            .storage
                            .from('logi_evidences')
                            .update(fileName, imageBlob, {
                                contentType: 'image/jpeg'
                            });
                        storageData = updateData;
                        storageError = updateError;
                        if (!storageError) break;
                    }

                    // Si llegamos aquí y es el último intento, o es un error que no vale la pena reintentar (ej. Acceso Denegado), paramos
                    if (attempts >= MAX_ATTEMPTS) break;
                    
                    // Si es un error de red o servidor (como el 502), esperamos y reintentamos
                    console.warn(`Supabase Bridge: Error en intento ${attempts}/${MAX_ATTEMPTS}. Reintentando en 1.5s...`, storageError);
                    await new Promise(r => setTimeout(r, 1500));
                }

                if (storageError) {
                    console.error("Supabase Bridge: Error final de STORAGE:", storageError);
                    throw new Error(`Error de Almacenamiento (Storage): ${storageError.message || storageError.error_description || 'Acceso Denegado (Posible 502)'}`);
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

        try {
            if (btn) btn.classList.add('syncing');

            const items = await dbGetAll();
            const activeProject = (typeof getActiveProject === 'function') ? getActiveProject() : null;
            const activeId = activeProject ? activeProject.id : null;
            const activeName = activeProject ? activeProject.name : null;

            // Filtrar items: deben tener el mismo projectId (o nombre si es registro antiguo) y estar pendientes de sincronización
            const projectItems = items.filter(it => {
                const norm = (s) => (s || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
                const itName = norm(it.proyecto);
                const targetName = norm(activeName);
                const matchesProject = activeId ? (it.projectId === activeId || itName === targetName) : true;
                return matchesProject && (!it.synced || it.needsSync);
            });

            if (projectItems.length === 0) {
                const totalItems = items.length;
                const inProject = items.filter(it => {
                    const norm = (s) => (s || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
                    const itName = norm(it.proyecto);
                    const targetName = norm(activeName);
                    return activeId ? (it.projectId === activeId || itName === targetName) : true;
                }).length;
                const alreadySynced = items.filter(it => {
                    const norm = (s) => (s || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
                    const itName = norm(it.proyecto);
                    const targetName = norm(activeName);
                    const isProj = activeId ? (it.projectId === activeId || itName === targetName) : true;
                    return isProj && it.synced && !it.needsSync;
                }).length;

                alert(`No hay fotos pendientes de sincronización en este proyecto.\n\nResumen:\n- Fotos en este proyecto: ${inProject}\n- Ya sincronizadas: ${alreadySynced}\n- Pendientes: 0\n\nSi has editado descripciones, asegúrate de que el indicador de nube en la foto no esté verde.`);
                if (btn) btn.classList.remove('syncing');
                return;
            }

            // FEEDBACK INICIAL
            const logMsg = `🚀 INICIANDO TURBO-SYNC\n\n` +
                           `Proyecto Logi: ${activeName || 'Sin nombre'}\n` +
                           `ID Destino Cloud: ${projectId}\n` +
                           `Fotos a enviar: ${projectItems.length}\n\n` +
                           `Procesando en lotes de 4...`;
            
            console.log("Supabase Bridge: Iniciando sync detallado:", {
                logiProject: activeName,
                logiProjectId: activeId,
                cloudProjectId: projectId,
                itemsToSync: projectItems.length
            });

            alert(logMsg);

            let successCount = 0;
            let errorCount = 0;
            let firstError = null;

            const CHUNK_SIZE = 4;
            for (let i = 0; i < projectItems.length; i += CHUNK_SIZE) {
                const chunk = projectItems.slice(i, i + CHUNK_SIZE);
                
                // Ejecutar subidas del chunk en paralelo
                await Promise.all(chunk.map(async (it) => {
                    try {
                        // v2026-05-05: uploadPhoto es la función que hace el push real
                        await uploadPhoto(it);
                        successCount++;
                    } catch (err) {
                        errorCount++;
                        if (!firstError) firstError = err;
                        console.error(`Error en item ${it.id}:`, err);
                    }
                }));

                // Pequeña pausa para no saturar la radio del móvil
                await new Promise(r => setTimeout(r, 100));
            }

            if (errorCount > 0) {
                alert(`⚠️ Sincronización terminada con algunos errores.\n\nÉxito: ${successCount}\nErrores: ${errorCount}\n\nPrimer error: ${firstError?.message || 'Error desconocido'}`);
            } else {
                alert(`✅ TURBO-SYNC COMPLETADO\n\nSe han subido ${successCount} fotos exitosamente.`);
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

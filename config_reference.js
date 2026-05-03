const html = '<!DOCTYPE html>

<html class="dark" lang="es"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Logi - Configuraci√≥n</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700;900&amp;family=Inter:wght@300;400;500;600;700&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            colors: {
              "on-primary-container": "#4a5e00",
              "on-secondary-container": "#fff6f5",
              "on-background": "#f6f2fa",
              "surface-dim": "#0e0e13",
              "surface": "#0e0e13",
              "secondary": "#ff6f7c",
              "surface-bright": "#2b2b33",
              "surface-container-high": "#1f1f26",
              "primary-fixed": "#cafd00",
              "on-secondary-fixed": "#6f001b",
              "inverse-on-surface": "#55545a",
              "tertiary-fixed": "#00e3fd",
              "inverse-primary": "#516700",
              "tertiary-container": "#00e3fd",
              "on-primary-fixed-variant": "#526900",
              "on-error": "#450900",
              "inverse-surface": "#fbf8ff",
              "secondary-dim": "#e51245",
              "outline-variant": "#48474d",
              "on-tertiary-fixed-variant": "#005762",
              "error-container": "#b92902",
              "primary-container": "#cafd00",
              "surface-container-low": "#131318",
              "on-tertiary-fixed": "#003840",
              "on-secondary-fixed-variant": "#a4002d",
              "background": "#0e0e13",
              "surface-container": "#19191f",
              "outline": "#76747b",
              "surface-container-highest": "#25252c",
              "tertiary-dim": "#00d4ec",
              "primary-fixed-dim": "#beee00",
              "primary": "#f3ffca",
              "on-surface": "#f6f2fa",
              "on-primary-fixed": "#3a4a00",
              "primary-dim": "#beee00",
              "surface-tint": "#f3ffca",
              "secondary-fixed": "#ffc3c4",
              "on-tertiary": "#005762",
              "on-secondary": "#49000f",
              "on-tertiary-container": "#004d57",
              "secondary-fixed-dim": "#ffaeb2",
              "error-dim": "#d53d18",
              "surface-variant": "#25252c",
              "on-surface-variant": "#acaab1",
              "tertiary": "#81ecff",
              "tertiary-fixed-dim": "#00d4ec",
              "secondary-container": "#be0036",
              "on-error-container": "#ffd2c8",
              "on-primary": "#516700",
              "error": "#ff7351",
              "surface-container-lowest": "#000000"
            },
            fontFamily: {
              "headline": ["Space Grotesk"],
              "body": ["Inter"],
              "label": ["Inter"]
            },
            borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
          },
        },
      }
    </script>
<style>
        .material-symbols-outlined {
            font-variation-settings: \'FILL\' 0, \'wght\' 400, \'GRAD\' 0, \'opsz\' 24;
        }
        .glass-panel {
            background: rgba(25, 25, 31, 0.6);
            backdrop-filter: blur(25px);
            border-top: 1px solid rgba(243, 255, 202, 0.1);
            border-left: 1px solid rgba(243, 255, 202, 0.1);
        }
        .glow-accent {
            box-shadow: 0 0 20px rgba(202, 253, 0, 0.15);
        }
    </style>
<style>
    body {
      min-height: max(884px, 100dvh);
    }
  </style>
  </head>
<body class="bg-background text-on-surface font-body selection:bg-primary-container selection:text-on-primary-container">
<!-- TopAppBar -->
<header class="fixed top-0 w-full z-50 bg-[#0e0e13]/80 backdrop-blur-xl border-b border-[#f3ffca]/10 shadow-[0_4px_30px_rgba(0,0,0,0.1)] flex justify-between items-center px-6 h-16 w-full">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-[#cafd00]" data-icon="architecture">architecture</span>
<h1 class="font-[\'Space_Grotesk\'] font-black text-[#cafd00] tracking-tighter text-xl">LOGI</h1>
</div>
<div class="flex items-center gap-4">
<h2 class="font-[\'Space_Grotesk\'] font-bold tracking-tight text-lg text-[#cafd00]">Configuraci√≥n</h2>
<button class="material-symbols-outlined text-slate-400 hover:bg-[#f3ffca]/10 transition-colors p-2 rounded-full active:scale-95 duration-200" data-icon="close">close</button>
</div>
</header>
<main class="pt-24 pb-32 px-6 max-w-2xl mx-auto space-y-8">
<!-- Appearance Section -->
<section class="space-y-4">
<h3 class="font-headline font-bold text-sm uppercase tracking-[0.2em] text-on-surface-variant ml-2">Apariencia</h3>
<div class="glass-panel p-6 rounded-2xl space-y-8 shadow-2xl">
<!-- Tema Toggle -->
<div class="flex justify-between items-center">
<div>
<p class="font-headline font-semibold text-on-surface">Tema</p>
<p class="text-xs text-on-surface-variant">Cambia entre modo claro y oscuro</p>
</div>
<div class="flex bg-surface-container-low p-1 rounded-xl border border-outline-variant/20">
<button class="flex items-center gap-2 px-4 py-2 rounded-lg text-slate-400 transition-all">
<span class="material-symbols-outlined text-sm" data-icon="light_mode">light_mode</span>
</button>
<button class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-container text-on-primary-container font-bold shadow-lg transition-all">
<span class="material-symbols-outlined text-sm" data-icon="dark_mode">dark_mode</span>
</button>
</div>
</div>
<!-- Acento Color Circles -->
<div class="space-y-3">
<p class="font-headline font-semibold text-on-surface">Acento</p>
<div class="flex gap-4">
<button class="w-10 h-10 rounded-full bg-primary-fixed ring-2 ring-primary ring-offset-4 ring-offset-background transition-transform active:scale-90"></button>
<button class="w-10 h-10 rounded-full bg-tertiary-dim transition-transform active:scale-90"></button>
<button class="w-10 h-10 rounded-full bg-secondary-dim transition-transform active:scale-90"></button>
<button class="w-10 h-10 rounded-full bg-purple-500 transition-transform active:scale-90"></button>
<button class="w-10 h-10 rounded-full border-2 border-outline-variant transition-transform active:scale-90"></button>
</div>
</div>
<!-- Modo (Glow vs Glass) -->
<div class="grid grid-cols-2 gap-4">
<button class="flex flex-col items-center gap-3 p-4 rounded-xl border-2 border-primary-container bg-primary-container/10 transition-all">
<div class="w-full h-12 rounded-lg bg-primary-container/20 flex items-center justify-center glow-accent">
<span class="material-symbols-outlined text-primary-fixed" data-icon="blur_on">blur_on</span>
</div>
<span class="font-label text-xs font-bold uppercase tracking-widest text-primary-fixed">Glow</span>
</button>
<button class="flex flex-col items-center gap-3 p-4 rounded-xl border-2 border-outline-variant/30 hover:border-outline-variant transition-all">
<div class="w-full h-12 rounded-lg bg-white/5 backdrop-blur-md flex items-center justify-center">
<span class="material-symbols-outlined text-on-surface-variant" data-icon="layers">layers</span>
</div>
<span class="font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant">Glass</span>
</button>
</div>
</div>
</section>
<!-- Backups Section -->
<section class="space-y-4">
<h3 class="font-headline font-bold text-sm uppercase tracking-[0.2em] text-on-surface-variant ml-2">Respaldos y Datos</h3>
<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
<!-- Project Backup -->
<div class="glass-panel p-6 rounded-2xl group hover:bg-surface-container transition-all">
<div class="flex justify-between items-start mb-4">
<div class="w-10 h-10 rounded-xl bg-tertiary/10 flex items-center justify-center">
<span class="material-symbols-outlined text-tertiary" data-icon="cloud_upload">cloud_upload</span>
</div>
<span class="text-[10px] font-bold px-2 py-1 rounded bg-tertiary/20 text-tertiary">SEMANAL</span>
</div>
<h4 class="font-headline font-bold text-on-surface">Project Backup</h4>
<p class="text-xs text-on-surface-variant mt-1">Sincroniza solo las fotos del proyecto activo.</p>
<button class="mt-6 w-full py-3 rounded-xl bg-surface-container-high border border-outline-variant/20 font-bold text-sm hover:border-tertiary/50 transition-colors flex items-center justify-center gap-2">
<span class="material-symbols-outlined text-sm" data-icon="sync">sync</span>
                        Ejecutar ahora
                    </button>
</div>
<!-- Total Backup -->
<div class="glass-panel p-6 rounded-2xl group hover:bg-surface-container transition-all">
<div class="flex justify-between items-start mb-4">
<div class="w-10 h-10 rounded-xl bg-secondary/10 flex items-center justify-center">
<span class="material-symbols-outlined text-secondary" data-icon="database">database</span>
</div>
<span class="text-[10px] font-bold px-2 py-1 rounded bg-secondary/20 text-secondary">MANUAL</span>
</div>
<h4 class="font-headline font-bold text-on-surface">Total Backup</h4>
<p class="text-xs text-on-surface-variant mt-1">Exportaci√≥n completa de base de datos y logs.</p>
<button class="mt-6 w-full py-3 rounded-xl bg-surface-container-high border border-outline-variant/20 font-bold text-sm hover:border-secondary/50 transition-colors flex items-center justify-center gap-2">
<span class="material-symbols-outlined text-sm" data-icon="download">download</span>
                        Descargar .ZIP
                    </button>
</div>
</div>
</section>
<!-- Project Items & Formats -->
<section class="space-y-4">
<h3 class="font-headline font-bold text-sm uppercase tracking-[0.2em] text-on-surface-variant ml-2">Almacenamiento Local</h3>
<div class="glass-panel rounded-2xl overflow-hidden">
<!-- Item 1 -->
<div class="flex items-center justify-between p-4 hover:bg-white/5 transition-colors group">
<div class="flex items-center gap-4">
<div class="w-12 h-12 rounded-lg bg-surface-container-highest overflow-hidden relative">
<img class="w-full h-full object-cover opacity-60" data-alt="architectural blueprint on a wooden table with precision tools and focused warm lighting" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA9HY5jQfcAg80lk3AeGRpMARKIZhlpT9o3NUJB4H-FvIlBnK1WRTNQHjv-aAhl01-dbB7FGVfgjqH75Cqu2nrx88zi6GeGwXvt6jtLWtvVFJOouSC3hKpBQ7p2xvRIV-TpElc7hsbkpLvgLAUxCAodriMoI9cmArPj4HHqTCAnsP54jjlQ6ZqEYN5um2SvYmBq9hLOmnrUC6BvKoGKQO3_RMPYHDTTX44KVnpKBtmwTOyxnO_TWcLmu6-IDNRMhuzLpwHuiUsEtQ"/>
<div class="absolute inset-0 flex items-center justify-center">
<span class="material-symbols-outlined text-xs text-white" data-icon="image">image</span>
</div>
</div>
<div>
<p class="font-semibold text-sm text-on-surface">LOG_Norte_V2.raw</p>
<p class="text-[10px] uppercase tracking-tighter text-on-surface-variant">142 MB ‚?¢ 15/10/2023</p>
</div>
</div>
<div class="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
<button class="p-2 rounded-lg text-on-surface-variant hover:text-white hover:bg-white/10">
<span class="material-symbols-outlined text-xl" data-icon="visibility">visibility</span>
</button>
<button class="p-2 rounded-lg text-secondary hover:bg-secondary/10">
<span class="material-symbols-outlined text-xl" data-icon="delete">delete</span>
</button>
</div>
</div>
<!-- Item 2 -->
<div class="flex items-center justify-between p-4 hover:bg-white/5 transition-colors group border-t border-outline-variant/10">
<div class="flex items-center gap-4">
<div class="w-12 h-12 rounded-lg bg-surface-container-highest overflow-hidden relative">
<img class="w-full h-full object-cover opacity-60" data-alt="modern concrete building structure under construction with a clear blue sky background" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAfmVliuZMZBfTh20S9DoH1wJTEmT0QfwgtaasmxfpHVCumLTo0aPFV2DDvTojw3d7Rmvsdi9w_ND7j7dHLvQliQnBzBaW1MleW2hT9BDRvhpdGv8zODx7LXkYLBffM1dS-14XdJQ8_A-HmJDOzxu31qPcWYTjlwwBGDPSQ8B4aCd0NxGnw9UlXvbyPE5y4STuChGb5E5eZ2dhgCEp3u2gjdskX0p6gjMM55EQ0SseCBXqxDq0ogUGW4PTNP30oZNJDVcTQJBpXOw"/>
<div class="absolute inset-0 flex items-center justify-center">
<span class="material-symbols-outlined text-xs text-white" data-icon="description">description</span>
</div>
</div>
<div>
<p class="font-semibold text-sm text-on-surface">Cimentaci√≥n_Final.pdf</p>
<p class="text-[10px] uppercase tracking-tighter text-on-surface-variant">2.4 MB ‚?¢ 12/10/2023</p>
</div>
</div>
<div class="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
<button class="p-2 rounded-lg text-on-surface-variant hover:text-white hover:bg-white/10">
<span class="material-symbols-outlined text-xl" data-icon="visibility">visibility</span>
</button>
<button class="p-2 rounded-lg text-secondary hover:bg-secondary/10">
<span class="material-symbols-outlined text-xl" data-icon="delete">delete</span>
</button>
</div>
</div>
<!-- Footer List Action -->
<div class="p-4 bg-surface-container-high/50 text-center">
<button class="text-[10px] font-bold uppercase tracking-[0.2em] text-primary-fixed hover:text-primary transition-colors">Ver todos los archivos</button>
</div>
</div>
</section>
</main>
<!-- BottomNavBar -->
<nav class="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center pt-3 pb-6 px-4 bg-[#0e0e13]/90 backdrop-blur-2xl rounded-t-2xl border-t border-[#f3ffca]/10 shadow-[0_-8px_32px_rgba(0,0,0,0.4)]">
<a class="flex flex-col items-center justify-center text-slate-500 hover:text-[#f3ffca] transition-all active:translate-y-0.5 duration-150" href="#">
<span class="material-symbols-outlined mb-1" data-icon="photo_camera">photo_camera</span>
<span class="font-[\'Inter\'] font-bold text-[10px] tracking-[0.1em] uppercase">Captura</span>
</a>
<a class="flex flex-col items-center justify-center text-slate-500 hover:text-[#f3ffca] transition-all active:translate-y-0.5 duration-150" href="#">
<span class="material-symbols-outlined mb-1" data-icon="grid_view">grid_view</span>
<span class="font-[\'Inter\'] font-bold text-[10px] tracking-[0.1em] uppercase">Galer√≠a</span>
</a>
<a class="flex flex-col items-center justify-center text-slate-500 hover:text-[#f3ffca] transition-all active:translate-y-0.5 duration-150" href="#">
<span class="material-symbols-outlined mb-1" data-icon="ios_share">ios_share</span>
<span class="font-[\'Inter\'] font-bold text-[10px] tracking-[0.1em] uppercase">Exportar</span>
</a>
<a class="flex flex-col items-center justify-center text-[#cafd00] bg-[#cafd00]/10 rounded-xl px-3 py-1 transition-all active:translate-y-0.5 duration-150" href="#">
<span class="material-symbols-outlined mb-1" data-icon="description">description</span>
<span class="font-[\'Inter\'] font-bold text-[10px] tracking-[0.1em] uppercase">Informes</span>
</a>
</nav>
</body></html>
'

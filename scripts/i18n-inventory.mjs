// Extractor puntual para el inventario i18n. Uso: node scripts/i18n-inventory.mjs
// Recorre src/**/*.ts y extrae cadenas visibles para el usuario.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}


const ES_WORDS = ['el','la','los','las','del','al','una','unos','unas','este','esta','estos','estas','ese','esa','hay','son','está','están','será','puede','pueden','debe','haga','hacer','clic','pulse','pulsa','archivo','muestra','ruido','puerta','mezcla','tono','nota','notas','grabar','grabación','detener','cancelar','aceptar','cerrar','guardar','cargar','aviso','éxito','para','porque','como','pero','entre','cuando','donde','sobre','también','ningún','cada','todo','todos','aquí','ahora','después','antes','durante','medido','medida','puente','barrido','celda','celdas','cola','ataque','sostén','músico','teclado','batería','caja','ritmos','afinación','deriva','rescate','deslizar','soltar','arrastrar','mantén','elige','elige','selecciona','ajustes','prefijo','salida','entrada','dispositivo','permiso','permite','denegado','correctamente','verificada','instalado','listo','lista','falló','fallido','omitido','ruidoso','silencio','sonido','volumen','brillo','calidez','pegada','contundencia','aire','cuerpo','definición'];
const EN_WORDS = ['the','and','with','from','when','your','have','has','had','will','would','could','should','must','already','recorded','failed','please','before','after','press','click','stop','start','discarded','scheduled','cells','floor','release','samples','take','session','warning','success','loading','ready','active','inactive','available','unavailable','are','was','were','been','does','did','into','over','under','while','without','exported','saved','installed','desktop','valid','invalid','missing','found','created','deleted','updated','loaded','empty','large','small','black','white','brown','noise','hum','model','models','bank','banks','zone','zones','layer','layers','velocity','velocities','gate','mix','loop','loops','slice','slices','slicer','trim','export','import','drive','batch','health','grid','deck','panel','meter','monitor','rescue','offset','jitter','pilot','sweep','spike','smoke','latency','decay','sustain','tail','peak','denoise','enhance','master','chain','neural','neuron','classic','extended','region','regions','keyboard','drum','kit','hardware','synth','port','ports','channel','octave','curve','curves','manual','table','fixed','live','capture','captured','free','chopper','recorder','wizard','inspector','drawer','ribbon','strip','settings','config','telemetry','spectral','universal','process','triage','round','robin','detune','crossfade','keytrack','soundfont','preset','presets','factory','custom','preview','render','bypass','solo','mute','fade','gain','threshold','ratio','knee','blend','width','depth','rate','shape','drive','tone','color','clean','dirty','warm','bright','dark','vintage','modern','glue','punch','air','body','sample','samples','copyright','statement','creation','authoring','artist','genre','track','tracks','marker','markers','chunk','format','comment','comments','engineer','isrc','keyword','keywords','subject','location','source','software','tool','album','year','length','size','type','kind','version','status','state','mode','value','values','level','levels','range','count','index','number','name','names','title','date','time','stereo','mono','file','files','enabled','disabled','using','offline','online','during','processing','fallback','assistance','assistant','bridge','companion','position','placement','space','hall','studio','manufacturer','tuning','pitch','temperament','techniques','contact','creator','website','support','playing','instrument','make','set','category','output','reset','prompt','default','acoustic','description','diffusion','configured','storage','token','generated','successfully','generation','downloaded','cover','artwork','image','images','picture','photo','button','dialog','modal','menu','tab','tabs','page','home','back','next','previous','close','open','add','edit','delete','remove','clear','apply','confirm','cancel','done','save','load','retry','refresh','search','filter','sort','select','selected','new','none','token','tokens','key','keys','provider','endpoint','model','models','temperature','seed','steps','scale','guidance','strength','hugging','replicate','webhook','byok','cortes','manuales','preservados','conservados','generado','generada','generados','detectado','detectada','aplicado','aplicada','completado','completada','omitida','omitido','prev','cut','cuts','nudge','zoom','safety','margin','margins','milliseconds','seconds','minutes','hours','roll','snap','snaps','quantize','swing','groove','humanize','velocity','aftertouch','pitch','bend','modulation','chorus','reverb','delay','echo','flanger','phaser','distortion','overdrive','fuzz','compressor','limiter','gate','expander','filter','filters','resonance','cutoff','envelope','attack','decay','sustain','release','oscillator','sub','unison','detune','spread','octave','semitone','cent','cents','tune','tempo','metronome','count','count-in'];
const TECH_WORDS = ['midi','wav','mp3','flac','ogg','riff','cue','atem','dbfs','rms','db','ms','hz','khz','smp','bpm','cc','sysex','webmidi','getusermedia','worklet','vst','au','axionikdb','gemini','openai','webp','png','jpg','jpeg','svg','gif','ico','midi','wav','mp3','flac','ogg','take','takes','slot','slots','root','keybed','noteon','noteoff','sound','audio','video','ok','on','off','fx','eq','io','ui','db','id','url','api','abc','xyz'];
const CODE_TOKENS = ['===','!==','=>','&&','||','?.','const ','let ','var ','return ','Promise','ArrayBuffer','Record<','Map<','Set<','File[',': Promise',': void',': string',': number',': boolean','function ','=>','?.',');','};','else ','new ','for (','while (','new Array'];

function looksLikeCode(t) {
  if (/^#[0-9a-fA-F]{3,8}$/.test(t)) return true;
  if (/0x[0-9a-fA-F]+/.test(t)) return true;
  if (t.includes('//') || t.includes('`')) return true;
  if (/^\(\s/.test(t)) return true;
  if (/\?/.test(t) && /:/.test(t) && /[a-z][A-Z]/.test(t)) return true;
  if (t.includes('|') && /[()]/.test(t)) return true;
  if (/^[=),;.»·•\]—–]/.test(t)) return true;
  if (/[;,]\s/.test(t) && /[()=]/.test(t)) return true;
  return CODE_TOKENS.some((tok) => t.includes(tok));
}
function hasWord(list, s) { return list.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(s)); }

function langOf(s) {
  const hasEsDiac = /[áéíóúüñ¿¡]/i.test(s);
  const hasEs = hasEsDiac || hasWord(ES_WORDS, s);
  const hasEn = hasWord(EN_WORDS, s);
  if (hasEs && hasEn) return 'mixto';
  if (hasEs) return 'es';
  if (hasEn) return 'en';
  if (hasWord(TECH_WORDS, s)) return 'técnico/sin marcas';
  if (/^[A-Za-z0-9][A-Za-z0-9 _\-/().,%+°]*$/.test(s.trim()) && s.trim().split(/\s+/).length <= 3) return 'técnico/sin marcas';
  return 'sin determinar';
}

function lineOf(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

const rows = []; // {file, line, ctx, text}
function add(file, line, ctx, text) {
  let t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 2) return;
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(t)) return;
  if (/^[<>/_+=(){}\[\];:,.?¿!¡'"“”’`~@#$%^&*|\\-]+$/.test(t)) return;
  if (looksLikeCode(t)) return;
  // descarta fragmentos de código/URLs evidentes
  if (/^(https?:|www\.|data:|blob:)/.test(t)) return;
  if (/^[a-z0-9_-]+\.(ts|js|css|wav|json)$/i.test(t)) return;
  rows.push({ file, line, ctx, text: t });
}

for (const f of walk(SRC)) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  const src = readFileSync(f, 'utf8');
  // 1) toast('...') / confirmDialog('...') / notify
  for (const m of src.matchAll(/(?:toast|confirmDialog|notifyUser|announce)\(\s*(`|'|")/g)) {
    const q = m[1];
    let i = m.index + m[0].length, buf = '';
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { buf += c + (src[i + 1] ?? ''); i += 2; continue; }
      if (c === q) break;
      if (q === '`' && c === '$' && src[i + 1] === '{') {
        let d = i + 2, depth = 1;
        while (d < src.length && depth > 0) { if (src[d] === '{') depth++; else if (src[d] === '}') depth--; d++; }
        buf += src.slice(i, d); i = d; continue;
      }
      buf += c; i++;
    }
    if (i >= src.length) continue;
    // solo el primer argumento: cortar en coma de nivel 0 (plantillas) — aproximación: hasta el cierre
    add(rel, lineOf(src, m.index), m[0].startsWith('confirm') ? 'confirmDialog' : 'toast', buf.replace(/\\n/g, ' '));
  }
  // 2) texto entre etiquetas HTML: >texto<
  for (const m of src.matchAll(/>([^<>{}]{2,}?)</g)) {
    const t = m[1].replace(/\$\{[^}]*\}/g, '').trim();
    if (t.length >= 2) add(rel, lineOf(src, m.index), 'html', m[1].trim());
  }
  // 3) atributos title/aria/placeholder/alt
  for (const m of src.matchAll(/\b(title|aria-label|aria-description|placeholder|alt|data-tooltip)\s*=\s*"([^"]{2,})"/g)) {
    add(rel, lineOf(src, m.index), `attr:${m[1]}`, m[2]);
  }
  // 4) textContent / innerText
  for (const m of src.matchAll(/\.(?:textContent|innerText)\s*=\s*(`|'|")([^`'"]{1,300}?)\1/g)) {
    if (!m[2].includes('${')) add(rel, lineOf(src, m.index), 'textContent', m[2]);
    else add(rel, lineOf(src, m.index), 'textContent', m[2]);
  }
  // 5) props label:/text:/message:/caption:
  for (const m of src.matchAll(/\b(label|text|caption|message|hint|emptyText|confirmText|cancelText)\s*:\s*('([^']{2,200}?)'|"([^"]{2,200}?)")/g)) {
    add(rel, lineOf(src, m.index), `prop:${m[1]}`, m[3] ?? m[4] ?? '');
  }
}

// Deduplicar por fichero+texto, acumulando líneas
const seen = new Map();
for (const r of rows) {
  const k = r.file + '\u0000' + r.ctx + '\u0000' + r.text;
  if (seen.has(k)) seen.get(k).lines.push(r.line);
  else seen.set(k, { ...r, lines: [r.line] });
}
const uniq = [...seen.values()].sort((a, b) => a.file.localeCompare(b.file) || a.lines[0] - b.lines[0]);
for (const u of uniq) u.lang = langOf(u.text);

const byLang = {}, byCtx = {}, byFile = {};
for (const u of uniq) {
  byLang[u.lang] = (byLang[u.lang] || 0) + 1;
  byCtx[u.ctx] = (byCtx[u.ctx] || 0) + 1;
  byFile[u.file] = (byFile[u.file] || 0) + 1;
}
const withInterp = uniq.filter((u) => /\$\{/.test(u.text));

let md = `# Inventario de cadenas de texto para internacionalización (i18n)\n\n`;
md += `Proyecto: ABDNeuModMakr · Fecha: 2026-11-03 · Alcance: \`src/**/*.ts\` (se excluyen \`tests/\`, \`vendor/\` y \`.d.ts\`).\n\n`;
md += `Este documento es solo inventario. No propone implementación.\n\n`;
md += `## Cómo leer cada fila\n\n- **Cadena**: texto actual tal como aparece en el código (se conserva \`\${...}\` porque indica interpolación que la futura i18n deberá parametrizar con estilo ICU).\n- **Idioma**: detección heurística — \`es\` (tildes/ñ/¿¡ o vocabulario español), \`en\` (vocabulario inglés), \`mixto\` (ambos), \`sin determinar\` (etiqueta corta sin marcas de idioma, p. ej. "Gate", "Mix": probablemente préstamo inglés, a decidir término a término).\n- **Fichero / líneas**: dónde aparece (las líneas agregan todas las repeticiones idénticas en el mismo fichero y contexto).\n- **Contexto**: \`toast\`, \`confirmDialog\`, \`html\` (nodo de texto en plantilla), \`attr:title/aria-label/placeholder/alt\`, \`textContent\`, \`prop:label/text/...\`.\n\n`;
md += `## Resumen\n\n- Cadenas únicas inventariadas: **${uniq.length}** (repeticiones idénticas dentro del mismo fichero fusionadas).\n- Por idioma: ${Object.entries(byLang).map(([k, v]) => `\`${k}\`: ${v}`).join(' · ')}.\n- Por contexto: ${Object.entries(byCtx).map(([k, v]) => `\`${k}\`: ${v}`).join(' · ')}.\n- Con interpolaciones \`\${...}\` (requieren parámetros en i18n): **${withInterp.length}**.\n- Ficheros con más cadenas: ${Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `\`${k}\` (${v})`).join(', ')}.\n\n`;
md += `## Notas importantes para la futura i18n\n\n`;
md += `1. Ya existe un glosario centralizado parcial (src/ui/preflightGateView.ts:28): \`MUSICIAN_TERMS\` (usado en 8 ficheros de \`src/ui/\`). Es el candidato natural a primer catálogo de claves.\n`;
md += `2. Existe infraestructura i18n compartida sin usar aquí: \`vendor/@abdsynths/shared/Components/I18n/i18n.js\`. Decidir si se adopta o se crea catálogo propio.\n`;
md += `3. Las cadenas \`mixto\` (p. ej. "RTL: … ms · Peak: … dBFS · …") mezclan etiquetas inglesas con conectores españoles; al extraer claves habrá que normalizar el idioma base por cadena completa.\n`;
md += `4. Los toasts de diagnóstico con valores numéricos (\`toFixed\`) y unidades (ms, dBFS, smp) necesitan formato numérico por locale, no solo traducción.\n`;
md += `5. Las cadenas en \`DOCS/\` y comentarios de código NO se inventarían (no son UI); este inventario cubre solo texto visible en la aplicación.\n`;
md += `6. Limitaciones del extractor: heurística por regex sobre el fuente; puede haber falsos positivos (fragmentos de código con pinta de texto) y falsos negativos (cadenas construidas por concatenación o llegadas por parámetros). Revisar el fichero marcado como dudoso antes de convertirlo en clave.\n\n`;
md += `## Inventario por fichero\n\n`;
let cur = '';
for (const u of uniq) {
  if (u.file !== cur) { cur = u.file; md += `### \`${cur}\` (${byFile[cur]} cadenas)\n\n| Línea(s) | Contexto | Idioma | Cadena |\n|---|---|---|---|\n`; }
  const lines = u.lines.join(', ');
  let t = u.text;
  if (t.length > 280) t = t.slice(0, 280) + `… [+${u.text.length - 280} car.]`;
  t = t.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  md += `| ${lines} | ${u.ctx} | ${u.lang} | ${t} |\n`;
  // cierre de tabla: se añade una línea en blanco al cambiar de fichero (implícito por el siguiente encabezado)
}
md += `\n*Generado automáticamente con \`scripts/i18n-inventory.mjs\` (heurística).*\n`;

writeFileSync(join(ROOT, 'DOCS', 'I18N_STRING_INVENTORY.md'), md, 'utf8');
console.log('cadenas únicas:', uniq.length);
console.log('por idioma:', JSON.stringify(byLang));
console.log('con interpolación:', withInterp.length);

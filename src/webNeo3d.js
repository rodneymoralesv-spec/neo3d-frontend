/* =============================================================
   PUENTE CON LA PAGINA WEB

   La app corre en localhost, asi que el navegador puede escribir
   directo en la carpeta PAGINA WEB. Le das permiso UNA sola vez y
   queda guardado: despues cada pieza nueva se publica sola.

   Solo funciona en Chrome o Edge (Firefox no tiene esta capacidad).
   Si no esta disponible, cae al plan B: descarga un archivo .json
   y lo recoge SUBIR-A-LA-WEB.bat.
   ============================================================= */

const DB = "neo3d_web_bridge";
const STORE = "handles";
const KEY = "carpetaWeb";

export const soportaDirecto = () =>
  typeof window !== "undefined" && "showDirectoryPicker" in window;

// ── guardar el permiso de la carpeta entre sesiones ──────────
function abrirDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function guardarHandle(h) {
  const db = await abrirDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(h, KEY);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

async function leerHandle() {
  try {
    const db = await abrirDB();
    return await new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readonly");
      const q = tx.objectStore(STORE).get(KEY);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => rej(q.error);
    });
  } catch {
    return null;
  }
}

// ── permisos ─────────────────────────────────────────────────
async function conPermiso(handle, pedir) {
  if (!handle) return null;
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return handle;
  if (!pedir) return null;
  if ((await handle.requestPermission(opts)) === "granted") return handle;
  return null;
}

/** ¿Ya tenemos la carpeta conectada y con permiso vigente? */
export async function carpetaLista() {
  const h = await leerHandle();
  return !!(await conPermiso(h, false));
}

/** Pide la carpeta PAGINA WEB. Se hace una sola vez. */
export async function conectarCarpeta() {
  if (!soportaDirecto()) throw new Error("Tu navegador no permite esto. Usa Chrome o Edge.");
  const h = await window.showDirectoryPicker({ id: "neo3dWeb", mode: "readwrite" });
  // Comprobar que es la carpeta correcta antes de guardarla
  try {
    const js = await h.getDirectoryHandle("js");
    await js.getFileHandle("catalogo.js");
  } catch {
    throw new Error('Esa no es la carpeta. Elige "PAGINA WEB", la que tiene adentro index.html.');
  }
  if (!(await conPermiso(h, true))) throw new Error("No diste permiso de escritura.");
  await guardarHandle(h);
  return true;
}

/** Suelta la carpeta (por si eligio la equivocada). */
export async function olvidarCarpeta() {
  const db = await abrirDB();
  return new Promise((res) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = res;
    tx.onerror = res;
  });
}

// ── utilidades ───────────────────────────────────────────────
export const slugWeb = (s) =>
  String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "pieza";

const escapar = (s) =>
  String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ").trim();

/** Achica la foto a 1000 px y la pasa a JPEG, para que la web no pese. */
export const optimizarFoto = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onerror = () => reject(new Error("No pude leer la foto."));
  fr.onload = () => {
    const img = new Image();
    img.onerror = () => resolve(fr.result);
    img.onload = () => {
      const max = 1000;
      const esc = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * esc);
      cv.height = Math.round(img.height * esc);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      try { resolve(cv.toDataURL("image/jpeg", 0.82)); } catch { resolve(fr.result); }
    };
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
});

const dataUrlABlob = (d) => {
  const [cab, b64] = d.split("base64,");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: cab.match(/data:([^;]+)/)?.[1] || "image/jpeg" });
};

const escribir = async (dirHandle, nombre, contenido) => {
  const fh = await dirHandle.getFileHandle(nombre, { create: true });
  const w = await fh.createWritable();
  await w.write(contenido);
  await w.close();
};

function bloqueProducto(p) {
  let s = `  { id: "${p.id}", nombre: "${escapar(p.nombre)}", cat: "${p.cat}", precio: ${Number(p.precio)},`;
  if (p.esc) s += ` esc: "${p.esc}",`;
  s += `\n    tags: "${escapar(p.tags)}",`;
  s += `\n    desc: "${escapar(p.desc)}" },\n`;
  return s;
}

/**
 * Publica una pieza en la pagina web, escribiendo directo en la carpeta.
 * Devuelve { id, foto } o lanza un error con un mensaje entendible.
 */
export async function publicarEnWeb({ nombre, cat, esc, precio, desc, tags, fotoDataUrl }) {
  const raiz = await conPermiso(await leerHandle(), true);
  if (!raiz) throw new Error("La carpeta no esta conectada. Dale a 'Conectar carpeta'.");

  const jsDir = await raiz.getDirectoryHandle("js");
  const fh = await jsDir.getFileHandle("catalogo.js");
  const src = await (await fh.getFile()).text();

  // id unico
  const usados = new Set([...src.matchAll(/id:\s*"([^"]+)"/g)].map(m => m[1]));
  let id = slugWeb(nombre);
  if (usados.has(id)) {
    let n = 2;
    while (usados.has(`${id}-${n}`)) n++;
    id = `${id}-${n}`;
  }

  const corte = src.trimEnd().lastIndexOf("];");
  if (corte === -1) throw new Error("No entendi catalogo.js. Revisalo a mano.");

  const producto = {
    id, nombre, cat, esc, precio,
    tags: (tags || nombre).toLowerCase(),
    desc: desc || `${nombre}, impreso en 3D a pedido.`,
  };

  // primero la foto: si falla, no dejamos el catalogo a medias
  let fotoGuardada = null;
  if (fotoDataUrl) {
    const img = await raiz.getDirectoryHandle("img");
    const prod = await img.getDirectoryHandle("productos", { create: true });
    const ext = fotoDataUrl.includes("image/png") ? "png" : "jpg";
    await escribir(prod, `${id}.${ext}`, dataUrlABlob(fotoDataUrl));
    fotoGuardada = `img/productos/${id}.${ext}`;
  }

  await escribir(jsDir, "catalogo.js",
    src.slice(0, corte).trimEnd() + "\n\n" + bloqueProducto(producto) + "];\n");

  return { id, foto: fotoGuardada };
}

const API = "https://neo3d-backend.onrender.com";

/**
 * Deja la pieza guardada en el servidor para publicarla despues desde la PC.
 * Es el camino cuando cargas desde el celular: ahi el navegador no puede
 * escribir en la carpeta porque la carpeta no existe en el telefono.
 */
export async function enviarAlServidor({ nombre, cat, esc, precio, desc, tags, fotoDataUrl, gramos, horas }) {
  const r = await fetch(`${API}/web-pendientes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre, cat, esc, precio,
      descripcion: desc || "",
      tags: (tags || nombre).toLowerCase(),
      foto: fotoDataUrl || null,
      gramos: gramos ? Number(gramos) : null,
      horas: horas ? Number(horas) : null,
    }),
  });
  if (!r.ok) {
    throw new Error(
      r.status === 413
        ? "La foto pesa demasiado. Proba con otra."
        : "No pude guardar en el servidor. Revisa tu conexion."
    );
  }
  return r.json();
}

/** Plan B cuando el navegador no soporta escritura directa. */
export function descargarParaBat(p) {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `neo3d-web-${slugWeb(p.nombre)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

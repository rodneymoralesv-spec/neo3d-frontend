// Conexion con el backend. Todas las llamadas llevan la clave de la app en la
// cabecera x-clave; sin ella el servidor no entrega ni guarda nada.

// En produccion apunta a Render. Para probar contra otro servidor: REACT_APP_API_URL
export const API = process.env.REACT_APP_API_URL || "https://neo3d-backend.onrender.com";

const LLAVE = "neo3d_clave";

export const leerClave = () => { try { return localStorage.getItem(LLAVE) || ""; } catch { return ""; } };
export const guardarClave = (c) => { try { localStorage.setItem(LLAVE, c); } catch {} };
export const borrarClave = () => { try { localStorage.removeItem(LLAVE); } catch {} };

// Si el servidor rechaza la clave (se cambio en Render, o quedo mal guardada)
// se borra y la app vuelve a la pantalla de ingreso.
export async function apiFetch(ruta, opciones = {}) {
  const r = await fetch(API + ruta, {
    ...opciones,
    headers: { ...(opciones.headers || {}), "x-clave": leerClave() },
  });
  if (r.status === 401) {
    borrarClave();
    window.dispatchEvent(new Event("neo3d-sin-clave"));
  }
  return r;
}

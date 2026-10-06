import { useState, useEffect, useRef } from "react";
import {
  soportaDirecto, carpetaLista, conectarCarpeta, publicarEnWeb,
  enviarAlServidor, descargarParaBat, optimizarFoto, slugWeb,
} from "./webNeo3d";
import { API, apiFetch, leerClave, guardarClave, borrarClave } from "./servidor";

const DEFAULT_CFG = {
  precioPorGramo: 0.02,
  precioPorHora: 0.30,
  porcentajeGanancia: 0.30,
};

const STORAGE_VENTAS    = "neo3d_ventas_v4";
const STORAGE_GASTOS    = "neo3d_gastos_v4";
const STORAGE_CATALOGO  = "neo3d_catalogo_v4";

// ─── SEGUIMIENTO DE PEDIDOS ───────────────────────────────
const ESTADOS = [
  { id: "por_hacer", label: "Por hacer", color: "#fbbf24" },
  { id: "listo",     label: "Listo",     color: "#60a5fa" },
  { id: "entregado", label: "Entregado", color: "#00c4b4" },
];
const SIGUIENTE = { por_hacer: "listo", listo: "entregado" };
const estadoInfo = (id) => ESTADOS.find(e => e.id === id) || ESTADOS[2];

// Dias que faltan para la entrega (negativo = atrasada). null si no hay fecha.
const diasParaEntrega = (fechaEntrega) => {
  if (!fechaEntrega) return null;
  const f = new Date(fechaEntrega);  f.setHours(0, 0, 0, 0);
  const hoy = new Date();            hoy.setHours(0, 0, 0, 0);
  return Math.round((f - hoy) / 86400000);
};

// ISO del servidor -> "2026-09-25" para el <input type="date">
const aInputFecha = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// "2026-09-25" -> ISO al mediodia (evita que la zona horaria corra el dia)
const deInputFecha = (s) => (s ? new Date(s + "T12:00:00").toISOString() : null);

// Que parte del precio ya se cobro (0 a 1): pagado = todo; si no, lo abonado
const fraccionCobrada = (v) => (v.pagado ? 1 : Math.min(1, (v.abono || 0) / (v.precioTotal || 1)));

const fmt = (n = 0) =>
  Number(n).toLocaleString("es-EC", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

const mesLabel = (ym) =>
  new Date(ym + "-02").toLocaleDateString("es-EC", { month: "long", year: "numeric" });

const hoyYM = () => {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`;
};

// Deja solo una pieza por nombre (por si el catálogo trae duplicados viejos)
const dedupeCatalogo = (arr) => {
  const map = new Map();
  arr.forEach(p => {
    const key = p.nombre.trim().toLowerCase();
    const existente = map.get(key);
    if (!existente || p.id > existente.id) map.set(key, p);
  });
  return [...map.values()];
};

const calcPieza = ({ gramos, horas, manoDeObra }, cfg) => {
  const fil  = Number(gramos) * cfg.precioPorGramo;
  const hrs  = Number(horas)  * cfg.precioPorHora;
  const base = fil + hrs + Number(manoDeObra);
  const gan  = base * cfg.porcentajeGanancia;
  return { fil, hrs, base, gan, sugerido: base + gan };
};

const TABS = [
  { id: "calcular", icon: "⬡", label: "Calcular" },
  { id: "piezas",   icon: "▦", label: "Piezas"   },
  { id: "gastos",   icon: "↓", label: "Gastos"   },
  { id: "resumen",  icon: "◉", label: "Resumen"  },
  { id: "ajustes",  icon: "⚙", label: "Ajustes"  },
];

// ─── APP ──────────────────────────────────────────────────
// Sin clave guardada en este dispositivo solo se ve la pantalla de ingreso.
export default function App() {
  const [clave, setClave] = useState(leerClave);

  useEffect(() => {
    const salir = () => setClave("");
    window.addEventListener("neo3d-sin-clave", salir);
    return () => window.removeEventListener("neo3d-sin-clave", salir);
  }, []);

  if (!clave) return <Login onEntrar={c => { guardarClave(c); setClave(c); }} />;
  return <Panel onSalir={() => { borrarClave(); setClave(""); }} />;
}

function Login({ onEntrar }) {
  const [clave, setClave] = useState("");
  const [probando, setProbando] = useState(false);
  const [error, setError] = useState("");

  const entrar = async (e) => {
    e.preventDefault();
    if (!clave || probando) return;
    setProbando(true); setError("");
    try {
      const r = await fetch(API + "/config", { headers: { "x-clave": clave } });
      if (r.ok) return onEntrar(clave);
      setError(r.status === 401 ? "Clave incorrecta."
        : r.status === 503 ? "El servidor todavía no tiene clave configurada (APP_PASSWORD en Render)."
        : "El servidor respondió con un error. Probá de nuevo.");
    } catch {
      setError("No pude conectarme. Si el servidor estaba dormido, esperá medio minuto y probá de nuevo.");
    }
    setProbando(false);
  };

  return (
    <div style={S.root}>
      <form onSubmit={entrar} style={{ ...S.card, margin: "18vh 14px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={S.headerIcon}>⬡</span>
          <div>
            <div style={S.headerTitle}>Neo3D</div>
            <div style={S.headerSub}>Ingresá tu clave para continuar</div>
          </div>
        </div>
        <input style={S.input} type="password" autoFocus autoComplete="current-password"
          value={clave} onChange={e => setClave(e.target.value)} placeholder="Clave" />
        {error && <div style={S.webError}>{error}</div>}
        <button style={{ ...S.btn, ...(!clave || probando ? S.btnOff : {}) }} disabled={!clave || probando}>
          {probando ? "Entrando… (si el servidor dormía tarda unos segundos)" : "Entrar"}
        </button>
      </form>
    </div>
  );
}

function Panel({ onSalir }) {
  const [tab, setTab] = useState("calcular");

  const [ventas, setVentas] = useState([]);

  const [gastos, setGastos] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_GASTOS)) || []; } catch { return []; }
  });
  const [catalogo, setCatalogo] = useState([]);
  const [cfg, setCfg] = useState(DEFAULT_CFG);

 useEffect(() => {
  apiFetch("/gastos")
    .then(res => res.json())
    .then(data => setGastos(data))
    .catch(err => console.log(err));
}, []);

useEffect(() => {
  apiFetch("/config")
    .then(res => res.json())
    .then(data => {
      if (data && data.precioPorGramo != null) {
        setCfg({
          precioPorGramo: Number(data.precioPorGramo),
          precioPorHora: Number(data.precioPorHora),
          porcentajeGanancia: Number(data.porcentajeGanancia),
        });
      }
    })
    .catch(err => console.log(err));
}, []);

const guardarConfig = (nuevoCfg) => {
  apiFetch("/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    // porcentajeRodney queda en 1: el negocio ya no se reparte con nadie
    body: JSON.stringify({ ...nuevoCfg, porcentajeRodney: 1 }),
  })
    .then(() => setCfg(nuevoCfg))
    .catch(err => console.log(err));
};

  
  const fetchVentas = () => {
  apiFetch("/ventas")
    .then(res => res.json())
    .then(data => {
  const limpio = data.map(v => ({
    ...v,
    precioTotal: Number(v.precioTotal),
    precioUnit: Number(v.precioUnit),
    gramos: Number(v.gramos),
    horas: Number(v.horas),
    manoDeObra: Number(v.manoDeObra),
    cantidad: Number(v.cantidad),
    abono: Number(v.abono) || 0,
    estado: v.estado || "entregado",
    fechaEntrega: v.fechaEntrega || null,
  }));
  setVentas(limpio);
})
    .catch(err => console.log(err));
};

useEffect(() => {
  fetchVentas();
}, []);

useEffect(() => {
  fetchCatalogo();
}, []);

// Cambia lo que haga falta de una venta: { estado }, { fechaEntrega }, { abono } o { pagado }
const actualizarVenta = (id, campos) => {
  apiFetch(`/ventas/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(campos),
  })
    .then(() => fetchVentas())
    .catch(err => console.log(err));
};

const marcarPago = (id, estadoActual) => actualizarVenta(id, { pagado: !estadoActual });


const fetchCatalogo = () => {
  apiFetch("/catalogo")
    .then(res => res.json())
    .then(data => setCatalogo(dedupeCatalogo(data)))
    .catch(err => console.log(err));
};

const eliminarVenta = (id) => {
  if (!window.confirm("¿Eliminar esta venta? No se puede deshacer.")) return;

  apiFetch(`/ventas/${id}`, {
    method: "DELETE",
  })
    .then(() => fetchVentas())
    .catch(err => console.log(err));
};

const eliminarGasto = (id) => {
  if (!window.confirm("¿Eliminar este gasto? No se puede deshacer.")) return;

  apiFetch(`/gastos/${id}`, {
    method: "DELETE",
  })
    .then(() => {
      // 🔥 volver a cargar desde backend
      apiFetch("/gastos")
        .then(res => res.json())
        .then(data => setGastos(data));
    })
    .catch(err => console.log(err));
};

  // Guarda o actualiza una pieza en el catálogo
  
const guardarEnCatalogo = (pieza) => {
  apiFetch("/catalogo", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(pieza),
  })
    .then(res => res.text())
    .then(() => {
      fetchCatalogo(); // 🔥 recarga desde backend
    })
    .catch(err => console.log(err));
};


  const eliminarDeCatalogo = (id) => {
    if (!window.confirm("¿Eliminar esta pieza del catálogo?")) return;

    apiFetch(`/catalogo/${id}`, {
      method: "DELETE",
    })
      .then(() => fetchCatalogo())
      .catch(err => console.log(err));
  };

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.headerIcon}>⬡</span>
        <div>
          <div style={S.headerTitle}>Neo3D</div>
          <div style={S.headerSub}>Impresión 3D</div>
        </div>
        <button style={{ ...S.btnX, marginLeft: "auto", fontSize: 12 }} onClick={onSalir}>Salir</button>
      </div>

      <main style={S.main}>
        {tab === "calcular" && (
          <TabCalcular
  setVentas={setVentas}
  catalogo={catalogo}
  guardarEnCatalogo={guardarEnCatalogo}
  eliminarDeCatalogo={eliminarDeCatalogo}
  fetchVentas={fetchVentas}
  cfg={cfg}
/>
        )}
        {tab === "piezas"  && <TabPiezas ventas={ventas} marcarPago={marcarPago} eliminarVenta={eliminarVenta} actualizarVenta={actualizarVenta} cfg={cfg} />}
        {tab === "gastos"  && <TabGastos gastos={gastos} setGastos={setGastos} eliminarGasto={eliminarGasto} />}
        {tab === "resumen" && <TabResumen ventas={ventas} gastos={gastos} cfg={cfg} />}
        {tab === "ajustes" && <TabAjustes cfg={cfg} guardarConfig={guardarConfig} />}
      </main>

      <nav style={S.bottomNav}>
        {TABS.map(t => (
          <button key={t.id} style={{ ...S.navBtn, ...(tab === t.id ? S.navActive : {}) }} onClick={() => setTab(t.id)}>
            <span style={S.navIcon}>{t.icon}</span>
            <span style={S.navLabel}>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── TAB CALCULAR ─────────────────────────────────────────
function TabCalcular({ setVentas, catalogo, guardarEnCatalogo, eliminarDeCatalogo, fetchVentas, cfg }) {
  const empty = {
  nombre: "",
  cliente: "",
  gramos: "",
  horas: "",
  manoDeObra: "",
  cantidad: "1",
  precioManual: "",
  fecha: new Date().toISOString().split("T")[0],
  fechaEntrega: "",
  abono: "",
  estado: "por_hacer"
};
  const [form, setForm]         = useState(empty);
  const [ok,   setOk]           = useState(false);
  const [sugerencias, setSugs]  = useState([]);   // lista filtrada del catálogo
  const [mostrarSugs, setMostrarSugs] = useState(false);
  const [esDelCatalogo, setEsDelCatalogo] = useState(false); // si el form vino de catálogo
  const inputRef = useRef(null);

  // Filtra sugerencias cuando cambia el nombre
  const handleNombre = (e) => {
    const val = e.target.value;
    setForm(p => ({ ...p, nombre: val }));
    setEsDelCatalogo(false);

    if (val.length > 0) {
      const filtradas = catalogo.filter(p =>
        p.nombre.toLowerCase().includes(val.toLowerCase())
      );
      setSugs(filtradas);
      setMostrarSugs(filtradas.length > 0);
    } else {
      setSugs([]);
      setMostrarSugs(false);
    }
  };

  // Al seleccionar del catálogo, autocompleta
  const seleccionarSugerencia = (pieza) => {
    setForm(p => ({
      ...p,
      nombre:     pieza.nombre,
      gramos:     String(pieza.gramos),
      horas:      String(pieza.horas),
      manoDeObra: String(pieza.manoDeObra),
    }));
    setSugs([]);
    setMostrarSugs(false);
    setEsDelCatalogo(true);
  };

  const ch = (e) => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const valid = form.gramos && form.horas && form.manoDeObra;
  const calc  = valid ? calcPieza(form, cfg) : null;
  const cant  = Math.max(1, Number(form.cantidad) || 1);
  const precioUnit  = calc ? (Number(form.precioManual) > 0 ? Number(form.precioManual) : calc.sugerido) : 0;
  const precioTotal = precioUnit * cant;
  // El abono nunca puede pasar del precio; si lo cubre entero, queda como pagado
  const abonoNum = Math.min(Math.max(Number(form.abono) || 0, 0), precioTotal);

  const guardar = () => {
  if (!valid) return;

  const nombre = form.nombre || "Pieza sin nombre";

  guardarEnCatalogo({
    nombre,
    gramos: Number(form.gramos),
    horas: Number(form.horas),
    manoDeObra: Number(form.manoDeObra),
  });

  apiFetch("/ventas", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache"
  },
  body: JSON.stringify({
    nombre,
    cliente: form.cliente || "",
    gramos: Number(form.gramos),
    horas: Number(form.horas),
    manoDeObra: Number(form.manoDeObra),
    cantidad: cant,
    precioUnit,
    precioTotal,
    ajustado: Number(form.precioManual) > 0,
    pagado: precioTotal > 0 && abonoNum >= precioTotal - 0.005,
    abono: abonoNum,
    estado: form.estado,
    fechaEntrega: deInputFecha(form.fechaEntrega),
    fecha: new Date(form.fecha + "T12:00:00").toISOString(),
  }),
})
  .then(res => {
    console.log("STATUS:", res.status);
    return res.text();
  })
  .then(data => {
    console.log("Guardado:", data);
  fetchVentas();
  })
  .catch(err => console.log("ERROR:", err));

  setForm({
  ...empty,
  fecha: new Date().toISOString().split("T")[0]
});
  setEsDelCatalogo(false);
  setOk(true);
  setTimeout(() => setOk(false), 2200);
};

  // Detecta si hay cambios respecto al catálogo (para ofrecer actualizar)
  const piezaCatalogo = catalogo.find(p => p.nombre.toLowerCase() === form.nombre.toLowerCase());
  const hayDiferencia = piezaCatalogo && valid && (
    Number(form.gramos)     !== piezaCatalogo.gramos ||
    Number(form.horas)      !== piezaCatalogo.horas  ||
    Number(form.manoDeObra) !== piezaCatalogo.manoDeObra
  );

  return (
    <div style={S.section}>
      <SectionHeader title="Nueva pieza" sub="Escribí el nombre y se autocompleta si ya existe" />

      <div style={S.card}>

        {/* Nombre con autocompletado */}
        <div style={{ position: "relative" }}>
          <Field label="Nombre de la pieza">
            <input
              ref={inputRef}
              style={S.input}
              name="nombre"
              value={form.nombre}
              onChange={handleNombre}
              onFocus={() => sugerencias.length > 0 && setMostrarSugs(true)}
              onBlur={() => setTimeout(() => setMostrarSugs(false), 150)}
              placeholder="Ej: Soporte, Llavero, Figura..."
              autoComplete="off"
            />
          </Field>

          {/* Dropdown de sugerencias */}
          {mostrarSugs && (
            <div style={S.dropdown}>
              {sugerencias.map(p => (
                <div key={p.nombre} style={S.dropItem} onMouseDown={() => seleccionarSugerencia(p)}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{p.nombre}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>
                    {p.gramos}g · {p.horas}h · MO {fmt(p.manoDeObra)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Badge "autocomplete aplicado" */}
        {esDelCatalogo && !hayDiferencia && (
          <div style={S.autocompleteBadge}>
            ✓ Datos del catálogo aplicados — solo ajustá las unidades
          </div>
        )}

        {/* Alerta de diferencia con catálogo */}
        {hayDiferencia && (
          <div style={S.diffBadge}>
            ⚠ Cambiaste los datos respecto al catálogo. Al guardar se actualizará.
          </div>
        )}

        {/* Cliente */}
        <Field label="Cliente">
          <input style={S.input} name="cliente" value={form.cliente} onChange={ch} placeholder="Nombre del cliente" />
        </Field>

        <div style={S.row2}>
          <Field label="Fecha del pedido">
            <input type="date" name="fecha" value={form.fecha} onChange={ch} style={{ ...S.input, ...S.inputFecha }} />
          </Field>
          <Field label="Entregar el" hint="opcional">
            <input type="date" name="fechaEntrega" value={form.fechaEntrega} onChange={ch} style={{ ...S.input, ...S.inputFecha }} />
          </Field>
        </div>

        {/* Gramos, horas, mano de obra */}
        <div style={S.row3}>
          <Field label="Gramos" hint={`$${cfg.precioPorGramo}/g`}>
            <input style={S.input} type="number" name="gramos" value={form.gramos} onChange={ch} placeholder="0" min="0" />
          </Field>
          <Field label="Horas" hint={`$${cfg.precioPorHora}/h`}>
            <input style={S.input} type="number" name="horas" value={form.horas} onChange={ch} placeholder="0" min="0" step="0.5" />
          </Field>
          <Field label="Mano obra" hint="USD">
            <input style={S.input} type="number" name="manoDeObra" value={form.manoDeObra} onChange={ch} placeholder="0.00" min="0" step="0.01" />
          </Field>
        </div>

        {/* Unidades y precio ajustado */}
        <div style={S.row2}>
          <Field label="Unidades">
            <input style={{ ...S.input, ...S.inputDestacado }} type="number" name="cantidad" value={form.cantidad} onChange={ch} placeholder="1" min="1" step="1" />
          </Field>
          <Field label="Precio ajustado" hint="opcional">
            <input style={{ ...S.input, ...(form.precioManual ? { borderColor: C.accent } : {}) }}
              type="number" name="precioManual" value={form.precioManual} onChange={ch}
              placeholder={calc ? fmt(calc.sugerido) : "0.00"} min="0" step="0.50" />
          </Field>
        </div>

        {/* Abono recibido y estado del pedido */}
        <div style={S.row2}>
          <Field label="Abono recibido" hint={abonoNum > 0 && precioTotal > 0 ? `${Math.round(abonoNum / precioTotal * 100)}%` : "USD"}>
            <input style={S.input} type="number" name="abono" value={form.abono} onChange={ch} placeholder="0.00" min="0" step="0.50" />
          </Field>
          <Field label="Estado">
            <select style={{ ...S.input, ...S.inputFecha }} name="estado" value={form.estado} onChange={ch}>
              {ESTADOS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </Field>
        </div>

        {/* Preview */}
        {calc && (
          <div style={S.preview}>
            <div style={S.previewTitle}>Desglose por unidad</div>
            <Row label={`Filamento (${form.gramos}g)`} val={fmt(calc.fil)} />
            <Row label={`Horas (${form.horas}h)`}      val={fmt(calc.hrs)} />
            <Row label="Mano de obra"                   val={fmt(Number(form.manoDeObra))} />
            <div style={S.divider} />
            <Row label="Subtotal"        val={fmt(calc.base)} bold />
            <Row label={`Ganancia ${Math.round(cfg.porcentajeGanancia * 100)}%`} val={`+${fmt(calc.gan)}`} teal />
            <Row label="Precio sugerido" val={fmt(calc.sugerido)} bold />

            {Number(form.precioManual) > 0 && (
              <div style={S.ajusteBadge}>
                Precio ajustado: <strong>{fmt(precioUnit)}</strong>
                {precioUnit > calc.sugerido
                  ? <span style={{ color: C.teal }}> ▲ +{fmt(precioUnit - calc.sugerido)}</span>
                  : <span style={{ color: "#f87171" }}> ▼ {fmt(precioUnit - calc.sugerido)}</span>}
              </div>
            )}

            {cant > 1 && (
              <div style={S.multiBadge}>
                {cant} uds × {fmt(precioUnit)} = <strong>{fmt(precioTotal)}</strong>
              </div>
            )}

            <div style={S.precioBig}>
              <span style={{ fontSize: 12, opacity: 0.85 }}>TOTAL A COBRAR</span>
              <span style={S.precioBigNum}>{fmt(precioTotal)}</span>
            </div>
          </div>
        )}

        <button style={{ ...S.btn, ...(!valid ? S.btnOff : {}) }} onClick={guardar} disabled={!valid}>
          {ok ? "✓ ¡Venta registrada!" : "Registrar venta"}
        </button>

        {/* Pieza nueva (el nombre no esta en el catalogo): ofrecer publicarla */}
        {valid && form.nombre.trim() && !piezaCatalogo && (
          <PublicarEnWeb nombre={form.nombre.trim()} precioSugerido={precioUnit}
            gramos={form.gramos} horas={form.horas} />
        )}
      </div>

      {/* Catálogo guardado */}
      {catalogo.length > 0 && (
        <div style={S.section}>
          <SectionHeader title="Catálogo" sub="Tus piezas guardadas — tocá para cargar" />
          {catalogo.map(p => (
            <div key={p.nombre} style={S.catalogoCard}>
              <div style={{ flex: 1, cursor: "pointer" }} onClick={() => seleccionarSugerencia(p)}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{p.nombre}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                  {p.gramos}g · {p.horas}h · MO {fmt(p.manoDeObra)}
                  <span style={{ marginLeft: 8, color: C.teal, fontWeight: 600 }}>
                    → {fmt(calcPieza(p, cfg).sugerido)}
                  </span>
                </div>
              </div>
              <button style={S.btnX} onClick={() => eliminarDeCatalogo(p.id)} title="Eliminar del catálogo">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Tarifas */}
      <div style={S.row3}>
        {[["⬡",`$${cfg.precioPorGramo}`,"por gramo"],["◷",`$${cfg.precioPorHora}`,"por hora"],["◈",`${Math.round(cfg.porcentajeGanancia * 100)}%`,"ganancia"]].map(([ic,v,l]) => (
          <div key={l} style={S.chipCard}>
            <span style={{ fontSize: 18, color: C.accent }}>{ic}</span>
            <span style={{ fontWeight: 800, fontSize: 15 }}>{v}</span>
            <span style={{ fontSize: 10, color: C.muted }}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PUBLICAR EN LA PAGINA WEB ────────────────────────────
// Sale solo cuando la pieza es NUEVA. Escribe directo en la carpeta
// PAGINA WEB: no hay que volver a escribir gramos, horas ni precio.
const CATS_WEB = [
  ["personalizados", "Personalizados"],
  ["gamer",          "Gamer y figuras"],
  ["llaveros",       "Llaveros"],
  ["hogar",          "Hogar y deco"],
  ["piezas",         "Piezas y repuestos"],
  ["empresas",       "Para empresas"],
];

const ESCALAS_WEB = [
  ["llavero", "Muchas por placa (tipo llavero)"],
  ["media",   "Unas 6 o 7 (tipo soporte de celular)"],
  ["grande",  "Una sola (jarro, figura, soporte de control)"],
  ["",        "Sin mayoreo, precio fijo"],
];

function PublicarEnWeb({ nombre, precioSugerido, gramos, horas }) {
  const [abierto,  setAbierto]  = useState(false);
  const [conectada, setConectada] = useState(false);
  const [cat,   setCat]   = useState("personalizados");
  const [esc,   setEsc]   = useState("grande");
  const [desc,  setDesc]  = useState("");
  const [tags,  setTags]  = useState("");
  const [precio, setPrecio] = useState("");
  const [foto,  setFoto]  = useState(null);
  const [estado, setEstado] = useState("");   // "", "cargando", "guardando", "ok"
  const [error,  setError]  = useState("");
  const [hecho,  setHecho]  = useState(null);

  useEffect(() => { carpetaLista().then(setConectada); }, [abierto]);

  const conectar = async () => {
    setError("");
    try {
      await conectarCarpeta();
      setConectada(true);
    } catch (e) {
      setError(e.message);
    }
  };

  const tomarFoto = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setEstado("cargando"); setError("");
    try { setFoto(await optimizarFoto(f)); }
    catch (err) { setError(err.message); }
    setEstado("");
  };

  const datosPieza = () => ({
    nombre, cat, esc, desc: desc.trim(), tags: tags.trim(),
    precio: Number(Number(Number(precio) > 0 ? Number(precio) : precioSugerido).toFixed(2)),
    fotoDataUrl: foto, gramos, horas,
  });

  // Si la carpeta esta conectada (estas en la PC) escribe directo.
  // Si no (estas en el celular) la deja en el servidor para recogerla despues.
  const publicar = async () => {
    setEstado("guardando"); setError("");
    try {
      if (conectada) {
        const r = await publicarEnWeb(datosPieza());
        setHecho({ ...r, via: "carpeta" });
      } else {
        await enviarAlServidor(datosPieza());
        setHecho({ id: slugWeb(nombre), via: "servidor" });
      }
      setEstado("ok");
    } catch (err) {
      setError(err.message);
      setEstado("");
    }
  };

  const planB = () => {
    descargarParaBat({ ...datosPieza(), foto });
    setHecho({ id: slugWeb(nombre), via: "archivo" });
    setEstado("ok");
  };

  const cerrar = () => {
    setAbierto(false); setEstado(""); setHecho(null);
    setFoto(null); setDesc(""); setTags(""); setPrecio(""); setError("");
  };

  if (!abierto) {
    return (
      <button style={S.btnWeb} onClick={() => setAbierto(true)}>
        🌐 Esta pieza es nueva — publicarla en la página web
      </button>
    );
  }

  if (estado === "ok") {
    return (
      <div style={S.webOk}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>
          {hecho?.via === "servidor" ? "✓ Guardada" : "✓ Publicada"}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>
          {hecho?.via === "archivo" &&
            <>Se descargó el archivo. Ahora doble clic en <strong>SUBIR-A-LA-WEB.bat</strong> en la carpeta PAGINA WEB.</>}
          {hecho?.via === "servidor" &&
            <>Quedó guardada en el servidor con su foto. Cuando estés en la computadora,
              doble clic en <strong>SUBIR-A-LA-WEB.bat</strong> y se publica sola.</>}
          {hecho?.via === "carpeta" &&
            <>Ya quedó en el catálogo{hecho?.foto ? " con su foto" : " (sin foto)"}. Para que se vea en internet,
              corré <strong>armar_paquete.py</strong> y subí el zip a Netlify.</>}
        </div>
        <button style={{ ...S.btnX, marginTop: 10, color: C.teal }} onClick={cerrar}>Cerrar</button>
      </div>
    );
  }

  return (
    <div style={S.webBox}>
      <div style={S.previewTitle}>Publicar "{nombre}"</div>

      {!conectada && (
        <div style={S.webAviso}>
          <div style={{ fontSize: 12, lineHeight: 1.55, marginBottom: soportaDirecto() ? 8 : 0 }}>
            {soportaDirecto()
              ? <>Estás en la computadora. Conectá la carpeta <strong>PAGINA WEB</strong> una
                 sola vez y desde ahí se publica al instante. Si no la conectás, la pieza se
                 guarda en el servidor y la publicás después.</>
              : <>Se va a guardar en el servidor con su foto. Cuando estés en la computadora,
                 doble clic en <strong>SUBIR-A-LA-WEB.bat</strong> y se publica sola.</>}
          </div>
          {soportaDirecto() && (
            <button style={S.btnWeb} onClick={conectar}>📁 Conectar carpeta PAGINA WEB</button>
          )}
        </div>
      )}

      <div style={S.row2}>
        <Field label="Categoría">
          <select style={S.input} value={cat} onChange={e => setCat(e.target.value)}>
            {CATS_WEB.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Precio público" hint={fmt(precioSugerido)}>
          <input style={S.input} type="number" value={precio} min="0" step="0.50"
            onChange={e => setPrecio(e.target.value)} placeholder={precioSugerido.toFixed(2)} />
        </Field>
      </div>

      <Field label="Cuántas entran en una placa" hint="define el mayoreo">
        <select style={S.input} value={esc} onChange={e => setEsc(e.target.value)}>
          {ESCALAS_WEB.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>

      <Field label="Descripción corta">
        <input style={S.input} value={desc} onChange={e => setDesc(e.target.value)}
          placeholder="Una o dos frases, como se lo contarías a un cliente" />
      </Field>

      <Field label="Palabras de búsqueda" hint="separadas por espacio">
        <input style={S.input} value={tags} onChange={e => setTags(e.target.value)}
          placeholder="ej: gato mascota regalo llavero" />
      </Field>

      <Field label="Foto de la pieza">
        <input style={{ ...S.input, padding: 8 }} type="file" accept="image/*" onChange={tomarFoto} />
      </Field>

      {estado === "cargando" && <div style={{ fontSize: 12, color: C.muted }}>Procesando la foto…</div>}
      {foto && <img src={foto} alt="" style={{ width: "100%", borderRadius: 10,
        border: `1px solid ${C.border}`, maxHeight: 220, objectFit: "cover" }} />}

      {error && <div style={S.webError}>{error}</div>}

      <button
        style={{ ...S.btn, ...(!foto || estado === "guardando" ? S.btnOff : {}) }}
        onClick={publicar}
        disabled={!foto || estado === "guardando"}>
        {estado === "guardando" ? "Guardando…"
          : !foto ? "Falta la foto"
          : conectada ? "Publicar en la web"
          : "Guardar para publicar desde la PC"}
      </button>

      {!conectada && foto && soportaDirecto() && (
        <button style={S.btnWeb} onClick={planB}>
          O descargar el archivo y usar SUBIR-A-LA-WEB.bat
        </button>
      )}
      <button style={S.btnX} onClick={cerrar}>Cancelar</button>
    </div>
  );
}

// ─── TAB PIEZAS ───────────────────────────────────────────
function TabPiezas({ ventas, marcarPago, eliminarVenta, actualizarVenta, cfg }) {
  // Si hay pedidos por hacer se abre en ellos; si no, en todas
  const [filtro, setFiltro] = useState(() => ventas.some(v => v.estado === "por_hacer") ? "por_hacer" : "todas");

  const cumple = {
    todas:      () => true,
    por_hacer:  v => v.estado === "por_hacer",
    listas:     v => v.estado === "listo",
    por_cobrar: v => !v.pagado,
    entregadas: v => v.estado === "entregado",
  };

  let lista = ventas.filter(cumple[filtro]);
  // En "por hacer" y "listas" van primero las que se entregan antes
  if (filtro === "por_hacer" || filtro === "listas") {
    const clave = v => (v.fechaEntrega ? new Date(v.fechaEntrega).getTime() : Infinity);
    lista = [...lista].sort((a, b) => { const x = clave(a), y = clave(b); return x === y ? 0 : x < y ? -1 : 1; });
  }

  const porHacer  = ventas.filter(v => v.estado === "por_hacer").length;
  const listas    = ventas.filter(v => v.estado === "listo").length;
  const atrasadas = ventas.filter(v => v.estado !== "entregado" && diasParaEntrega(v.fechaEntrega) !== null && diasParaEntrega(v.fechaEntrega) < 0).length;
  const porCobrar = ventas.filter(v => !v.pagado).reduce((s, v) => s + Math.max(0, v.precioTotal - v.abono), 0);

  return (
    <div style={S.section}>
      <SectionHeader title="Piezas" sub={`${ventas.length} registros en total`} />

      <div style={S.row3}>
        <div style={S.chipCard}>
          <span style={{ fontWeight: 800, fontSize: 18, color: "#fbbf24" }}>{porHacer}</span>
          <span style={{ fontSize: 10, color: C.muted }}>por hacer</span>
        </div>
        <div style={S.chipCard}>
          <span style={{ fontWeight: 800, fontSize: 18, color: C.accent }}>{fmt(porCobrar)}</span>
          <span style={{ fontSize: 10, color: C.muted }}>por cobrar</span>
        </div>
        <div style={S.chipCard}>
          <span style={{ fontWeight: 800, fontSize: 18, color: atrasadas > 0 ? "#f87171" : C.teal }}>{atrasadas > 0 ? atrasadas : listas}</span>
          <span style={{ fontSize: 10, color: C.muted }}>{atrasadas > 0 ? (atrasadas === 1 ? "atrasada" : "atrasadas") : "listas p/ entregar"}</span>
        </div>
      </div>

      <div style={S.filterRow}>
        {[["por_hacer","Por hacer"],["listas","Listas"],["por_cobrar","Por cobrar"],["entregadas","Entregadas"],["todas","Todas"]].map(([v,l]) => (
          <button key={v} style={{ ...S.filterBtn, ...(filtro === v ? S.filterActive : {}) }} onClick={() => setFiltro(v)}>{l}</button>
        ))}
      </div>

      {lista.length === 0
        ? <Empty icon="▦" text="Sin piezas en esta categoría" />
        : lista.map(v => <VentaCard key={v.id} v={v} marcarPago={marcarPago} eliminarVenta={eliminarVenta} actualizarVenta={actualizarVenta} cfg={cfg} />)}
    </div>
  );
}

function VentaCard({ v, marcarPago, eliminarVenta, actualizarVenta, cfg }) {
  const [open, setOpen] = useState(false);
  const abonoRef = useRef(null);
  const calc = calcPieza(v, cfg);
  const fecha = new Date(v.fecha).toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" });

  const est       = estadoInfo(v.estado);
  const siguiente = SIGUIENTE[v.estado];
  const abonado   = v.pagado ? v.precioTotal : v.abono;
  const saldo     = Math.max(0, v.precioTotal - abonado);
  const conAbono  = !v.pagado && abonado > 0;

  // Aviso de entrega: solo mientras el pedido no se haya entregado
  const dias = v.estado === "entregado" ? null : diasParaEntrega(v.fechaEntrega);
  const aviso = dias === null ? null
    : dias < 0   ? { txt: `Atrasada ${-dias} d`, color: "#f87171" }
    : dias === 0 ? { txt: "Entrega HOY",         color: "#fbbf24" }
    : dias === 1 ? { txt: "Entrega mañana",      color: "#fbbf24" }
    : { txt: `Entrega ${new Date(v.fechaEntrega).toLocaleDateString("es-EC", { day: "2-digit", month: "short" })}`, color: C.muted };

  const pagoColor = v.pagado ? C.teal : conAbono ? "#fbbf24" : "#f87171";
  const pagoTxt   = v.pagado ? "✓ Pagado" : conAbono ? `Abono ${Math.round(abonado / v.precioTotal * 100)}%` : "Pendiente";

  return (
    <div style={{ ...S.vCard, borderLeftColor: v.pagado ? C.teal : "#f87171" }}>
      <div style={S.vTop} onClick={() => setOpen(o => !o)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.vNombre}>{v.nombre}</div>
          <div style={S.vMeta}>
            {v.cliente && <span>{v.cliente} · </span>}
            <span>{fecha}</span>
            {v.cantidad > 1 && <span> · {v.cantidad} uds</span>}
          </div>
          <div style={S.vEstadoRow}>
            <span style={{ ...S.badge, background: est.color + "22", color: est.color }}>{est.label}</span>
            {aviso && <span style={{ fontSize: 11, fontWeight: 700, color: aviso.color }}>{aviso.txt}</span>}
            {siguiente && (
              <button style={S.miniBtn}
                onClick={e => { e.stopPropagation(); actualizarVenta(v.id, { estado: siguiente }); }}>
                → {estadoInfo(siguiente).label}
              </button>
            )}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={S.vPrecio}>{fmt(v.precioTotal)}</div>
          <span style={{ ...S.badge, background: pagoColor + "22", color: pagoColor }}>{pagoTxt}</span>
          {conAbono && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>Debe {fmt(saldo)}</div>}
        </div>
      </div>

      {open && (
        <div style={S.vDetail}>
          <Row label={`Filamento (${v.gramos}g)`} val={fmt(calc.fil)} />
          <Row label={`Horas (${v.horas}h)`}       val={fmt(calc.hrs)} />
          <Row label="Mano de obra"                 val={fmt(v.manoDeObra)} />
          <Row label="Costo base"                   val={fmt(calc.base)} bold />
          <Row label="Precio por unidad"            val={fmt(v.precioUnit)} />
          {v.ajustado    && <Row label="Precio ajustado" val="Sí" teal />}
          {v.cantidad > 1 && <Row label={`× ${v.cantidad} unidades`} val={fmt(v.precioTotal)} bold />}

          <div style={S.vLabel}>Estado del pedido</div>
          <div style={S.segRow}>
            {ESTADOS.map(e => (
              <button key={e.id}
                style={{ ...S.segBtn, ...(v.estado === e.id ? { background: e.color + "26", color: e.color, borderColor: e.color } : {}) }}
                onClick={() => v.estado !== e.id && actualizarVenta(v.id, { estado: e.id })}>
                {e.label}
              </button>
            ))}
          </div>

          <div style={S.vLabel}>Entregar el</div>
          <input key={"f" + (v.fechaEntrega || "")} style={S.input} type="date"
            defaultValue={aInputFecha(v.fechaEntrega)}
            onChange={e => {
              const s = e.target.value;
              if (s && s < "2000-01-01") return;   // mientras se escribe el año, no guardar
              actualizarVenta(v.id, { fechaEntrega: deInputFecha(s) });
            }} />

          <div style={S.vLabel}>
            Pagos · {fmt(abonado)} de {fmt(v.precioTotal)}{saldo > 0 ? ` · saldo ${fmt(saldo)}` : ""}
          </div>
          {!v.pagado && (
            <>
              <div style={{ display: "flex", gap: 8 }}>
                <input key={"a" + v.abono} ref={abonoRef} style={S.input} type="number" min="0" step="0.50"
                  defaultValue={v.abono || ""} placeholder="Total abonado (USD)" />
                <button style={S.miniBtn2}
                  onClick={() => actualizarVenta(v.id, { abono: Math.min(Number(abonoRef.current.value) || 0, v.precioTotal) })}>
                  Guardar
                </button>
              </div>
              <div style={S.segRow}>
                {[30, 50].map(p => (
                  <button key={p} style={S.segBtn}
                    onClick={() => actualizarVenta(v.id, { abono: Math.round(v.precioTotal * p) / 100 })}>
                    Abono {p}%
                  </button>
                ))}
              </div>
            </>
          )}

          <div style={S.vActions}>
            <button style={{ ...S.actionBtn, flex: 2,
              background: v.pagado ? "rgba(248,113,113,0.15)" : "rgba(0,196,180,0.15)",
              color: v.pagado ? "#f87171" : C.teal }}
              onClick={() => marcarPago(v.id, v.pagado)}>
              {v.pagado ? "Marcar como pendiente" : "✓ Marcar como pagado"}
            </button>
            <button style={{ ...S.actionBtn, background: "rgba(255,107,53,0.12)", color: C.accent }}
              onClick={() => eliminarVenta(v.id)}>
              Eliminar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TAB GASTOS ───────────────────────────────────────────
function TabGastos({ gastos, setGastos, eliminarGasto }) {
  const emptyG = { descripcion: "", categoria: "filamento", monto: "", fecha: new Date().toISOString().slice(0, 10) };
  const [form, setForm] = useState(emptyG);
  const [ok,   setOk]   = useState(false);

  const ch = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const guardar = () => {
  if (!form.monto || !form.descripcion) return;

  apiFetch("/gastos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      descripcion: form.descripcion,
      categoria: form.categoria,
      monto: Number(form.monto),
      fecha: form.fecha,
    }),
  })
    .then(res => res.text())
    .then(() => {
      // 🔥 volver a traer datos del backend
      apiFetch("/gastos")
        .then(res => res.json())
        .then(data => setGastos(data));
    })
    .catch(err => console.log(err));

  setForm(emptyG);
  setOk(true);
  setTimeout(() => setOk(false), 2000);
};

  const cats = { filamento: "⬡ Filamento", herramienta: "⚙ Herramienta", servicio: "⚡ Servicio/Luz", otro: "• Otro" };
  const total = gastos.reduce((s, g) => s + g.monto, 0);

  return (
    <div style={S.section}>
      <SectionHeader title="Gastos" sub="Filamentos y otros insumos" />

      <div style={S.card}>
        <div style={S.row2}>
          <Field label="Descripción">
            <input style={S.input} name="descripcion" value={form.descripcion} onChange={ch} placeholder="Ej: Rollo PLA 1kg blanco" />
          </Field>
          <Field label="Categoría">
            <select style={S.input} name="categoria" value={form.categoria} onChange={ch}>
              {Object.entries(cats).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </div>
        <div style={S.row2}>
          <Field label="Monto USD">
            <input style={S.input} type="number" name="monto" value={form.monto} onChange={ch} placeholder="0.00" min="0" step="0.01" />
          </Field>
          <Field label="Fecha">
            <input style={S.input} type="date" name="fecha" value={form.fecha} onChange={ch} />
          </Field>
        </div>
        <button style={{ ...S.btn, background: "#2a2a3a", ...(!form.monto || !form.descripcion ? S.btnOff : {}) }}
          onClick={guardar} disabled={!form.monto || !form.descripcion}>
          {ok ? "✓ Registrado" : "Registrar gasto"}
        </button>
      </div>

      {gastos.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 2px" }}>
            <span style={{ color: C.muted, fontSize: 13 }}>Total acumulado</span>
            <span style={{ fontWeight: 800, fontSize: 18, color: "#f87171" }}>−{fmt(total)}</span>
          </div>
          {[...gastos].reverse().map(g => (
            <div key={g.id} style={S.gastoCard}>
              <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>{cats[g.categoria]?.slice(0, 2) || "•"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{g.descripcion}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{cats[g.categoria]?.slice(2).trim()} · {new Date(g.fecha).toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" })}</div>
              </div>
              <span style={{ fontWeight: 800, color: "#f87171", marginRight: 10 }}>{fmt(g.monto)}</span>
              <button style={S.btnX} onClick={() => eliminarGasto(g.id)}>✕</button>
            </div>
          ))}
        </>
      )}

      {gastos.length === 0 && <Empty icon="↓" text="Sin gastos registrados" />}
    </div>
  );
}

// ─── TAB RESUMEN ──────────────────────────────────────────
function calcResumen(ventasArr, gastosArr, cfg) {
  let totalFil = 0, totalHrs = 0, totalMO = 0, totalGan = 0;
  let totalFact = 0, totalCobrado = 0;
  let filCobrado = 0, hrsCobrado = 0, moCobrado = 0;
  ventasArr.forEach(v => {
    const cc   = calcPieza(v, cfg);
    const cant = v.cantidad || 1;
    totalFil  += cc.fil  * cant;
    totalHrs  += cc.hrs  * cant;
    totalMO   += Number(v.manoDeObra) * cant;
    totalGan  += Math.max(0, v.precioTotal - cc.base * cant);
    totalFact += v.precioTotal;
    // Cuenta completo si esta pagado; si aun debe saldo, solo la parte abonada
    const f = fraccionCobrada(v);
    if (f > 0) {
      totalCobrado += v.precioTotal * f;
      filCobrado   += cc.fil  * cant * f;
      hrsCobrado   += cc.hrs  * cant * f;
      moCobrado    += Number(v.manoDeObra) * cant * f;
    }
  });
  const totalGastos    = gastosArr.reduce((s, g) => s + g.monto, 0);
  const totalPendiente = totalFact - totalCobrado;
  // Sueldo y caja chica solo sobre lo cobrado
  const cuenta = totalCobrado - totalGastos;
  const ganCobrada     = ventasArr.reduce((s, v) => {
    const cc = calcPieza(v, cfg); const cant = v.cantidad || 1;
    return s + Math.max(0, v.precioTotal - cc.base * cant) * fraccionCobrada(v);
  }, 0);
  const sueldo     = ganCobrada + moCobrado;
  const cajaChica  = (filCobrado + hrsCobrado) - totalGastos;
  return {
    totalFact, totalCobrado, totalPendiente,
    totalFil, totalHrs, totalMO, totalGan, totalGastos,
    ganCobrada, moCobrado, sueldo,
    cajaChica, cuenta,
    numVentas: ventasArr.length,
    numPendientes: ventasArr.filter(v => !v.pagado).length,
  };
}

function TabResumen({ ventas, gastos, cfg }) {
  const mesesDisponibles = [...new Set([
    ...ventas.map(v => v.fecha.slice(0, 7)),
    ...gastos.map(g => g.fecha.slice(0, 7)),
  ])].sort().reverse();

  const [filtro, setFiltro] = useState(() => mesesDisponibles.includes(hoyYM()) ? hoyYM() : "global");

  const ventasFiltradas = filtro === "global" ? ventas : ventas.filter(v => v.fecha.startsWith(filtro));
  const gastosFiltrados = filtro === "global" ? gastos : gastos.filter(g => g.fecha.startsWith(filtro));
  const r = calcResumen(ventasFiltradas, gastosFiltrados, cfg);
  const periodoLabel = filtro === "global" ? "Todos los meses" : mesLabel(filtro);
  const sinDatos = ventasFiltradas.length === 0 && gastosFiltrados.length === 0;

  return (
    <div style={S.section}>
      <SectionHeader title="Resumen" sub="Finanzas del negocio" />

      {/* Selector de período */}
      <div style={S.card}>
        <Field label="Período">
          <select style={S.input} value={filtro} onChange={e => setFiltro(e.target.value)}>
            <option value="global">📊 Todos los meses (global)</option>
            {mesesDisponibles.map(m => <option key={m} value={m}>{mesLabel(m)}</option>)}
          </select>
        </Field>
      </div>

      {sinDatos
        ? <Empty icon="◉" text={`Sin registros en ${periodoLabel}`} />
        : <>
            {/* Tarjetas principales */}
            <div style={S.row2}>
              <StatCard label="Cobrado" val={fmt(r.totalCobrado)} sub="pagos recibidos" color={C.teal} />
              <StatCard label="Por cobrar" val={fmt(r.totalPendiente)} sub={`${r.numPendientes} pedido${r.numPendientes !== 1 ? "s" : ""} con saldo`} color="#fbbf24" />
            </div>
            <div style={S.row2}>
              <StatCard label="Total facturado" val={fmt(r.totalFact)} sub={`${r.numVentas} pieza${r.numVentas !== 1 ? "s" : ""} registradas`} color={C.accent} />
              <StatCard label="Gastado" val={fmt(r.totalGastos)} sub="insumos y gastos" color="#f87171" />
            </div>
            <div style={S.row2}>
  <StatCard
    label="Cuenta"
    val={fmt(r.cuenta)}
    sub="Cobrado - Gastos"
    color="#22c55e"
  />
</div>
            {/* Sueldo */}
            <div style={{ ...S.sueldoCard, flexDirection: "row", alignItems: "center", gap: 12,
              borderColor: "rgba(255,107,53,0.4)", background: "rgba(255,107,53,0.07)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>Tu sueldo</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                  Ganancia {fmt(r.ganCobrada)} + mano de obra {fmt(r.moCobrado)}
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 900 }}>{fmt(r.sueldo)}</div>
            </div>

            {/* Caja chica */}
            <div style={{ ...S.card, flexDirection: "row", alignItems: "center", gap: 16 }}>
              <span style={{ fontSize: 26, color: C.accent }}>⬡</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Caja chica</div>
                <div style={{ fontSize: 11, color: C.muted }}>
                  Solo de lo cobrado{r.totalGastos > 0 ? ` − gastos ${fmt(r.totalGastos)}` : ""}
                </div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: r.cajaChica >= 0 ? C.accent : "#f87171" }}>{fmt(r.cajaChica)}</div>
            </div>

            {/* Desglose completo */}
            <div style={S.card}>
              <div style={S.previewTitle}>Desglose completo</div>
              <Row label="Total facturado"   val={fmt(r.totalFact)} />
              <Row label="  Cobrado"         val={fmt(r.totalCobrado)} teal />
              <Row label="  Por cobrar"      val={fmt(r.totalPendiente)} />
              <div style={S.divider} />
              <Row label="Tu sueldo (de cobrado)" val={fmt(r.sueldo)} />
              <div style={S.divider} />
              <Row label="Caja chica bruta"  val={fmt(r.cajaChica + r.totalGastos)} />
              {r.totalGastos > 0 && <Row label="  − Gastos insumos" val={`−${fmt(r.totalGastos)}`} red />}
              <Row label="Caja chica neta"   val={fmt(r.cajaChica)} bold />
            </div>
          </>
      }
    </div>
  );
}

// ─── TAB AJUSTES ──────────────────────────────────────────
function TabAjustes({ cfg, guardarConfig }) {
  const [form, setForm] = useState(() => cfgToForm(cfg));
  const [ok, setOk] = useState(false);

  useEffect(() => { setForm(cfgToForm(cfg)); }, [cfg]);

  const ch = (e) => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const guardar = () => {
    guardarConfig({
      precioPorGramo: Number(form.precioPorGramo) || 0,
      precioPorHora: Number(form.precioPorHora) || 0,
      porcentajeGanancia: (Number(form.porcentajeGanancia) || 0) / 100,
    });
    setOk(true);
    setTimeout(() => setOk(false), 2000);
  };

  return (
    <div style={S.section}>
      <SectionHeader title="Ajustes" sub="Tarifas del negocio" />

      <div style={S.card}>
        <div style={S.row2}>
          <Field label="Precio por gramo" hint="USD">
            <input style={S.input} type="number" name="precioPorGramo" value={form.precioPorGramo} onChange={ch} min="0" step="0.01" />
          </Field>
          <Field label="Precio por hora" hint="USD">
            <input style={S.input} type="number" name="precioPorHora" value={form.precioPorHora} onChange={ch} min="0" step="0.01" />
          </Field>
        </div>

        <Field label="Ganancia sobre el costo" hint="%">
          <input style={S.input} type="number" name="porcentajeGanancia" value={form.porcentajeGanancia} onChange={ch} min="0" step="1" />
        </Field>

        <button style={S.btn} onClick={guardar}>
          {ok ? "✓ Guardado" : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}

function cfgToForm(cfg) {
  return {
    precioPorGramo: cfg.precioPorGramo,
    precioPorHora: cfg.precioPorHora,
    porcentajeGanancia: Math.round(cfg.porcentajeGanancia * 100),
  };
}

// ─── COMPONENTES BASE ─────────────────────────────────────
function SectionHeader({ title, sub }) {
  return <div><h2 style={S.h2}>{title}</h2><p style={S.sub}>{sub}</p></div>;
}
function StatCard({ label, val, sub, color }) {
  return (
    <div style={{ ...S.card, gap: 4, borderColor: color + "44" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color }}>{val}</div>
      <div style={{ fontSize: 11, color: C.muted }}>{sub}</div>
    </div>
  );
}
function Field({ label, hint, children }) {
  return (
    <div style={S.field}>
      <label style={S.label}>{label}{hint && <span style={S.hint}> {hint}</span>}</label>
      {children}
    </div>
  );
}
function Row({ label, val, bold, teal, red }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, padding:"3px 0",
      fontWeight: bold ? 700 : 400,
      color: teal ? C.teal : red ? "#f87171" : bold ? C.text : C.muted }}>
      <span>{label}</span><span>{val}</span>
    </div>
  );
}
function Empty({ icon, text }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8, padding:"50px 20px", textAlign:"center" }}>
      <span style={{ fontSize:38, opacity:0.2 }}>{icon}</span>
      <span style={{ color:C.muted, fontSize:14 }}>{text}</span>
    </div>
  );
}

// ─── COLORES Y ESTILOS ────────────────────────────────────
const C = {
  bg:      "#0c0c10",
  surface: "#13131a",
  card:    "#1a1a24",
  border:  "#252532",
  accent:  "#ff6b35",
  teal:    "#00c4b4",
  text:    "#eeeef5",
  muted:   "#7777aa",
};

const S = {
  root:    { minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"'DM Sans','Segoe UI',sans-serif", maxWidth:480, margin:"0 auto", paddingBottom:72 },
  header:  { display:"flex", alignItems:"center", gap:10, padding:"14px 18px 10px", background:C.surface, borderBottom:`1px solid ${C.border}`, position:"sticky", top:0, zIndex:50 },
  headerIcon:  { fontSize:26, color:C.accent },
  headerTitle: { fontWeight:900, fontSize:18, letterSpacing:-0.5 },
  headerSub:   { fontSize:11, color:C.muted },
  main:    { padding:"18px 14px 8px" },
  bottomNav: { position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, background:C.surface, borderTop:`1px solid ${C.border}`, display:"flex", zIndex:100 },
  navBtn:    { flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2, background:"none", border:"none", color:C.muted, padding:"10px 0 8px", cursor:"pointer" },
  navActive: { color:C.accent },
  navIcon:   { fontSize:18 },
  navLabel:  { fontSize:10, fontWeight:700, letterSpacing:0.5 },

  section: { display:"flex", flexDirection:"column", gap:14 },
  h2:      { fontSize:22, fontWeight:900, margin:0, letterSpacing:-0.5 },
  sub:     { fontSize:13, color:C.muted, margin:"3px 0 0" },
  card:    { background:C.card, borderRadius:16, border:`1px solid ${C.border}`, padding:18, display:"flex", flexDirection:"column", gap:12 },
  field:   { display:"flex", flexDirection:"column", gap:5 },
  label:   { fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:0.8 },
  hint:    { color:C.accent, fontWeight:600, textTransform:"none", letterSpacing:0 },
  input:   { background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"10px 13px", color:C.text, fontSize:14, outline:"none", width:"100%", boxSizing:"border-box" },
  inputDestacado: { borderColor: C.accent, fontSize:16, fontWeight:700 },
  row2:    { display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:10 },
  row3:    { display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)", gap:10 },
  inputFecha: { padding:"10px 5px 10px 8px", fontSize:12 },
  divider: { height:1, background:C.border, margin:"4px 0" },

  dropdown: { position:"absolute", top:"100%", left:0, right:0, background:C.card, border:`1px solid ${C.accent}`, borderRadius:10, zIndex:200, overflow:"hidden", boxShadow:"0 8px 24px rgba(0,0,0,0.4)", marginTop:2 },
  dropItem: { padding:"12px 14px", cursor:"pointer", borderBottom:`1px solid ${C.border}` },

  autocompleteBadge: { fontSize:12, fontWeight:600, color:C.teal, background:"rgba(0,196,180,0.1)", border:"1px solid rgba(0,196,180,0.25)", borderRadius:8, padding:"8px 12px" },
  diffBadge:         { fontSize:12, fontWeight:600, color:"#fbbf24", background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.25)", borderRadius:8, padding:"8px 12px" },

  preview:      { background:"rgba(255,107,53,0.07)", border:`1px solid rgba(255,107,53,0.2)`, borderRadius:12, padding:14, display:"flex", flexDirection:"column", gap:6 },
  previewTitle: { fontSize:11, fontWeight:700, color:C.accent, textTransform:"uppercase", letterSpacing:1, marginBottom:4 },
  ajusteBadge:  { fontSize:12, background:"rgba(255,255,255,0.05)", borderRadius:8, padding:"6px 10px" },
  multiBadge:   { fontSize:13, color:C.muted, background:"rgba(255,255,255,0.04)", borderRadius:8, padding:"7px 10px" },
  precioBig:    { display:"flex", justifyContent:"space-between", alignItems:"center", background:C.accent, borderRadius:10, padding:"10px 14px", marginTop:4 },
  precioBigNum: { fontSize:22, fontWeight:900, color:"#fff" },

  btn:    { background:C.accent, border:"none", borderRadius:12, color:"#fff", fontSize:15, fontWeight:700, padding:"13px", cursor:"pointer" },
  btnWeb:  { background:"rgba(0,196,180,0.12)", border:`1px solid rgba(0,196,180,0.35)`, borderRadius:12, color:C.teal, fontSize:13, fontWeight:700, padding:"12px", cursor:"pointer", width:"100%" },
  webBox:  { background:"rgba(0,196,180,0.06)", border:`1px solid rgba(0,196,180,0.28)`, borderRadius:12, padding:14, display:"flex", flexDirection:"column", gap:11 },
  webOk:   { background:"rgba(0,196,180,0.10)", border:`1px solid rgba(0,196,180,0.35)`, borderRadius:12, padding:14, color:C.text },
  webAviso:{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:10, padding:12 },
  webError:{ background:"rgba(248,113,113,0.10)", border:"1px solid rgba(248,113,113,0.35)", borderRadius:10, padding:"10px 12px", fontSize:12, color:"#f87171", lineHeight:1.5 },
  btnOff: { opacity:0.35, cursor:"not-allowed" },
  btnX:   { background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:14, padding:"0 4px" },

  catalogoCard: { background:C.card, borderRadius:14, border:`1px solid ${C.border}`, padding:"14px 14px", display:"flex", alignItems:"center", gap:10 },
  chipCard:     { background:C.card, borderRadius:14, border:`1px solid ${C.border}`, padding:"12px 8px", display:"flex", flexDirection:"column", alignItems:"center", gap:3 },

  filterRow:   { display:"flex", gap:8, flexWrap:"wrap" },
  filterBtn:   { fontSize:12, fontWeight:600, padding:"7px 14px", borderRadius:20, border:`1px solid ${C.border}`, background:"none", color:C.muted, cursor:"pointer" },
  filterActive:{ background:C.accent, color:"#fff", borderColor:C.accent },

  alertBox: { background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.25)", borderRadius:12, padding:"12px 14px", display:"flex", alignItems:"center", gap:12, fontSize:13 },

  vCard:   { background:C.card, borderRadius:14, border:`1px solid ${C.border}`, borderLeftWidth:3, overflow:"hidden", marginBottom:2 },
  vTop:    { display:"flex", gap:12, padding:"14px", cursor:"pointer" },
  vNombre: { fontWeight:700, fontSize:15, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" },
  vMeta:   { fontSize:12, color:C.muted, marginTop:2 },
  vPrecio: { fontWeight:800, fontSize:17, color:C.accent },
  badge:   { fontSize:10, fontWeight:700, letterSpacing:0.5, padding:"2px 7px", borderRadius:6, textTransform:"uppercase" },
  vDetail: { padding:"12px 14px 14px", display:"flex", flexDirection:"column", gap:5, borderTop:`1px solid ${C.border}` },
  vActions:{ display:"flex", gap:8, marginTop:8 },
  actionBtn:{ flex:1, padding:"9px", borderRadius:10, border:"none", fontWeight:700, fontSize:13, cursor:"pointer" },
  vEstadoRow:{ display:"flex", alignItems:"center", gap:8, marginTop:7, flexWrap:"wrap" },
  miniBtn:  { fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:14, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.05)", color:C.text, cursor:"pointer" },
  miniBtn2: { fontSize:13, fontWeight:700, padding:"0 16px", borderRadius:10, border:"none", background:C.accent, color:"#fff", cursor:"pointer", flexShrink:0 },
  vLabel:   { fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:0.8, marginTop:10 },
  segRow:   { display:"flex", gap:6 },
  segBtn:   { flex:1, fontSize:12, fontWeight:700, padding:"8px 4px", borderRadius:10, border:`1px solid ${C.border}`, background:"none", color:C.muted, cursor:"pointer" },

  gastoCard: { background:C.card, borderRadius:12, border:`1px solid ${C.border}`, padding:"12px 14px", display:"flex", alignItems:"center", gap:10 },

  enCuentaCard: { background:`linear-gradient(135deg,#1e3a5f,#1a2f4a)`, borderRadius:16, border:"1px solid rgba(99,179,237,0.3)", padding:"18px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 },
  totalCard: { background:`linear-gradient(135deg,${C.accent},#ff9a5c)`, borderRadius:18, padding:"20px 18px", textAlign:"center" },
  sueldoCard:{ borderRadius:16, padding:16, display:"flex", flexDirection:"column", border:"1px solid transparent" },
};
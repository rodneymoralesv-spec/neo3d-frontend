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
  // Parte de la ganancia que se queda en la caja chica para el negocio (0.2 = 20%)
  reservaNegocio: 0,
};

// Desde este mes el negocio es solo de Rodney (antes era en sociedad). Resumen,
// gastos y entregadas arrancan de cero aquí; lo anterior queda como historial.
const INICIO_SOLO = "2026-10";
const esEtapaActual = (fecha) => String(fecha).slice(0, 7) >= INICIO_SOLO;

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

// Fecha de hoy en hora de Ecuador (toISOString da la de Londres: después de las 7 pm ya es mañana)
const hoyLocal = () => {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
};

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
          <Logo />
          <div style={{ ...S.headerSub, marginLeft: "auto" }}>Ingresá tu clave</div>
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
          // En la base sigue la columna porcentajeRodney (la parte de la ganancia que
          // va al sueldo); lo que falta para 1 es la reserva del negocio.
          reservaNegocio: data.porcentajeRodney == null ? 0
            : Math.min(1, Math.max(0, 1 - Number(data.porcentajeRodney))),
        });
      }
    })
    .catch(err => console.log(err));
}, []);

const guardarConfig = (nuevoCfg) => {
  apiFetch("/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      precioPorGramo: nuevoCfg.precioPorGramo,
      precioPorHora: nuevoCfg.precioPorHora,
      porcentajeGanancia: nuevoCfg.porcentajeGanancia,
      porcentajeRodney: 1 - (nuevoCfg.reservaNegocio || 0),
    }),
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
        <Logo />
        <button style={{ ...S.btnX, marginLeft: "auto", fontSize: 12 }} onClick={onSalir}>Salir</button>
      </div>

      <main style={S.main}>
        {tab === "calcular" && (
          <TabCalcular
  ventas={ventas}
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
function TabCalcular({ ventas, setVentas, catalogo, guardarEnCatalogo, eliminarDeCatalogo, fetchVentas, cfg }) {
  const empty = {
  nombre: "",
  cliente: "",
  gramos: "",
  horas: "",
  manoDeObra: "",
  cantidad: "1",
  precioManual: "",
  fecha: hoyLocal(),
  fechaEntrega: "",
  abono: "",
  estado: "por_hacer"
};
  const [form, setForm]         = useState(empty);
  const [ok,   setOk]           = useState(false);
  const [sugerencias, setSugs]  = useState([]);   // lista filtrada del catálogo
  const [mostrarSugs, setMostrarSugs] = useState(false);
  const [esDelCatalogo, setEsDelCatalogo] = useState(false); // si el form vino de catálogo
  // Piezas ya agregadas al pedido del cliente; se registran todas juntas
  const [pedido, setPedido] = useState([]);
  // "pieza" = se calcula con gramos y horas; "personalizado" = solo el precio que cobraste
  const [modo, setModo] = useState("pieza");
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

  // La pieza que está en el formulario, lista para sumarse al pedido
  const piezaActual = () => ({
    nombre: form.nombre.trim() || "Pieza sin nombre",
    gramos: Number(form.gramos),
    horas: Number(form.horas),
    manoDeObra: Number(form.manoDeObra),
    cantidad: cant,
    precioUnit,
    precioTotal,
    ajustado: Number(form.precioManual) > 0,
  });
  const totalPedido = pedido.reduce((s, x) => s + x.precioTotal, 0) + (valid ? precioTotal : 0);
  const nPiezas = pedido.length + (valid ? 1 : 0);

  // El abono es del pedido completo: nunca pasa del total
  const abonoNum = Math.min(Math.max(Number(form.abono) || 0, 0), totalPedido);

  const limpiarPieza = () => {
    setForm(p => ({ ...p, nombre: "", gramos: "", horas: "", manoDeObra: "", cantidad: "1", precioManual: "" }));
    setEsDelCatalogo(false);
  };

  const agregarAlPedido = () => {
    if (!valid) return;
    const pieza = piezaActual();
    guardarEnCatalogo({ nombre: pieza.nombre, gramos: pieza.gramos, horas: pieza.horas, manoDeObra: pieza.manoDeObra });
    setPedido(p => [...p, pieza]);
    limpiarPieza();
  };

  const guardar = () => {
  const items = [...pedido];
  if (valid) {
    const pieza = piezaActual();
    guardarEnCatalogo({ nombre: pieza.nombre, gramos: pieza.gramos, horas: pieza.horas, manoDeObra: pieza.manoDeObra });
    items.push(pieza);
  }
  if (items.length === 0) return;

  // Todas las piezas comparten cliente y fecha exacta: así Piezas las agrupa como un pedido.
  // El abono se reparte en proporción al precio de cada pieza; la última se lleva el redondeo.
  const fecha = new Date(form.fecha + "T12:00:00").toISOString();
  const total = items.reduce((s, x) => s + x.precioTotal, 0);
  let resto = abonoNum;
  const envios = items.map((x, i) => {
    const abono = i === items.length - 1 ? resto
      : Math.min(resto, Math.round((total > 0 ? abonoNum * x.precioTotal / total : 0) * 100) / 100);
    resto = Math.round((resto - abono) * 100) / 100;
    return apiFetch("/ventas", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify({
        ...x,
        cliente: form.cliente.trim(),
        pagado: x.precioTotal > 0 && abono >= x.precioTotal - 0.005,
        abono,
        estado: form.estado,
        fechaEntrega: deInputFecha(form.fechaEntrega),
        fecha,
      }),
    });
  });
  Promise.all(envios)
    .then(() => fetchVentas())
    .catch(err => console.log("ERROR:", err));

  setForm({
  ...empty,
  fecha: hoyLocal()
});
  setPedido([]);
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
      <SectionHeader
        title={modo === "personalizado" ? "Pedido personalizado" : "Nueva pieza"}
        sub={modo === "personalizado" ? "Ya lo cotizaste: solo poné qué es y cuánto cobraste"
          : "Escribí el nombre y se autocompleta si ya existe"} />

      {pedido.length === 0 && (
        <div style={S.segRow}>
          {[["pieza", "Pieza calculada"], ["personalizado", "Personalizado (solo precio)"]].map(([id, label]) => (
            <button key={id} onClick={() => setModo(id)}
              style={{ ...S.segBtn, ...(modo === id ? { background: "rgba(227,20,31,0.15)", color: C.text, borderColor: C.accent } : {}) }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {modo === "personalizado"
        ? <FormPersonalizado ventas={ventas} catalogo={catalogo} fetchVentas={fetchVentas} cfg={cfg} />
        : <>
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
        <ClienteCampo value={form.cliente} onChange={ch} ventas={ventas} />

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
          <Field label={pedido.length > 0 ? "Abono del pedido" : "Abono recibido"}
            hint={abonoNum > 0 && totalPedido > 0 ? `${Math.round(abonoNum / totalPedido * 100)}%` : "USD"}>
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

        {pedido.length > 0 && (
          <div style={S.preview}>
            <div style={S.previewTitle}>Pedido de {form.cliente.trim() || "este cliente"}</div>
            {pedido.map((x, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ flex: 1 }}>{x.cantidad > 1 ? `${x.cantidad} × ` : ""}{x.nombre}</span>
                <span style={{ fontWeight: 700 }}>{fmt(x.precioTotal)}</span>
                <button style={S.btnX} onClick={() => setPedido(p => p.filter((_, j) => j !== i))} title="Quitar del pedido">✕</button>
              </div>
            ))}
            {valid && (
              <div style={{ display: "flex", fontSize: 13, color: C.muted }}>
                <span style={{ flex: 1 }}>+ {form.nombre.trim() || "Pieza sin nombre"} (en el formulario)</span>
                <span>{fmt(precioTotal)}</span>
              </div>
            )}
            <div style={S.divider} />
            <Row label={`Total del pedido · ${nPiezas} ${nPiezas === 1 ? "pieza" : "piezas"}`} val={fmt(totalPedido)} bold />
          </div>
        )}

        <button style={{ ...S.btn, background: "#2a2a3a", ...(!valid ? S.btnOff : {}) }} onClick={agregarAlPedido} disabled={!valid}>
          + Agregar otra pieza a este pedido
        </button>

        <button style={{ ...S.btn, ...(nPiezas === 0 ? S.btnOff : {}) }} onClick={guardar} disabled={nPiezas === 0}>
          {ok ? "✓ ¡Registrado!"
            : nPiezas > 1 ? `Registrar pedido (${nPiezas} piezas · ${fmt(totalPedido)})`
            : "Registrar venta"}
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

      </>}

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

// Campo cliente: sugiere los clientes anteriores y avisa si ya compró y cuánto debe
function ClienteCampo({ value, onChange, ventas }) {
  const clientes = [...new Set(ventas.map(v => (v.cliente || "").trim()).filter(Boolean))];
  const buscado = value.trim().toLowerCase();
  const delCliente = buscado ? ventas.filter(v => (v.cliente || "").trim().toLowerCase() === buscado) : [];
  const debe = delCliente.filter(v => !v.pagado).reduce((s, v) => s + Math.max(0, v.precioTotal - v.abono), 0);
  const pedidos = new Set(delCliente.map(v => String(v.fecha).slice(0, 10))).size;
  return (
    <>
      <Field label="Cliente">
        <input style={S.input} name="cliente" value={value} onChange={onChange} placeholder="Nombre del cliente"
          list="clientes-anteriores" autoComplete="off" />
        <datalist id="clientes-anteriores">
          {clientes.map(c => <option key={c} value={c} />)}
        </datalist>
      </Field>
      {delCliente.length > 0 && (
        <div style={S.autocompleteBadge}>
          Cliente conocido: {pedidos} {pedidos === 1 ? "pedido" : "pedidos"} antes
          {debe > 0.004 && <span style={{ color: "#fbbf24" }}> · te debe {fmt(debe)}</span>}
        </div>
      )}
    </>
  );
}

// ─── PEDIDO PERSONALIZADO ─────────────────────────────────
// Para lo que ya cotizaste a mano: una descripción y el total cobrado.
// Se reparte como una pieza normal: con regla de tres sobre tu fórmula se estima
// cuántos gramos y horas lleva ese precio (mano de obra $1 y tu % de ganancia).
const MO_PERSONALIZADO = 1;

// Gramos que imprimís por hora, en promedio, según las piezas de tu catálogo
const gramosPorHora = (catalogo) => {
  const conDatos = catalogo.filter(p => Number(p.gramos) > 0 && Number(p.horas) > 0);
  const g = conDatos.reduce((s, p) => s + Number(p.gramos), 0);
  const h = conDatos.reduce((s, p) => s + Number(p.horas), 0);
  return h > 0 ? g / h : 30;
};

function FormPersonalizado({ ventas, catalogo, fetchVentas, cfg }) {
  const hoy = hoyLocal;
  const vacio = { descripcion: "", cliente: "", fecha: hoy(), fechaEntrega: "", total: "", abono: "",
    estado: "por_hacer", gramos: "", horas: "" };
  const [f, setF]   = useState(vacio);
  const [ok, setOk] = useState(false);
  const ch = e => setF(p => ({ ...p, [e.target.name]: e.target.value }));

  const total  = Math.max(0, Number(f.total) || 0);
  const abono  = Math.min(Math.max(Number(f.abono) || 0, 0), total);
  const valido = f.descripcion.trim() && total > 0;

  // Regla de tres: precio = costo × (1 + ganancia), y costo = material + máquina + mano de obra
  const ritmo     = gramosPorHora(catalogo);
  const baseEst   = total / (1 + cfg.porcentajeGanancia);
  const mo        = Math.min(MO_PERSONALIZADO, baseEst);
  const porHora   = ritmo * cfg.precioPorGramo + cfg.precioPorHora;   // material + máquina de 1 hora
  const horasEst  = porHora > 0 ? Math.max(0, baseEst - mo) / porHora : 0;
  // Si escribís los reales se usan esos; si no, el estimado
  const horas  = f.horas  !== "" ? Number(f.horas)  || 0 : Math.round(horasEst * 10) / 10;
  const gramos = f.gramos !== "" ? Number(f.gramos) || 0 : Math.round(horasEst * ritmo);

  // Mismo reparto que el Resumen
  const c        = calcPieza({ gramos, horas, manoDeObra: mo }, cfg);
  const ganancia = total - c.base;
  const reserva  = Math.max(0, ganancia) * (cfg.reservaNegocio || 0);
  const caja     = c.fil + c.hrs + reserva;
  const sueldo   = mo + ganancia - reserva;

  const guardar = () => {
    if (!valido) return;
    apiFetch("/ventas", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify({
        nombre: f.descripcion.trim(),
        cliente: f.cliente.trim(),
        gramos,
        horas,
        manoDeObra: mo,
        cantidad: 1,
        precioUnit: total,
        precioTotal: total,
        ajustado: true,
        pagado: abono >= total - 0.005,
        abono,
        estado: f.estado,
        fechaEntrega: deInputFecha(f.fechaEntrega),
        fecha: new Date(f.fecha + "T12:00:00").toISOString(),
      }),
    })
      .then(() => fetchVentas())
      .catch(err => console.log("ERROR:", err));
    setF({ ...vacio, fecha: hoy() });
    setOk(true);
    setTimeout(() => setOk(false), 2200);
  };

  return (
    <div style={S.card}>
      <Field label="¿Qué es el pedido?">
        <input style={S.input} name="descripcion" value={f.descripcion} onChange={ch}
          placeholder="Ej: 3 llaveros con logo + letrero" autoComplete="off" />
      </Field>

      <ClienteCampo value={f.cliente} onChange={ch} ventas={ventas} />

      <div style={S.row2}>
        <Field label="Fecha del pedido">
          <input type="date" name="fecha" value={f.fecha} onChange={ch} style={{ ...S.input, ...S.inputFecha }} />
        </Field>
        <Field label="Entregar el" hint="opcional">
          <input type="date" name="fechaEntrega" value={f.fechaEntrega} onChange={ch} style={{ ...S.input, ...S.inputFecha }} />
        </Field>
      </div>

      <div style={S.row2}>
        <Field label="Total cobrado" hint="USD">
          <input style={{ ...S.input, ...S.inputDestacado }} type="number" name="total" value={f.total} onChange={ch}
            placeholder="0.00" min="0" step="0.50" />
        </Field>
        <Field label="Abono recibido" hint={abono > 0 && total > 0 ? `${Math.round(abono / total * 100)}%` : "USD"}>
          <input style={S.input} type="number" name="abono" value={f.abono} onChange={ch} placeholder="0.00" min="0" step="0.50" />
        </Field>
      </div>

      <Field label="Estado">
        <select style={{ ...S.input, ...S.inputFecha }} name="estado" value={f.estado} onChange={ch}>
          {ESTADOS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
      </Field>

      <div style={S.row2}>
        <Field label="Gramos" hint={f.gramos === "" ? "estimado" : "real"}>
          <input style={S.input} type="number" name="gramos" value={f.gramos} onChange={ch}
            placeholder={total > 0 ? `~${gramos}` : "auto"} min="0" />
        </Field>
        <Field label="Horas" hint={f.horas === "" ? "estimado" : "real"}>
          <input style={S.input} type="number" name="horas" value={f.horas} onChange={ch}
            placeholder={total > 0 ? `~${horas}` : "auto"} min="0" step="0.5" />
        </Field>
      </div>

      {total > 0 && (
        <div style={S.preview}>
          <div style={S.previewTitle}>Como una pieza normal</div>
          <Row label={`Filamento (${gramos}g)`} val={fmt(c.fil)} />
          <Row label={`Horas (${horas}h)`} val={fmt(c.hrs)} />
          <Row label="Mano de obra" val={fmt(mo)} />
          <Row label="Costo" val={fmt(c.base)} bold />
          <Row label={`Ganancia (${Math.round(ganancia / (c.base || 1) * 100)}% sobre el costo)`} val={`+${fmt(ganancia)}`} teal={ganancia >= 0} red={ganancia < 0} />
          <div style={S.divider} />
          <Row label="Caja chica (material, máquina y reserva)" val={fmt(caja)} />
          <Row label="Tu sueldo (mano de obra y ganancia)" val={fmt(sueldo)} bold />
          <div style={{ fontSize: 11, color: C.muted }}>
            {f.gramos === "" && f.horas === ""
              ? `Gramos y horas sacados con regla de tres: tu fórmula con mano de obra $${MO_PERSONALIZADO} y ${Math.round(cfg.porcentajeGanancia * 100)}% de ganancia, a ~${Math.round(ritmo)} g por hora como tus piezas del catálogo. Si sabés los reales, escribilos.`
              : "Con los gramos y horas que escribiste."}
          </div>
        </div>
      )}

      <button style={{ ...S.btn, ...(!valido ? S.btnOff : {}) }} onClick={guardar} disabled={!valido}>
        {ok ? "✓ ¡Registrado!" : total > 0 ? `Registrar pedido personalizado · ${fmt(total)}` : "Registrar pedido personalizado"}
      </button>
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
    todas:      v => esEtapaActual(v.fecha),
    por_hacer:  v => v.estado === "por_hacer",
    listas:     v => v.estado === "listo",
    por_cobrar: v => !v.pagado,
    entregadas: v => v.estado === "entregado" && esEtapaActual(v.fecha),
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
      <SectionHeader title="Piezas" sub={`${ventas.filter(v => esEtapaActual(v.fecha)).length} desde ${mesLabel(INICIO_SOLO)}`} />

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
        : agruparPedidos(lista).map(g => g.length === 1
          ? <VentaCard key={g[0].id} v={g[0]} marcarPago={marcarPago} eliminarVenta={eliminarVenta} actualizarVenta={actualizarVenta} cfg={cfg} />
          : <PedidoGrupo key={"p" + g[0].id} piezas={g} marcarPago={marcarPago} eliminarVenta={eliminarVenta} actualizarVenta={actualizarVenta} cfg={cfg} />)}
    </div>
  );
}

// Mismo cliente y mismo día = un solo pedido. Respeta el orden de la lista.
function agruparPedidos(lista) {
  const grupos = new Map();
  lista.forEach(v => {
    const cliente = (v.cliente || "").trim().toLowerCase();
    const clave = cliente ? cliente + "|" + String(v.fecha).slice(0, 10) : "suelta" + v.id;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(v);
  });
  return [...grupos.values()];
}

function PedidoGrupo({ piezas, marcarPago, eliminarVenta, actualizarVenta, cfg }) {
  const total = piezas.reduce((s, v) => s + v.precioTotal, 0);
  const debe  = piezas.filter(v => !v.pagado).reduce((s, v) => s + Math.max(0, v.precioTotal - v.abono), 0);
  const fecha = new Date(piezas[0].fecha).toLocaleDateString("es-EC", { day: "2-digit", month: "short" });
  // Si todas van en el mismo estado, se pueden avanzar juntas
  const mismoEstado = piezas.every(v => v.estado === piezas[0].estado);
  const siguiente   = mismoEstado ? SIGUIENTE[piezas[0].estado] : null;

  return (
    <div style={S.pedidoGrupo}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>🧾 Pedido de {piezas[0].cliente}</div>
          <div style={{ fontSize: 12, color: C.muted }}>{piezas.length} piezas · {fecha}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>{fmt(total)}</div>
          <div style={{ fontSize: 11, color: debe > 0.004 ? "#fbbf24" : C.teal }}>
            {debe > 0.004 ? `Debe ${fmt(debe)}` : "✓ Pagado"}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {siguiente && (
          <button style={S.miniBtn} onClick={() => piezas.forEach(v => actualizarVenta(v.id, { estado: siguiente }))}>
            → Todo {estadoInfo(siguiente).label.toLowerCase()}
          </button>
        )}
        {debe > 0.004 && (
          <button style={S.miniBtn} onClick={() => {
            if (!window.confirm(`¿Marcar como pagado todo el pedido (${fmt(debe)} pendiente)?`)) return;
            piezas.filter(v => !v.pagado).forEach(v => actualizarVenta(v.id, { pagado: true }));
          }}>
            ✓ Cobrar todo
          </button>
        )}
      </div>
      {piezas.map(v => <VentaCard key={v.id} v={v} marcarPago={marcarPago} eliminarVenta={eliminarVenta} actualizarVenta={actualizarVenta} cfg={cfg} />)}
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
            <button style={{ ...S.actionBtn, background: "rgba(227,20,31,0.12)", color: C.accent }}
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
  const emptyG = { descripcion: "", categoria: "filamento", monto: "", fecha: hoyLocal() };
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
  // Los gastos de antes siguen guardados: se ven en Resumen → historial
  const actuales = gastos.filter(g => esEtapaActual(g.fecha));
  const total = actuales.reduce((s, g) => s + g.monto, 0);

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

      {actuales.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 2px" }}>
            <span style={{ color: C.muted, fontSize: 13 }}>Desde {mesLabel(INICIO_SOLO)}</span>
            <span style={{ fontWeight: 800, fontSize: 18, color: "#f87171" }}>−{fmt(total)}</span>
          </div>
          {[...actuales].reverse().map(g => (
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

      {actuales.length === 0 && <Empty icon="↓" text={`Sin gastos desde ${mesLabel(INICIO_SOLO)}`} />}
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
  // Si una pieza se vendió por menos de su costo, esa diferencia (perdida) sale
  // del sueldo: así sueldo + caja chica siempre suman exactamente lo cobrado.
  let ganCobrada = 0, perdida = 0;
  ventasArr.forEach(v => {
    const cc = calcPieza(v, cfg); const cant = v.cantidad || 1;
    const dif = (v.precioTotal - cc.base * cant) * fraccionCobrada(v);
    if (dif >= 0) ganCobrada += dif; else perdida -= dif;
  });
  // La reserva sale de la ganancia y va a la caja; la mano de obra es toda tuya
  const reserva    = ganCobrada * (cfg.reservaNegocio || 0);
  const sueldo     = ganCobrada - reserva + moCobrado - perdida;
  const costoCobrado = filCobrado + hrsCobrado;
  const cajaChica  = costoCobrado + reserva - totalGastos;
  return {
    totalFact, totalCobrado, totalPendiente,
    totalFil, totalHrs, totalMO, totalGan, totalGastos,
    ganCobrada, moCobrado, sueldo, reserva, costoCobrado, perdida,
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

  const mesesActuales = mesesDisponibles.filter(m => m >= INICIO_SOLO);
  const mesesAntes    = mesesDisponibles.filter(m => m < INICIO_SOLO);

  // "actual" = desde que el negocio es solo tuyo; "antes" = etapa en sociedad; "global" = todo
  const [filtro, setFiltro] = useState(() => mesesActuales.includes(hoyYM()) ? hoyYM() : "actual");

  const enPeriodo = (fecha) =>
    filtro === "global" ? true
    : filtro === "actual" ? esEtapaActual(fecha)
    : filtro === "antes"  ? !esEtapaActual(fecha)
    : fecha.startsWith(filtro);
  const ventasFiltradas = ventas.filter(v => enPeriodo(v.fecha));
  const gastosFiltrados = gastos.filter(g => enPeriodo(g.fecha));
  const r = calcResumen(ventasFiltradas, gastosFiltrados, cfg);
  const periodoLabel = {
    global: "todo el historial",
    actual: `desde ${mesLabel(INICIO_SOLO)}`,
    antes:  "la etapa en sociedad",
  }[filtro] || mesLabel(filtro);
  const sinDatos = ventasFiltradas.length === 0 && gastosFiltrados.length === 0;

  return (
    <div style={S.section}>
      <SectionHeader title="Resumen" sub="Finanzas del negocio" />

      {/* Selector de período */}
      <div style={S.card}>
        <Field label="Período">
          <select style={S.input} value={filtro} onChange={e => setFiltro(e.target.value)}>
            <option value="actual">📊 Desde {mesLabel(INICIO_SOLO)} (todo tuyo)</option>
            {mesesActuales.map(m => <option key={m} value={m}>{mesLabel(m)}</option>)}
            {mesesAntes.length > 0 && (
              <optgroup label="Historial (etapa en sociedad)">
                <option value="antes">Todo antes de {mesLabel(INICIO_SOLO)}</option>
                {mesesAntes.map(m => <option key={m} value={m}>{mesLabel(m)}</option>)}
                <option value="global">Todo el historial junto</option>
              </optgroup>
            )}
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
              borderColor: "rgba(227,20,31,0.4)", background: "rgba(227,20,31,0.07)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>Tu sueldo</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                  Ganancia {fmt(r.ganCobrada - r.reserva)} + mano de obra {fmt(r.moCobrado)}
                  {r.perdida > 0.004 && ` − ${fmt(r.perdida)} vendido bajo costo`}
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
                  Material, máquina{r.reserva > 0 ? " y reserva" : ""}{r.totalGastos > 0 ? ` − gastos ${fmt(r.totalGastos)}` : ""}
                </div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: r.cajaChica >= 0 ? C.teal : "#f87171" }}>{fmt(r.cajaChica)}</div>
            </div>

            {/* Desglose completo */}
            <div style={S.card}>
              <div style={S.previewTitle}>Desglose completo</div>
              <Row label="Total facturado"   val={fmt(r.totalFact)} />
              <Row label="  Cobrado"         val={fmt(r.totalCobrado)} teal />
              <Row label="  Por cobrar"      val={fmt(r.totalPendiente)} />
              <div style={S.divider} />
              <Row label="Mano de obra" val={fmt(r.moCobrado)} />
              <Row label="Ganancia (después de la reserva)" val={fmt(r.ganCobrada - r.reserva)} />
              {r.perdida > 0.004 && <Row label="  − Piezas vendidas bajo costo" val={`−${fmt(r.perdida)}`} red />}
              <Row label="Tu sueldo (de cobrado)" val={fmt(r.sueldo)} bold />
              <div style={S.divider} />
              <Row label="Material y máquina" val={fmt(r.costoCobrado)} />
              {r.reserva > 0 && <Row label={`Reserva (${Math.round(cfg.reservaNegocio * 100)}% de la ganancia)`} val={`+${fmt(r.reserva)}`} />}
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
      reservaNegocio: Math.min(100, Math.max(0, Number(form.reservaNegocio) || 0)) / 100,
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

        <Field label="Reserva para el negocio" hint="% de la ganancia">
          <input style={S.input} type="number" name="reservaNegocio" value={form.reservaNegocio} onChange={ch} min="0" max="100" step="1" />
        </Field>
        <div style={{ fontSize: 11, color: C.muted, marginTop: -6 }}>
          Esa parte de la ganancia va a la caja chica (máquina nueva, repuestos, imprevistos).
          El resto de la ganancia y toda la mano de obra son tu sueldo.
        </div>

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
    reservaNegocio: Math.round((cfg.reservaNegocio || 0) * 100),
  };
}

// ─── COMPONENTES BASE ─────────────────────────────────────
function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <img src={process.env.PUBLIC_URL + "/cubo-3d.png"} alt="" style={{ height: 32 }} />
      <img src={process.env.PUBLIC_URL + "/roer.png"} alt="ROER 3D" style={{ height: 20 }} />
    </div>
  );
}
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
  accent:  "#e3141f",   // rojo ROER 3D
  teal:    "#00c4b4",
  text:    "#eeeef5",
  muted:   "#7777aa",
};

const S = {
  root:    { minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"'DM Sans','Segoe UI',sans-serif", maxWidth:480, margin:"0 auto", paddingBottom:72 },
  header:  { display:"flex", alignItems:"center", gap:10, padding:"14px 18px 10px", background:C.surface, borderBottom:`1px solid ${C.border}`, position:"sticky", top:0, zIndex:50 },
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

  preview:      { background:"rgba(227,20,31,0.07)", border:`1px solid rgba(227,20,31,0.2)`, borderRadius:12, padding:14, display:"flex", flexDirection:"column", gap:6 },
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
  pedidoGrupo:{ display:"flex", flexDirection:"column", gap:10, padding:12, borderRadius:16, border:`1px dashed ${C.border}`, background:"rgba(255,255,255,0.02)" },
  sueldoCard:{ borderRadius:16, padding:16, display:"flex", flexDirection:"column", border:"1px solid transparent" },
};
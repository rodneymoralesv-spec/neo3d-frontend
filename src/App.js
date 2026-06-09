import { useState, useEffect, useRef } from "react";

const CFG = {
  precioPorGramo: 0.02,
  precioPorHora: 0.30,
  porcentajeGanancia: 0.30,
  porcentajeRodney: 0.55,
  porcentajeDoris: 0.45,
};

const STORAGE_VENTAS    = "neo3d_ventas_v4";
const STORAGE_GASTOS    = "neo3d_gastos_v4";
const STORAGE_CATALOGO  = "neo3d_catalogo_v4";

const fmt = (n = 0) =>
  Number(n).toLocaleString("es-EC", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

const mesLabel = (ym) =>
  new Date(ym + "-02").toLocaleDateString("es-EC", { month: "long", year: "numeric" });

const hoyYM = () => {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`;
};

const calcPieza = ({ gramos, horas, manoDeObra }) => {
  const fil  = Number(gramos) * CFG.precioPorGramo;
  const hrs  = Number(horas)  * CFG.precioPorHora;
  const base = fil + hrs + Number(manoDeObra);
  const gan  = base * CFG.porcentajeGanancia;
  return { fil, hrs, base, gan, sugerido: base + gan };
};

const TABS = [
  { id: "calcular", icon: "⬡", label: "Calcular" },
  { id: "piezas",   icon: "▦", label: "Piezas"   },
  { id: "gastos",   icon: "↓", label: "Gastos"   },
  { id: "resumen",  icon: "◉", label: "Resumen"  },
];

// ─── APP ──────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("calcular");

  const [ventas, setVentas] = useState([]);

  const [gastos, setGastos] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_GASTOS)) || []; } catch { return []; }
  });
  const [catalogo, setCatalogo] = useState([]);

 useEffect(() => {
  fetch("https://neo3d-backend.onrender.com/gastos")
    .then(res => res.json())
    .then(data => setGastos(data));
}, []);

  
  const fetchVentas = () => {
  fetch("https://neo3d-backend.onrender.com/ventas")
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

const marcarPago = (id, estadoActual) => {
  fetch(`https://neo3d-backend.onrender.com/ventas/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pagado: !estadoActual,
    }),
  })
    .then(() => fetchVentas())
    .catch(err => console.log(err));
};


const fetchCatalogo = () => {
  fetch("https://neo3d-backend.onrender.com/catalogo")
    .then(res => res.json())
    .then(data => setCatalogo(data))
    .catch(err => console.log(err));
};

const eliminarVenta = (id) => {
  fetch(`https://neo3d-backend.onrender.com/ventas/${id}`, {
    method: "DELETE",
  })
    .then(() => fetchVentas())
    .catch(err => console.log(err));
};

const eliminarGasto = (id) => {
  fetch(`https://neo3d-backend.onrender.com/gastos/${id}`, {
    method: "DELETE",
  })
    .then(() => {
      // 🔥 volver a cargar desde backend
      fetch("https://neo3d-backend.onrender.com/gastos")
        .then(res => res.json())
        .then(data => setGastos(data));
    })
    .catch(err => console.log(err));
};

  // Guarda o actualiza una pieza en el catálogo
  
const guardarEnCatalogo = (pieza) => {
  fetch("https://neo3d-backend.onrender.com/catalogo", {
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


  const eliminarDeCatalogo = (nombre) =>
    setCatalogo(prev => prev.filter(p => p.nombre !== nombre));

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.headerIcon}>⬡</span>
        <div>
          <div style={S.headerTitle}>Neo3D</div>
          <div style={S.headerSub}>Rodney &amp; Doris</div>
        </div>
      </div>

      <main style={S.main}>
        {tab === "calcular" && (
          <TabCalcular
  setVentas={setVentas}
  catalogo={catalogo}
  guardarEnCatalogo={guardarEnCatalogo}
  eliminarDeCatalogo={eliminarDeCatalogo}
  fetchVentas={fetchVentas}
/>
        )}
        {tab === "piezas"  && <TabPiezas ventas={ventas} marcarPago={marcarPago} eliminarVenta={eliminarVenta} />}
        {tab === "gastos"  && <TabGastos gastos={gastos} setGastos={setGastos} eliminarGasto={eliminarGasto} />}
        {tab === "resumen" && <TabResumen ventas={ventas} gastos={gastos} />}
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
function TabCalcular({ setVentas, catalogo, guardarEnCatalogo, eliminarDeCatalogo, fetchVentas }) {
  const empty = { nombre: "", cliente: "", gramos: "", horas: "", manoDeObra: "", cantidad: "1", precioManual: "" };
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
  const calc  = valid ? calcPieza(form) : null;
  const cant  = Math.max(1, Number(form.cantidad) || 1);
  const precioUnit  = calc ? (Number(form.precioManual) > 0 ? Number(form.precioManual) : calc.sugerido) : 0;
  const precioTotal = precioUnit * cant;

  const guardar = () => {
  if (!valid) return;

  const nombre = form.nombre || "Pieza sin nombre";

  guardarEnCatalogo({
    nombre,
    gramos: Number(form.gramos),
    horas: Number(form.horas),
    manoDeObra: Number(form.manoDeObra),
  });

  fetch("https://neo3d-backend.onrender.com/ventas", {
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
    pagado: false,
    fecha: new Date().toISOString(),
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

  setForm(empty);
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

        {/* Gramos, horas, mano de obra */}
        <div style={S.row3}>
          <Field label="Gramos" hint="$0.02/g">
            <input style={S.input} type="number" name="gramos" value={form.gramos} onChange={ch} placeholder="0" min="0" />
          </Field>
          <Field label="Horas" hint="$0.30/h">
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

        {/* Preview */}
        {calc && (
          <div style={S.preview}>
            <div style={S.previewTitle}>Desglose por unidad</div>
            <Row label={`Filamento (${form.gramos}g)`} val={fmt(calc.fil)} />
            <Row label={`Horas (${form.horas}h)`}      val={fmt(calc.hrs)} />
            <Row label="Mano de obra"                   val={fmt(Number(form.manoDeObra))} />
            <div style={S.divider} />
            <Row label="Subtotal"        val={fmt(calc.base)} bold />
            <Row label="Ganancia 30%"    val={`+${fmt(calc.gan)}`} teal />
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
                    → {fmt(calcPieza(p).sugerido)}
                  </span>
                </div>
              </div>
              <button style={S.btnX} onClick={() => eliminarDeCatalogo(p.nombre)} title="Eliminar del catálogo">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Tarifas */}
      <div style={S.row3}>
        {[["⬡","$0.02","por gramo"],["◷","$0.30","por hora"],["◈","30%","ganancia"]].map(([ic,v,l]) => (
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

// ─── TAB PIEZAS ───────────────────────────────────────────
function TabPiezas({ ventas, marcarPago, eliminarVenta }) {
  const [filtro, setFiltro] = useState("todas");

  const lista = ventas.filter(v => {
  if (filtro === "pendientes") return !v.pagado;
  if (filtro === "pagadas") return v.pagado;
  return true;
});

  const pendTotal = ventas.filter(v => !v.pagado).reduce((s, v) => s + v.precioTotal, 0);

  return (
    <div style={S.section}>
      <SectionHeader title="Piezas" sub={`${ventas.length} registros en total`} />

      {pendTotal > 0 && (
        <div style={S.alertBox}>
          <span style={{ fontSize: 18 }}>⏳</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Por cobrar</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>{fmt(pendTotal)}</div>
          </div>
        </div>
      )}

      <div style={S.filterRow}>
        {[["todas","Todas"],["pendientes","Pendientes"],["pagadas","Pagadas"]].map(([v,l]) => (
          <button key={v} style={{ ...S.filterBtn, ...(filtro === v ? S.filterActive : {}) }} onClick={() => setFiltro(v)}>{l}</button>
        ))}
      </div>

      {lista.length === 0
        ? <Empty icon="▦" text="Sin piezas en esta categoría" />
        : lista.map(v => <VentaCard key={v.id} v={v} marcarPago={marcarPago} eliminarVenta={eliminarVenta} />)}
    </div>
  );
}

function VentaCard({ v, marcarPago, eliminarVenta }) {
  const [open, setOpen] = useState(false);
  const calc = calcPieza(v);
  const fecha = new Date(v.fecha).toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" });

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
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={S.vPrecio}>{fmt(v.precioTotal)}</div>
          <span style={{ ...S.badge, background: v.pagado ? C.teal + "22" : "#f8717122", color: v.pagado ? C.teal : "#f87171" }}>
            {v.pagado ? "✓ Pagado" : "Pendiente"}
          </span>
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

  fetch("https://neo3d-backend.onrender.com/gastos", {
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
      fetch("https://neo3d-backend.onrender.com/gastos")
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
function calcResumen(ventasArr, gastosArr) {
  let totalFil = 0, totalHrs = 0, totalMO = 0, totalGan = 0;
  let totalFact = 0, totalCobrado = 0;
  let filCobrado = 0, hrsCobrado = 0, moCobrado = 0;
  ventasArr.forEach(v => {
    const cc   = calcPieza(v);
    const cant = v.cantidad || 1;
    totalFil  += cc.fil  * cant;
    totalHrs  += cc.hrs  * cant;
    totalMO   += Number(v.manoDeObra) * cant;
    totalGan  += Math.max(0, v.precioTotal - cc.base * cant);
    totalFact += v.precioTotal;
    if (v.pagado) {
      totalCobrado += v.precioTotal;
      filCobrado   += cc.fil  * cant;
      hrsCobrado   += cc.hrs  * cant;
      moCobrado    += Number(v.manoDeObra) * cant;
    }
  });
  const totalGastos    = gastosArr.reduce((s, g) => s + g.monto, 0);
  const totalPendiente = totalFact - totalCobrado;
  // Sueldos y caja chica solo sobre lo cobrado
  const cuenta = totalCobrado - totalGastos;
  const ganCobrada     = ventasArr.filter(v => v.pagado).reduce((s, v) => {
    const cc = calcPieza(v); const cant = v.cantidad || 1;
    return s + Math.max(0, v.precioTotal - cc.base * cant);
  }, 0);
  const rodneyGan  = ganCobrada * CFG.porcentajeRodney;
  const dorisGan   = ganCobrada * CFG.porcentajeDoris;
  const rodneyTotal= rodneyGan + moCobrado;
  const dorisTotal = dorisGan;
  const cajaChica  = (filCobrado + hrsCobrado) - totalGastos;
  return {
    totalFact, totalCobrado, totalPendiente,
    totalFil, totalHrs, totalMO, totalGan, totalGastos,
    rodneyGan, dorisGan, rodneyTotal, dorisTotal,
    cajaChica, cuenta,
    numVentas: ventasArr.length,
    numPendientes: ventasArr.filter(v => !v.pagado).length,
  };
}

function TabResumen({ ventas, gastos }) {
  const mesesDisponibles = [...new Set([
    ...ventas.map(v => v.fecha.slice(0, 7)),
    ...gastos.map(g => g.fecha.slice(0, 7)),
  ])].sort().reverse();

  const [filtro, setFiltro] = useState(hoyYM());

  const ventasFiltradas = filtro === "global" ? ventas : ventas.filter(v => v.fecha.startsWith(filtro));
  const gastosFiltrados = filtro === "global" ? gastos : gastos.filter(g => g.fecha.startsWith(filtro));
  const r = calcResumen(ventasFiltradas, gastosFiltrados);
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
              <StatCard label="Por cobrar" val={fmt(r.totalPendiente)} sub={`${r.numPendientes} entregada${r.numPendientes !== 1 ? "s" : ""} sin pago`} color="#fbbf24" />
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
            {/* Sueldos */}
            <div style={S.previewTitle}>Sueldos del período</div>
            <div style={S.row2}>
              <div style={{ ...S.sueldoCard, borderColor: "rgba(255,107,53,0.4)", background: "rgba(255,107,53,0.07)" }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>Rodney</div>
                <div style={{ fontSize: 11, color: C.muted }}>55% gan. + mano de obra</div>
                <div style={{ fontSize: 24, fontWeight: 900, marginTop: 8 }}>{fmt(r.rodneyTotal)}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                  <div>Ganancia: {fmt(r.rodneyGan)}</div>
                  <div>MO: {fmt(r.totalMO)}</div>
                </div>
              </div>
              <div style={{ ...S.sueldoCard, borderColor: "rgba(0,196,180,0.4)", background: "rgba(0,196,180,0.07)" }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>Doris</div>
                <div style={{ fontSize: 11, color: C.muted }}>45% ganancia</div>
                <div style={{ fontSize: 24, fontWeight: 900, marginTop: 8 }}>{fmt(r.dorisTotal)}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                  <div>Ganancia: {fmt(r.dorisGan)}</div>
                </div>
              </div>
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
              <Row label="Sueldos (de cobrado)" val="" />
              <Row label="  Rodney"          val={fmt(r.rodneyTotal)} />
              <Row label="  Doris"           val={fmt(r.dorisTotal)} />
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
  row2:    { display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 },
  row3:    { display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 },
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
  btnOff: { opacity:0.35, cursor:"not-allowed" },
  btnX:   { background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:14, padding:"0 4px" },

  catalogoCard: { background:C.card, borderRadius:14, border:`1px solid ${C.border}`, padding:"14px 14px", display:"flex", alignItems:"center", gap:10 },
  chipCard:     { background:C.card, borderRadius:14, border:`1px solid ${C.border}`, padding:"12px 8px", display:"flex", flexDirection:"column", alignItems:"center", gap:3 },

  filterRow:   { display:"flex", gap:8 },
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

  gastoCard: { background:C.card, borderRadius:12, border:`1px solid ${C.border}`, padding:"12px 14px", display:"flex", alignItems:"center", gap:10 },

  enCuentaCard: { background:`linear-gradient(135deg,#1e3a5f,#1a2f4a)`, borderRadius:16, border:"1px solid rgba(99,179,237,0.3)", padding:"18px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 },
  totalCard: { background:`linear-gradient(135deg,${C.accent},#ff9a5c)`, borderRadius:18, padding:"20px 18px", textAlign:"center" },
  sueldoCard:{ borderRadius:16, padding:16, display:"flex", flexDirection:"column", border:"1px solid transparent" },
};
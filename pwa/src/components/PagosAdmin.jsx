import { useState, useEffect, useCallback } from 'react';
import { getSolicitudes, pagarSolicitud, asignarSemanaPago } from '../services/api';

// Tab "Pagos": cuentas por pagar (pagos autorizados) y ya pagadas, con selección
// y pago en lote. Antes vivía dentro de Reportes; ahora es su propia sección.

const TIPOS_PERIODO = ['Semanal', 'Mensual'];

const money = (v) => `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

// Estatus para mostrar: el pago se deriva del booleano autorizacionpago
// (NULL = esperando pago → 'Reparado'; 1 = 'Pago autorizado'; 0 = 'Pago rechazado').
const displayEstatus = (s) => {
  if (s.estatus === 'Reparado') {
    if (s.autorizacionpago === 1) return 'Pago autorizado';
    if (s.autorizacionpago === 0) return 'Pago rechazado';
  }
  return s.estatus;
};

// Rango [inicio, fin) del periodo. Semanal = lunes a domingo; Mensual = mes calendario.
// offset 0 = periodo actual, -1 = anterior, etc.
function rangoPeriodo(tipo, offset) {
  const hoy = new Date();
  if (tipo === 'Semanal') {
    const inicio = new Date(hoy);
    inicio.setHours(0, 0, 0, 0);
    inicio.setDate(inicio.getDate() - ((inicio.getDay() + 6) % 7) + offset * 7);
    const fin = new Date(inicio);
    fin.setDate(fin.getDate() + 7);
    return { inicio, fin };
  }
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth() + offset, 1);
  const fin = new Date(hoy.getFullYear(), hoy.getMonth() + offset + 1, 1);
  return { inicio, fin };
}

function etiquetaPeriodo(tipo, { inicio, fin }) {
  if (tipo === 'Mensual') {
    const txt = inicio.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }
  const ultimo = new Date(fin);
  ultimo.setDate(ultimo.getDate() - 1);
  const f = (d) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  return `${f(inicio)} — ${f(ultimo)} ${ultimo.getFullYear()}`;
}

// Hora de pared: interpreta el DATETIME guardado tal cual, SIN convertir zona horaria.
function parseWall(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
}

const enPeriodo = (raw, { inicio, fin }) => {
  const f = parseWall(raw);
  if (!f) return false;
  return f >= inicio && f < fin;
};

const formatFechaCorta = (raw) => {
  const d = parseWall(raw);
  return d ? d.toLocaleDateString('es-MX', { dateStyle: 'short' }) : '—';
};

// Semana efectiva del PO para agruparlo: la asignada manualmente (semanapago) o,
// si no hay, la de cierre. El sufijo de hora hace que parseWall la acepte.
const semanaEfectiva = (s) => (s.semanapago ? `${s.semanapago}T00:00:00` : s.fechacierre);

// Lunes (inicio de semana) de una fecha; misma aritmética que rangoPeriodo('Semanal').
function lunesDe(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
const dosDigitos = (n) => String(n).padStart(2, '0');
const toISODate = (d) => `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
const etiquetaSemana = (lunes) => {
  const fin = new Date(lunes);
  fin.setDate(fin.getDate() + 7);
  return etiquetaPeriodo('Semanal', { inicio: lunes, fin });
};

// ── Cuentas por pagar (pagos autorizados) ─────────────────────
// Solo tickets con pago AUTORIZADO (autorizacionpago = 1). El periodo se
// determina por la fecha de cierre de la reparación (no hay timestamp de
// la decisión de pago en la BD).
function CuentasPorPagar({ solicitudes, rango, onPagados, onReasignada }) {
  const [vista, setVista] = useState('porPagar'); // 'porPagar' | 'pagadas'

  const pagosAutorizados = solicitudes
    .filter((s) => displayEstatus(s) === 'Pago autorizado' && enPeriodo(semanaEfectiva(s), rango))
    .sort((a, b) => (parseWall(semanaEfectiva(a)) || 0) - (parseWall(semanaEfectiva(b)) || 0));

  const pagadas = solicitudes
    .filter((s) => s.estatus === 'Pagado' && enPeriodo(semanaEfectiva(s), rango))
    .sort((a, b) => (parseWall(semanaEfectiva(a)) || 0) - (parseWall(semanaEfectiva(b)) || 0));

  const lista = vista === 'porPagar' ? pagosAutorizados : pagadas;
  const totalMonto = lista.reduce((acc, s) => acc + Number(s.costoreal ?? s.costo ?? 0), 0);

  const [seleccion, setSeleccion] = useState(() => new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [comentario, setComentario] = useState('');
  const [pagando, setPagando] = useState(false);
  const [pagoError, setPagoError] = useState('');

  // Reasignación de semana de pago (una fila a la vez).
  const [reasignar, setReasignar] = useState(null);   // solicitud en edición | null
  const [semLunes, setSemLunes] = useState(null);      // Date del lunes objetivo
  const [reasignando, setReasignando] = useState(false);
  const [reasignarError, setReasignarError] = useState('');

  const abrirReasignar = (s) => {
    setReasignar(s);
    setSemLunes(lunesDe(parseWall(semanaEfectiva(s)) || new Date()));
    setReasignarError('');
  };
  const guardarSemana = async (semanaISO) => {
    setReasignando(true);
    setReasignarError('');
    try {
      await asignarSemanaPago(reasignar.idserviciomovil, semanaISO);
      onReasignada(reasignar.idserviciomovil, semanaISO);
      setReasignar(null);
    } catch (e) {
      setReasignarError(e?.response?.data?.message || 'Error al reasignar la semana.');
    } finally {
      setReasignando(false);
    }
  };

  const idsVisibles = pagosAutorizados.map((s) => s.idserviciomovil);
  const allSelected = idsVisibles.length > 0 && idsVisibles.every((id) => seleccion.has(id));
  const seleccionadas = pagosAutorizados.filter((s) => seleccion.has(s.idserviciomovil));
  const totalSeleccion = seleccionadas.reduce((acc, s) => acc + Number(s.costoreal ?? s.costo ?? 0), 0);

  const toggle = (id) => setSeleccion((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleAll = () => setSeleccion(allSelected ? new Set() : new Set(idsVisibles));

  const confirmarPago = async () => {
    const ids = seleccionadas.map((s) => s.idserviciomovil);
    if (ids.length === 0) return;
    setPagando(true);
    setPagoError('');
    try {
      const txt = comentario.trim();
      await Promise.all(ids.map((id) => pagarSolicitud(id, txt || null)));
      onPagados(ids, txt);
      setSeleccion(new Set());
      setModalOpen(false);
      setComentario('');
    } catch (e) {
      setPagoError(e?.response?.data?.message || 'Error al registrar el pago.');
    } finally {
      setPagando(false);
    }
  };

  return (
    <section className="reporte">
      <h3 className="reporte__titulo">Cuentas por pagar</h3>

      {/* Toggle: por pagar / ya pagadas (sobre el periodo seleccionado) */}
      <div className="periodo-tipos" style={{ marginTop: 4, marginBottom: 12 }}>
        <button
          type="button"
          className={`periodo-tipos__btn ${vista === 'porPagar' ? 'periodo-tipos__btn--active' : ''}`}
          onClick={() => setVista('porPagar')}
        >
          Por pagar ({pagosAutorizados.length})
        </button>
        <button
          type="button"
          className={`periodo-tipos__btn ${vista === 'pagadas' ? 'periodo-tipos__btn--active' : ''}`}
          onClick={() => setVista('pagadas')}
        >
          Pagadas ({pagadas.length})
        </button>
      </div>

      <p className="reporte__nota">
        {vista === 'porPagar'
          ? 'Pagos autorizados · por semana de pago · costo real'
          : 'Solicitudes pagadas · por semana de pago · costo real'}
      </p>

      {lista.length === 0 && (
        <p className="admin-estado">
          {vista === 'porPagar'
            ? 'Sin pagos autorizados en este periodo.'
            : 'Sin solicitudes pagadas en este periodo.'}
        </p>
      )}

      {vista === 'porPagar' && pagosAutorizados.length > 0 && (
        <div className="cxp-acciones">
          <label className="cxp-selall">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            Seleccionar todo
          </label>
          {seleccion.size > 0 && (
            <button
              type="button"
              className="btn-accion btn-accion--aprobar"
              onClick={() => { setPagoError(''); setModalOpen(true); }}
            >
              Pagar {seleccion.size} · {money(totalSeleccion)}
            </button>
          )}
        </div>
      )}

      {lista.map((s) => (
        <div key={s.idserviciomovil} className="cxp-row">
          {vista === 'porPagar' && (
            <input
              type="checkbox"
              className="cxp-row__check"
              checked={seleccion.has(s.idserviciomovil)}
              onChange={() => toggle(s.idserviciomovil)}
            />
          )}
          <div className="cxp-row__info">
            <span className="cxp-row__id">
              #{String(s.idserviciomovil)}{s.PO != null ? `  ·  PO ${s.PO}` : ''}
              {s.semanapago && <span className="cxp-reprog">Reprogramado</span>}
            </span>
            <span className="cxp-row__meta">
              {s.tunidad} · {s.numeconomico} · cierre {formatFechaCorta(s.fechacierre)}
            </span>
            {vista === 'porPagar' && (
              <button type="button" className="cxp-mover" onClick={() => abrirReasignar(s)}>
                Semana: {etiquetaSemana(lunesDe(parseWall(semanaEfectiva(s)) || new Date()))} ›
              </button>
            )}
            {vista === 'pagadas' && s.comentariocheckbox && (
              <span className="cxp-row__comentario">“{s.comentariocheckbox}”</span>
            )}
          </div>
          <span className="cxp-row__monto">{money(s.costoreal ?? s.costo)}</span>
        </div>
      ))}

      {lista.length > 0 && (
        <div className="cxp-total">
          <span className="cxp-total__label">
            Total ({lista.length} {lista.length === 1 ? 'ticket' : 'tickets'})
          </span>
          <span className="cxp-total__monto">{money(totalMonto)}</span>
        </div>
      )}

      {modalOpen && (
        <div className="detalle-modal" onClick={() => !pagando && setModalOpen(false)}>
          <div className="detalle-modal__card" onClick={(e) => e.stopPropagation()}>
            <div className="detalle-modal__header">
              <span className="solicitud__id">
                Pagar {seleccionadas.length} {seleccionadas.length === 1 ? 'ticket' : 'tickets'} · {money(totalSeleccion)}
              </span>
            </div>
            <p className="admin-estado" style={{ marginBottom: 12 }}>
              Se marcarán como <strong>Pagado</strong> y saldrán de cuentas por pagar. Comentario (opcional):
            </p>
            <textarea
              className="form-input"
              rows={3}
              placeholder="Comentario opcional…"
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
            />
            {pagoError && <div className="form-error" style={{ marginTop: 8 }}>{pagoError}</div>}
            <div className="solicitud__actions" style={{ marginTop: 14 }}>
              <button type="button" className="btn-accion" onClick={() => { setModalOpen(false); setComentario(''); }} disabled={pagando}>
                Cancelar
              </button>
              <button type="button" className="btn-accion btn-accion--aprobar" onClick={confirmarPago} disabled={pagando}>
                {pagando ? '...' : 'Confirmar pago'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reasignar la semana de pago de un PO (navegador de semanas) */}
      {reasignar && (
        <div className="detalle-modal" onClick={() => !reasignando && setReasignar(null)}>
          <div className="detalle-modal__card" onClick={(e) => e.stopPropagation()}>
            <div className="detalle-modal__header">
              <span className="solicitud__id">
                Mover a semana · #{String(reasignar.idserviciomovil)}{reasignar.PO != null ? ` · PO ${reasignar.PO}` : ''}
              </span>
              <button type="button" className="detalle-modal__cerrar" onClick={() => setReasignar(null)} aria-label="Cerrar">✕</button>
            </div>

            <div className="periodo-nav" style={{ marginTop: 4 }}>
              <button type="button" className="periodo-nav__btn"
                onClick={() => setSemLunes((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}>‹</button>
              <div className="periodo-nav__label-box">
                <span className="periodo-nav__label">{semLunes && etiquetaSemana(semLunes)}</span>
              </div>
              <button type="button" className="periodo-nav__btn"
                onClick={() => setSemLunes((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}>›</button>
            </div>

            {reasignarError && <div className="form-error" style={{ marginTop: 12 }}>{reasignarError}</div>}

            <div className="solicitud__actions" style={{ marginTop: 16 }}>
              {reasignar.semanapago && (
                <button type="button" className="btn-accion" disabled={reasignando}
                  onClick={() => guardarSemana(null)}>
                  {reasignando ? '...' : 'Quitar asignación'}
                </button>
              )}
              <button type="button" className="btn-accion btn-accion--aprobar" disabled={reasignando}
                onClick={() => guardarSemana(toISODate(semLunes))}>
                {reasignando ? '...' : 'Asignar a esta semana'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default function PagosAdmin() {
  const [solicitudes, setSolicitudes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tipoPeriodo, setTipoPeriodo] = useState('Semanal');
  const [offset, setOffset] = useState(0);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await getSolicitudes();
      setSolicitudes(data.data ?? []);
    } catch {
      setError('Error al cargar las cuentas por pagar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const rango = rangoPeriodo(tipoPeriodo, offset);

  return (
    <div>
      {/* Selector Semanal / Mensual */}
      <div className="periodo-tipos">
        {TIPOS_PERIODO.map((t) => (
          <button
            key={t}
            type="button"
            className={`periodo-tipos__btn ${tipoPeriodo === t ? 'periodo-tipos__btn--active' : ''}`}
            onClick={() => { setTipoPeriodo(t); setOffset(0); }}
          >
            {t}
          </button>
        ))}
        <button className="filtro-btn filtro-btn--reload" onClick={cargar} title="Recargar">↺</button>
      </div>

      {/* Navegación del periodo */}
      <div className="periodo-nav">
        <button type="button" className="periodo-nav__btn" onClick={() => setOffset((o) => o - 1)}>‹</button>
        <div className="periodo-nav__label-box">
          <span className="periodo-nav__label">{etiquetaPeriodo(tipoPeriodo, rango)}</span>
          {offset === 0 && <span className="periodo-nav__actual">Periodo actual</span>}
        </div>
        <button
          type="button"
          className="periodo-nav__btn"
          onClick={() => setOffset((o) => Math.min(0, o + 1))}
          disabled={offset === 0}
        >›</button>
      </div>

      {loading && <p className="admin-estado">Cargando cuentas por pagar...</p>}
      {error   && <div className="form-error">{error}</div>}

      {!loading && !error && (
        <CuentasPorPagar
          solicitudes={solicitudes}
          rango={rango}
          onPagados={(ids, comentario) => setSolicitudes((prev) =>
            prev.map((s) => ids.includes(s.idserviciomovil)
              ? { ...s, estatus: 'Pagado', comentariocheckbox: comentario || null }
              : s))}
          onReasignada={(id, semanaISO) => setSolicitudes((prev) =>
            prev.map((s) => s.idserviciomovil === id
              ? { ...s, semanapago: semanaISO }
              : s))}
        />
      )}
    </div>
  );
}

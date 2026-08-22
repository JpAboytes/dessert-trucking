import { useState, useEffect, useCallback } from 'react';
import { getSolicitudes } from '../services/api';

const TIPOS_PERIODO = ['Semanal', 'Mensual'];
const ESTATUS_KPI = ['Pendiente', 'En proceso', 'Reparado', 'Pago autorizado', 'Pagado', 'Rechazado', 'Pago rechazado'];

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

// ── Reporte 1: KPIs de tickets por estatus ────────────────────
function ReporteKpis({ solicitudes, rango }) {
  const delPeriodo = solicitudes.filter((s) => enPeriodo(s.fechahora, rango));
  const total = delPeriodo.length;
  const conteos = ESTATUS_KPI.map((est) => ({
    estatus: est,
    n: delPeriodo.filter((s) => displayEstatus(s) === est).length,
  }));

  return (
    <section className="reporte">
      <h3 className="reporte__titulo">Tickets por estatus</h3>
      <p className="reporte__nota">Por fecha de solicitud</p>

      {conteos.map(({ estatus, n }) => (
        <div key={estatus} className="kpi-row">
          <span className="kpi-row__label">{estatus}</span>
          <span className="kpi-row__track">
            {total > 0 && n > 0 && (
              <span className="kpi-row__bar" style={{ width: `${(n / total) * 100}%` }} />
            )}
          </span>
          <span className="kpi-row__valor">{n}</span>
          <span className="kpi-row__pct">{total > 0 ? `${Math.round((n / total) * 100)}%` : '—'}</span>
        </div>
      ))}

      <div className="kpi-row kpi-row--total">
        <span className="kpi-row__label">Total</span>
        <span className="kpi-row__track" />
        <span className="kpi-row__valor">{total}</span>
        <span className="kpi-row__pct">{total > 0 ? '100%' : '—'}</span>
      </div>
    </section>
  );
}

export default function ReportesAdmin() {
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
      setError('Error al cargar los datos del reporte.');
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

      {loading && <p className="admin-estado">Cargando reporte...</p>}
      {error   && <div className="form-error">{error}</div>}

      {!loading && !error && (
        <ReporteKpis solicitudes={solicitudes} rango={rango} />
      )}
    </div>
  );
}

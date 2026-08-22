import { useState, useEffect, useCallback } from 'react';
import { getUnidades, crearSolicitud, getMisSolicitudes, cerrarReparacion } from '../services/api';
import { subirFotos } from '../services/uploads';
import Toast from '../components/Toast';
import FotoThumb from '../components/FotoThumb';
import DetalleSolicitud from '../components/DetalleSolicitud';
import FotoPicker from '../components/FotoPicker';
import BotonNotificaciones from '../components/BotonNotificaciones';
import { useToast } from '../hooks/useToast';

const TIPOS_UNIDAD = ['Camión', 'Remolque'];
const TIPO_API     = { 'Camión': 'camion', 'Remolque': 'remolque' };
const FILTROS      = ['Todos', 'Pendiente', 'En proceso', 'Reparado', 'Pago autorizado', 'Pagado', 'Rechazado', 'Pago rechazado'];
const FILTROS_FECHA = ['Todo', 'Hoy', 'Últimos 7 días', 'Últimos 30 días'];
const POR_PAGINA   = 10;

const estatusSlug = (e) => e.toLowerCase().replace(/\s+/g, '-');
const money = (v) => `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

// Filtro por rango de fecha (presets). 'Hoy' = mismo día; N días = últimos N días.
function dentroDeRango(raw, rango) {
  if (rango === 'Todo') return true;
  const f = parseWall(raw);
  if (!f) return false;
  if (rango === 'Hoy') return f.toDateString() === new Date().toDateString();
  const dias = rango === 'Últimos 7 días' ? 7 : 30;
  const limite = new Date();
  limite.setDate(limite.getDate() - dias);
  return f >= limite;
}

// Bloque de fotos colapsable: oculto por defecto, se muestra con un botón.
function FotosColapsables({ fotos }) {
  const [abierto, setAbierto] = useState(false);
  if (!fotos?.length) return null;
  return (
    // stopPropagation: la tarjeta abre el modal de detalle al hacer clic.
    <div className="fotos-colapsables" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="fotos-toggle" onClick={() => setAbierto((a) => !a)}>
        {abierto ? 'Ocultar imágenes' : `Ver imágenes (${fotos.length})`}
      </button>
      {abierto && (
        <div className="solicitud__fotos">
          {fotos.map((f, i) => <FotoThumb key={i} url={f.url} />)}
        </div>
      )}
    </div>
  );
}

// Estatus para mostrar: el pago se deriva del booleano autorizacionpago
// (NULL = esperando pago → 'Reparado'; 1 = 'Pago autorizado'; 0 = 'Pago rechazado').
const displayEstatus = (s) => {
  if (s.estatus === 'Reparado') {
    if (s.autorizacionpago === 1) return 'Pago autorizado';
    if (s.autorizacionpago === 0) return 'Pago rechazado';
  }
  return s.estatus;
};

// Hora de pared: interpreta el DATETIME guardado tal cual, SIN convertir zona horaria.
// Acepta "2026-06-22 11:36:00" o el ISO con 'Z' que serializa el backend.
function parseWall(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
}

function formatFecha(raw) {
  const d = parseWall(raw);
  return d ? d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

function MisSolicitudes({ refreshKey }) {
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState('Todos');
  const [filtroFecha, setFiltroFecha] = useState('Todo');
  const [visibleCount, setVisibleCount] = useState(POR_PAGINA);
  const [detalleId, setDetalleId] = useState(null);

  useEffect(() => {
    setLoading(true);
    getMisSolicitudes()
      .then(({ data }) => setLista(data.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshKey]);

  // Al cambiar los filtros se vuelve a la primera página.
  useEffect(() => { setVisibleCount(POR_PAGINA); }, [filtro, filtroFecha]);

  if (loading) return <p className="admin-estado">Cargando solicitudes...</p>;

  // Más reciente primero (por id) + filtros por estatus (derivado para el pago) y fecha
  const ordenadas = [...lista].sort((a, b) => b.idserviciomovil - a.idserviciomovil);
  const visibles = ordenadas.filter((s) =>
    (filtro === 'Todos' || displayEstatus(s) === filtro) &&
    dentroDeRango(s.fechahora, filtroFecha)
  );
  const pagina = visibles.slice(0, visibleCount);
  const detalle = lista.find((s) => s.idserviciomovil === detalleId);

  return (
    <>
      {/* Filtros (estatus + fecha) */}
      <div className="filtros-select">
        <label className="filtros-select__group">
          <span className="filtros-select__label">Estatus</span>
          <select className="form-select" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
            {FILTROS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="filtros-select__group">
          <span className="filtros-select__label">Fecha</span>
          <select className="form-select" value={filtroFecha} onChange={(e) => setFiltroFecha(e.target.value)}>
            {FILTROS_FECHA.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
      </div>

      {visibles.length === 0 && (
        <p className="admin-estado">
          {lista.length === 0
            ? 'Aún no tienes solicitudes registradas.'
            : 'Sin solicitudes con los filtros seleccionados.'}
        </p>
      )}

      <div className="solicitudes-lista">
        {pagina.map((s) => (
        <div key={s.idserviciomovil} className="solicitud solicitud--clickable" onClick={() => setDetalleId(s.idserviciomovil)}>
          <div className="solicitud__header">
            <span className="solicitud__id">#{String(s.idserviciomovil)}</span>
            <span className={`solicitud__estatus solicitud__estatus--${estatusSlug(displayEstatus(s))}`}>
              {displayEstatus(s)}
            </span>
            {s.PO != null && <span className="po-box">PO {s.PO}</span>}
          </div>
          <div className="solicitud__meta">
            {s.tunidad}&nbsp;&middot;&nbsp;{s.numeconomico}&nbsp;&middot;&nbsp;{formatFecha(s.fechahora)}
          </div>
          {s.odometro != null && (
            <div className="solicitud__field">
              <span className="solicitud__field-label">Odómetro</span>
              {Number(s.odometro).toLocaleString('es-MX')} mi
            </div>
          )}
          <div className="solicitud__field">
            <span className="solicitud__field-label">Descripción</span>
            {s.descripcion}
          </div>
          <div className="solicitud__field">
            <span className="solicitud__field-label">Costo estimado</span>
            {money(s.costo)}
          </div>
          {s.costoreal != null && (
            <div className="solicitud__field">
              <span className="solicitud__field-label">Costo real</span>
              {money(s.costoreal)}
            </div>
          )}
          {s.nombreaprobador && (
            <div className="solicitud__field">
              <span className="solicitud__field-label">
                {s.estatus === 'Rechazado' ? 'Rechazado por' : 'Autorizado por'}
              </span>
              {s.nombreaprobador}
            </div>
          )}
          {displayEstatus(s) === 'Pago rechazado' && s.nombrepagador && (
            <div className="solicitud__field">
              <span className="solicitud__field-label">Rechazado por</span>
              {s.nombrepagador}
            </div>
          )}
          {displayEstatus(s) === 'Pago rechazado' && s.comentariorechazo && (
            <div className="solicitud__field">
              <span className="solicitud__field-label">Motivo del rechazo de pago</span>
              {s.comentariorechazo}
            </div>
          )}
          <FotosColapsables fotos={s.fotos} />
        </div>
        ))}
      </div>

      {visibles.length > visibleCount && (
        <button type="button" className="btn-ver-mas" onClick={() => setVisibleCount((c) => c + POR_PAGINA)}>
          Ver más solicitudes ({visibles.length - visibleCount})
        </button>
      )}

      {detalle && <DetalleSolicitud s={detalle} onClose={() => setDetalleId(null)} />}
    </>
  );
}

// ── Reparaciones en proceso (el mecánico cierra el ticket) ─────
function ReparacionesEnProceso({ refreshKey, showToast }) {
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [localKey, setLocalKey] = useState(0);
  const [visibleCount, setVisibleCount] = useState(POR_PAGINA);

  useEffect(() => {
    setLoading(true);
    getMisSolicitudes()
      .then(({ data }) => setLista((data.data ?? []).filter((s) => s.estatus === 'En proceso')))
      .catch(() => setLista([]))
      .finally(() => setLoading(false));
  }, [refreshKey, localKey]);

  if (loading) return <p className="admin-estado">Cargando reparaciones...</p>;
  if (lista.length === 0) return <p className="admin-estado">No tienes reparaciones en proceso.</p>;

  const ordenadas = [...lista].sort((a, b) => b.idserviciomovil - a.idserviciomovil);

  return (
    <>
    <div className="solicitudes-lista">
      {ordenadas.slice(0, visibleCount).map((s) => (
        <div key={s.idserviciomovil} className="solicitud">
          <div className="solicitud__header">
            <span className="solicitud__id">#{String(s.idserviciomovil)}</span>
            <span className={`solicitud__estatus solicitud__estatus--${estatusSlug(s.estatus)}`}>
              {s.estatus}
            </span>
            {s.PO != null && <span className="po-box">PO {s.PO}</span>}
          </div>
          <div className="solicitud__meta">
            {s.tunidad}&nbsp;&middot;&nbsp;{s.numeconomico}&nbsp;&middot;&nbsp;{formatFecha(s.fechahora)}
          </div>
          <div className="solicitud__field">
            <span className="solicitud__field-label">Descripción</span>
            {s.descripcion}
          </div>
          <div className="solicitud__field">
            <span className="solicitud__field-label">Costo estimado</span>
            {money(s.costo)}
          </div>
          <CerrarTicketForm solicitud={s} showToast={showToast} onClosed={() => setLocalKey((k) => k + 1)} />
        </div>
      ))}
    </div>

    {ordenadas.length > visibleCount && (
      <button type="button" className="btn-ver-mas" onClick={() => setVisibleCount((c) => c + POR_PAGINA)}>
        Ver más solicitudes ({ordenadas.length - visibleCount})
      </button>
    )}
    </>
  );
}

// ── Formulario de cierre de un ticket ─────────────────────────
function CerrarTicketForm({ solicitud, showToast, onClosed }) {
  const [costoReal, setCostoReal] = useState('');
  const [fotos, setFotos] = useState([]);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const costo = parseFloat(costoReal);
    if (costoReal === '' || isNaN(costo) || costo < 0) {
      showToast('Ingresa un costo real válido', 'error');
      return;
    }
    setLoading(true);
    try {
      const urls = await subirFotos(fotos);
      await cerrarReparacion(solicitud.idserviciomovil, { costoReal, fotos: urls });
      showToast(`Reparación #${String(solicitud.idserviciomovil)} cerrada`);
      onClosed?.();
    } catch {
      showToast('Error al cerrar la reparación', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="cierre-form" onSubmit={submit}>
      <div className="form-group">
        <label className="form-label">Costo real ($)</label>
        <input type="number" min="0" step="0.01" className="form-input"
          value={costoReal} onChange={(e) => setCostoReal(e.target.value)} placeholder="0.00" />
      </div>
      <div className="form-group">
        <label className="form-label">Fotografías del cierre (máx. 7)</label>
        <FotoPicker fotos={fotos} onChange={setFotos} disabled={loading} />
      </div>
      <button type="submit" className="btn-submit" disabled={loading}>
        {loading ? 'Cerrando...' : 'Marcar como reparado'}
      </button>
    </form>
  );
}

export default function MecanicoForm({ user, tab, setTab }) {
  const [form, setForm] = useState({
    fechaHora: '', tipoUnidad: '', numeroEconomico: '',
    descripcionServicio: '', costoEstimado: '', odometro: '',
  });
  const [unidades, setUnidades] = useState([]);
  const [loadingUnidades, setLoadingUnidades] = useState(false);
  const [status, setStatus] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [fotos, setFotos] = useState([]);
  const { toast, showToast, hideToast } = useToast();

  const esCamion = form.tipoUnidad === 'Camión';
  const tieneApi = !!TIPO_API[form.tipoUnidad];

  useEffect(() => {
    if (!tieneApi) { setUnidades([]); return; }
    setLoadingUnidades(true);
    setForm((p) => ({ ...p, numeroEconomico: '' }));
    getUnidades(TIPO_API[form.tipoUnidad])
      .then(({ data }) => setUnidades(data.data ?? []))
      .catch(() => setUnidades([]))
      .finally(() => setLoadingUnidades(false));
  }, [form.tipoUnidad]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'tipoUnidad') setForm((p) => ({ ...p, tipoUnidad: value, numeroEconomico: '' }));
    else setForm((p) => ({ ...p, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('loading');
    setErrorMsg('');
    try {
      const payload = { ...form };
      if (!esCamion) delete payload.odometro;
      payload.fotos = await subirFotos(fotos);
      await crearSolicitud(payload);
      setStatus(null);
      setForm({ fechaHora: '', tipoUnidad: '', numeroEconomico: '',
                descripcionServicio: '', costoEstimado: '', odometro: '' });
      setFotos([]);
      setUnidades([]);
      setRefreshKey((k) => k + 1);
      setTab('mis');
      showToast('Solicitud enviada correctamente');
    } catch (err) {
      setErrorMsg(err.response?.data?.message || 'Error al enviar la solicitud');
      setStatus('error');
      showToast('Error al enviar la solicitud', 'error');
    }
  };

  return (
    <>
      <Toast message={toast.message} type={toast.type} onDismiss={hideToast} />

      <BotonNotificaciones showToast={showToast} />

      {tab === 'crear' ? (
      <form className="form form--full" onSubmit={handleSubmit} autoComplete="off">
        <div className="form-greeting">
          <p className="form-greeting__text">Hola, <strong>{user.nombre}</strong></p>
          <p className="form-greeting__sub">Complete el formulario para solicitar autorización de servicio.</p>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="fechaHora">Fecha y hora</label>
          <input id="fechaHora" type="datetime-local" name="fechaHora"
            value={form.fechaHora} onChange={handleChange} required className="form-input" />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="tipoUnidad">Tipo de unidad</label>
          <select id="tipoUnidad" name="tipoUnidad" value={form.tipoUnidad}
            onChange={handleChange} required className="form-select">
            <option value="">— Seleccionar —</option>
            {TIPOS_UNIDAD.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {esCamion && (
          <div className="form-group">
            <label className="form-label" htmlFor="odometro">Odómetro (mi)</label>
            <input id="odometro" type="number" name="odometro" value={form.odometro}
              onChange={handleChange} required min="0" className="form-input" placeholder="0" />
          </div>
        )}

        {form.tipoUnidad && (
          <div className="form-group">
            <label className="form-label" htmlFor="numeroEconomico">Número económico</label>
            <select id="numeroEconomico" name="numeroEconomico" value={form.numeroEconomico}
              onChange={handleChange} required disabled={loadingUnidades} className="form-select">
              <option value="">{loadingUnidades ? 'Cargando...' : '— Seleccionar —'}</option>
              {unidades.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        )}

        <div className="form-group">
          <label className="form-label" htmlFor="descripcionServicio">Descripción del servicio</label>
          <textarea id="descripcionServicio" name="descripcionServicio" value={form.descripcionServicio}
            onChange={handleChange} required rows={4} className="form-textarea" />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="costoEstimado">Costo estimado ($Mxn)</label>
          <input id="costoEstimado" type="number" name="costoEstimado" value={form.costoEstimado}
            onChange={handleChange} required min="0" step="0.01" className="form-input" placeholder="0.00" />
        </div>

        <div className="form-group">
          <label className="form-label">Fotografías (máx. 7)</label>
          <FotoPicker fotos={fotos} onChange={setFotos} disabled={status === 'loading'} />
        </div>

        {status === 'error' && <div className="form-error">{errorMsg}</div>}

        <button type="submit" className="btn-submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Enviando...' : 'Solicitar autorización'}
        </button>
      </form>
      ) : tab === 'proceso' ? (
      <div>
        <div className="user-block">
          <p className="user-block__name">Reparaciones en proceso</p>
        </div>
        <ReparacionesEnProceso refreshKey={refreshKey} showToast={showToast} />
      </div>
      ) : (
      <div>
        <div className="user-block">
          <p className="user-block__name">Mis solicitudes</p>
        </div>
        <MisSolicitudes refreshKey={refreshKey} />
      </div>
      )}
    </>
  );
}

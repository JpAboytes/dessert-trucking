import { useState, useEffect, useCallback } from 'react';
import { getSolicitudes, actualizarEstatus, autorizarPago } from '../services/api';
import Toast from '../components/Toast';
import FotoThumb from '../components/FotoThumb';
import DetalleSolicitud from '../components/DetalleSolicitud';
import BotonNotificaciones from '../components/BotonNotificaciones';
import ReportesAdmin from '../components/ReportesAdmin';
import PagosAdmin from '../components/PagosAdmin';
import FiltrosPanel from '../components/FiltrosPanel';
import { useToast } from '../hooks/useToast';

const ESTATUS_LABEL = {
  Pendiente:        'Pendiente',
  'En proceso':     'En proceso',
  Reparado:         'Reparado',
  'Pago autorizado':'Pago autorizado',
  Pagado:           'Pagado',
  Rechazado:        'Rechazado',
  'Pago rechazado': 'Pago rechazado',
};

const POR_PAGINA = 10;

// Filtros de la vista. Todos opcionales; vacío = sin filtrar por ese campo.
const FILTROS_VACIOS = { estatus: 'Todos', tipoUnidad: '', po: '', fechaInicio: '', fechaFin: '' };

// slug para la clase CSS del badge ('En proceso' -> 'en-proceso')
const estatusSlug = (e) => e.toLowerCase().replace(/\s+/g, '-');
const money = (v) => `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

// ¿La solicitud pasa todos los filtros activos? (fecha por fecha de solicitud)
function coincideFiltros(s, f) {
  if (f.estatus !== 'Todos' && displayEstatus(s) !== f.estatus) return false;
  if (f.tipoUnidad && s.tunidad !== f.tipoUnidad) return false;
  if (f.po.trim() && !String(s.PO ?? '').includes(f.po.trim())) return false;
  if (f.fechaInicio || f.fechaFin) {
    const d = parseWall(s.fechahora);
    if (!d) return false;
    if (f.fechaInicio && d < parseWall(`${f.fechaInicio}T00:00:00`)) return false;
    if (f.fechaFin && d > parseWall(`${f.fechaFin}T23:59:59`)) return false;
  }
  return true;
}

// Chips descriptivos de los filtros activos (para el indicador). Cada uno sabe
// cómo "limpiarse" devolviendo los campos a restablecer.
function chipsActivos(f) {
  const chips = [];
  if (f.estatus !== 'Todos') chips.push({ key: 'estatus', label: f.estatus, reset: { estatus: 'Todos' } });
  if (f.tipoUnidad)          chips.push({ key: 'tipoUnidad', label: f.tipoUnidad, reset: { tipoUnidad: '' } });
  if (f.po.trim())           chips.push({ key: 'po', label: `PO ${f.po.trim()}`, reset: { po: '' } });
  if (f.fechaInicio)         chips.push({ key: 'fechaInicio', label: `Desde ${f.fechaInicio}`, reset: { fechaInicio: '' } });
  if (f.fechaFin)            chips.push({ key: 'fechaFin', label: `Hasta ${f.fechaFin}`, reset: { fechaFin: '' } });
  return chips;
}

// Bloque de fotos colapsable (Apertura/Cierre): oculto por defecto.
function FotosColapsables({ fotos }) {
  const [abierto, setAbierto] = useState(false);
  if (!fotos?.length) return null;
  return (
    // stopPropagation: la tarjeta del admin abre el modal de detalle al hacer clic
    <div className="fotos-colapsables" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="fotos-toggle" onClick={() => setAbierto((a) => !a)}>
        {abierto ? 'Ocultar imágenes' : `Ver imágenes (${fotos.length})`}
      </button>
      {abierto && (
        <div className="solicitud__fotos">
          {['Apertura', 'Cierre'].map((tipo) => {
            const fs = fotos.filter((f) => f.tipo === tipo);
            if (fs.length === 0) return null;
            return (
              <div key={tipo} className="solicitud__foto-col">
                <span className="solicitud__field-label">{tipo}</span>
                <div className="solicitud__fotos-row">
                  {fs.map((f, i) => <FotoThumb key={i} url={f.url} />)}
                </div>
              </div>
            );
          })}
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

// El detalle (modal) vive en components/DetalleSolicitud, compartido por admin y mecánico.

function SolicitudRow({ s, onActualizar, onPago, onToast, onVerDetalle }) {
  const [loading, setLoading] = useState(null);
  const [rechazoOpen, setRechazoOpen] = useState(false);
  const [comentario, setComentario] = useState('');
  const est = displayEstatus(s);

  const handleEstatus = async (estatus, etiqueta) => {
    setLoading(estatus);
    try {
      await onActualizar(s.idserviciomovil, estatus);
      onToast(`Solicitud #${String(s.idserviciomovil)} ${etiqueta}`);
    } catch (e) {
      onToast(e?.response?.data?.message || 'Error al actualizar la solicitud', 'error');
    }
    setLoading(null);
  };

  const handlePago = async (aprobado, comentarioRechazo) => {
    const key = aprobado ? 'pago-si' : 'pago-no';
    setLoading(key);
    try {
      await onPago(s.idserviciomovil, aprobado, comentarioRechazo);
      onToast(`Pago de #${String(s.idserviciomovil)} ${aprobado ? 'autorizado' : 'rechazado'}`);
    } catch (e) {
      onToast(e?.response?.data?.message || 'Error al registrar el pago', 'error');
    }
    setLoading(null);
  };

  const confirmarRechazo = async () => {
    const txt = comentario.trim();
    if (!txt) return;
    await handlePago(false, txt);
    setRechazoOpen(false);
    setComentario('');
  };

  return (
    <div className="solicitud solicitud--clickable" onClick={() => onVerDetalle(s)}>
      <div className="solicitud__header">
        <span className="solicitud__id">#{String(s.idserviciomovil)}</span>
        <span className={`solicitud__estatus solicitud__estatus--${estatusSlug(est)}`}>
          {ESTATUS_LABEL[est] ?? est}
        </span>
        {s.PO != null && <span className="po-box">PO {s.PO}</span>}
      </div>

      <div className="solicitud__meta">
        {s.nombresolicitante}&nbsp;&middot;&nbsp;{s.tunidad}&nbsp;&middot;&nbsp;{s.numeconomico}&nbsp;&middot;&nbsp;{formatFecha(s.fechahora)}
      </div>

      {s.nombreaprobador && (
        <div className="solicitud__field">
          <span className="solicitud__field-label">
            {s.estatus === 'Rechazado' ? 'Rechazado por' : 'Autorizado por'}
          </span>
          {s.nombreaprobador}
        </div>
      )}

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

      <FotosColapsables fotos={s.fotos} />

      {s.estatus === 'Pendiente' && (
        <div className="solicitud__actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="btn-accion btn-accion--aprobar"
            onClick={() => handleEstatus('En proceso', 'autorizada')}
            disabled={!!loading}
          >
            {loading === 'En proceso' ? '...' : 'Aprobar'}
          </button>
          <button
            className="btn-accion btn-accion--rechazar"
            onClick={() => handleEstatus('Rechazado', 'rechazada')}
            disabled={!!loading}
          >
            {loading === 'Rechazado' ? '...' : 'Rechazar'}
          </button>
        </div>
      )}

      {est === 'Reparado' && (
        <div className="solicitud__actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="btn-accion btn-accion--aprobar"
            onClick={() => handlePago(true)}
            disabled={!!loading}
          >
            {loading === 'pago-si' ? '...' : 'Autorizar pago'}
          </button>
          <button
            className="btn-accion btn-accion--rechazar"
            onClick={() => setRechazoOpen(true)}
            disabled={!!loading}
          >
            {loading === 'pago-no' ? '...' : 'Rechazar pago'}
          </button>
        </div>
      )}

      {/* La corrección de un pago rechazado (Autorizar pago) vive ahora dentro del modal de detalle. */}

      {/* Modal de confirmación de rechazo de pago con comentario obligatorio. */}
      {rechazoOpen && (
        <div className="detalle-modal" onClick={(e) => { e.stopPropagation(); setRechazoOpen(false); setComentario(''); }}>
          <div className="detalle-modal__card" onClick={(e) => e.stopPropagation()}>
            <div className="detalle-modal__header">
              <span className="solicitud__id">Rechazar pago · #{String(s.idserviciomovil)}</span>
            </div>
            <p className="admin-estado" style={{ marginBottom: 12 }}>
              ¿Seguro que quieres rechazar el pago? Deja un comentario para el mecánico (obligatorio).
            </p>
            <textarea
              className="form-input"
              rows={4}
              placeholder="Motivo del rechazo…"
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
            />
            <div className="solicitud__actions" style={{ marginTop: 14 }}>
              <button
                className="btn-accion"
                onClick={() => { setRechazoOpen(false); setComentario(''); }}
                disabled={!!loading}
              >
                Cancelar
              </button>
              <button
                className="btn-accion btn-accion--rechazar"
                disabled={!comentario.trim() || !!loading}
                onClick={confirmarRechazo}
              >
                {loading === 'pago-no' ? '...' : 'Confirmar rechazo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminView({ tab = 'solicitudes' }) {
  const [solicitudes, setSolicitudes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(FILTROS_VACIOS); // filtros que afectan la lista
  const [draft, setDraft] = useState(FILTROS_VACIOS);     // edición dentro del panel
  const [panelOpen, setPanelOpen] = useState(false);
  const [detalleId, setDetalleId] = useState(null);
  const [visibleCount, setVisibleCount] = useState(POR_PAGINA);
  const { toast, showToast, hideToast } = useToast();

  // Al cambiar los filtros aplicados se vuelve a la primera página.
  useEffect(() => { setVisibleCount(POR_PAGINA); }, [applied]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await getSolicitudes();
      setSolicitudes(data.data ?? []);
    } catch {
      setError('Error al cargar las solicitudes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const handleActualizar = async (id, estatus) => {
    try {
      await actualizarEstatus(id, estatus);
      setSolicitudes((prev) =>
        prev.map((s) => s.idserviciomovil === id ? { ...s, estatus } : s)
      );
    } catch (e) {
      cargar(); // el estado en BD difiere del de la lista (p. ej. 409): resincronizar
      throw e;  // que el child muestre el mensaje real del servidor
    }
  };

  const handlePago = async (id, aprobado, comentarioRechazo) => {
    try {
      await autorizarPago(id, aprobado, comentarioRechazo);
      setSolicitudes((prev) =>
        prev.map((s) => s.idserviciomovil === id
          ? { ...s, autorizacionpago: aprobado ? 1 : 0, comentariorechazo: aprobado ? null : comentarioRechazo }
          : s)
      );
    } catch (e) {
      cargar();
      throw e;
    }
  };

  // El modal guarda solo el id: así el detalle se refresca si la solicitud cambia.
  const detalle = solicitudes.find((s) => s.idserviciomovil === detalleId);

  // Opciones de tipo de unidad: los valores distintos presentes en los datos (ya legibles).
  const tipoUnidadOptions = [...new Set(solicitudes.map((s) => s.tunidad).filter(Boolean))].sort();
  const lista = solicitudes.filter((s) => coincideFiltros(s, applied));
  const chips = chipsActivos(applied);
  const visibles = lista.slice(0, visibleCount);

  const abrirPanel = () => { setDraft(applied); setPanelOpen(true); };
  const aplicar    = () => { setApplied(draft); setPanelOpen(false); };
  const limpiar    = () => { setDraft(FILTROS_VACIOS); setApplied(FILTROS_VACIOS); };
  const quitarChip = (reset) => setApplied((a) => ({ ...a, ...reset }));

  return (
    <div>
      <Toast message={toast.message} type={toast.type} onDismiss={hideToast} />

      <BotonNotificaciones showToast={showToast} />

      {tab === 'reportes' ? (
        <ReportesAdmin />
      ) : tab === 'pagos' ? (
        <PagosAdmin />
      ) : (
        <>
      {/* Barra de filtros: botón que abre el panel (con indicador de activos) + recarga */}
      <div className="filtros-wrap">
        <div className="filtros-bar">
          <button type="button" className="filtros-btn" onClick={abrirPanel}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 5h18M6 12h12M10 19h4" />
            </svg>
            Filtros
            {chips.length > 0 && <span className="filtros-badge">{chips.length}</span>}
          </button>
          <button className="filtro-btn filtro-btn--reload" onClick={cargar} title="Recargar">↺</button>
        </div>

        {panelOpen && (
          <FiltrosPanel
            draft={draft}
            setDraft={setDraft}
            tipoUnidadOptions={tipoUnidadOptions}
            onAplicar={aplicar}
            onLimpiar={limpiar}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </div>

      {/* Indicador de filtros activos: chips removibles */}
      {chips.length > 0 && (
        <div className="filtros-chips">
          {chips.map((c) => (
            <button key={c.key} type="button" className="filtros-chip" onClick={() => quitarChip(c.reset)}>
              {c.label} <span className="filtros-chip__x">✕</span>
            </button>
          ))}
          <button type="button" className="filtros-chip filtros-chip--clear" onClick={limpiar}>
            Limpiar todo
          </button>
        </div>
      )}

      {loading && <p className="admin-estado">Cargando solicitudes...</p>}
      {error   && <div className="form-error">{error}</div>}

      {!loading && !error && lista.length === 0 && (
        <p className="admin-estado">Sin solicitudes con los filtros seleccionados.</p>
      )}

      <div className="solicitudes-lista">
        {visibles.map((s) => (
          <SolicitudRow
            key={s.idserviciomovil}
            s={s}
            onActualizar={handleActualizar}
            onPago={handlePago}
            onToast={showToast}
            onVerDetalle={(sol) => setDetalleId(sol.idserviciomovil)}
          />
        ))}
      </div>

      {lista.length > visibleCount && (
        <button type="button" className="btn-ver-mas" onClick={() => setVisibleCount((c) => c + POR_PAGINA)}>
          Ver más solicitudes ({lista.length - visibleCount})
        </button>
      )}
        </>
      )}

      {detalle && (
        <DetalleSolicitud
          s={detalle}
          onClose={() => setDetalleId(null)}
          onAutorizarPago={async (id) => {
            try {
              await handlePago(id, true);
              showToast(`Pago de #${String(id)} autorizado`);
            } catch (e) {
              showToast(e?.response?.data?.message || 'Error al registrar el pago', 'error');
            }
          }}
        />
      )}
    </div>
  );
}

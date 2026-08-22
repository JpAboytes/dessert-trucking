// Panel de filtros de Solicitudes (admin). Un solo markup, dos formas por ancho:
//   · móvil  → bottom sheet (overlay oscuro + hoja inferior)
//   · desktop → dropdown anclado bajo la barra de filtros
// (ver .filtros-* en index.css). Edita un borrador; el padre aplica/limpia.

const ESTATUS = ['Todos', 'Pendiente', 'En proceso', 'Reparado', 'Pago autorizado', 'Pagado', 'Rechazado', 'Pago rechazado'];

export default function FiltrosPanel({ draft, setDraft, tipoUnidadOptions, onAplicar, onLimpiar, onClose }) {
  const set = (campo) => (e) => setDraft((d) => ({ ...d, [campo]: e.target.value }));

  return (
    <>
      <div className="filtros-overlay" onClick={onClose} />
      <div className="filtros-panel" role="dialog" aria-label="Filtros">
        <div className="filtros-panel__head">
          <span className="filtros-panel__titulo">Filtros</span>
          <button type="button" className="detalle-modal__cerrar" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="filtros-campo">
          <span className="filtros-select__label">Estatus</span>
          <select className="form-select" value={draft.estatus} onChange={set('estatus')}>
            {ESTATUS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        <div className="filtros-campo">
          <span className="filtros-select__label">Tipo de unidad</span>
          <select className="form-select" value={draft.tipoUnidad} onChange={set('tipoUnidad')}>
            <option value="">Todos</option>
            {tipoUnidadOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="filtros-campo">
          <span className="filtros-select__label">PO</span>
          <input
            type="text"
            inputMode="numeric"
            className="form-input"
            placeholder="Buscar por PO…"
            value={draft.po}
            onChange={set('po')}
          />
        </div>

        <div className="filtros-rango">
          <div className="filtros-campo">
            <span className="filtros-select__label">Fecha inicial</span>
            <input type="date" className="form-input" value={draft.fechaInicio}
              max={draft.fechaFin || undefined} onChange={set('fechaInicio')} />
          </div>
          <div className="filtros-campo">
            <span className="filtros-select__label">Fecha final</span>
            <input type="date" className="form-input" value={draft.fechaFin}
              min={draft.fechaInicio || undefined} onChange={set('fechaFin')} />
          </div>
        </div>

        <div className="filtros-panel__actions">
          <button type="button" className="btn-accion filtros-limpiar" onClick={onLimpiar}>
            Limpiar filtros
          </button>
          <button type="button" className="btn-accion btn-accion--aprobar" onClick={onAplicar}>
            Aplicar filtros
          </button>
        </div>
      </div>
    </>
  );
}

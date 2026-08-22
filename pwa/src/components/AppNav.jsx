// Navegación principal por secciones. Un solo markup sirve para dos formas:
//   · móvil  → barra de tabs inferior (fixed bottom)
//   · desktop → sidebar izquierdo (ver @media en index.css)
// El estado del tab vive en Home (shell); aquí solo renderizamos y avisamos.
// Cada item trae `icon` (clave) → SVG de trazo que hereda el color (currentColor).

const I = (props) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    className="appnav__icon" aria-hidden="true" {...props} />
);

const ICONS = {
  // Crear: signo + en círculo
  crear: <I><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></I>,
  // En proceso: llave/herramienta
  proceso: <I><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8 7.2 20l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.2-2.2 2.6-2.6z" /></I>,
  // Mis solicitudes: documento con líneas
  mis: <I><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></I>,
  // Solicitudes (admin): pila de documentos
  solicitudes: <I><path d="M8 4h9l3 3v11H8z" /><path d="M17 4v3h3" /><path d="M4 8v12h11" /></I>,
  // Reportes: barras
  reportes: <I><path d="M4 20h16" /><rect x="6" y="11" width="3" height="6" /><rect x="11" y="7" width="3" height="10" /><rect x="16" y="13" width="3" height="4" /></I>,
  // Pagos: billete con moneda
  pagos: <I><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9v6M18 9v6" /></I>,
};

export default function AppNav({ items, active, onSelect }) {
  return (
    <nav className="appnav" aria-label="Secciones">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className={`appnav__item ${active === it.key ? 'appnav__item--active' : ''}`}
          aria-current={active === it.key ? 'page' : undefined}
          onClick={() => onSelect(it.key)}
        >
          {ICONS[it.icon]}
          <span className="appnav__label">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

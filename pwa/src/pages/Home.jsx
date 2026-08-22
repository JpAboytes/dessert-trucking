import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import MecanicoForm from './MecanicoForm';
import AdminView from './AdminView';
import AppNav from '../components/AppNav';
import Logo from '../components/Logo';

// Secciones por rol. El shell (Home) mantiene el tab activo y lo baja a la vista.
// `icon` = clave del SVG en AppNav.
const NAV = {
  Mantenimiento: [
    { key: 'crear',   label: 'Crear',           icon: 'crear' },
    { key: 'proceso', label: 'En proceso',      icon: 'proceso' },
    { key: 'mis',     label: 'Mis solicitudes', icon: 'mis' },
  ],
  Administrador: [
    { key: 'solicitudes', label: 'Solicitudes', icon: 'solicitudes' },
    { key: 'reportes',    label: 'Reportes',    icon: 'reportes' },
    { key: 'pagos',       label: 'Pagos',       icon: 'pagos' },
  ],
};

// Título del bloque de usuario (admin) según la sección activa.
const TITULO_ADMIN = {
  solicitudes: 'Solicitudes de servicio',
  reportes:    'Reportes',
  pagos:       'Cuentas por pagar',
};

export default function Home() {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const user = token ? jwtDecode(token) : {};

  const navItems = NAV[user.tusuario] ?? [];
  const [tab, setTab] = useState(navItems[0]?.key);

  const handleLogout = () => {
    localStorage.clear();
    navigate('/');
  };

  return (
    <div className="page">
      <header className="masthead">
        <div className="masthead__left">
          <Logo size="sm" />
          <div className="masthead__brand">
            <span className="masthead__title">Desert Transport</span>
            <span className="masthead__subtitle">SERVICE CENTER</span>
          </div>
        </div>
        <button className="masthead__action" onClick={handleLogout}>
          Cerrar sesión
        </button>
      </header>

      <div className="app-body">
        {navItems.length > 0 && (
          <AppNav items={navItems} active={tab} onSelect={setTab} />
        )}

        <main className="content">
          {user.tusuario === 'Mantenimiento' && (
            <MecanicoForm user={user} tab={tab} setTab={setTab} />
          )}

          {user.tusuario === 'Administrador' && (
            <>
              <div className="user-block">
                <p className="user-block__name">
                  {TITULO_ADMIN[tab] ?? 'Solicitudes de servicio'}
                </p>
                <p className="user-block__meta">
                  {user.nombre}&nbsp;&middot;&nbsp;Administrador
                </p>
              </div>
              <AdminView tab={tab} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

// Adjunta el JWT en cada request si existe
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Si el backend responde 401 (token vencido o inválido), cierra la sesión y manda a login.
// Cubre el caso de que el token expire con la app abierta; el guard de ruta cubre el arranque.
// Excepción: el propio /login responde 401 con credenciales malas — ahí ya estamos en '/'.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && window.location.pathname !== '/') {
      localStorage.clear();
      window.location.replace('/');
    }
    return Promise.reject(error);
  }
);

export const loginRequest = (usuario, password) =>
  api.post('/login', { usuario, password });

export const getUnidades = (tipo) =>
  api.get('/unidades', { params: { tipo } });

export const crearSolicitud = (data) =>
  api.post('/solicitudes', data);

export const getMisSolicitudes = () =>
  api.get('/mis-solicitudes');

export const cerrarReparacion = (id, { costoReal, fotos }) =>
  api.patch(`/mis-solicitudes/${id}`, { costoReal, fotos });

export const getPresignUrl = (contentType = 'image/jpeg') =>
  api.post('/uploads/presign', { contentType });

export const suscribirPush = (subscription) =>
  api.post('/push/subscribe', subscription);

// Decisión de pago del admin sobre un ticket Reparado (true = autorizar, false = rechazar).
// Al rechazar, comentarioRechazo es obligatorio (lo verá el mecánico).
export const autorizarPago = (id, autorizacionPago, comentarioRechazo) =>
  api.patch(`/admin/solicitudes/${id}`, { autorizacionPago, comentarioRechazo });

export const getSolicitudes = () =>
  api.get('/admin/solicitudes');

// Marca como pagado un ticket con pago autorizado (estatus -> 'Pagado'); comentario opcional.
export const pagarSolicitud = (id, comentarioCheckbox) =>
  api.patch(`/admin/solicitudes/${id}`, { pagar: true, comentarioCheckbox });

// Reasigna la semana de pago de un PO "por pagar" (semanaPago: 'YYYY-MM-DD' | null para quitar).
export const asignarSemanaPago = (id, semanaPago) =>
  api.patch(`/admin/solicitudes/${id}`, { semanaPago });

export const actualizarEstatus = (id, estatus) =>
  api.patch(`/admin/solicitudes/${id}`, { estatus });

export default api;

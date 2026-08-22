import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/api';

const authAxios = async () => {
  const token = await AsyncStorage.getItem('token');
  return axios.create({
    baseURL: API_URL,
    headers: { Authorization: `Bearer ${token}` },
  });
};

export const getUnidades = async (tipo) => {
  const api = await authAxios();
  return api.get('/unidades', { params: { tipo } });
};

export const crearSolicitud = async (data) => {
  const api = await authAxios();
  return api.post('/solicitudes', data);
};

export const getMisSolicitudes = async () => {
  const api = await authAxios();
  return api.get('/mis-solicitudes');
};

export const getSolicitudes = async () => {
  const api = await authAxios();
  return api.get('/admin/solicitudes');
};

// Marca como pagado un ticket con pago autorizado (estatus -> 'Pagado'); comentario opcional.
export const pagarSolicitud = async (id, comentarioCheckbox) => {
  const api = await authAxios();
  return api.patch(`/admin/solicitudes/${id}`, { pagar: true, comentarioCheckbox });
};

export const actualizarEstatus = async (id, estatus) => {
  const api = await authAxios();
  return api.patch(`/admin/solicitudes/${id}`, { estatus });
};

export const getPresignUrl = async (contentType = 'image/jpeg') => {
  const api = await authAxios();
  return api.post('/uploads/presign', { contentType });
};

export const cerrarReparacion = async (id, { costoReal, fotos }) => {
  const api = await authAxios();
  return api.patch(`/mis-solicitudes/${id}`, { costoReal, fotos });
};

// Decisión de pago del admin sobre un ticket Reparado (true = autorizar, false = rechazar).
// Al rechazar, comentarioRechazo es obligatorio (lo verá el mecánico).
export const autorizarPago = async (id, autorizacionPago, comentarioRechazo) => {
  const api = await authAxios();
  return api.patch(`/admin/solicitudes/${id}`, { autorizacionPago, comentarioRechazo });
};

// Reasigna la semana de pago de un PO "por pagar" (semanaPago: 'YYYY-MM-DD' | null para quitar).
export const asignarSemanaPago = async (id, semanaPago) => {
  const api = await authAxios();
  return api.patch(`/admin/solicitudes/${id}`, { semanaPago });
};

export const registerPushToken = async (expoPushToken) => {
  const api = await authAxios();
  return api.put('/push-token', { expoPushToken });
};

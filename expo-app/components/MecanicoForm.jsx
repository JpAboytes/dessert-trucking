import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Modal, FlatList, ActivityIndicator, Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { getUnidades, crearSolicitud, getMisSolicitudes, cerrarReparacion } from '../services/solicitudes';
import { subirFotos } from '../services/uploads';
import FotoPicker from './FotoPicker';
import FotoThumb from './FotoThumb';
import DetalleSolicitud from './DetalleSolicitud';

const INK        = '#0a0a0a';
const BRAND      = '#046738';
const BROWN      = '#553111';
const RED        = '#C0202A';
const WARNING    = '#E6A100';
const NEUTRAL    = '#737373';
const LIME       = '#84CC16';
const INK_MID    = '#444444';
const INK_LIGHT  = '#888888';
const RULE       = '#bbbbbb';
const PAPER      = '#ffffff';
const PAPER_TINT = '#f2f1ee';

const serif = Platform.OS === 'ios' ? 'Georgia' : 'serif';
const sans  = Platform.OS === 'ios' ? 'Helvetica Neue' : 'sans-serif';
const mono  = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

const TIPOS_UNIDAD = ['Camión', 'Remolque'];
const TIPO_API     = { 'Camión': 'camion', 'Remolque': 'remolque' };
const FILTROS      = ['Todos', 'Pendiente', 'En proceso', 'Reparado', 'Pago autorizado', 'Pagado', 'Rechazado', 'Pago rechazado'];
const FILTROS_FECHA = ['Todo', 'Hoy', '7 días', '30 días'];
const POR_PAGINA   = 10;

const money = (v) => `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

// Hora de pared: interpreta el DATETIME guardado tal cual, SIN convertir zona horaria.
// Acepta "2026-06-22 11:36:00" o el ISO con 'Z' que serializa el backend, y devuelve un Date
// local con esos mismos números (lo que está en BD es lo que se muestra).
function parseWall(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
}

// Hora de pared local (sin zona) para mandar al backend: "YYYY-MM-DDTHH:MM:SS".
function toWallString(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function formatFecha(raw) {
  const d = parseWall(raw);
  return d ? d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

// Filtro por rango de fecha (presets). 'Hoy' = mismo día; N días = últimos N días.
function dentroDeRango(raw, rango) {
  if (rango === 'Todo') return true;
  const f = parseWall(raw);
  if (!f) return false;
  if (rango === 'Hoy') return f.toDateString() === new Date().toDateString();
  const dias = rango === '7 días' ? 7 : 30;
  const limite = new Date();
  limite.setDate(limite.getDate() - dias);
  return f >= limite;
}

// Bloque de fotos colapsable: oculto por defecto, se muestra con un botón.
function FotosColapsables({ fotos, agrupar = false }) {
  const [abierto, setAbierto] = useState(false);
  if (!fotos?.length) return null;
  return (
    <View style={{ marginTop: 8 }}>
      <TouchableOpacity style={styles.fotosToggle} onPress={() => setAbierto((a) => !a)} activeOpacity={0.7}>
        <Text style={styles.fotosToggleText}>
          {abierto ? 'Ocultar imágenes' : `Ver imágenes (${fotos.length})`}
        </Text>
      </TouchableOpacity>
      {abierto && (agrupar ? (
        <View style={styles.fotosBlock}>
          {['Apertura', 'Cierre'].map((tipo) => {
            const fs = fotos.filter((f) => f.tipo === tipo);
            if (fs.length === 0) return null;
            return (
              <View key={tipo} style={styles.fotoCol}>
                <Text style={styles.campoLabel}>{tipo}</Text>
                <View style={styles.fotosRowAdmin}>
                  {fs.map((f, i) => <FotoThumb key={i} url={f.url} size={48} />)}
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.fotosRow}>
          {fotos.map((f, i) => <FotoThumb key={i} url={f.url} />)}
        </View>
      ))}
    </View>
  );
}

const estatusStyleOf = (estatus) => ({
  Pendiente:        styles.estatusPendiente,
  'En proceso':     styles.estatusProceso,
  Reparado:         styles.estatusReparado,
  'Pago autorizado': styles.estatusPagoAutorizado,
  Pagado:           styles.estatusPagado,
  Rechazado:        styles.estatusRechazado,
  'Pago rechazado': styles.estatusRechazado,
}[estatus] ?? {});

// Estatus para mostrar: el pago se deriva del booleano autorizacionpago
// (NULL = esperando pago → 'Reparado'; 1 = 'Pago autorizado'; 0 = 'Pago rechazado').
const displayEstatus = (s) => {
  if (s.estatus === 'Reparado') {
    if (s.autorizacionpago === 1) return 'Pago autorizado';
    if (s.autorizacionpago === 0) return 'Pago rechazado';
  }
  return s.estatus;
};

// ── Select modal B&W ─────────────────────────────────────────
function CustomSelect({ value, options, onChange, placeholder, disabled }) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <TouchableOpacity
        style={[styles.input, styles.selectTrigger, disabled && { opacity: 0.5 }]}
        onPress={() => !disabled && setVisible(true)}
        activeOpacity={0.7}
        disabled={disabled}
      >
        <Text style={[styles.monoText, !value && { color: INK_LIGHT }]}>
          {disabled ? 'Cargando...' : (value || placeholder)}
        </Text>
        <Text style={styles.selectCaret}>▾</Text>
      </TouchableOpacity>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <TouchableOpacity style={styles.overlay} onPress={() => setVisible(false)} activeOpacity={1}>
          <View style={styles.sheet}>
            <FlatList
              data={options}
              keyExtractor={(item, i) => `${item}-${i}`}
              ItemSeparatorComponent={() => <View style={styles.sheetDivider} />}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.sheetOption} onPress={() => { onChange(item); setVisible(false); }}>
                  <Text style={[styles.sheetOptionText, item === value && { fontWeight: '700' }]}>{item}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ── Lista mis solicitudes ─────────────────────────────────────
function MisSolicitudes({ refreshKey }) {
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState('Todos');
  const [filtroFecha, setFiltroFecha] = useState('Todo');
  const [visibleCount, setVisibleCount] = useState(POR_PAGINA);
  const [detalleId, setDetalleId] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getMisSolicitudes();
      setLista(data.data ?? []);
    } catch {
      setLista([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar, refreshKey]);

  // Al cambiar los filtros se vuelve a la primera página.
  useEffect(() => { setVisibleCount(POR_PAGINA); }, [filtro, filtroFecha]);

  if (loading) return <ActivityIndicator color={INK} style={{ marginTop: 16 }} />;

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
      <View style={styles.filtroSelects}>
        <View style={styles.filtroSelectCol}>
          <Text style={styles.filtroSelectLabel}>Estatus</Text>
          <CustomSelect value={filtro} options={FILTROS} onChange={setFiltro} placeholder="Todos" />
        </View>
        <View style={styles.filtroSelectCol}>
          <Text style={styles.filtroSelectLabel}>Fecha</Text>
          <CustomSelect value={filtroFecha} options={FILTROS_FECHA} onChange={setFiltroFecha} placeholder="Todo" />
        </View>
      </View>

      {visibles.length === 0 && (
        <Text style={styles.emptyText}>
          {lista.length === 0
            ? 'Aún no tienes solicitudes registradas.'
            : 'Sin solicitudes con los filtros seleccionados.'}
        </Text>
      )}

      {pagina.map((s) => (
        <TouchableOpacity
          key={s.idserviciomovil}
          style={styles.solicitudItem}
          activeOpacity={0.9}
          onPress={() => setDetalleId(s.idserviciomovil)}
        >
          <View style={styles.solicitudHeader}>
            <Text style={styles.solicitudId}>#{String(s.idserviciomovil)}</Text>
            <View style={[styles.estatusBadge, estatusStyleOf(displayEstatus(s))]}>
              <Text style={[styles.estatusText, estatusStyleOf(displayEstatus(s))]}>{displayEstatus(s).toUpperCase()}</Text>
            </View>
            {s.PO != null && (
              <View style={styles.poBox}><Text style={styles.poText}>PO {s.PO}</Text></View>
            )}
          </View>
          <Text style={styles.solicitudMeta}>
            {s.tunidad} · {s.numeconomico} · {formatFecha(s.fechahora)}
          </Text>
          {s.odometro != null && (
            <View style={styles.campo}>
              <Text style={styles.campoLabel}>Odómetro  </Text>
              <Text style={styles.campoValor}>{Number(s.odometro).toLocaleString('es-MX')} mi</Text>
            </View>
          )}
          <View style={styles.campo}>
            <Text style={styles.campoLabel}>Descripción  </Text>
            <Text style={styles.campoValor}>{s.descripcion}</Text>
          </View>
          <View style={styles.campo}>
            <Text style={styles.campoLabel}>Costo estimado  </Text>
            <Text style={styles.campoValor}>{money(s.costo)}</Text>
          </View>
          {s.costoreal != null && (
            <View style={styles.campo}>
              <Text style={styles.campoLabel}>Costo real  </Text>
              <Text style={styles.campoValor}>{money(s.costoreal)}</Text>
            </View>
          )}
          {s.nombreaprobador && (
            <View style={styles.campo}>
              <Text style={styles.campoLabel}>
                {s.estatus === 'Rechazado' ? 'Rechazado por  ' : 'Autorizado por  '}
              </Text>
              <Text style={styles.campoValor}>{s.nombreaprobador}</Text>
            </View>
          )}
          {displayEstatus(s) === 'Pago rechazado' && s.nombrepagador ? (
            <View style={styles.campo}>
              <Text style={styles.campoLabel}>Rechazado por  </Text>
              <Text style={styles.campoValor}>{s.nombrepagador}</Text>
            </View>
          ) : null}
          {displayEstatus(s) === 'Pago rechazado' && s.comentariorechazo ? (
            <View style={styles.campo}>
              <Text style={styles.campoLabel}>Motivo del rechazo de pago  </Text>
              <Text style={styles.campoValor}>{s.comentariorechazo}</Text>
            </View>
          ) : null}
          <FotosColapsables fotos={s.fotos} />
        </TouchableOpacity>
      ))}

      {visibles.length > visibleCount && (
        <TouchableOpacity
          style={styles.btnVerMas}
          onPress={() => setVisibleCount((c) => c + POR_PAGINA)}
          activeOpacity={0.7}
        >
          <Text style={styles.btnVerMasText}>Ver más solicitudes ({visibles.length - visibleCount})</Text>
        </TouchableOpacity>
      )}

      {detalle && <DetalleSolicitud solicitud={detalle} onClose={() => setDetalleId(null)} />}
    </>
  );
}

// ── Reparaciones en proceso (el mecánico cierra el ticket) ─────
function ReparacionesEnProceso({ refreshKey, showToast }) {
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [localKey, setLocalKey] = useState(0);
  const [visibleCount, setVisibleCount] = useState(POR_PAGINA);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getMisSolicitudes();
      setLista((data.data ?? []).filter((s) => s.estatus === 'En proceso'));
    } catch {
      setLista([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar, refreshKey, localKey]);

  if (loading) return <ActivityIndicator color={INK} style={{ marginTop: 16 }} />;

  if (lista.length === 0) {
    return <Text style={styles.emptyText}>No tienes reparaciones en proceso.</Text>;
  }

  const ordenadas = [...lista].sort((a, b) => b.idserviciomovil - a.idserviciomovil);

  return (
    <>
      {ordenadas.slice(0, visibleCount).map((s) => (
        <View key={s.idserviciomovil} style={styles.solicitudItem}>
          <View style={styles.solicitudHeader}>
            <Text style={styles.solicitudId}>#{String(s.idserviciomovil)}</Text>
            <View style={[styles.estatusBadge, estatusStyleOf(s.estatus)]}>
              <Text style={[styles.estatusText, estatusStyleOf(s.estatus)]}>{s.estatus.toUpperCase()}</Text>
            </View>
            {s.PO != null && (
              <View style={styles.poBox}><Text style={styles.poText}>PO {s.PO}</Text></View>
            )}
          </View>
          <Text style={styles.solicitudMeta}>
            {s.tunidad} · {s.numeconomico} · {formatFecha(s.fechahora)}
          </Text>
          <View style={styles.campo}>
            <Text style={styles.campoLabel}>Descripción  </Text>
            <Text style={styles.campoValor}>{s.descripcion}</Text>
          </View>
          <View style={styles.campo}>
            <Text style={styles.campoLabel}>Costo estimado  </Text>
            <Text style={styles.campoValor}>{money(s.costo)}</Text>
          </View>
          <CerrarTicketForm solicitud={s} showToast={showToast} onClosed={() => setLocalKey((k) => k + 1)} />
        </View>
      ))}

      {ordenadas.length > visibleCount && (
        <TouchableOpacity
          style={styles.btnVerMas}
          onPress={() => setVisibleCount((c) => c + POR_PAGINA)}
          activeOpacity={0.7}
        >
          <Text style={styles.btnVerMasText}>Ver más solicitudes ({ordenadas.length - visibleCount})</Text>
        </TouchableOpacity>
      )}
    </>
  );
}

// ── Formulario de cierre de un ticket ─────────────────────────
function CerrarTicketForm({ solicitud, showToast, onClosed }) {
  const [costoReal, setCostoReal] = useState('');
  const [fotos, setFotos] = useState([]);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const costo = parseFloat(costoReal);
    if (costoReal === '' || isNaN(costo) || costo < 0) {
      showToast?.('Ingresa un costo real válido', 'error');
      return;
    }
    setLoading(true);
    try {
      const urls = await subirFotos(fotos);
      await cerrarReparacion(solicitud.idserviciomovil, { costoReal, fotos: urls });
      showToast?.(`Reparación #${String(solicitud.idserviciomovil)} cerrada`);
      onClosed?.();
    } catch {
      showToast?.('Error al cerrar la reparación', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.cierreBox}>
      <Text style={styles.label}>Costo real ($)</Text>
      <TextInput
        style={styles.input}
        value={costoReal}
        onChangeText={setCostoReal}
        placeholder="0.00"
        placeholderTextColor={INK_LIGHT}
        keyboardType="decimal-pad"
      />
      <Text style={[styles.label, { marginTop: 12 }]}>Fotografías del cierre (máx. 7)</Text>
      <FotoPicker fotos={fotos} onChange={setFotos} disabled={loading} />
      <TouchableOpacity
        style={[styles.btn, { marginTop: 12 }, loading && { backgroundColor: INK_LIGHT }]}
        onPress={submit}
        disabled={loading}
        activeOpacity={0.7}
      >
        {loading
          ? <ActivityIndicator color={PAPER} />
          : <Text style={styles.btnText}>Marcar como reparado</Text>
        }
      </TouchableOpacity>
    </View>
  );
}

// ── Formulario principal ──────────────────────────────────────
export default function MecanicoForm({ user, showToast, tab, setTab }) {
  const [form, setForm] = useState({
    tipoUnidad: '', numeroEconomico: '',
    descripcionServicio: '', costoEstimado: '', odometro: '',
  });
  const [fechaHora, setFechaHora] = useState(new Date());
  const [fotos, setFotos] = useState([]);
  const [showPicker, setShowPicker]   = useState(false);
  const [pickerMode, setPickerMode]   = useState('date');
  const [unidades, setUnidades] = useState([]);
  const [loadingUnidades, setLoadingUnidades] = useState(false);
  const [status, setStatus] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const esCamion = form.tipoUnidad === 'Camión';

  useEffect(() => {
    const tipoApi = TIPO_API[form.tipoUnidad];
    if (!tipoApi) { setUnidades([]); return; }
    setLoadingUnidades(true);
    setForm((p) => ({ ...p, numeroEconomico: '' }));
    getUnidades(tipoApi)
      .then(({ data }) => setUnidades(data.data ?? []))
      .catch(() => setUnidades([]))
      .finally(() => setLoadingUnidades(false));
  }, [form.tipoUnidad]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (field) => (value) => setForm((p) => ({ ...p, [field]: value }));
  const setTipo = (value) => setForm((p) => ({ ...p, tipoUnidad: value, numeroEconomico: '' }));

  const onPickerChange = (event, selected) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
      if (event.type === 'dismissed') return;
      if (pickerMode === 'date') {
        // combinar la fecha seleccionada con la hora actual
        const next = new Date(selected);
        next.setHours(fechaHora.getHours(), fechaHora.getMinutes());
        setFechaHora(next);
        // abrir picker de hora
        setPickerMode('time');
        setShowPicker(true);
      } else {
        const next = new Date(fechaHora);
        next.setHours(selected.getHours(), selected.getMinutes());
        setFechaHora(next);
        setPickerMode('date');
      }
    } else {
      if (selected) setFechaHora(selected);
    }
  };

  const formatFechaHora = (d) =>
    d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });

  const handleSubmit = async () => {
    const { tipoUnidad, numeroEconomico, descripcionServicio, costoEstimado, odometro } = form;
    if (!tipoUnidad || !numeroEconomico || !descripcionServicio || !costoEstimado) {
      setErrorMsg('Completa todos los campos requeridos.');
      setStatus('error');
      return;
    }
    setStatus('loading');
    setErrorMsg('');
    try {
      const urls = await subirFotos(fotos);
      await crearSolicitud({
        fechaHora: toWallString(fechaHora),
        tipoUnidad, numeroEconomico, descripcionServicio, costoEstimado,
        ...(esCamion ? { odometro } : {}),
        fotos: urls,
      });
      setForm({ tipoUnidad: '', numeroEconomico: '',
                descripcionServicio: '', costoEstimado: '', odometro: '' });
      setFechaHora(new Date());
      setFotos([]);
      setUnidades([]);
      setStatus(null);
      setRefreshKey((k) => k + 1);
      setTab('mis');
      showToast?.('Solicitud enviada correctamente');
    } catch (err) {
      setErrorMsg(err.response?.data?.message || 'Error al enviar la solicitud');
      setStatus('error');
      showToast?.('Error al enviar la solicitud', 'error');
    }
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

      {tab === 'crear' ? (
      <>
      {/* ── Formulario ── */}
      <View style={styles.greeting}>
        <Text style={styles.greetingText}>
          Hola, <Text style={{ fontWeight: '700' }}>{user.nombre}</Text>
        </Text>
        <Text style={styles.greetingSub}>Complete el formulario para solicitar autorización de servicio.</Text>
      </View>

      <View style={styles.fieldWrap}>
        <Text style={styles.label}>Fecha y hora</Text>
        <TouchableOpacity
          style={[styles.input, styles.selectTrigger]}
          onPress={() => { setPickerMode('date'); setShowPicker(true); }}
          activeOpacity={0.7}
        >
          <Text style={styles.monoText}>{formatFechaHora(fechaHora)}</Text>
          <Text style={styles.selectCaret}>▾</Text>
        </TouchableOpacity>
      </View>

      {showPicker && (
        <DateTimePicker
          value={fechaHora}
          mode={Platform.OS === 'ios' ? 'datetime' : pickerMode}
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={onPickerChange}
          locale="es-MX"
        />
      )}

      <View style={styles.fieldWrap}>
        <Text style={styles.label}>Tipo de unidad</Text>
        <CustomSelect value={form.tipoUnidad} options={TIPOS_UNIDAD} onChange={setTipo} placeholder="— Seleccionar —" />
      </View>

      {esCamion && (
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>Odómetro (mi)</Text>
          <TextInput style={styles.input} value={form.odometro} onChangeText={set('odometro')}
            placeholder="0" placeholderTextColor={INK_LIGHT} keyboardType="numeric" />
        </View>
      )}

      {!!form.tipoUnidad && (
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>Número económico</Text>
          <CustomSelect value={form.numeroEconomico} options={unidades} onChange={set('numeroEconomico')}
            placeholder="— Seleccionar —" disabled={loadingUnidades} />
        </View>
      )}

      <View style={styles.fieldWrap}>
        <Text style={styles.label}>Descripción del servicio</Text>
        <TextInput style={[styles.input, styles.textarea]} value={form.descripcionServicio}
          onChangeText={set('descripcionServicio')} multiline numberOfLines={4}
          textAlignVertical="top" placeholderTextColor={INK_LIGHT} placeholder="Describe el servicio requerido" />
      </View>

      <View style={styles.fieldWrap}>
        <Text style={styles.label}>Costo estimado ($Mxn)</Text>
        <TextInput style={styles.input} value={form.costoEstimado} onChangeText={set('costoEstimado')}
          placeholder="0.00" placeholderTextColor={INK_LIGHT} keyboardType="decimal-pad" />
      </View>

      <View style={styles.fieldWrap}>
        <Text style={styles.label}>Fotografías (máx. 7)</Text>
        <FotoPicker fotos={fotos} onChange={setFotos} disabled={status === 'loading'} />
      </View>

      {status === 'error' && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.btn, status === 'loading' && { backgroundColor: INK_LIGHT }]}
        onPress={handleSubmit} disabled={status === 'loading'} activeOpacity={0.7}
      >
        {status === 'loading'
          ? <ActivityIndicator color={PAPER} />
          : <Text style={styles.btnText}>Solicitar autorización</Text>
        }
      </TouchableOpacity>

      </>
      ) : tab === 'proceso' ? (
      <View style={styles.misSolicitudesSection}>
        <ReparacionesEnProceso refreshKey={refreshKey} showToast={showToast} />
      </View>
      ) : (
      <View style={styles.misSolicitudesSection}>
        <MisSolicitudes refreshKey={refreshKey} />
      </View>
      )}

    </ScrollView>
  );
}

// Sombra suave estilo iOS para tarjetas y botones destacados.
const CARD_SHADOW = {
  shadowColor: INK,
  shadowOpacity: 0.06,
  shadowOffset: { width: 0, height: 4 },
  shadowRadius: 12,
  elevation: 2,
};

const styles = StyleSheet.create({
  scroll:     { flex: 1 },
  container:  { padding: 24, paddingBottom: 48 },

  greeting: { marginBottom: 24 },
  greetingText: { fontFamily: serif, fontSize: 18, color: INK, marginBottom: 4 },
  greetingSub: { fontFamily: sans, fontSize: 11, letterSpacing: 0.5, color: INK_MID },

  row:       { flexDirection: 'row' },
  fieldWrap: { marginBottom: 20 },
  label: {
    fontFamily: sans, fontSize: 10, fontWeight: '700',
    letterSpacing: 2, textTransform: 'uppercase', color: INK, marginBottom: 6,
  },
  input: {
    backgroundColor: PAPER_TINT, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: mono, fontSize: 14, color: INK,
  },
  monoText: { fontFamily: mono, fontSize: 14, color: INK, flex: 1 },
  textarea:  { minHeight: 96, textAlignVertical: 'top' },

  selectTrigger: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  selectCaret:   { fontFamily: sans, fontSize: 14, color: INK, marginLeft: 8 },

  // Diálogo centrado (no bottom sheet: abajo interfiere con la barra de navegación del teléfono)
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 36 },
  sheet:   {
    backgroundColor: PAPER, borderRadius: 20,
    maxHeight: 380, paddingVertical: 6, overflow: 'hidden', ...CARD_SHADOW,
  },
  sheetDivider:     { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RULE },
  sheetOption:      { paddingHorizontal: 20, paddingVertical: 14 },
  sheetOptionText:  { fontFamily: mono, fontSize: 14, color: INK },

  photoPlaceholder: { borderWidth: 1, borderColor: RULE, borderStyle: 'dashed', borderRadius: 12, padding: 20, alignItems: 'center' },
  photoPlaceholderText: { fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: INK_LIGHT },

  errorBox:  { backgroundColor: PAPER_TINT, borderRadius: 12, borderLeftWidth: 3, borderLeftColor: INK, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 20 },
  errorText: { fontFamily: sans, fontSize: 13, color: INK },

  btn:     { backgroundColor: BRAND, paddingVertical: 15, alignItems: 'center', borderRadius: 14, ...CARD_SHADOW },
  btnText: { fontFamily: sans, color: PAPER, fontWeight: '700', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase' },

  // Sección mis solicitudes
  misSolicitudesSection: { marginTop: 0 },
  sectionTitle: { fontFamily: serif, fontSize: 18, fontWeight: '700', color: INK },
  sectionRule:  { borderTopWidth: 3, borderTopColor: BROWN, marginTop: 8, marginBottom: 8 },
  emptyText:    { fontFamily: sans, fontSize: 12, color: INK_MID, fontStyle: 'italic', marginTop: 12 },

  // Filtros (estatus + fecha) como selects
  filtroSelects:     { flexDirection: 'row', gap: 12, marginBottom: 16 },
  filtroSelectCol:   { flex: 1 },
  filtroSelectLabel: { fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: '700', color: INK_LIGHT, marginBottom: 6 },

  // Toggle de fotos (pill)
  fotosToggle:     { alignSelf: 'flex-start', backgroundColor: PAPER_TINT, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  fotosToggleText: { fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: '700', color: INK },
  fotosBlock:      { gap: 10, marginTop: 8 },
  fotoCol:         { gap: 4 },
  fotosRowAdmin:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  // Items solicitud (tarjeta iOS)
  solicitudItem: {
    backgroundColor: PAPER, borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: RULE, ...CARD_SHADOW,
  },
  solicitudHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  solicitudId:  { fontFamily: mono, fontSize: 14, fontWeight: '700', color: INK },
  poBox:  { backgroundColor: PAPER_TINT, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  poText: { fontFamily: sans, fontSize: 8, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700', color: INK },
  solicitudMeta: { fontFamily: sans, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: INK_MID, marginBottom: 8 },

  estatusBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  estatusText:  { fontFamily: sans, fontSize: 8, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700' },
  estatusPendiente:  { borderColor: NEUTRAL, color: PAPER, backgroundColor: NEUTRAL },
  estatusProceso:    { borderColor: WARNING, color: INK, backgroundColor: WARNING },
  estatusReparado:   { borderColor: LIME, color: INK, backgroundColor: LIME },
  estatusPagoAutorizado: { borderColor: BRAND, color: PAPER, backgroundColor: BRAND },
  estatusPagado:     { borderColor: INK, color: PAPER, backgroundColor: INK },
  estatusRechazado:  { borderColor: RED, color: PAPER, backgroundColor: RED },

  campo:      { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 3 },
  campoLabel: { fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: '700', color: INK_MID },
  campoValor: { fontFamily: serif, fontSize: 14, color: INK, flex: 1 },

  // Botón "ver más solicitudes" (paginación cliente)
  btnVerMas: {
    backgroundColor: PAPER_TINT, borderRadius: 14, paddingVertical: 13,
    alignItems: 'center', marginTop: 4, marginBottom: 12,
  },
  btnVerMasText: {
    fontFamily: sans, fontSize: 10, letterSpacing: 2,
    textTransform: 'uppercase', fontWeight: '700', color: INK,
  },

  // Formulario de cierre de ticket
  cierreBox: { marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RULE, paddingTop: 14 },

  // Miniaturas de fotos
  fotosRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
});

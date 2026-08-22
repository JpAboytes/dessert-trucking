import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  FlatList, ActivityIndicator, Platform, Modal, TextInput,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { getSolicitudes, actualizarEstatus, autorizarPago } from '../services/solicitudes';
import FotoThumb from './FotoThumb';
import DetalleSolicitud from './DetalleSolicitud';

const INK        = '#0a0a0a';
const BRAND      = '#046738';
const RED        = '#C0202A';
const WARNING    = '#E6A100';
const NEUTRAL    = '#737373';
const LIME       = '#84CC16';
const INK_MID    = '#444444';
const INK_LIGHT  = '#888888';
const RULE       = '#bbbbbb';
const PAPER      = '#ffffff';
const PAPER_TINT = '#f2f1ee';

const sans = Platform.OS === 'ios' ? 'Helvetica Neue' : 'sans-serif';
const mono = Platform.OS === 'ios' ? 'Courier New' : 'monospace';
const serif = Platform.OS === 'ios' ? 'Georgia' : 'serif';

const FILTROS = ['Todos', 'Pendiente', 'En proceso', 'Reparado', 'Pago autorizado', 'Pagado', 'Rechazado', 'Pago rechazado'];
const POR_PAGINA = 10;

// Filtros de la vista. Todos opcionales; vacío = sin filtrar por ese campo.
const FILTROS_VACIOS = { estatus: 'Todos', tipoUnidad: '', po: '', fechaInicio: '', fechaFin: '' };

const money = (v) => `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

// Fechas de los filtros: 'YYYY-MM-DD' <-> Date (local, sin zona horaria).
const dosDigitos = (n) => String(n).padStart(2, '0');
const toISODate = (d) => `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
const parseISODate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

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

// Chips descriptivos de los filtros activos (indicador). Cada uno sabe cómo limpiarse.
function chipsActivos(f) {
  const chips = [];
  if (f.estatus !== 'Todos') chips.push({ key: 'estatus', label: f.estatus, reset: { estatus: 'Todos' } });
  if (f.tipoUnidad)          chips.push({ key: 'tipoUnidad', label: f.tipoUnidad, reset: { tipoUnidad: '' } });
  if (f.po.trim())           chips.push({ key: 'po', label: `PO ${f.po.trim()}`, reset: { po: '' } });
  if (f.fechaInicio)         chips.push({ key: 'fechaInicio', label: `Desde ${f.fechaInicio}`, reset: { fechaInicio: '' } });
  if (f.fechaFin)            chips.push({ key: 'fechaFin', label: `Hasta ${f.fechaFin}`, reset: { fechaFin: '' } });
  return chips;
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

// ── Select modal B&W (compacto, para filtros) ────────────────
function CustomSelect({ value, options, onChange, placeholder }) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <TouchableOpacity
        style={[styles.input, styles.selectTrigger]}
        onPress={() => setVisible(true)}
        activeOpacity={0.7}
      >
        <Text style={[styles.monoText, !value && { color: INK_LIGHT }]} numberOfLines={1}>
          {value || placeholder}
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

// Bloque de fotos colapsable (Apertura/Cierre): oculto por defecto.
function FotosColapsables({ fotos }) {
  const [abierto, setAbierto] = useState(false);
  if (!fotos?.length) return null;
  return (
    <View style={{ marginTop: 8 }}>
      <TouchableOpacity style={styles.fotosToggle} onPress={() => setAbierto((a) => !a)} activeOpacity={0.7}>
        <Text style={styles.fotosToggleText}>
          {abierto ? 'Ocultar imágenes' : `Ver imágenes (${fotos.length})`}
        </Text>
      </TouchableOpacity>
      {abierto && (
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
      )}
    </View>
  );
}

function SolicitudItem({ item, onActualizar, onPago, onToast, onVerDetalle }) {
  const [loading, setLoading] = useState(null);
  const [rechazoOpen, setRechazoOpen] = useState(false);
  const [comentario, setComentario] = useState('');
  const est = displayEstatus(item);

  const handleEstatus = async (estatus, etiqueta) => {
    setLoading(estatus);
    try {
      await onActualizar(item.idserviciomovil, estatus);
      onToast?.(`Solicitud #${String(item.idserviciomovil)} ${etiqueta}`);
    } catch {
      onToast?.('Error al actualizar la solicitud', 'error');
    }
    setLoading(null);
  };

  const handlePago = async (aprobado, comentarioRechazo) => {
    const key = aprobado ? 'pago-si' : 'pago-no';
    setLoading(key);
    try {
      await onPago(item.idserviciomovil, aprobado, comentarioRechazo);
      onToast?.(`Pago de #${String(item.idserviciomovil)} ${aprobado ? 'autorizado' : 'rechazado'}`);
    } catch {
      onToast?.('Error al registrar el pago', 'error');
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

  const estatusStyle = {
    Pendiente:         styles.estatusPendiente,
    'En proceso':      styles.estatusProceso,
    Reparado:          styles.estatusReparado,
    'Pago autorizado': styles.estatusPagoAutorizado,
    Pagado:            styles.estatusPagado,
    Rechazado:         styles.estatusRechazado,
    'Pago rechazado':  styles.estatusRechazado,
  }[est] ?? {};

  return (
    <TouchableOpacity style={styles.item} activeOpacity={0.9} onPress={() => onVerDetalle?.(item)}>
      <View style={styles.itemHeader}>
        <Text style={styles.itemId}>#{String(item.idserviciomovil)}</Text>
        <View style={[styles.estatusBadge, estatusStyle]}>
          <Text style={[styles.estatusText, estatusStyle]}>{est.toUpperCase()}</Text>
        </View>
        {item.PO != null && (
          <View style={styles.poBox}><Text style={styles.poText}>PO {item.PO}</Text></View>
        )}
      </View>

      <Text style={styles.itemMeta}>
        {item.nombresolicitante} · {item.tunidad} · {item.numeconomico} · {formatFecha(item.fechahora)}
      </Text>

      {item.odometro != null && (
        <View style={styles.campo}>
          <Text style={styles.campoLabel}>Odómetro  </Text>
          <Text style={styles.campoValor}>{Number(item.odometro).toLocaleString('es-MX')} mi</Text>
        </View>
      )}

      <View style={styles.campo}>
        <Text style={styles.campoLabel}>Descripción  </Text>
        <Text style={styles.campoValor}>{item.descripcion}</Text>
      </View>

      <View style={styles.campo}>
        <Text style={styles.campoLabel}>Costo estimado  </Text>
        <Text style={styles.campoValor}>{money(item.costo)}</Text>
      </View>

      {item.costoreal != null && (
        <View style={styles.campo}>
          <Text style={styles.campoLabel}>Costo real  </Text>
          <Text style={styles.campoValor}>{money(item.costoreal)}</Text>
        </View>
      )}

      <FotosColapsables fotos={item.fotos} />

      {item.nombreaprobador && (
        <View style={styles.campo}>
          <Text style={styles.campoLabel}>
            {item.estatus === 'Rechazado' ? 'Rechazado por  ' : 'Autorizado por  '}
          </Text>
          <Text style={styles.campoValor}>{item.nombreaprobador}</Text>
        </View>
      )}

      {est === 'Pago rechazado' && item.nombrepagador && (
        <View style={styles.campo}>
          <Text style={styles.campoLabel}>Rechazado por  </Text>
          <Text style={styles.campoValor}>{item.nombrepagador}</Text>
        </View>
      )}
      {est === 'Pago rechazado' && item.comentariorechazo && (
        <View style={styles.campo}>
          <Text style={styles.campoLabel}>Motivo del rechazo de pago  </Text>
          <Text style={styles.campoValor}>{item.comentariorechazo}</Text>
        </View>
      )}

      {item.estatus === 'Pendiente' && (
        <View style={styles.acciones}>
          <TouchableOpacity
            style={[styles.btnAccion, styles.btnAprobar, loading && { opacity: 0.4 }]}
            onPress={() => handleEstatus('En proceso', 'autorizada')}
            disabled={!!loading}
            activeOpacity={0.7}
          >
            {loading === 'En proceso'
              ? <ActivityIndicator color={PAPER} size="small" />
              : <Text style={styles.btnAprobarText}>Aprobar</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btnAccion, styles.btnRechazar, loading && { opacity: 0.4 }]}
            onPress={() => handleEstatus('Rechazado', 'rechazada')}
            disabled={!!loading}
            activeOpacity={0.7}
          >
            {loading === 'Rechazado'
              ? <ActivityIndicator color={INK} size="small" />
              : <Text style={styles.btnRechazarText}>Rechazar</Text>
            }
          </TouchableOpacity>
        </View>
      )}

      {est === 'Reparado' && (
        <View style={styles.acciones}>
          <TouchableOpacity
            style={[styles.btnAccion, styles.btnAprobar, loading && { opacity: 0.4 }]}
            onPress={() => handlePago(true)}
            disabled={!!loading}
            activeOpacity={0.7}
          >
            {loading === 'pago-si'
              ? <ActivityIndicator color={PAPER} size="small" />
              : <Text style={styles.btnAprobarText}>Autorizar pago</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btnAccion, styles.btnRechazar, loading && { opacity: 0.4 }]}
            onPress={() => setRechazoOpen(true)}
            disabled={!!loading}
            activeOpacity={0.7}
          >
            {loading === 'pago-no'
              ? <ActivityIndicator color={INK} size="small" />
              : <Text style={styles.btnRechazarText}>Rechazar pago</Text>
            }
          </TouchableOpacity>
        </View>
      )}

      {/* La corrección de un pago rechazado (Autorizar pago) vive ahora dentro del modal de detalle. */}

      {/* Modal de confirmación de rechazo de pago con comentario obligatorio. */}
      <Modal visible={rechazoOpen} transparent animationType="fade" onRequestClose={() => setRechazoOpen(false)}>
        <View style={styles.rechazoOverlay}>
          <View style={styles.rechazoCard}>
            <Text style={styles.rechazoTitulo}>Rechazar pago · #{String(item.idserviciomovil)}</Text>
            <Text style={styles.rechazoTexto}>
              ¿Seguro que quieres rechazar el pago? Deja un comentario para el mecánico (obligatorio).
            </Text>
            <TextInput
              style={styles.rechazoInput}
              value={comentario}
              onChangeText={setComentario}
              placeholder="Motivo del rechazo…"
              placeholderTextColor={INK_LIGHT}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            <View style={styles.rechazoAcciones}>
              <TouchableOpacity
                style={[styles.btnAccion, styles.btnCancelar]}
                onPress={() => { setRechazoOpen(false); setComentario(''); }}
                activeOpacity={0.7}
              >
                <Text style={styles.btnRechazarText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnAccion, styles.btnRechazar, (!comentario.trim() || loading === 'pago-no') && { opacity: 0.4 }]}
                onPress={confirmarRechazo}
                disabled={!comentario.trim() || loading === 'pago-no'}
                activeOpacity={0.7}
              >
                {loading === 'pago-no'
                  ? <ActivityIndicator color={INK} size="small" />
                  : <Text style={styles.btnRechazarText}>Confirmar rechazo</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </TouchableOpacity>
  );
}

export default function AdminView({ showToast }) {
  const [solicitudes, setSolicitudes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(FILTROS_VACIOS); // filtros que afectan la lista
  const [draft, setDraft] = useState(FILTROS_VACIOS);     // edición dentro del modal
  const [panelOpen, setPanelOpen] = useState(false);
  const [pickerField, setPickerField] = useState(null);   // 'fechaInicio' | 'fechaFin' | null
  const [visibleCount, setVisibleCount] = useState(POR_PAGINA);
  const [detalleId, setDetalleId] = useState(null);

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
    await actualizarEstatus(id, estatus);
    setSolicitudes((prev) =>
      prev.map((s) => s.idserviciomovil === id ? { ...s, estatus } : s)
    );
  };

  const handlePago = async (id, aprobado, comentarioRechazo) => {
    await autorizarPago(id, aprobado, comentarioRechazo);
    setSolicitudes((prev) =>
      prev.map((s) => s.idserviciomovil === id
        ? { ...s, autorizacionpago: aprobado ? 1 : 0, comentariorechazo: aprobado ? null : comentarioRechazo }
        : s)
    );
  };

  // Opciones de tipo de unidad: los valores distintos presentes en los datos (ya legibles).
  const tipoUnidadOptions = [...new Set(solicitudes.map((s) => s.tunidad).filter(Boolean))].sort();
  const lista = solicitudes.filter((s) => coincideFiltros(s, applied));
  const chips = chipsActivos(applied);
  const visibles = lista.slice(0, visibleCount);
  const detalle = solicitudes.find((s) => s.idserviciomovil === detalleId);

  const abrirPanel = () => { setDraft(applied); setPickerField(null); setPanelOpen(true); };
  const aplicar    = () => { setApplied(draft); setPanelOpen(false); };
  const limpiar    = () => { setDraft(FILTROS_VACIOS); setApplied(FILTROS_VACIOS); };
  const quitarChip = (reset) => setApplied((a) => ({ ...a, ...reset }));
  const setCampo   = (campo, valor) => setDraft((d) => ({ ...d, [campo]: valor }));

  return (
    <View style={styles.container}>
      {/* Barra: botón que abre el modal de filtros (con indicador) + recarga */}
      <View style={styles.filtroBar}>
        <TouchableOpacity style={styles.filtroBtn} onPress={abrirPanel} activeOpacity={0.7}>
          <Text style={styles.filtroBtnText}>≡  Filtros</Text>
          {chips.length > 0 && (
            <View style={styles.filtroBadge}><Text style={styles.filtroBadgeText}>{chips.length}</Text></View>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={cargar} style={styles.filtroReload} activeOpacity={0.7}>
          <Text style={styles.filtroReloadText}>↺</Text>
        </TouchableOpacity>
      </View>

      {/* Indicador de filtros activos: chips removibles */}
      {chips.length > 0 && (
        <View style={styles.chipsRow}>
          {chips.map((c) => (
            <TouchableOpacity key={c.key} style={styles.chip} onPress={() => quitarChip(c.reset)} activeOpacity={0.7}>
              <Text style={styles.chipText}>{c.label}</Text>
              <Text style={styles.chipX}>✕</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.chipClear} onPress={limpiar} activeOpacity={0.7}>
            <Text style={styles.chipClearText}>Limpiar todo</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Modal de filtros (centrado; el bottom sheet estorba con la barra del teléfono) */}
      <Modal visible={panelOpen} transparent animationType="fade" onRequestClose={() => setPanelOpen(false)}>
        <View style={styles.filtroModalOverlay}>
          <View style={styles.filtroModalCard}>
            <View style={styles.filtroModalHead}>
              <Text style={styles.filtroModalTitulo}>Filtros</Text>
              <TouchableOpacity onPress={() => setPanelOpen(false)} activeOpacity={0.7}>
                <Text style={styles.filtroModalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
              <Text style={styles.filtroCampoLabel}>Estatus</Text>
              <CustomSelect value={draft.estatus} options={FILTROS}
                onChange={(v) => setCampo('estatus', v)} placeholder="Todos" />

              <Text style={[styles.filtroCampoLabel, { marginTop: 14 }]}>Tipo de unidad</Text>
              <CustomSelect value={draft.tipoUnidad} options={['Todos', ...tipoUnidadOptions]}
                onChange={(v) => setCampo('tipoUnidad', v === 'Todos' ? '' : v)}
                placeholder="Todos" />

              <Text style={[styles.filtroCampoLabel, { marginTop: 14 }]}>PO</Text>
              <TextInput
                style={[styles.input, { fontFamily: mono, fontSize: 14, color: INK }]}
                value={draft.po}
                onChangeText={(v) => setCampo('po', v)}
                placeholder="Buscar por PO…"
                placeholderTextColor={INK_LIGHT}
                keyboardType="number-pad"
              />

              <View style={styles.filtroRango}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.filtroCampoLabel}>Fecha inicial</Text>
                  <TouchableOpacity
                    style={[styles.input, styles.selectTrigger]}
                    onPress={() => setPickerField(pickerField === 'fechaInicio' ? null : 'fechaInicio')}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.monoText, !draft.fechaInicio && { color: INK_LIGHT }]}>
                      {draft.fechaInicio || 'Cualquiera'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.filtroCampoLabel}>Fecha final</Text>
                  <TouchableOpacity
                    style={[styles.input, styles.selectTrigger]}
                    onPress={() => setPickerField(pickerField === 'fechaFin' ? null : 'fechaFin')}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.monoText, !draft.fechaFin && { color: INK_LIGHT }]}>
                      {draft.fechaFin || 'Cualquiera'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {pickerField && (
                <DateTimePicker
                  value={draft[pickerField] ? parseISODate(draft[pickerField]) : new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  onChange={(event, selected) => {
                    const field = pickerField;
                    if (Platform.OS === 'android') setPickerField(null);
                    if (event.type !== 'dismissed' && selected) {
                      setCampo(field, toISODate(selected));
                    }
                  }}
                />
              )}
            </ScrollView>

            <View style={styles.filtroModalAcciones}>
              <TouchableOpacity style={[styles.btnAccion, styles.btnCancelar, { flex: 1 }]} onPress={limpiar} activeOpacity={0.7}>
                <Text style={styles.btnRechazarText}>Limpiar filtros</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnAccion, styles.btnAprobar, { flex: 1 }]} onPress={aplicar} activeOpacity={0.7}>
                <Text style={styles.btnAprobarText}>Aplicar filtros</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {loading && <ActivityIndicator color={INK} style={{ marginTop: 32 }} />}

      {!!error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!loading && !error && lista.length === 0 && (
        <Text style={styles.empty}>
          Sin solicitudes con los filtros seleccionados.
        </Text>
      )}

      <FlatList
        data={visibles}
        keyExtractor={(item) => String(item.idserviciomovil)}
        renderItem={({ item }) => (
          <SolicitudItem
            item={item}
            onActualizar={handleActualizar}
            onPago={handlePago}
            onToast={showToast}
            onVerDetalle={(it) => setDetalleId(it.idserviciomovil)}
          />
        )}
        scrollEnabled={false}
      />

      {lista.length > visibleCount && (
        <TouchableOpacity
          style={styles.btnVerMas}
          onPress={() => setVisibleCount((c) => c + POR_PAGINA)}
          activeOpacity={0.7}
        >
          <Text style={styles.btnVerMasText}>Ver más solicitudes ({lista.length - visibleCount})</Text>
        </TouchableOpacity>
      )}

      {detalle && (
        <DetalleSolicitud
          solicitud={detalle}
          onClose={() => setDetalleId(null)}
          onAutorizarPago={async (id) => {
            try {
              await handlePago(id, true);
              showToast?.(`Pago de #${String(id)} autorizado`);
            } catch {
              showToast?.('Error al registrar el pago', 'error');
            }
          }}
        />
      )}
    </View>
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
  container: { flex: 1 },

  // Barra de filtros: botón "Filtros" (con badge) + recarga
  filtroBar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  filtroBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: PAPER_TINT, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 11,
  },
  filtroBtnText: {
    fontFamily: sans, fontSize: 10, letterSpacing: 1.5,
    textTransform: 'uppercase', fontWeight: '700', color: INK,
  },
  filtroBadge: {
    minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 999, backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
  },
  filtroBadgeText: { fontFamily: sans, fontSize: 10, fontWeight: '700', color: PAPER },
  filtroReload: { backgroundColor: PAPER_TINT, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  filtroReloadText: { fontFamily: sans, fontSize: 16, color: INK, lineHeight: 18 },

  // Chips de filtros activos (indicador)
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: PAPER_TINT, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
  },
  chipText: { fontFamily: sans, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: INK },
  chipX: { fontFamily: sans, fontSize: 11, color: INK_LIGHT },
  chipClear: { paddingHorizontal: 4, paddingVertical: 6 },
  chipClearText: {
    fontFamily: sans, fontSize: 10, fontWeight: '700', letterSpacing: 0.5,
    textTransform: 'uppercase', color: BRAND, textDecorationLine: 'underline',
  },

  // Modal de filtros
  filtroModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 24 },
  filtroModalCard: { backgroundColor: PAPER, borderRadius: 20, padding: 20, ...CARD_SHADOW },
  filtroModalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  filtroModalTitulo: { fontFamily: serif, fontSize: 18, fontWeight: '700', color: INK },
  filtroModalClose: { fontFamily: sans, fontSize: 16, color: INK },
  filtroCampoLabel: {
    fontFamily: sans, fontSize: 9, letterSpacing: 1.5,
    textTransform: 'uppercase', fontWeight: '700', color: INK_LIGHT, marginBottom: 6,
  },
  filtroRango: { flexDirection: 'row', gap: 10, marginTop: 14 },
  filtroModalAcciones: { flexDirection: 'row', gap: 10, marginTop: 18 },

  // Select (trigger + sheet)
  input: {
    backgroundColor: PAPER_TINT, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  selectTrigger: { flexDirection: 'row', alignItems: 'center' },
  monoText: { fontFamily: mono, fontSize: 14, color: INK, flex: 1 },
  selectCaret: { fontFamily: sans, fontSize: 14, color: INK, marginLeft: 8 },
  // Diálogo centrado (no bottom sheet: abajo interfiere con la barra de navegación del teléfono)
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 36 },
  sheet: {
    backgroundColor: PAPER, borderRadius: 20,
    maxHeight: 380, paddingVertical: 6, overflow: 'hidden', ...CARD_SHADOW,
  },
  sheetDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RULE },
  sheetOption: { paddingHorizontal: 20, paddingVertical: 14 },
  sheetOptionText: { fontFamily: mono, fontSize: 14, color: INK },

  // Toggle de fotos (pill)
  fotosToggle: {
    alignSelf: 'flex-start', backgroundColor: PAPER_TINT, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  fotosToggleText: {
    fontFamily: sans, fontSize: 9, letterSpacing: 1.5,
    textTransform: 'uppercase', fontWeight: '700', color: INK,
  },

  // Solicitud item (tarjeta iOS)
  item: {
    backgroundColor: PAPER, borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: RULE, ...CARD_SHADOW,
  },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  itemId: { fontFamily: mono, fontSize: 14, fontWeight: '700', color: INK },
  poBox:  { backgroundColor: PAPER_TINT, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  poText: { fontFamily: sans, fontSize: 8, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700', color: INK },

  estatusBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  estatusText: {
    fontFamily: sans, fontSize: 8, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700',
  },
  estatusPendiente:  { borderColor: NEUTRAL, color: PAPER, backgroundColor: NEUTRAL },
  estatusProceso:    { borderColor: WARNING, color: INK, backgroundColor: WARNING },
  estatusReparado:   { borderColor: LIME, color: INK, backgroundColor: LIME },
  estatusPagoAutorizado: { borderColor: BRAND, color: PAPER, backgroundColor: BRAND },
  estatusPagado:     { borderColor: INK, color: PAPER, backgroundColor: INK },
  estatusRechazado:  { borderColor: RED, color: PAPER, backgroundColor: RED },

  itemMeta: {
    fontFamily: sans, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase',
    color: INK_MID, marginBottom: 10,
  },

  campo: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  campoLabel: {
    fontFamily: sans, fontSize: 9, letterSpacing: 1.5,
    textTransform: 'uppercase', fontWeight: '700', color: INK_MID,
  },
  campoValor: { fontFamily: serif, fontSize: 14, color: INK, flex: 1 },

  // Fotos
  fotosBlock: { gap: 10, marginTop: 8, marginBottom: 4 },
  fotoCol: { gap: 4 },
  fotosRowAdmin: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  // Acciones (botones pill)
  acciones: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btnAccion: { paddingVertical: 10, paddingHorizontal: 20, alignItems: 'center', minWidth: 96, borderRadius: 999 },
  btnAprobar: { backgroundColor: BRAND, ...CARD_SHADOW },
  btnRechazar: { backgroundColor: PAPER_TINT },
  btnCancelar: { backgroundColor: PAPER_TINT },

  // Modal de rechazo de pago
  rechazoOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 28 },
  rechazoCard: { backgroundColor: PAPER, borderRadius: 20, padding: 22, ...CARD_SHADOW },
  rechazoTitulo: { fontFamily: serif, fontSize: 17, fontWeight: '700', color: INK, marginBottom: 8 },
  rechazoTexto: { fontFamily: sans, fontSize: 13, color: INK_MID, lineHeight: 19, marginBottom: 14 },
  rechazoInput: {
    fontFamily: sans, fontSize: 14, color: INK, backgroundColor: PAPER_TINT,
    borderRadius: 12, padding: 12, minHeight: 96, marginBottom: 16,
  },
  rechazoAcciones: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  btnAprobarText: {
    fontFamily: sans, color: PAPER, fontWeight: '700',
    fontSize: 9, letterSpacing: 2, textTransform: 'uppercase',
  },
  btnRechazarText: {
    fontFamily: sans, color: INK, fontWeight: '700',
    fontSize: 9, letterSpacing: 2, textTransform: 'uppercase',
  },

  // Botón "ver más solicitudes" (paginación cliente)
  btnVerMas: {
    backgroundColor: PAPER_TINT, borderRadius: 14, paddingVertical: 13,
    alignItems: 'center', marginTop: 4, marginBottom: 12,
  },
  btnVerMasText: {
    fontFamily: sans, fontSize: 10, letterSpacing: 2,
    textTransform: 'uppercase', fontWeight: '700', color: INK,
  },

  // Error / vacío
  errorBox: {
    borderLeftWidth: 3, borderLeftColor: INK, borderRadius: 12,
    backgroundColor: PAPER_TINT, padding: 12, marginVertical: 16,
  },
  errorText: { fontFamily: sans, fontSize: 13, color: INK },
  empty: { fontFamily: sans, fontSize: 12, color: INK_MID, fontStyle: 'italic', marginTop: 24 },
});

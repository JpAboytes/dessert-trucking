import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, Modal, TextInput,
} from 'react-native';
import { getSolicitudes, pagarSolicitud, asignarSemanaPago } from '../services/solicitudes';

// Tab "Pagos": cuentas por pagar (pagos autorizados) y ya pagadas, con selección
// y pago en lote. Antes vivía dentro de Reportes; ahora es su propia sección.

const INK        = '#0a0a0a';
const BRAND      = '#046738';
const RED        = '#C0202A';
const INK_MID    = '#444444';
const INK_LIGHT  = '#888888';
const RULE       = '#bbbbbb';
const PAPER      = '#ffffff';
const PAPER_TINT = '#f2f1ee';

const sans  = Platform.OS === 'ios' ? 'Helvetica Neue' : 'sans-serif';
const mono  = Platform.OS === 'ios' ? 'Courier New' : 'monospace';
const serif = Platform.OS === 'ios' ? 'Georgia' : 'serif';

const TIPOS_PERIODO = ['Semanal', 'Mensual'];

const money = (v) => `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

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

const formatFechaCorta = (raw) => {
  const d = parseWall(raw);
  return d ? d.toLocaleDateString('es-MX', { dateStyle: 'short' }) : '—';
};

// Semana efectiva del PO: la asignada manualmente (semanapago) o, si no, la de cierre.
const semanaEfectiva = (s) => (s.semanapago ? `${s.semanapago}T00:00:00` : s.fechacierre);

// Lunes (inicio de semana) de una fecha; misma aritmética que rangoPeriodo('Semanal').
function lunesDe(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
const dosDigitos = (n) => String(n).padStart(2, '0');
const toISODate = (d) => `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
const etiquetaSemana = (lunes) => {
  const fin = new Date(lunes);
  fin.setDate(fin.getDate() + 7);
  return etiquetaPeriodo('Semanal', { inicio: lunes, fin });
};

// ── Cuentas por pagar (pagos autorizados) ─────────────────────
// Solo tickets con pago AUTORIZADO (autorizacionpago = 1). El periodo se
// determina por la fecha de cierre de la reparación (no hay timestamp de
// la decisión de pago en la BD).
function CuentasPorPagar({ solicitudes, rango, onPagados, onReasignada }) {
  const [vista, setVista] = useState('porPagar'); // 'porPagar' | 'pagadas'

  const pagosAutorizados = solicitudes
    .filter((s) => displayEstatus(s) === 'Pago autorizado' && enPeriodo(semanaEfectiva(s), rango))
    .sort((a, b) => (parseWall(semanaEfectiva(a)) || 0) - (parseWall(semanaEfectiva(b)) || 0));

  const pagadas = solicitudes
    .filter((s) => s.estatus === 'Pagado' && enPeriodo(semanaEfectiva(s), rango))
    .sort((a, b) => (parseWall(semanaEfectiva(a)) || 0) - (parseWall(semanaEfectiva(b)) || 0));

  const lista = vista === 'porPagar' ? pagosAutorizados : pagadas;
  const totalMonto = lista.reduce((acc, s) => acc + Number(s.costoreal ?? s.costo ?? 0), 0);

  const [seleccion, setSeleccion] = useState(() => new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [comentario, setComentario] = useState('');
  const [pagando, setPagando] = useState(false);
  const [pagoError, setPagoError] = useState('');

  // Reasignación de semana de pago (una fila a la vez).
  const [reasignar, setReasignar] = useState(null);   // solicitud en edición | null
  const [semLunes, setSemLunes] = useState(null);      // Date del lunes objetivo
  const [reasignando, setReasignando] = useState(false);
  const [reasignarError, setReasignarError] = useState('');

  const abrirReasignar = (s) => {
    setReasignar(s);
    setSemLunes(lunesDe(parseWall(semanaEfectiva(s)) || new Date()));
    setReasignarError('');
  };
  const guardarSemana = async (semanaISO) => {
    setReasignando(true);
    setReasignarError('');
    try {
      await asignarSemanaPago(reasignar.idserviciomovil, semanaISO);
      onReasignada(reasignar.idserviciomovil, semanaISO);
      setReasignar(null);
    } catch (e) {
      setReasignarError(e?.response?.data?.message || 'Error al reasignar la semana.');
    } finally {
      setReasignando(false);
    }
  };

  const idsVisibles = pagosAutorizados.map((s) => s.idserviciomovil);
  const allSelected = idsVisibles.length > 0 && idsVisibles.every((id) => seleccion.has(id));
  const seleccionadas = pagosAutorizados.filter((s) => seleccion.has(s.idserviciomovil));
  const totalSeleccion = seleccionadas.reduce((acc, s) => acc + Number(s.costoreal ?? s.costo ?? 0), 0);

  const toggle = (id) => setSeleccion((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleAll = () => setSeleccion(allSelected ? new Set() : new Set(idsVisibles));

  const confirmarPago = async () => {
    const ids = seleccionadas.map((s) => s.idserviciomovil);
    if (ids.length === 0) return;
    setPagando(true);
    setPagoError('');
    try {
      const txt = comentario.trim();
      await Promise.all(ids.map((id) => pagarSolicitud(id, txt || null)));
      onPagados(ids, txt);
      setSeleccion(new Set());
      setModalOpen(false);
      setComentario('');
    } catch (e) {
      setPagoError(e?.response?.data?.message || 'Error al registrar el pago.');
    } finally {
      setPagando(false);
    }
  };

  return (
    <View style={styles.reporte}>
      <Text style={styles.reporteTitulo}>Cuentas por pagar</Text>

      {/* Toggle: por pagar / ya pagadas */}
      <View style={styles.cxpToggle}>
        <TouchableOpacity
          style={[styles.cxpToggleBtn, vista === 'porPagar' && styles.cxpToggleBtnActive]}
          onPress={() => setVista('porPagar')}
          activeOpacity={0.7}
        >
          <Text style={[styles.cxpToggleText, vista === 'porPagar' && styles.cxpToggleTextActive]}>
            Por pagar ({pagosAutorizados.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.cxpToggleBtn, vista === 'pagadas' && styles.cxpToggleBtnActive]}
          onPress={() => setVista('pagadas')}
          activeOpacity={0.7}
        >
          <Text style={[styles.cxpToggleText, vista === 'pagadas' && styles.cxpToggleTextActive]}>
            Pagadas ({pagadas.length})
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.reporteNota}>
        {vista === 'porPagar'
          ? 'Pagos autorizados · por semana de pago · costo real'
          : 'Solicitudes pagadas · por semana de pago · costo real'}
      </Text>

      {lista.length === 0 && (
        <Text style={styles.empty}>
          {vista === 'porPagar' ? 'Sin pagos autorizados en este periodo.' : 'Sin solicitudes pagadas en este periodo.'}
        </Text>
      )}

      {vista === 'porPagar' && pagosAutorizados.length > 0 && (
        <View style={styles.cxpAcciones}>
          <TouchableOpacity style={styles.cxpSelall} onPress={toggleAll} activeOpacity={0.7}>
            <View style={[styles.checkbox, allSelected && styles.checkboxOn]}>
              {allSelected && <Text style={styles.checkboxMark}>✓</Text>}
            </View>
            <Text style={styles.cxpSelallText}>Seleccionar todo</Text>
          </TouchableOpacity>
          {seleccion.size > 0 && (
            <TouchableOpacity style={styles.btnPagar} onPress={() => { setPagoError(''); setModalOpen(true); }} activeOpacity={0.7}>
              <Text style={styles.btnPagarText}>Pagar {seleccion.size} · {money(totalSeleccion)}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {lista.map((s) => {
        const checked = seleccion.has(s.idserviciomovil);
        const Row = vista === 'porPagar' ? TouchableOpacity : View;
        const rowProps = vista === 'porPagar'
          ? { onPress: () => toggle(s.idserviciomovil), activeOpacity: 0.7 }
          : {};
        return (
          <Row key={s.idserviciomovil} style={styles.cxpRow} {...rowProps}>
            {vista === 'porPagar' && (
              <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                {checked && <Text style={styles.checkboxMark}>✓</Text>}
              </View>
            )}
            <View style={styles.cxpInfo}>
              <Text style={styles.cxpId}>
                #{String(s.idserviciomovil)}{s.PO != null ? `  ·  PO ${s.PO}` : ''}
                {s.semanapago ? <Text style={styles.reprog}>   REPROGRAMADO</Text> : null}
              </Text>
              <Text style={styles.cxpMeta}>
                {s.tunidad} · {s.numeconomico} · cierre {formatFechaCorta(s.fechacierre)}
              </Text>
              {vista === 'porPagar' && (
                <TouchableOpacity onPress={() => abrirReasignar(s)} activeOpacity={0.7} style={styles.moverBtn}>
                  <Text style={styles.moverText}>
                    Semana: {etiquetaSemana(lunesDe(parseWall(semanaEfectiva(s)) || new Date()))} ›
                  </Text>
                </TouchableOpacity>
              )}
              {vista === 'pagadas' && s.comentariocheckbox ? (
                <Text style={styles.cxpComentario}>“{s.comentariocheckbox}”</Text>
              ) : null}
            </View>
            <Text style={styles.cxpMonto}>{money(s.costoreal ?? s.costo)}</Text>
          </Row>
        );
      })}

      {lista.length > 0 && (
        <View style={styles.cxpTotalRow}>
          <Text style={styles.cxpTotalLabel}>Total ({lista.length} {lista.length === 1 ? 'ticket' : 'tickets'})</Text>
          <Text style={styles.cxpTotalMonto}>{money(totalMonto)}</Text>
        </View>
      )}

      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => !pagando && setModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitulo}>
              Pagar {seleccionadas.length} {seleccionadas.length === 1 ? 'ticket' : 'tickets'} · {money(totalSeleccion)}
            </Text>
            <Text style={styles.modalTexto}>
              Se marcarán como Pagado y saldrán de cuentas por pagar. Comentario (opcional):
            </Text>
            <TextInput
              style={styles.modalInput}
              value={comentario}
              onChangeText={setComentario}
              placeholder="Comentario opcional…"
              placeholderTextColor={INK_LIGHT}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            {!!pagoError && <Text style={styles.modalError}>{pagoError}</Text>}
            <View style={styles.modalAcciones}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => { setModalOpen(false); setComentario(''); }} disabled={pagando} activeOpacity={0.7}>
                <Text style={styles.modalBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnPagar, pagando && { opacity: 0.4 }]} onPress={confirmarPago} disabled={pagando} activeOpacity={0.7}>
                {pagando ? <ActivityIndicator color={PAPER} size="small" /> : <Text style={styles.modalBtnPagarText}>Confirmar pago</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reasignar la semana de pago de un PO (navegador de semanas) */}
      <Modal visible={!!reasignar} transparent animationType="fade" onRequestClose={() => !reasignando && setReasignar(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitulo}>
              Mover a semana{reasignar ? ` · #${String(reasignar.idserviciomovil)}${reasignar.PO != null ? ` · PO ${reasignar.PO}` : ''}` : ''}
            </Text>

            <View style={styles.semNav}>
              <TouchableOpacity style={styles.semNavBtn} activeOpacity={0.7}
                onPress={() => setSemLunes((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}>
                <Text style={styles.semNavBtnText}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.semNavLabel}>{semLunes ? etiquetaSemana(semLunes) : ''}</Text>
              <TouchableOpacity style={styles.semNavBtn} activeOpacity={0.7}
                onPress={() => setSemLunes((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}>
                <Text style={styles.semNavBtnText}>›</Text>
              </TouchableOpacity>
            </View>

            {!!reasignarError && <Text style={styles.modalError}>{reasignarError}</Text>}

            <View style={styles.modalAcciones}>
              {reasignar?.semanapago && (
                <TouchableOpacity style={[styles.modalBtn, styles.modalBtnCancel, reasignando && { opacity: 0.4 }]}
                  onPress={() => guardarSemana(null)} disabled={reasignando} activeOpacity={0.7}>
                  <Text style={styles.modalBtnCancelText}>Quitar</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnPagar, reasignando && { opacity: 0.4 }]}
                onPress={() => guardarSemana(toISODate(semLunes))} disabled={reasignando} activeOpacity={0.7}>
                {reasignando ? <ActivityIndicator color={PAPER} size="small" /> : <Text style={styles.modalBtnPagarText}>Asignar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default function PagosAdmin() {
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
      setError('Error al cargar las cuentas por pagar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const rango = rangoPeriodo(tipoPeriodo, offset);

  return (
    <View style={styles.container}>
      {/* Selector de tipo de periodo */}
      <View style={styles.periodoTipos}>
        {TIPOS_PERIODO.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.periodoTipo, tipoPeriodo === t && styles.periodoTipoActivo]}
            onPress={() => { setTipoPeriodo(t); setOffset(0); }}
            activeOpacity={0.7}
          >
            <Text style={[styles.periodoTipoText, tipoPeriodo === t && styles.periodoTipoTextActivo]}>
              {t}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity onPress={cargar} style={styles.reloadBtn} activeOpacity={0.7}>
          <Text style={styles.reloadText}>↺</Text>
        </TouchableOpacity>
      </View>

      {/* Navegación del periodo */}
      <View style={styles.periodoNav}>
        <TouchableOpacity onPress={() => setOffset((o) => o - 1)} style={styles.navBtn} activeOpacity={0.7}>
          <Text style={styles.navBtnText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.periodoLabelBox}>
          <Text style={styles.periodoLabel}>{etiquetaPeriodo(tipoPeriodo, rango)}</Text>
          {offset === 0 && <Text style={styles.periodoActual}>PERIODO ACTUAL</Text>}
        </View>
        <TouchableOpacity
          onPress={() => setOffset((o) => Math.min(0, o + 1))}
          style={[styles.navBtn, offset === 0 && { opacity: 0.3 }]}
          disabled={offset === 0}
          activeOpacity={0.7}
        >
          <Text style={styles.navBtnText}>›</Text>
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator color={INK} style={{ marginTop: 32 }} />}

      {!!error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!loading && !error && (
        <CuentasPorPagar
          solicitudes={solicitudes}
          rango={rango}
          onPagados={(ids, comentario) => setSolicitudes((prev) =>
            prev.map((s) => ids.includes(s.idserviciomovil)
              ? { ...s, estatus: 'Pagado', comentariocheckbox: comentario || null }
              : s))}
          onReasignada={(id, semanaISO) => setSolicitudes((prev) =>
            prev.map((s) => s.idserviciomovil === id ? { ...s, semanapago: semanaISO } : s))}
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

  // Selector Semanal / Mensual (pills)
  periodoTipos: { flexDirection: 'row', alignItems: 'stretch', gap: 10, marginBottom: 14 },
  periodoTipo: {
    flex: 1, backgroundColor: PAPER_TINT, borderRadius: 12,
    paddingVertical: 11, alignItems: 'center',
  },
  periodoTipoActivo: { backgroundColor: INK, ...CARD_SHADOW },
  periodoTipoText: {
    fontFamily: sans, fontSize: 10, fontWeight: '700',
    letterSpacing: 1.5, textTransform: 'uppercase', color: INK,
  },
  periodoTipoTextActivo: { color: PAPER },
  reloadBtn: { backgroundColor: PAPER_TINT, borderRadius: 12, paddingHorizontal: 14, justifyContent: 'center' },
  reloadText: { fontFamily: sans, fontSize: 16, color: INK, lineHeight: 18 },

  // Navegación del periodo (◀ etiqueta ▶)
  periodoNav: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4,
  },
  navBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: PAPER_TINT,
    alignItems: 'center', justifyContent: 'center',
  },
  navBtnText: { fontFamily: sans, fontSize: 20, lineHeight: 22, color: INK },
  periodoLabelBox: { flex: 1, alignItems: 'center' },
  periodoLabel: { fontFamily: serif, fontSize: 16, fontWeight: '700', color: INK },
  periodoActual: {
    fontFamily: sans, fontSize: 8, letterSpacing: 2, color: BRAND,
    fontWeight: '700', marginTop: 2,
  },

  // Bloque de la tarjeta (iOS)
  reporte: {
    marginTop: 20, backgroundColor: PAPER, borderRadius: 16, padding: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: RULE, ...CARD_SHADOW,
  },
  reporteTitulo: {
    fontFamily: serif, fontSize: 18, fontWeight: '700', color: INK,
  },
  reporteNota: {
    fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase',
    color: INK_LIGHT, marginTop: 2, marginBottom: 12,
  },

  // Filas cuentas por pagar
  cxpRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: RULE, paddingVertical: 10,
  },
  cxpInfo: { flex: 1 },
  cxpId: { fontFamily: mono, fontSize: 13, fontWeight: '700', color: INK },
  cxpMeta: {
    fontFamily: sans, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
    color: INK_MID, marginTop: 2,
  },
  cxpMonto: { fontFamily: mono, fontSize: 14, color: INK },
  cxpComentario: { fontFamily: serif, fontSize: 12, fontStyle: 'italic', color: INK_MID, marginTop: 3 },

  // Reasignación de semana: chip "Reprogramado" + botón por fila + navegador de semanas
  reprog: { fontFamily: sans, fontSize: 8, fontWeight: '700', letterSpacing: 1, color: BRAND },
  moverBtn: { alignSelf: 'flex-start', marginTop: 4 },
  moverText: { fontFamily: sans, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: INK_MID },
  semNav: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 14 },
  semNavBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: PAPER_TINT,
    alignItems: 'center', justifyContent: 'center',
  },
  semNavBtnText: { fontFamily: sans, fontSize: 20, lineHeight: 22, color: INK },
  semNavLabel: { flex: 1, textAlign: 'center', fontFamily: serif, fontSize: 15, fontWeight: '700', color: INK },

  // Toggle por pagar / pagadas
  cxpToggle: { flexDirection: 'row', gap: 6, backgroundColor: PAPER_TINT, borderRadius: 12, padding: 3, marginTop: 4, marginBottom: 12 },
  cxpToggleBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 9 },
  cxpToggleBtnActive: { backgroundColor: INK },
  cxpToggleText: { fontFamily: sans, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: INK_MID },
  cxpToggleTextActive: { color: PAPER },
  cxpTotalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: INK, paddingVertical: 12,
  },
  cxpTotalLabel: {
    fontFamily: sans, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase',
    fontWeight: '700', color: INK,
  },
  cxpTotalMonto: { fontFamily: mono, fontSize: 16, fontWeight: '700', color: BRAND },

  errorBox: {
    borderLeftWidth: 3, borderLeftColor: INK, borderRadius: 12,
    backgroundColor: PAPER_TINT, padding: 12, marginVertical: 16,
  },
  errorText: { fontFamily: sans, fontSize: 13, color: INK },
  empty: { fontFamily: sans, fontSize: 12, color: INK_MID, fontStyle: 'italic', marginTop: 4 },

  // Selección + pago en cuentas por pagar
  cxpAcciones: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    flexWrap: 'wrap', gap: 10, marginTop: 2, marginBottom: 4,
  },
  cxpSelall: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cxpSelallText: {
    fontFamily: sans, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
    color: INK_MID, fontWeight: '700',
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: RULE,
    alignItems: 'center', justifyContent: 'center', backgroundColor: PAPER,
  },
  checkboxOn: { backgroundColor: BRAND, borderColor: BRAND },
  checkboxMark: { color: PAPER, fontSize: 13, fontWeight: '700', lineHeight: 16 },
  btnPagar: { backgroundColor: BRAND, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16, ...CARD_SHADOW },
  btnPagarText: { fontFamily: sans, color: PAPER, fontWeight: '700', fontSize: 11, letterSpacing: 0.5 },

  // Modal de pago
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 28 },
  modalCard: { backgroundColor: PAPER, borderRadius: 20, padding: 22, ...CARD_SHADOW },
  modalTitulo: { fontFamily: serif, fontSize: 16, fontWeight: '700', color: INK, marginBottom: 8 },
  modalTexto: { fontFamily: sans, fontSize: 12, color: INK_MID, lineHeight: 18, marginBottom: 12 },
  modalInput: {
    fontFamily: sans, fontSize: 14, color: INK, backgroundColor: PAPER_TINT,
    borderRadius: 12, padding: 12, minHeight: 76, marginBottom: 12,
  },
  modalError: { fontFamily: sans, fontSize: 12, color: RED, marginBottom: 8 },
  modalAcciones: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  modalBtn: { borderRadius: 999, paddingVertical: 11, paddingHorizontal: 20, alignItems: 'center', minWidth: 96 },
  modalBtnCancel: { backgroundColor: PAPER_TINT },
  modalBtnCancelText: { fontFamily: sans, color: INK, fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
  modalBtnPagar: { backgroundColor: BRAND },
  modalBtnPagarText: { fontFamily: sans, color: PAPER, fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
});

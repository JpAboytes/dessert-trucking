import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform,
} from 'react-native';
import { getSolicitudes } from '../services/solicitudes';

const INK        = '#0a0a0a';
const BRAND      = '#046738';
const INK_MID    = '#444444';
const INK_LIGHT  = '#888888';
const RULE       = '#bbbbbb';
const PAPER      = '#ffffff';
const PAPER_TINT = '#f2f1ee';

const sans  = Platform.OS === 'ios' ? 'Helvetica Neue' : 'sans-serif';
const mono  = Platform.OS === 'ios' ? 'Courier New' : 'monospace';
const serif = Platform.OS === 'ios' ? 'Georgia' : 'serif';

const TIPOS_PERIODO = ['Semanal', 'Mensual'];
const ESTATUS_KPI = ['Pendiente', 'En proceso', 'Reparado', 'Pago autorizado', 'Pagado', 'Rechazado', 'Pago rechazado'];

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

// ── Reporte 1: KPIs de tickets por estatus ────────────────────
function ReporteKpis({ solicitudes, rango }) {
  const delPeriodo = solicitudes.filter((s) => enPeriodo(s.fechahora, rango));
  const total = delPeriodo.length;
  const conteos = ESTATUS_KPI.map((est) => ({
    estatus: est,
    n: delPeriodo.filter((s) => displayEstatus(s) === est).length,
  }));

  return (
    <View style={styles.reporte}>
      <Text style={styles.reporteTitulo}>Tickets por estatus</Text>
      <Text style={styles.reporteNota}>Por fecha de solicitud</Text>

      {conteos.map(({ estatus, n }) => (
        <View key={estatus} style={styles.kpiRow}>
          <Text style={styles.kpiLabel}>{estatus}</Text>
          <View style={styles.kpiBarTrack}>
            {total > 0 && n > 0 && (
              <View style={[styles.kpiBar, { flex: n / total }]} />
            )}
            <View style={{ flex: total > 0 ? 1 - n / total : 1 }} />
          </View>
          <Text style={styles.kpiValor}>{n}</Text>
          <Text style={styles.kpiPct}>{total > 0 ? `${Math.round((n / total) * 100)}%` : '—'}</Text>
        </View>
      ))}

      <View style={[styles.kpiRow, styles.kpiTotalRow]}>
        <Text style={[styles.kpiLabel, { fontWeight: '700', color: INK }]}>Total</Text>
        <View style={styles.kpiBarTrack} />
        <Text style={[styles.kpiValor, { fontWeight: '700' }]}>{total}</Text>
        <Text style={styles.kpiPct}>{total > 0 ? '100%' : '—'}</Text>
      </View>
    </View>
  );
}

export default function ReportesAdmin() {
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
      setError('Error al cargar los datos del reporte.');
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
        <ReporteKpis solicitudes={solicitudes} rango={rango} />
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

  // Bloques de reporte (tarjetas iOS)
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

  // Filas KPI
  kpiRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: RULE, paddingVertical: 10,
  },
  kpiTotalRow: { borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: INK },
  kpiLabel: {
    width: 110, fontFamily: sans, fontSize: 10, letterSpacing: 1,
    textTransform: 'uppercase', fontWeight: '700', color: INK_MID,
  },
  kpiBarTrack: {
    flex: 1, flexDirection: 'row', height: 8, backgroundColor: PAPER_TINT,
    borderRadius: 4, overflow: 'hidden',
  },
  kpiBar: { backgroundColor: BRAND, borderRadius: 4 },
  kpiValor: { width: 32, fontFamily: mono, fontSize: 14, color: INK, textAlign: 'right' },
  kpiPct: { width: 42, fontFamily: mono, fontSize: 11, color: INK_LIGHT, textAlign: 'right' },

  errorBox: {
    borderLeftWidth: 3, borderLeftColor: INK, borderRadius: 12,
    backgroundColor: PAPER_TINT, padding: 12, marginVertical: 16,
  },
  errorText: { fontFamily: sans, fontSize: 13, color: INK },
});

import { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { getToken, decodeToken, logout } from '../services/auth';
import MecanicoForm from '../components/MecanicoForm';
import AdminView from '../components/AdminView';
import ReportesAdmin from '../components/ReportesAdmin';
import PagosAdmin from '../components/PagosAdmin';
import BottomTabs from '../components/BottomTabs';
import Toast from '../components/Toast';
import Logo from '../components/Logo';
import { registerForNotifications } from '../services/notifications';

// Secciones por rol; el shell mantiene el tab activo y lo baja a la vista.
// `icon` = nombre base de Ionicons (BottomTabs elige relleno/outline según activo).
const NAV = {
  Mantenimiento: [
    { key: 'crear',   label: 'Crear',          icon: 'add-circle' },
    { key: 'proceso', label: 'En proceso',     icon: 'construct' },
    { key: 'mis',     label: 'Mis solicitudes', icon: 'document-text' },
  ],
  Administrador: [
    { key: 'solicitudes', label: 'Solicitudes', icon: 'documents' },
    { key: 'reportes',    label: 'Reportes',    icon: 'bar-chart' },
    { key: 'pagos',       label: 'Pagos',       icon: 'cash' },
  ],
};

const INK     = '#0a0a0a';
const BRAND   = '#046738';
const BROWN   = '#553111';
const INK_MID = '#444444';
const RULE    = '#bbbbbb';
const PAPER   = '#ffffff';
const PAPER_TINT = '#f2f1ee';

const serif = Platform.OS === 'ios' ? 'Georgia' : 'serif';
const sans  = Platform.OS === 'ios' ? 'Helvetica Neue' : 'sans-serif';

export default function HomeScreen() {
  const [user, setUser] = useState(null);
  const [toast, setToast] = useState({ message: '', type: 'success' });
  const [tab, setTab] = useState(null);

  const navItems = user ? (NAV[user.tusuario] ?? []) : [];

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
  }, []);

  const hideToast = useCallback(() => {
    setToast({ message: '', type: 'success' });
  }, []);

  useEffect(() => {
    getToken().then(async (token) => {
      if (!token) { router.replace('/'); return; }
      const decoded = decodeToken(token);
      if (!decoded) { router.replace('/'); return; }
      setUser(decoded);
      setTab(NAV[decoded.tusuario]?.[0]?.key ?? null);
      // Mecánicos: avisos de autorización/pago. Administradores: aviso de cierre de reparación.
      if (decoded.tusuario === 'Mantenimiento' || decoded.tusuario === 'Administrador') {
        await registerForNotifications();
      }
    });
  }, []);

  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  if (!user) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={INK} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Masthead */}
      <View style={styles.masthead}>
        <View style={styles.mastheadLeft}>
          <Logo size={52} />
          <View>
            <Text style={styles.mastheadTitle}>Desert Transport</Text>
            <Text style={styles.mastheadSub}>SERVICE CENTER</Text>
          </View>
        </View>
        <TouchableOpacity onPress={handleLogout} activeOpacity={0.6}>
          <Text style={styles.logoutBtn}>Cerrar sesión</Text>
        </TouchableOpacity>
      </View>

      {/* Contenido según rol (flex:1: llena el espacio sobre la barra de tabs) */}
      <View style={styles.body}>
        {user.tusuario === 'Mantenimiento' && (
          <MecanicoForm user={user} showToast={showToast} tab={tab} setTab={setTab} />
        )}

        {user.tusuario === 'Administrador' && (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <View style={styles.userBlock}>
              <Text style={styles.userName}>
                {tab === 'reportes' ? 'Reportes' : tab === 'pagos' ? 'Cuentas por pagar' : 'Solicitudes de servicio'}
              </Text>
              <Text style={styles.userMeta}>{user.nombre} · Administrador</Text>
            </View>

            {tab === 'reportes'
              ? <ReportesAdmin />
              : tab === 'pagos'
                ? <PagosAdmin />
                : <AdminView showToast={showToast} />}
          </ScrollView>
        )}
      </View>

      {/* Barra de tabs inferior (hermana del contenido: no lo tapa) */}
      {navItems.length > 0 && (
        <BottomTabs items={navItems} active={tab} onSelect={setTab} />
      )}

      {/* Toast — fuera del contenido para superponerse a todo */}
      <Toast message={toast.message} type={toast.type} onDismiss={hideToast} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loading:   { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: PAPER },
  container: { flex: 1, backgroundColor: PAPER },

  masthead: {
    borderTopWidth: 5, borderTopColor: BRAND,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: RULE,
    paddingHorizontal: 20, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', backgroundColor: PAPER,
  },
  mastheadLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mastheadTitle: {
    fontFamily: serif, fontSize: 15, fontWeight: '700',
    color: INK, letterSpacing: 1, textTransform: 'uppercase',
  },
  mastheadSub: {
    fontFamily: sans, fontSize: 9, color: BROWN,
    letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 2,
  },
  logoutBtn: {
    fontFamily: sans, fontSize: 8.5, color: INK,
    letterSpacing: 1, textTransform: 'uppercase',
    backgroundColor: PAPER_TINT, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden',
  },

  body:      { flex: 1 },
  scroll:    { flex: 1 },
  content:   { padding: 24, paddingBottom: 48 },

  userBlock: { paddingBottom: 8, marginBottom: 16 },
  userName: {
    fontFamily: serif, fontSize: 20, fontWeight: '700',
    color: INK, letterSpacing: 0.3, marginBottom: 4,
  },
  userMeta: {
    fontFamily: sans, fontSize: 10, color: INK_MID,
    letterSpacing: 2, textTransform: 'uppercase',
  },
});

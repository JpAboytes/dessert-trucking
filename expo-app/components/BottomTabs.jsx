import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

// Barra de tabs inferior (nativo). Es hermana del contenido en home.jsx, así que
// ocupa layout y no tapa el contenido. Icono (Ionicons) + label en mayúsculas con
// tracking, estética editorial. El activo se marca con color de marca.
const BRAND    = '#046738';
const INK_MID  = '#666666';
const RULE     = '#bbbbbb';
const PAPER    = '#ffffff';
const sans = Platform.OS === 'ios' ? 'Helvetica Neue' : 'sans-serif';

export default function BottomTabs({ items, active, onSelect }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {items.map((it) => {
        const isActive = active === it.key;
        return (
          <TouchableOpacity
            key={it.key}
            style={styles.tab}
            onPress={() => onSelect(it.key)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={isActive ? it.icon : `${it.icon}-outline`}
              size={22}
              color={isActive ? BRAND : INK_MID}
            />
            <Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={1}>
              {it.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: PAPER,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
    paddingTop: 6,
    paddingHorizontal: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
  },
  label: {
    fontFamily: sans,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: INK_MID,
    marginTop: 4,
  },
  labelActive: { color: BRAND },
});

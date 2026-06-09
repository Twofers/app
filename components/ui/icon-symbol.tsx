// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolViewProps, SymbolWeight } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];
type IconMapping = Partial<Record<SymbolViewProps['name'], MaterialIconName>>;
export type IconSymbolName = keyof typeof ICON_SYMBOL_TO_MATERIAL_ICON;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
export const ICON_SYMBOL_TO_MATERIAL_ICON = {
  'house.fill': 'home',
  'paperplane.fill': 'send',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron-right',
  'qrcode.viewfinder': 'qr-code-scanner',
  'chart.bar.fill': 'bar-chart',
  'plus.circle.fill': 'add-circle',
  'heart.fill': 'favorite',
  'gearshape.fill': 'settings',
  'person.crop.circle.fill': 'person',
  'wallet.pass.fill': 'account-balance-wallet',
  'map.fill': 'map',
} as const satisfies IconMapping;

export const DEFAULT_MATERIAL_ICON_NAME: MaterialIconName = 'help-outline';

export function getMaterialIconName(name: string): MaterialIconName {
  return (ICON_SYMBOL_TO_MATERIAL_ICON as Record<string, MaterialIconName>)[name] ?? DEFAULT_MATERIAL_ICON_NAME;
}

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={getMaterialIconName(name)} style={style} />;
}

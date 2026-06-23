import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView, SymbolViewProps, SymbolWeight } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, StyleProp, View, ViewStyle } from 'react-native';

type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];
type IconMapping = Partial<Record<SymbolViewProps['name'], MaterialIconName>>;
type IconSymbolName = keyof typeof ICON_SYMBOL_TO_MATERIAL_ICON;

const ICON_SYMBOL_TO_MATERIAL_ICON = {
  'house.fill': 'home',
  'paperplane.fill': 'send',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron-right',
  'qrcode.viewfinder': 'qr-code-scanner',
  'chart.bar.fill': 'bar-chart',
  'plus.circle.fill': 'add-circle',
  'heart.fill': 'favorite',
  dollarsign: 'attach-money',
  'gearshape.fill': 'settings',
  'person.crop.circle.fill': 'person',
  'wallet.pass.fill': 'account-balance-wallet',
  'map.fill': 'map',
} as const satisfies IconMapping;

const DEFAULT_MATERIAL_ICON_NAME: MaterialIconName = 'help-outline';
const SF_SYMBOLS_CONFIRMED_ON_IOS_15_1 = new Set<string>([
  'house.fill',
  'paperplane.fill',
  'chevron.left.forwardslash.chevron.right',
  'chevron.right',
  'qrcode.viewfinder',
  'chart.bar.fill',
  'plus.circle.fill',
  'heart.fill',
  'dollarsign',
  'gearshape.fill',
  'person.crop.circle.fill',
  'wallet.pass.fill',
  'map.fill',
]);

function getMaterialIconName(name: string): MaterialIconName {
  return (ICON_SYMBOL_TO_MATERIAL_ICON as Record<string, MaterialIconName>)[name] ?? DEFAULT_MATERIAL_ICON_NAME;
}

function MaterialIconFallback({
  name,
  size,
  color,
  style,
}: {
  name: string;
  size: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <MaterialIcons color={color} size={size} name={getMaterialIconName(name)} />
    </View>
  );
}

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
  weight = 'regular',
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<ViewStyle>;
  weight?: SymbolWeight;
}) {
  const fallback = <MaterialIconFallback name={name} size={size} color={color} style={style} />;

  if (!SF_SYMBOLS_CONFIRMED_ON_IOS_15_1.has(name)) {
    return fallback;
  }

  return (
    <SymbolView
      weight={weight}
      tintColor={color}
      resizeMode="scaleAspectFit"
      name={name}
      fallback={fallback}
      style={[
        {
          width: size,
          height: size,
        },
        style,
      ]}
    />
  );
}

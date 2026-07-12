import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Pressable, StyleSheet } from "react-native";

import type { ComposedAdFavoriteAction } from "./types";

// Rose accent that stays legible on the dark scrim circle in both light and dark
// cards; mirrors the dark-theme `favorite` app color used on the deal-detail header.
const FAVORITE_ACTIVE_COLOR = "#F0467A";

export function AdFavoriteButton({ action }: { action: ComposedAdFavoriteAction }) {
  return (
    <Pressable
      onPress={action.onPress}
      disabled={action.disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel ?? action.label}
      accessibilityState={{ selected: action.selected, disabled: action.disabled }}
      style={({ pressed }) => [styles.button, { opacity: pressed && !action.disabled ? 0.82 : 1 }]}
    >
      <MaterialIcons
        name={action.selected ? "favorite" : "favorite-border"}
        size={22}
        color={action.selected ? FAVORITE_ACTIVE_COLOR : "#FFFFFF"}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.42)",
    zIndex: 2,
  },
});

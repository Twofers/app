export type SwitchAccessibilityState = {
  checked: boolean;
  disabled?: boolean;
};

export function getSwitchAccessibilityState(
  checked: boolean,
  disabled = false,
): SwitchAccessibilityState {
  return disabled ? { checked, disabled: true } : { checked };
}

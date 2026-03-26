import React from "react";
import { View } from "react-native";

type Props = Record<string, unknown> & { children?: React.ReactNode };

export default function MapViewStub(props: Props) {
  return <View {...props} />;
}

export function Marker(props: Props) {
  return <View {...props} />;
}

export function Circle(props: Props) {
  return <View {...props} />;
}


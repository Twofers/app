import { useCallback, useEffect, useRef } from "react";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

import { devWarn } from "@/lib/dev-log";

const REGISTER_SUCCESS_SOUND = require("../assets/sounds/twofer-redemption.wav");

export function useRegisterSuccessSound() {
  const playerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    playerRef.current = createAudioPlayer(REGISTER_SUCCESS_SOUND, {
      keepAudioSessionActive: false,
    });
    return () => {
      playerRef.current?.remove();
      playerRef.current = null;
    };
  }, []);

  return useCallback(async () => {
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        interruptionMode: "mixWithOthers",
        allowsRecording: false,
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      });
      const player = playerRef.current ?? createAudioPlayer(REGISTER_SUCCESS_SOUND);
      playerRef.current = player;
      player.volume = 1;
      await player.seekTo(0);
      player.play();
    } catch (err) {
      devWarn("[register-success-sound] playback failed:", err);
    }
  }, []);
}

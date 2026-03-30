import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import type { GeneratedAd } from "./ad-variants";
import type { StructuredOffer } from "./menu-offer";

export type RefineChatTurn = { role: "user" | "assistant"; content: string };

type WizardContextValue = {
  /** Primary first; additional locations when multi-location publish */
  dealLocationIds: string[];
  setDealLocationIds: (ids: string[]) => void;
  structuredOffer: StructuredOffer | null;
  setStructuredOffer: (o: StructuredOffer | null) => void;
  adsOriginal: GeneratedAd[] | null;
  adsWorking: GeneratedAd[] | null;
  setGenerationResult: (ads: GeneratedAd[]) => void;
  updateWorkingAd: (index: number, ad: GeneratedAd) => void;
  resetAdToOriginal: (index: number) => void;
  refineAdIndex: number | null;
  setRefineAdIndex: (i: number | null) => void;
  refineHistory: RefineChatTurn[];
  setRefineHistory: React.Dispatch<React.SetStateAction<RefineChatTurn[]>>;
  clearWizard: () => void;
};

const CreateMenuOfferWizardContext = createContext<WizardContextValue | null>(null);

function cloneAd(a: GeneratedAd): GeneratedAd {
  return { ...a };
}

export function CreateMenuOfferWizardProvider({ children }: { children: React.ReactNode }) {
  const [dealLocationIds, setDealLocationIds] = useState<string[]>([]);
  const [structuredOffer, setStructuredOffer] = useState<StructuredOffer | null>(null);
  const [adsOriginal, setAdsOriginal] = useState<GeneratedAd[] | null>(null);
  const [adsWorking, setAdsWorking] = useState<GeneratedAd[] | null>(null);
  const [refineAdIndex, setRefineAdIndex] = useState<number | null>(null);
  const [refineHistory, setRefineHistory] = useState<RefineChatTurn[]>([]);

  const setGenerationResult = useCallback((ads: GeneratedAd[]) => {
    const o = ads.map(cloneAd);
    const w = ads.map(cloneAd);
    setAdsOriginal(o);
    setAdsWorking(w);
    setRefineHistory([]);
    setRefineAdIndex(null);
  }, []);

  const updateWorkingAd = useCallback((index: number, ad: GeneratedAd) => {
    setAdsWorking((prev) => {
      if (!prev || index < 0 || index >= prev.length) return prev;
      const next = [...prev];
      next[index] = cloneAd(ad);
      return next;
    });
  }, []);

  const resetAdToOriginal = useCallback((index: number) => {
    setAdsWorking((prev) => {
      if (!prev || !adsOriginal || index < 0 || index >= adsOriginal.length) return prev;
      const next = [...prev];
      next[index] = cloneAd(adsOriginal[index]);
      return next;
    });
  }, [adsOriginal]);

  const clearWizard = useCallback(() => {
    setDealLocationIds([]);
    setStructuredOffer(null);
    setAdsOriginal(null);
    setAdsWorking(null);
    setRefineAdIndex(null);
    setRefineHistory([]);
  }, []);

  const value = useMemo(
    () => ({
      dealLocationIds,
      setDealLocationIds,
      structuredOffer,
      setStructuredOffer,
      adsOriginal,
      adsWorking,
      setGenerationResult,
      updateWorkingAd,
      resetAdToOriginal,
      refineAdIndex,
      setRefineAdIndex,
      refineHistory,
      setRefineHistory,
      clearWizard,
    }),
    [
      dealLocationIds,
      structuredOffer,
      adsOriginal,
      adsWorking,
      setGenerationResult,
      updateWorkingAd,
      resetAdToOriginal,
      refineAdIndex,
      refineHistory,
      clearWizard,
    ],
  );

  return (
    <CreateMenuOfferWizardContext.Provider value={value}>
      {children}
    </CreateMenuOfferWizardContext.Provider>
  );
}

export function useCreateMenuOfferWizard() {
  const ctx = useContext(CreateMenuOfferWizardContext);
  if (!ctx) {
    throw new Error("useCreateMenuOfferWizard must be used within CreateMenuOfferWizardProvider");
  }
  return ctx;
}

export function useOptionalCreateMenuOfferWizard() {
  return useContext(CreateMenuOfferWizardContext);
}

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import type { StructuredOffer } from "./menu-offer";

type WizardContextValue = {
  /** Primary first; additional locations when multi-location publish */
  dealLocationIds: string[];
  setDealLocationIds: (ids: string[]) => void;
  structuredOffer: StructuredOffer | null;
  setStructuredOffer: (o: StructuredOffer | null) => void;
  clearWizard: () => void;
};

const CreateMenuOfferWizardContext = createContext<WizardContextValue | null>(null);

export function CreateMenuOfferWizardProvider({ children }: { children: React.ReactNode }) {
  const [dealLocationIds, setDealLocationIds] = useState<string[]>([]);
  const [structuredOffer, setStructuredOffer] = useState<StructuredOffer | null>(null);

  const clearWizard = useCallback(() => {
    setDealLocationIds([]);
    setStructuredOffer(null);
  }, []);

  const value = useMemo(
    () => ({
      dealLocationIds,
      setDealLocationIds,
      structuredOffer,
      setStructuredOffer,
      clearWizard,
    }),
    [dealLocationIds, structuredOffer, clearWizard],
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

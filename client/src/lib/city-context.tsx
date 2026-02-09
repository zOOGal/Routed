import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface CityContextType {
  cityId: string;
  setCityId: (id: string) => void;
}

const CityContext = createContext<CityContextType | undefined>(undefined);

const STORAGE_KEY = "routed-selected-city";
const DEFAULT_CITY = "nyc";

export function CityProvider({ children }: { children: ReactNode }) {
  // Initialize from localStorage or default
  const [cityId, setCityIdState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_CITY;
    }
    return DEFAULT_CITY;
  });

  // Persist to localStorage when city changes
  const setCityId = (id: string) => {
    setCityIdState(id);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, id);
    }
  };

  return (
    <CityContext.Provider value={{ cityId, setCityId }}>
      {children}
    </CityContext.Provider>
  );
}

export function useCity() {
  const context = useContext(CityContext);
  if (context === undefined) {
    throw new Error("useCity must be used within a CityProvider");
  }
  return context;
}

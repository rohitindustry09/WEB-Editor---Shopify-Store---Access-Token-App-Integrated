"use client";

import { createContext, useContext } from "react";

const StoreDomainContext = createContext("");

/** The connected store's myshopify domain, for links into its Shopify admin. Empty outside the app shell. */
export const StoreDomainProvider = StoreDomainContext.Provider;
export const useStoreDomain = (): string => useContext(StoreDomainContext);

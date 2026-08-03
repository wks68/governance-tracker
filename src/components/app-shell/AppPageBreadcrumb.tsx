"use client";

import { useEffect } from "react";

export const APP_BREADCRUMB_EVENT = "dms:app-breadcrumb";
export const APP_BREADCRUMB_REQUEST_EVENT = "dms:app-breadcrumb-request";

export default function AppPageBreadcrumb({ label }: { label: string }) {
  useEffect(() => {
    const announce = () => {
      window.dispatchEvent(new CustomEvent(APP_BREADCRUMB_EVENT, { detail: { label } }));
    };
    window.addEventListener(APP_BREADCRUMB_REQUEST_EVENT, announce);
    announce();
    return () => {
      window.removeEventListener(APP_BREADCRUMB_REQUEST_EVENT, announce);
      window.dispatchEvent(new CustomEvent(APP_BREADCRUMB_EVENT, { detail: { label: null } }));
    };
  }, [label]);
  return null;
}

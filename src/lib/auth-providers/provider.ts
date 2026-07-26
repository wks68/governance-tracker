// C2-A Provider 契約的小型建構輔助。
//
// 這裡不定義新的公開型別，只提供組出符合 AuthProvider 介面之描述子的共用邏輯，
// 讓 local/ 與 testing/ 下的實作不必各自重複同樣的樣板。

import type { AuthProvider, ProviderCapabilities, ProviderDescriptor, ProviderKind } from "./types";

export function createProviderDescriptor(params: {
  key: string;
  kind: ProviderKind;
  displayName: string;
  enabled: boolean;
  capabilities: ProviderCapabilities;
}): ProviderDescriptor {
  return {
    key: params.key,
    kind: params.kind,
    displayName: params.displayName,
    enabled: params.enabled,
    capabilities: params.capabilities,
  };
}

export function isProviderEnabled(provider: AuthProvider): boolean {
  return provider.descriptor.enabled;
}

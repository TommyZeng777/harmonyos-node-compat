import { connection } from '@kit.NetworkKit';

export interface ResolvedAddress { address: string; family: number; }

// Resolves a hostname on the ArkTS side for code in the Worker (which has no DNS),
// e.g. to check the addresses before a fetch with pinnedAddresses.
export async function resolveHostname(hostname: string): Promise<ResolvedAddress[]> {
  if (!hostname || hostname.length > 253 || !/^[a-zA-Z0-9_.-]+$/.test(hostname)) throw new Error('invalid_hostname');
  const values = await connection.getAddressesByName(hostname);
  return values.map((value: connection.NetAddress): ResolvedAddress => ({ address: value.address, family: value.address.includes(':') ? 6 : 4 }));
}

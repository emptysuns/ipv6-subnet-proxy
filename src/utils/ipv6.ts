import crypto from 'crypto';
import os from 'os';

export interface ParsedCIDR {
  prefix: string;
  prefixLength: number;
}

export function parseCIDR(cidr: string): ParsedCIDR {
  const parts = cidr.split('/');
  if (parts.length !== 2) {
    throw new Error(`Invalid CIDR format: "${cidr}". Expected: "2001:db8:1::/64"`);
  }

  const prefixLength = parseInt(parts[1], 10);
  if (isNaN(prefixLength) || prefixLength < 1 || prefixLength > 128) {
    throw new Error(`Invalid prefix length in "${cidr}": must be 1-128`);
  }

  const addrStr = parts[0];
  let hextets: string[];
  if (addrStr.includes('::')) {
    const sides = addrStr.split('::');
    const left = sides[0] ? sides[0].split(':').filter(s => s !== '') : [];
    const right = sides[1] ? sides[1].split(':').filter(s => s !== '') : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0) {
      throw new Error(`Invalid IPv6 address in "${cidr}": too many hextets`);
    }
    hextets = [...left, ...Array(missing).fill('0'), ...right];
  } else {
    hextets = addrStr.split(':');
  }

  if (hextets.length !== 8) {
    throw new Error(`Invalid IPv6 address in "${cidr}": expected 8 hextets, got ${hextets.length}`);
  }

  for (const h of hextets) {
    if (!/^[0-9a-fA-F]{0,4}$/.test(h)) {
      throw new Error(`Invalid hextet "${h}" in "${cidr}"`);
    }
  }

  const padded = hextets.map(h => h.padStart(4, '0').toLowerCase());
  return { prefix: padded.join(':'), prefixLength };
}

export function generateIPv6(prefix: string, prefixLength: number): string {
  const hextets = prefix.split(':');
  const prefixBytes = Math.floor(prefixLength / 16);

  const result: string[] = [];
  for (let i = 0; i < 8; i++) {
    if (i < prefixBytes) {
      result.push(hextets[i]);
    } else if (i === prefixBytes && prefixLength % 16 !== 0) {
      const remaining = prefixLength % 16;
      const mask = (0xFFFF << (16 - remaining)) & 0xFFFF;
      const base = parseInt(hextets[i], 16) & mask;
      const randomPart = crypto.randomInt(0, 1 << (16 - remaining));
      result.push((base | randomPart).toString(16).padStart(4, '0'));
    } else {
      const rand = crypto.randomInt(0, 0xFFFF + 1);
      result.push(rand.toString(16).padStart(4, '0'));
    }
  }

  // Avoid all-zeros and all-ones interface ID
  const suffixStart = Math.max(0, prefixBytes);
  const suffix = result.slice(suffixStart).join(':');
  if (suffix === '0000:0000:0000:0000'.slice(0, suffix.length) ||
      suffix === 'ffff:ffff:ffff:ffff'.slice(0, suffix.length)) {
    return generateIPv6(prefix, prefixLength);
  }

  return result.join(':');
}

export function isReservedIPv6(addr: string): boolean {
  const lower = addr.toLowerCase();
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') ||
      lower.startsWith('fea') || lower.startsWith('feb')) return true;
  if (lower.startsWith('ff')) return true;
  return false;
}

/**
 * Auto-detect IPv6 subnets from the host's network interfaces.
 *
 * Reads all network interfaces via os.networkInterfaces(), extracts
 * IPv6 addresses with their prefix lengths (from the `cidr` field),
 * computes the network address for each, and returns unique subnet
 * CIDRs suitable for proxy address allocation.
 *
 * Skip candidates: loopback, link-local (fe80::/10), unspecified,
 * multicast (ff00::/8), and addresses with a /128 prefix (single-host).
 */
export function detectIPv6Subnets(): string[] {
  const ifaces = os.networkInterfaces();
  const subnets = new Set<string>();

  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;

    for (const addr of addrs) {
      // Only IPv6, only external (non-internal), only with a routable prefix
      if (addr.family !== 'IPv6' || addr.internal) continue;

      const cidr = (addr as any).cidr as string | undefined;
      if (!cidr) continue;

      const slashIdx = cidr.indexOf('/');
      if (slashIdx === -1) continue;

      const prefixLen = parseInt(cidr.slice(slashIdx + 1), 10);
      // Skip /128 (single-host, not a usable subnet) and invalid lengths
      if (isNaN(prefixLen) || prefixLen < 1 || prefixLen > 127) continue;

      const ipStr = cidr.slice(0, slashIdx);

      // Skip reserved address ranges
      if (isReservedIPv6(ipStr)) continue;
      if (ipStr.startsWith('fd') || ipStr.startsWith('fc')) continue; // ULA (optional skip)

      // Compute the network / prefix address
      try {
        const network = networkAddressFromCIDR(ipStr, prefixLen);
        const subnetCidr = `${network}/${prefixLen}`;
        subnets.add(subnetCidr);
      } catch {
        // silently skip malformed addresses
      }
    }
  }

  return Array.from(subnets);
}

/**
 * Given an IPv6 address and a prefix length, compute the network address
 * (all host bits zeroed). E.g., "2001:db8:1::1" / 64 => "2001:db8:1::"
 */
function networkAddressFromCIDR(address: string, prefixLen: number): string {
  const parts = address.split(':');
  // Expand :: notation
  let hextets: string[];
  if (address.includes('::')) {
    const sides = address.split('::');
    const left = sides[0] ? sides[0].split(':').filter(s => s !== '') : [];
    const right = sides[1] ? sides[1].split(':').filter(s => s !== '') : [];
    const missing = 8 - left.length - right.length;
    hextets = [...left, ...Array(missing).fill('0'), ...right];
  } else {
    hextets = address.split(':');
  }

  // Zero out bits beyond the prefix
  for (let i = 0; i < 8; i++) {
    const hextetVal = parseInt(hextets[i] || '0', 16);
    const bitsBefore = i * 16;
    if (bitsBefore >= prefixLen) {
      hextets[i] = '0';
    } else if (bitsBefore + 16 > prefixLen) {
      const keepBits = prefixLen - bitsBefore;
      const mask = 0xFFFF << (16 - keepBits);
      hextets[i] = (hextetVal & mask).toString(16).padStart(4, '0');
    } else {
      hextets[i] = hextetVal.toString(16).padStart(4, '0');
    }
  }

  return hextets.join(':').toLowerCase();
}

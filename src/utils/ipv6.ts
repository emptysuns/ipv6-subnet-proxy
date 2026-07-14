import crypto from 'crypto';
import os from 'os';
import { execFileSync } from 'child_process';

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
 * IPv6 addresses with their prefix lengths, computes the network address
 * for each, and returns unique subnet CIDRs suitable for proxy address
 * allocation.
 *
 * Two strategies (in order):
 * 1. Use the `cidr` field directly (available on Node.js >= 18).
 * 2. Fall back to computing the prefix length from the `netmask` field
 *    when `cidr` is null/missing (Node.js docs note `cidr` can be null
 *    when the netmask is invalid; some kernels report IPv6 addresses
 *    differently).
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
      // Only IPv6, only external (non-internal)
      if (addr.family !== 'IPv6' || addr.internal) continue;

      let ipStr: string;
      let prefixLen: number;

      // Strategy 1: use the cidr field
      const cidr = (addr as any).cidr as string | undefined | null;
      if (cidr) {
        const slashIdx = cidr.indexOf('/');
        if (slashIdx === -1) continue;
        prefixLen = parseInt(cidr.slice(slashIdx + 1), 10);
        ipStr = cidr.slice(0, slashIdx);
      } else {
        // Strategy 2: construct from address + netmask
        const netmask = (addr as any).netmask as string | undefined;
        if (!netmask) continue;
        prefixLen = prefixLengthFromNetmask(netmask);
        if (prefixLen < 1) continue;
        ipStr = (addr as any).address as string;
        if (!ipStr) continue;
      }

      // Skip /128 (single-host, not a usable subnet) and invalid lengths
      if (isNaN(prefixLen) || prefixLen < 1 || prefixLen > 127) continue;

      // Skip reserved address ranges
      if (isReservedIPv6(ipStr)) continue;
      if (ipStr.startsWith('fd') || ipStr.startsWith('fc')) continue; // ULA

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
 * Compute the prefix length from an IPv6 netmask string.
 * E.g., "ffff:ffff:ffff:ffff:0000:0000:0000:0000" → 64
 */
function prefixLengthFromNetmask(netmask: string): number {
  // Expand :: notation in the netmask
  let hextets: string[];
  if (netmask.includes('::')) {
    const sides = netmask.split('::');
    const left = sides[0] ? sides[0].split(':').filter(s => s !== '') : [];
    const right = sides[1] ? sides[1].split(':').filter(s => s !== '') : [];
    const missing = 8 - left.length - right.length;
    hextets = [...left, ...Array(missing).fill('0'), ...right];
  } else {
    hextets = netmask.split(':');
  }

  if (hextets.length !== 8) return 0;

  let bits = 0;
  for (const h of hextets) {
    const val = parseInt(h || '0', 16);
    if (val === 0xFFFF) {
      bits += 16;
    } else {
      // Count leading 1 bits in this hextet
      let mask = 0x8000;
      while (mask && (val & mask)) {
        bits++;
        mask >>= 1;
      }
      break;
    }
  }
  return bits;
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

// --- Interface address binding for LXC / non-Docker deployments ---

let _outboundInterface: string | null = null;
const _registeredAddrs = new Set<string>();

/**
 * Detect or return the cached outbound network interface (the one
 * with the default IPv6 route). Respects IPV6_INTERFACE env var.
 */
export function getOutboundInterface(): string {
  if (_outboundInterface) return _outboundInterface;

  // Allow explicit override via env
  const envIface = process.env.IPV6_INTERFACE;
  if (envIface) {
    _outboundInterface = envIface;
    return envIface;
  }

  // Auto-detect: find the interface that has the default IPv6 route
  try {
    const out = execFileSync('ip', ['-6', 'route', 'show', 'default'], {
      encoding: 'utf-8', timeout: 3000,
    });
    // Output: "default via FE80::1 dev eth0 metric 1024 pref medium"
    const m = out.match(/dev (\S+)/);
    if (m) {
      _outboundInterface = m[1];
      return _outboundInterface;
    }
  } catch {}

  // Fallback: use the first non-loopback interface with a global IPv6 address
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (name === 'lo' || !addrs) continue;
    for (const a of addrs) {
      if (a.family === 'IPv6' && !a.internal) {
        _outboundInterface = name;
        return name;
      }
    }
  }

  return 'eth0'; // last-resort fallback
}

/**
 * Register an IPv6 address on the outbound interface so the upstream
 * router responds to NDP (Neighbor Discovery) queries for this address.
 *
 * In LXC containers and some VPS configurations, only addresses
 * explicitly added to the network interface receive return traffic
 * because the upstream switch/router uses NDP to map IPv6 → MAC.
 * Adding the address to the interface makes the kernel answer NDP
 * solicitations, so return packets reach the container.
 */
export function registerIPv6Address(addr: string): void {
  if (_registeredAddrs.has(addr)) return;

  const iface = getOutboundInterface();
  try {
    execFileSync('ip', ['-6', 'addr', 'add', `${addr}/128`, 'dev', iface], {
      timeout: 3000,
    });
    _registeredAddrs.add(addr);
  } catch {
    // Address may already exist on the interface (e.g., from a previous
    // run) — still mark as registered so we track it for cleanup.
    _registeredAddrs.add(addr);
  }
}

/**
 * Remove a previously registered IPv6 address from the outbound interface.
 * Safe to call on addresses that were never registered.
 */
export function unregisterIPv6Address(addr: string): void {
  if (!_registeredAddrs.has(addr)) return;

  const iface = getOutboundInterface();
  try {
    execFileSync('ip', ['-6', 'addr', 'del', `${addr}/128`, 'dev', iface], {
      timeout: 3000,
    });
  } catch {
    // best-effort cleanup
  }
  _registeredAddrs.delete(addr);
}

/**
 * Remove all registered addresses (called on graceful shutdown).
 */
export function unregisterAllIPv6Addresses(): void {
  for (const addr of _registeredAddrs) {
    const iface = getOutboundInterface();
    try {
      execFileSync('ip', ['-6', 'addr', 'del', `${addr}/128`, 'dev', iface], {
        timeout: 3000,
      });
    } catch {
      // best-effort
    }
  }
  _registeredAddrs.clear();
}

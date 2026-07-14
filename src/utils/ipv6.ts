import crypto from 'crypto';

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

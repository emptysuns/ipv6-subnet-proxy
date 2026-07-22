import { v4 as uuidv4 } from 'uuid';
import net from 'net';
import { unregisterIPv6Address } from '../utils/ipv6';
export interface Session {
  id: string;
  userId: string;
  ipv6Addr: string;
  connectedAt: string;
  clientSocket: net.Socket;
  targetSocket: net.Socket | null;
}

const activeSessions = new Map<string, Session>();

export function createSession(userId: string, ipv6Addr: string, clientSocket: net.Socket): Session {
  const id = uuidv4();
  const session: Session = {
    id, userId, ipv6Addr,
    connectedAt: new Date().toISOString(),
    clientSocket, targetSocket: null,
  };
  activeSessions.set(id, session);
  return session;
}

export function setTargetSocket(sessionId: string, targetSocket: net.Socket): void {
  const session = activeSessions.get(sessionId);
  if (session) session.targetSocket = targetSocket;
}

export function closeSession(id: string): void {
  const session = activeSessions.get(id);
  if (!session) return;
  activeSessions.delete(id);
  // Drop interface address when last session using it ends (refcount in ipv6.ts)
  unregisterIPv6Address(session.ipv6Addr);
}

export function getActiveSessions(): Session[] {
  return Array.from(activeSessions.values());
}

export function getSession(id: string): Session | undefined {
  return activeSessions.get(id);
}

export function forceDisconnect(id: string): boolean {
  const session = activeSessions.get(id);
  if (!session) return false;
  if (session.clientSocket && !session.clientSocket.destroyed) {
    session.clientSocket.destroy();
  }
  if (session.targetSocket && !session.targetSocket.destroyed) {
    session.targetSocket.destroy();
  }
  // destroy() triggers close handlers that also call closeSession; still
  // release here so orphan sessions without relay listeners clean up.
  closeSession(id);
  return true;
}

export function getConnectionCount(userId: string): number {
  let count = 0;
  for (const s of activeSessions.values()) {
    if (s.userId === userId) count++;
  }
  return count;
}

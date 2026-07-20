/**
 * In-memory store for pending ticket data between modal submit and product selection.
 * Entries expire after 10 minutes if the user doesn't complete the flow.
 */

export interface PendingTicketData {
  mcid: string;
  purchaseId: string;
  timestamp: number;
}

const pending = new Map<string, PendingTicketData>();

export function setPending(userId: string, data: Omit<PendingTicketData, "timestamp">) {
  pending.set(userId, { ...data, timestamp: Date.now() });
}

export function getPending(userId: string): PendingTicketData | undefined {
  return pending.get(userId);
}

export function clearPending(userId: string) {
  pending.delete(userId);
}

// Clean up stale entries older than 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [userId, data] of pending.entries()) {
    if (data.timestamp < cutoff) {
      pending.delete(userId);
    }
  }
}, 60_000);

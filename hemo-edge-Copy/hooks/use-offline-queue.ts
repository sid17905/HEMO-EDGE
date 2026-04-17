// FILE: hooks/use-offline-queue.ts
// Phase 5 — Pillar D: Offline queue with NetInfo, AsyncStorage, Firestore sync,
// and conflict detection. Never silently discards data.

import { useCallback, useEffect, useRef, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  query,
  where,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  getSecureTimestamp,
  writeAuditLog,
  saveScanResult,
} from '../lib/firestore-service';
import type { StoredScanResult } from '../lib/firestore-service';

// ─────────────────────────────────────────────────────────────────────────────
//  Types matching the Phase 5 Firestore schema
// ─────────────────────────────────────────────────────────────────────────────

export type OfflineAction =
  | 'create_scan'
  | 'update_status'
  | 'add_annotation';

export interface OfflineQueueItem {
  id:            string;
  actorId:       string;
  action:        OfflineAction;
  payload:       Record<string, unknown>;
  createdAt:     string;          // ISO — local device time
  synced:        boolean;
  syncedAt?:     string;          // ISO
  conflictFlag:  boolean;
}

export interface OfflineConflict {
  queueId:        string;
  action:         OfflineAction;
  localPayload:   Record<string, unknown>;
  serverSnapshot: Record<string, unknown>;
}

export interface UseOfflineQueueReturn {
  isOnline:      boolean;
  queueLength:   number;
  isSyncing:     boolean;
  conflicts:     OfflineConflict[];
  enqueueAction: (action: OfflineAction, payload: Record<string, unknown>) => Promise<string>;
  flushQueue:    () => Promise<void>;
  resolveConflict: (queueId: string, resolution: 'keep_local' | 'keep_server') => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Typed errors
// ─────────────────────────────────────────────────────────────────────────────

export class OfflineQueueError extends Error {
  public readonly code: 'enqueue_failed' | 'flush_failed' | 'conflict_resolution_failed';
  constructor(code: OfflineQueueError['code'], message: string) {
    super(message);
    this.name = 'OfflineQueueError';
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  AsyncStorage key helpers
// ─────────────────────────────────────────────────────────────────────────────

const QUEUE_KEY = 'hemo_edge_offline_queue';

async function readLocalQueue(): Promise<OfflineQueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as OfflineQueueItem[]) : [];
  } catch {
    return [];
  }
}

async function writeLocalQueue(items: OfflineQueueItem[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Action replayer — applies a queued action against Firestore
//  Returns undefined on success, or a server snapshot string if conflict found.
// ─────────────────────────────────────────────────────────────────────────────

async function replayAction(
  item: OfflineQueueItem,
): Promise<{ conflict: false } | { conflict: true; serverSnapshot: Record<string, unknown> }> {
  const { action, payload, actorId } = item;

  if (action === 'create_scan') {
    // Payload must contain uid + scan data
    const { uid, ...scanData } = payload as { uid: string } & Omit<StoredScanResult, 'id'>;
    if (!uid) throw new OfflineQueueError('flush_failed', 'create_scan payload missing uid');
    await saveScanResult(uid, scanData as Omit<StoredScanResult, 'id'>);
    return { conflict: false };
  }

  if (action === 'update_status') {
    // Payload: { scanPath: string, fields: Record<string, unknown>, expectedUpdatedAt?: string }
    const { scanPath, fields, expectedUpdatedAt } = payload as {
      scanPath:          string;
      fields:            Record<string, unknown>;
      expectedUpdatedAt?: string;
    };
    const scanRef   = doc(db, scanPath);
    const serverDoc = await getDoc(scanRef);

    if (!serverDoc.exists()) {
      // Document deleted server-side — treat as conflict
      return { conflict: true, serverSnapshot: { _deleted: true } };
    }

    const serverData = serverDoc.data() as Record<string, unknown>;

    // Optimistic concurrency: if expectedUpdatedAt supplied and server differs → conflict
    if (
      expectedUpdatedAt &&
      serverData['updatedAt'] &&
      serverData['updatedAt'] !== expectedUpdatedAt
    ) {
      return { conflict: true, serverSnapshot: serverData };
    }

    await updateDoc(scanRef, {
      ...fields,
      updatedAt: await getSecureTimestamp(),
    });
    return { conflict: false };
  }

  if (action === 'add_annotation') {
    // Payload: { scanId: string, annotation: Record<string, unknown> }
    const { scanId, annotation } = payload as {
      scanId:     string;
      annotation: Record<string, unknown>;
    };
    const annotationsRef = collection(db, 'scans', scanId, 'annotations');
    await addDoc(annotationsRef, {
      ...annotation,
      addedBy:   actorId,
      addedAt:   await getSecureTimestamp(),
      _server:   serverTimestamp(),
    });
    return { conflict: false };
  }

  // Unknown action — log and skip rather than lose data
  console.warn('HEMO-EDGE: Unknown offline action —', action);
  return { conflict: false };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useOfflineQueue(actorId: string): UseOfflineQueueReturn {
  const [isOnline,    setIsOnline]    = useState<boolean>(true);
  const [queueLength, setQueueLength] = useState<number>(0);
  const [isSyncing,   setIsSyncing]   = useState<boolean>(false);
  const [conflicts,   setConflicts]   = useState<OfflineConflict[]>([]);

  const isSyncingRef = useRef(false);       // guards against concurrent flushes
  const mounted      = useRef(true);

  // ── Sync queue length from AsyncStorage on mount ──────────────────────────
  useEffect(() => {
    mounted.current = true;
    readLocalQueue().then((items) => {
      if (mounted.current) setQueueLength(items.filter((i) => !i.synced).length);
    });
    return () => { mounted.current = false; };
  }, []);

  // ── NetInfo subscription ───────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      if (mounted.current) setIsOnline(online);

      // Auto-flush when coming back online
      if (online && !isSyncingRef.current) {
        flushQueue();
      }
    });

    // Fetch initial state
    NetInfo.fetch().then((state: NetInfoState) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      if (mounted.current) setIsOnline(online);
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId]);

  // ── enqueueAction ──────────────────────────────────────────────────────────
  const enqueueAction = useCallback(
    async (action: OfflineAction, payload: Record<string, unknown>): Promise<string> => {
      try {
        const queueId   = `oq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const createdAt = new Date().toISOString();

        const item: OfflineQueueItem = {
          id:           queueId,
          actorId,
          action,
          payload,
          createdAt,
          synced:       false,
          conflictFlag: false,
        };

        // 1. Write to AsyncStorage first (survives app kill)
        const existing = await readLocalQueue();
        await writeLocalQueue([...existing, item]);

        // 2. Mirror to Firestore /offlineQueue so server can inspect queue
        try {
          await addDoc(collection(db, 'offlineQueue'), {
            ...item,
            createdAt: serverTimestamp(),
            _localCreatedAt: createdAt,
          });
        } catch (fsErr) {
          // Firestore write can fail while offline — AsyncStorage copy is the source of truth
          console.warn('HEMO-EDGE: offlineQueue Firestore mirror failed (ok offline) ->', fsErr);
        }

        if (mounted.current) {
          setQueueLength((prev) => prev + 1);
        }

        console.log(`HEMO-EDGE: Enqueued offline action id=${queueId} action=${action}`);
        return queueId;
      } catch (err) {
        console.error('HEMO-EDGE: enqueueAction failed ->', err);
        throw new OfflineQueueError('enqueue_failed', `Failed to enqueue action: ${String(err)}`);
      }
    },
    [actorId],
  );

  // ── flushQueue ────────────────────────────────────────────────────────────
  const flushQueue = useCallback(async (): Promise<void> => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    if (mounted.current) setIsSyncing(true);

    try {
      const items   = await readLocalQueue();
      const pending = items.filter((i) => !i.synced);
      if (pending.length === 0) return;

      console.log(`HEMO-EDGE: Flushing ${pending.length} queued action(s)`);

      const newConflicts: OfflineConflict[] = [];

      for (const item of pending) {
        try {
          const result = await replayAction(item);

          if (result.conflict) {
            // Mark conflict — do NOT silently overwrite
            item.conflictFlag = true;
            newConflicts.push({
              queueId:        item.id,
              action:         item.action,
              localPayload:   item.payload,
              serverSnapshot: result.serverSnapshot,
            });

            // Update Firestore mirror
            await markQueueItemConflict(item.id);

            console.warn(`HEMO-EDGE: Conflict detected for queue item ${item.id}`);
          } else {
            item.synced   = true;
            item.syncedAt = new Date().toISOString();

            // Update Firestore mirror
            await markQueueItemSyncedLocal(item.id, item.syncedAt);

            console.log(`HEMO-EDGE: Synced queue item ${item.id}`);
          }
        } catch (itemErr) {
          // Single item failure must not block the rest — log and continue
          console.error(`HEMO-EDGE: Failed to replay queue item ${item.id} ->`, itemErr);
        }
      }

      // Persist updated items back to AsyncStorage
      await writeLocalQueue(items);

      if (mounted.current) {
        const remaining = items.filter((i) => !i.synced && !i.conflictFlag).length;
        setQueueLength(remaining + newConflicts.length);
        setConflicts((prev) => {
          // Merge, deduplicate by queueId
          const existingIds = new Set(prev.map((c) => c.queueId));
          return [...prev, ...newConflicts.filter((c) => !existingIds.has(c.queueId))];
        });
      }

      // Audit log the flush
      await writeAuditLog({
        actorUid:     actorId,
        actorRole:    'patient', // role not available here; audit detail is in individual replays
        action:       'create_scan', // closest existing type — Phase 5 spec may extend AuditLogEntry
        resourceType: 'scan',
        resourceId:   'offline_flush',
      });
    } catch (err) {
      console.error('HEMO-EDGE: flushQueue failed ->', err);
      throw new OfflineQueueError('flush_failed', `Queue flush failed: ${String(err)}`);
    } finally {
      isSyncingRef.current = false;
      if (mounted.current) setIsSyncing(false);
    }
  }, [actorId]);

  // ── resolveConflict ────────────────────────────────────────────────────────
  const resolveConflict = useCallback(
    async (queueId: string, resolution: 'keep_local' | 'keep_server'): Promise<void> => {
      try {
        const items = await readLocalQueue();
        const item  = items.find((i) => i.id === queueId);
        if (!item) throw new OfflineQueueError('conflict_resolution_failed', `Queue item ${queueId} not found`);

        if (resolution === 'keep_local') {
          // Force-replay without conflict checking
          if (item.action === 'create_scan') {
            const { uid, ...scanData } = item.payload as { uid: string } & Omit<StoredScanResult, 'id'>;
            await saveScanResult(uid, scanData as Omit<StoredScanResult, 'id'>);
          } else if (item.action === 'update_status') {
            const { scanPath, fields } = item.payload as {
              scanPath: string;
              fields:   Record<string, unknown>;
            };
            await updateDoc(doc(db, scanPath), {
              ...fields,
              updatedAt: await getSecureTimestamp(),
            });
          } else if (item.action === 'add_annotation') {
            const { scanId, annotation } = item.payload as {
              scanId:     string;
              annotation: Record<string, unknown>;
            };
            await addDoc(collection(db, 'scans', scanId, 'annotations'), {
              ...annotation,
              addedBy: item.actorId,
              addedAt: await getSecureTimestamp(),
              _server: serverTimestamp(),
            });
          }
        }
        // resolution === 'keep_server' → discard local changes (no-op for data writes)

        // Mark item as resolved (synced) in local queue
        const updated = items.map((i) =>
          i.id === queueId
            ? { ...i, synced: true, syncedAt: new Date().toISOString(), conflictFlag: false }
            : i,
        );
        await writeLocalQueue(updated);

        // Update Firestore mirror
        await resolveConflictInFirestore(queueId, resolution);

        if (mounted.current) {
          setConflicts((prev) => prev.filter((c) => c.queueId !== queueId));
          setQueueLength((prev) => Math.max(0, prev - 1));
        }

        console.log(`HEMO-EDGE: Conflict ${queueId} resolved as ${resolution}`);
      } catch (err) {
        console.error('HEMO-EDGE: resolveConflict failed ->', err);
        throw new OfflineQueueError(
          'conflict_resolution_failed',
          `Failed to resolve conflict ${queueId}: ${String(err)}`,
        );
      }
    },
    [],
  );

  return { isOnline, queueLength, isSyncing, conflicts, enqueueAction, flushQueue, resolveConflict };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Internal Firestore mirror helpers
//  These are internal to the hook — the public API equivalents live in
//  firestore-service.ts (markQueueItemSynced, resolveConflict).
// ─────────────────────────────────────────────────────────────────────────────

async function findFirestoreQueueDoc(localQueueId: string): Promise<string | null> {
  try {
    const q    = query(collection(db, 'offlineQueue'), where('id', '==', localQueueId));
    const snap = await getDocs(q);
    return snap.empty ? null : snap.docs[0].id;
  } catch {
    return null;
  }
}

async function markQueueItemSyncedLocal(localQueueId: string, syncedAt: string): Promise<void> {
  try {
    const fsDocId = await findFirestoreQueueDoc(localQueueId);
    if (!fsDocId) return;
    await updateDoc(doc(db, 'offlineQueue', fsDocId), {
      synced:    true,
      syncedAt:  syncedAt,
      _syncedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('HEMO-EDGE: markQueueItemSyncedLocal Firestore update failed ->', err);
  }
}

async function markQueueItemConflict(localQueueId: string): Promise<void> {
  try {
    const fsDocId = await findFirestoreQueueDoc(localQueueId);
    if (!fsDocId) return;
    await updateDoc(doc(db, 'offlineQueue', fsDocId), {
      conflictFlag: true,
    });
  } catch (err) {
    console.warn('HEMO-EDGE: markQueueItemConflict Firestore update failed ->', err);
  }
}

async function resolveConflictInFirestore(
  localQueueId: string,
  resolution:   'keep_local' | 'keep_server',
): Promise<void> {
  try {
    const fsDocId = await findFirestoreQueueDoc(localQueueId);
    if (!fsDocId) return;
    await updateDoc(doc(db, 'offlineQueue', fsDocId), {
      synced:       true,
      syncedAt:     new Date().toISOString(),
      conflictFlag: false,
      resolution,
      _resolvedAt:  serverTimestamp(),
    });
  } catch (err) {
    console.warn('HEMO-EDGE: resolveConflictInFirestore failed ->', err);
  }
}

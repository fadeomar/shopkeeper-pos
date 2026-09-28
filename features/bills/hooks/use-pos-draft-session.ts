"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BillFormSchema } from "@/features/bills/schema";
import {
  activateDraftInSession,
  addDraftToSession,
  createPosDraftSession,
  getPosDraftV1Key,
  getPosDraftV2Key,
  migrateLegacyPosDraft,
  parsePosDraftSession,
  removeDraftFromSession,
  replaceDraftInSession,
  syncDraftForm,
  type PosDraftSession,
  type PosInvoiceDraft,
} from "@/features/bills/utils/pos-drafts";
import { nowIso } from "@/lib/utils/date";
import type { BillDraftItem } from "@/types/domain";

type DraftItemsUpdater =
  | BillDraftItem[]
  | ((items: BillDraftItem[]) => BillDraftItem[]);

export function usePosDraftSession({
  userId,
  fallbackForm,
}: {
  userId?: string;
  fallbackForm: BillFormSchema;
}) {
  const fallbackFormRef = useRef(fallbackForm);
  fallbackFormRef.current = fallbackForm;

  const [session, setSession] = useState<PosDraftSession | null>(null);
  const [ready, setReady] = useState(false);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);

  const storageKey = userId ? getPosDraftV2Key(userId) : null;

  useEffect(() => {
    setReady(false);
    setSession(null);
    setLoadedUserId(null);
    if (!userId) return;

    const currentFallback = fallbackFormRef.current;
    const v2Key = getPosDraftV2Key(userId);
    const v1Key = getPosDraftV1Key(userId);
    const rawV2 = window.localStorage.getItem(v2Key);
    const parsedV2 = rawV2
      ? parsePosDraftSession(rawV2, currentFallback)
      : null;

    if (parsedV2) {
      setSession(parsedV2);
      setLoadedUserId(userId);
      setReady(true);
      return;
    }

    if (rawV2) window.localStorage.removeItem(v2Key);

    const rawV1 = window.localStorage.getItem(v1Key);
    const migrated = rawV1
      ? migrateLegacyPosDraft(rawV1, currentFallback)
      : null;
    const next = migrated ?? createPosDraftSession(currentFallback);

    // Persist before deleting the legacy key so a quota/storage error never
    // destroys the only copy of an in-progress sale.
    try {
      window.localStorage.setItem(v2Key, JSON.stringify(next));
      if (migrated) window.localStorage.removeItem(v1Key);
    } catch {
      // The in-memory session still works for this visit. Persistence will be
      // retried by the effect below on the next session change.
    }

    setSession(next);
    setLoadedUserId(userId);
    setReady(true);
  }, [userId]);

  useEffect(() => {
    // userId can change before React commits the state loaded for that user.
    // Guard the write so a shared browser can never persist cashier A's open
    // invoices under cashier B's storage key during that transition render.
    if (
      !ready ||
      !storageKey ||
      !session ||
      !userId ||
      loadedUserId !== userId
    )
      return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(session));
    } catch {
      // Keep checkout usable if browser storage is temporarily unavailable.
    }
  }, [loadedUserId, ready, session, storageKey, userId]);

  const activeDraft = useMemo<PosInvoiceDraft | null>(() => {
    if (!session) return null;
    return (
      session.drafts.find((draft) => draft.id === session.activeDraftId) ??
      session.drafts[0] ??
      null
    );
  }, [session]);

  const setActiveItems = useCallback((updater: DraftItemsUpdater) => {
    setSession((current) => {
      if (!current) return current;
      return replaceDraftInSession(current, current.activeDraftId, (draft) => {
        const items =
          typeof updater === "function" ? updater(draft.items) : updater;
        if (items === draft.items) return draft;
        return { ...draft, items, updatedAt: nowIso() };
      });
    });
  }, []);

  const setActiveForm = useCallback((form: BillFormSchema) => {
    setSession((current) =>
      current
        ? syncDraftForm(current, current.activeDraftId, form)
        : current,
    );
  }, []);

  const createDraft = useCallback(
    (currentForm: BillFormSchema, newDraftForm: BillFormSchema) => {
      setSession((current) =>
        current
          ? addDraftToSession(current, currentForm, newDraftForm)
          : current,
      );
    },
    [],
  );

  const activateDraft = useCallback(
    (draftId: string, currentForm: BillFormSchema) => {
      setSession((current) =>
        current
          ? activateDraftInSession(current, draftId, currentForm)
          : current,
      );
    },
    [],
  );

  const removeDraft = useCallback(
    (
      draftId: string,
      currentForm: BillFormSchema,
      blankForm: BillFormSchema,
    ) => {
      setSession((current) =>
        current
          ? removeDraftFromSession(current, draftId, currentForm, blankForm)
          : current,
      );
    },
    [],
  );

  const updateDraft = useCallback(
    (draftId: string, update: (draft: PosInvoiceDraft) => PosInvoiceDraft) => {
      setSession((current) =>
        current ? replaceDraftInSession(current, draftId, update) : current,
      );
    },
    [],
  );

  return {
    ready,
    session,
    drafts: session?.drafts ?? [],
    activeDraft,
    activeDraftId: session?.activeDraftId ?? null,
    setActiveItems,
    setActiveForm,
    createDraft,
    activateDraft,
    removeDraft,
    updateDraft,
  };
}

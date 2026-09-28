import { billFormSchema, type BillFormSchema } from "@/features/bills/schema";
import { nowIso } from "@/lib/utils/date";
import { createId } from "@/lib/utils/id";
import type { BillDraftItem } from "@/types/domain";

export const POS_DRAFT_V1_KEY_PREFIX = "shopkeeper-pos-bill-draft-v1";
export const POS_DRAFT_V2_KEY_PREFIX = "shopkeeper-pos-bill-drafts-v2";

export interface PosInvoiceDraft {
  id: string;
  draftNumber: number;
  createdAt: string;
  updatedAt: string;
  items: BillDraftItem[];
  form: BillFormSchema;
}

export interface PosDraftSession {
  version: 2;
  activeDraftId: string | null;
  nextDraftNumber: number;
  drafts: PosInvoiceDraft[];
}

export function getPosDraftV1Key(userId: string): string {
  return `${POS_DRAFT_V1_KEY_PREFIX}:${userId}`;
}

export function getPosDraftV2Key(userId: string): string {
  return `${POS_DRAFT_V2_KEY_PREFIX}:${userId}`;
}

export function createDefaultBillForm(cashierName = ""): BillFormSchema {
  return {
    cashierName,
    customerName: "",
    customerPhone: "",
    paymentMethod: "cash",
    discountAmount: 0,
    taxAmount: 0,
    paidAmount: 0,
    cashAmount: 0,
    cardAmount: 0,
    notes: "",
  };
}

export function normalizeBillForm(
  value: unknown,
  fallback: BillFormSchema,
): BillFormSchema {
  const candidate =
    value && typeof value === "object"
      ? { ...fallback, ...(value as Partial<BillFormSchema>) }
      : fallback;
  const parsed = billFormSchema.safeParse(candidate);
  return parsed.success ? parsed.data : { ...fallback };
}

export function createPosInvoiceDraft(
  draftNumber: number,
  form: BillFormSchema,
  items: BillDraftItem[] = [],
): PosInvoiceDraft {
  const timestamp = nowIso();
  return {
    id: createId("posdraft"),
    draftNumber,
    createdAt: timestamp,
    updatedAt: timestamp,
    items,
    form: { ...form },
  };
}

export function createPosDraftSession(
  form: BillFormSchema,
): PosDraftSession {
  const draft = createPosInvoiceDraft(1, form);
  return {
    version: 2,
    activeDraftId: draft.id,
    nextDraftNumber: 2,
    drafts: [draft],
  };
}

export function parsePosDraftSession(
  raw: string,
  fallbackForm: BillFormSchema,
): PosDraftSession | null {
  try {
    const value = JSON.parse(raw) as Partial<PosDraftSession>;
    if (value.version !== 2 || !Array.isArray(value.drafts)) {
      return null;
    }

    const drafts = value.drafts
      .filter(
        (draft): draft is PosInvoiceDraft =>
          Boolean(
            draft &&
              typeof draft === "object" &&
              typeof draft.id === "string" &&
              typeof draft.draftNumber === "number" &&
              Array.isArray(draft.items),
          ),
      )
      .map((draft) => ({
        ...draft,
        createdAt: draft.createdAt || nowIso(),
        updatedAt: draft.updatedAt || draft.createdAt || nowIso(),
        form: normalizeBillForm(draft.form, fallbackForm),
      }));

    if (drafts.length === 0) {
      return {
        version: 2,
        activeDraftId: null,
        nextDraftNumber: 1,
        drafts: [],
      };
    }

    const activeDraftId = drafts.some((draft) => draft.id === value.activeDraftId)
      ? (value.activeDraftId as string)
      : drafts[0].id;
    const maxDraftNumber = drafts.reduce(
      (max, draft) => Math.max(max, draft.draftNumber),
      0,
    );
    const nextDraftNumber = Math.max(
      maxDraftNumber + 1,
      typeof value.nextDraftNumber === "number" ? value.nextDraftNumber : 1,
    );

    return {
      version: 2,
      activeDraftId,
      nextDraftNumber,
      drafts,
    };
  } catch {
    return null;
  }
}

export function migrateLegacyPosDraft(
  raw: string,
  fallbackForm: BillFormSchema,
): PosDraftSession | null {
  try {
    const value = JSON.parse(raw) as {
      items?: BillDraftItem[];
      form?: unknown;
    };
    const items = Array.isArray(value.items) ? value.items : [];
    const form = normalizeBillForm(value.form, fallbackForm);
    const draft = createPosInvoiceDraft(1, form, items);
    return {
      version: 2,
      activeDraftId: draft.id,
      nextDraftNumber: 2,
      drafts: [draft],
    };
  } catch {
    return null;
  }
}

export function replaceDraftInSession(
  session: PosDraftSession,
  draftId: string,
  update: (draft: PosInvoiceDraft) => PosInvoiceDraft,
): PosDraftSession {
  let changed = false;
  const drafts = session.drafts.map((draft) => {
    if (draft.id !== draftId) return draft;
    const next = update(draft);
    changed = next !== draft;
    return next;
  });
  return changed ? { ...session, drafts } : session;
}

export function syncDraftForm(
  session: PosDraftSession,
  draftId: string,
  form: BillFormSchema,
): PosDraftSession {
  return replaceDraftInSession(session, draftId, (draft) => ({
    ...draft,
    form: { ...form },
    updatedAt: nowIso(),
  }));
}

export function addDraftToSession(
  session: PosDraftSession,
  currentForm: BillFormSchema,
  newDraftForm: BillFormSchema,
): PosDraftSession {
  const synced = session.activeDraftId
    ? syncDraftForm(session, session.activeDraftId, currentForm)
    : session;
  const draft = createPosInvoiceDraft(synced.nextDraftNumber, newDraftForm);
  return {
    ...synced,
    activeDraftId: draft.id,
    nextDraftNumber: synced.nextDraftNumber + 1,
    drafts: [...synced.drafts, draft],
  };
}

export function activateDraftInSession(
  session: PosDraftSession,
  draftId: string,
  currentForm: BillFormSchema,
): PosDraftSession {
  if (draftId === session.activeDraftId) return session;
  if (!session.drafts.some((draft) => draft.id === draftId)) return session;
  const synced = session.activeDraftId
    ? syncDraftForm(session, session.activeDraftId, currentForm)
    : session;
  return { ...synced, activeDraftId: draftId };
}

export function removeDraftFromSession(
  session: PosDraftSession,
  draftId: string,
  currentForm: BillFormSchema,
): PosDraftSession {
  const removedIndex = session.drafts.findIndex((draft) => draft.id === draftId);
  if (removedIndex < 0) return session;

  const synced =
    draftId === session.activeDraftId || !session.activeDraftId
      ? session
      : syncDraftForm(session, session.activeDraftId, currentForm);
  const remaining = synced.drafts.filter((draft) => draft.id !== draftId);

  if (remaining.length === 0) {
    // Cancelling the final invoice must visibly close it. Keep a real empty
    // session instead of immediately replacing it with another blank tab; the
    // cashier can explicitly start the next invoice from the New Invoice action.
    return {
      ...synced,
      activeDraftId: null,
      nextDraftNumber: 1,
      drafts: [],
    };
  }

  if (draftId !== synced.activeDraftId) {
    return { ...synced, drafts: remaining };
  }

  const nextIndex = Math.min(removedIndex, remaining.length - 1);
  return {
    ...synced,
    activeDraftId: remaining[nextIndex].id,
    drafts: remaining,
  };
}

export function isMeaningfulPosDraft(
  items: BillDraftItem[],
  form: BillFormSchema,
): boolean {
  if (items.length > 0) return true;
  return (
    Boolean(form.customerName?.trim()) ||
    Boolean(form.customerPhone?.trim()) ||
    Number(form.discountAmount || 0) !== 0 ||
    Number(form.taxAmount || 0) !== 0 ||
    Boolean(form.notes?.trim())
  );
}

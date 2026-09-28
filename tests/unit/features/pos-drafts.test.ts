import { describe, expect, it } from "vitest";
import type { BillDraftItem } from "@/types/domain";
import {
  activateDraftInSession,
  addDraftToSession,
  createDefaultBillForm,
  createPosDraftSession,
  getPosDraftV1Key,
  getPosDraftV2Key,
  isMeaningfulPosDraft,
  migrateLegacyPosDraft,
  parsePosDraftSession,
  removeDraftFromSession,
  replaceDraftInSession,
} from "@/features/bills/utils/pos-drafts";

const milk: BillDraftItem = {
  productId: "prod_milk",
  barcode: "1001",
  name: "Milk 1L",
  category: "Dairy",
  availableStock: 8,
  quantity: 2,
  unitBuyPrice: 1,
  unitSellPrice: 2,
};

describe("POS multi-draft session", () => {
  it("keeps draft storage isolated per signed-in user and version", () => {
    expect(getPosDraftV1Key("user-a")).toBe("shopkeeper-pos-bill-draft-v1:user-a");
    expect(getPosDraftV2Key("user-a")).toBe("shopkeeper-pos-bill-drafts-v2:user-a");
    expect(getPosDraftV2Key("user-a")).not.toBe(getPosDraftV2Key("user-b"));
  });

  it("starts with one active invoice and a monotonic next number", () => {
    const session = createPosDraftSession(createDefaultBillForm("Owner"));

    expect(session.version).toBe(2);
    expect(session.drafts).toHaveLength(1);
    expect(session.drafts[0].draftNumber).toBe(1);
    expect(session.activeDraftId).toBe(session.drafts[0].id);
    expect(session.nextDraftNumber).toBe(2);
  });

  it("creates a new invoice without losing the current invoice form", () => {
    const initial = createPosDraftSession(createDefaultBillForm("Owner"));
    const currentForm = {
      ...initial.drafts[0].form,
      customerName: "Ahmad",
      notes: "Hold at counter",
    };
    const next = addDraftToSession(
      initial,
      currentForm,
      createDefaultBillForm("Owner"),
    );

    expect(next.drafts).toHaveLength(2);
    expect(next.drafts[0].form.customerName).toBe("Ahmad");
    expect(next.drafts[0].form.notes).toBe("Hold at counter");
    expect(next.drafts[1].draftNumber).toBe(2);
    expect(next.activeDraftId).toBe(next.drafts[1].id);
    expect(next.nextDraftNumber).toBe(3);
  });

  it("switches invoices while snapshotting the form being left", () => {
    const first = createPosDraftSession(createDefaultBillForm("Owner"));
    const two = addDraftToSession(
      first,
      first.drafts[0].form,
      createDefaultBillForm("Owner"),
    );
    const secondForm = { ...two.drafts[1].form, customerName: "Mona" };
    const switched = activateDraftInSession(
      two,
      two.drafts[0].id,
      secondForm,
    );

    expect(switched.activeDraftId).toBe(two.drafts[0].id);
    expect(switched.drafts[1].form.customerName).toBe("Mona");
  });

  it("keeps cashier-edited sell prices isolated with their invoice", () => {
    const first = createPosDraftSession(createDefaultBillForm("Owner"));
    const editedMilk = { ...milk, unitSellPrice: 1.35 };
    const priced = replaceDraftInSession(first, first.drafts[0].id, (draft) => ({
      ...draft,
      items: [editedMilk],
    }));
    const two = addDraftToSession(
      priced,
      priced.drafts[0].form,
      createDefaultBillForm("Owner"),
    );
    const switchedBack = activateDraftInSession(
      two,
      priced.drafts[0].id,
      two.drafts[1].form,
    );

    expect(switchedBack.drafts[0].items[0].unitSellPrice).toBe(1.35);
    expect(switchedBack.drafts[1].items).toEqual([]);
  });

  it("cancels one invoice without clearing the others", () => {
    const first = createPosDraftSession(createDefaultBillForm("Owner"));
    const two = addDraftToSession(
      first,
      first.drafts[0].form,
      createDefaultBillForm("Owner"),
    );
    const withItem = replaceDraftInSession(two, two.drafts[0].id, (draft) => ({
      ...draft,
      items: [milk],
    }));

    const remaining = removeDraftFromSession(
      withItem,
      withItem.drafts[1].id,
      withItem.drafts[1].form,
    );

    expect(remaining.drafts).toHaveLength(1);
    expect(remaining.drafts[0].items).toEqual([milk]);
    expect(remaining.activeDraftId).toBe(remaining.drafts[0].id);
  });

  it("leaves a real empty workspace when the last open invoice is cancelled", () => {
    const initial = createPosDraftSession(createDefaultBillForm("Owner"));
    const originalId = initial.drafts[0].id;
    const next = removeDraftFromSession(
      initial,
      originalId,
      initial.drafts[0].form,
    );

    expect(next.drafts).toEqual([]);
    expect(next.activeDraftId).toBeNull();
    expect(next.nextDraftNumber).toBe(1);
  });

  it("starts invoice numbering from one when creating after an empty workspace", () => {
    const initial = createPosDraftSession(createDefaultBillForm("Owner"));
    const empty = removeDraftFromSession(
      initial,
      initial.drafts[0].id,
      initial.drafts[0].form,
    );
    const next = addDraftToSession(
      empty,
      createDefaultBillForm("Owner"),
      createDefaultBillForm("Owner"),
    );

    expect(next.drafts).toHaveLength(1);
    expect(next.drafts[0].draftNumber).toBe(1);
    expect(next.activeDraftId).toBe(next.drafts[0].id);
    expect(next.nextDraftNumber).toBe(2);
  });

  it("restores a persisted empty workspace without inventing a replacement invoice", () => {
    const raw = JSON.stringify({
      version: 2,
      activeDraftId: null,
      nextDraftNumber: 1,
      drafts: [],
    });
    const parsed = parsePosDraftSession(raw, createDefaultBillForm("Owner"));

    expect(parsed).not.toBeNull();
    expect(parsed?.drafts).toEqual([]);
    expect(parsed?.activeDraftId).toBeNull();
  });

  it("migrates the scoped v1 single draft into invoice 1", () => {
    const legacy = JSON.stringify({
      items: [milk],
      form: {
        ...createDefaultBillForm("Owner"),
        customerName: "Legacy customer",
      },
    });
    const migrated = migrateLegacyPosDraft(
      legacy,
      createDefaultBillForm("Owner"),
    );

    expect(migrated).not.toBeNull();
    expect(migrated?.drafts).toHaveLength(1);
    expect(migrated?.drafts[0].items).toEqual([milk]);
    expect(migrated?.drafts[0].form.customerName).toBe("Legacy customer");
    expect(migrated?.nextDraftNumber).toBe(2);
  });

  it("repairs a saved v2 session whose active id no longer exists", () => {
    const initial = createPosDraftSession(createDefaultBillForm("Owner"));
    const raw = JSON.stringify({ ...initial, activeDraftId: "missing" });
    const parsed = parsePosDraftSession(raw, createDefaultBillForm("Owner"));

    expect(parsed?.activeDraftId).toBe(parsed?.drafts[0].id);
  });

  it("only asks for cancel confirmation when the draft has meaningful input", () => {
    const blank = createDefaultBillForm("Owner");
    expect(isMeaningfulPosDraft([], blank)).toBe(false);
    expect(
      isMeaningfulPosDraft([], { ...blank, customerName: "Ahmad" }),
    ).toBe(true);
    expect(isMeaningfulPosDraft([milk], blank)).toBe(true);
  });
});

export const MISC_ITEM_ID_PREFIX = "misc";
export const MISC_ITEM_BARCODE = "MISC";
export const MISC_ITEM_CATEGORY = "Misc";

export type MaybeMiscLine = {
  productId?: string;
  originalProductId?: string;
  itemKind?: "product" | "misc";
};

export function isMiscLine(line: MaybeMiscLine): boolean {
  const id = line.productId ?? line.originalProductId ?? "";
  return line.itemKind === "misc" || id.startsWith(`${MISC_ITEM_ID_PREFIX}_`);
}

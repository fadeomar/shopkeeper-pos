export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function createBillNumber(sequence: number) {
  return `INV-${sequence.toString().padStart(6, '0')}`;
}

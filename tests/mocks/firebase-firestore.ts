export class Timestamp {
  private readonly value: Date;

  private constructor(value: Date) {
    this.value = value;
  }

  static fromDate(value: Date): Timestamp {
    return new Timestamp(value);
  }

  toDate(): Date {
    return this.value;
  }
}

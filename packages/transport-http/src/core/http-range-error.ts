export class HttpRangeError extends Error {
  override readonly name = "HttpRangeError";

  constructor(message: string, readonly total?: number) {
    super(message);
  }
}

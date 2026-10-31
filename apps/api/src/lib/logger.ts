/** The tiny slice of the pino logger that services need (keeps them easy to fake in tests). */
export interface MinimalLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface SafeRunOptions<T> {
  fn: () => Promise<T>;
  timeoutMs: number;
  label: string;
}

export async function safeRun<T>({ fn, timeoutMs, label }: SafeRunOptions<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms: ${label}`));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

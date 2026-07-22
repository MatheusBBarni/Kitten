export interface DesktopBootstrapOptions {
  readonly start: () => Promise<unknown>;
  readonly reportStartupFailure: (error: unknown) => void;
}

export async function startDesktopBootstrap(options: DesktopBootstrapOptions): Promise<void> {
  try {
    await options.start();
  } catch (error) {
    options.reportStartupFailure(error);
    throw error;
  }
}

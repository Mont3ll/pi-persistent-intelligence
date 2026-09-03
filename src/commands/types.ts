export type CommandUiContext = {
  hasUI?: boolean;
  cwd: string;
  ui: {
    notify(message: string, kind?: string): void;
    setStatus?(id: string, message: string): void;
    custom?<T>(
      factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (value: T) => void) => unknown,
      options?: { overlay?: boolean; overlayOptions?: { anchor?: string; width?: number; maxHeight?: number } },
    ): Promise<T>;
  };
};

export type CommandDefinition = {
  description: string;
  handler(args: string, context: CommandUiContext): Promise<void> | void;
};

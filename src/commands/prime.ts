/** One-shot option string so a ribbon flyout can start a command in a specific mode. */
let primed = '';

export function primeCommand(value: string): void {
  primed = value;
}

export function takePrime(): string {
  const value = primed;
  primed = '';
  return value;
}

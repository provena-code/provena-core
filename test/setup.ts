import { vi } from 'vitest';
import { Position, Range } from './vs-code-mock';


vi.mock("vscode", () => ({
  Position: Position,
  Range: Range
}));
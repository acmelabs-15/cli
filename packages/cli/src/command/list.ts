import type { z } from "zod";

import type { Command } from "./command";
import type { Json } from "./outcome";

/**
 * The command list: every command, whatever its input and its result. A result is JSON, so the
 * list's type holds any command whose result is JSON. The list's rules live in `list-rules.ts`, so
 * a front-end that reads the list loads no rule.
 */
export type CommandList = readonly Command<z.ZodObject, Json>[];

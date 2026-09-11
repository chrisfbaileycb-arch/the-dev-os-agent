import { z } from "zod";
import superjson from "superjson";

// One JSON-RPC call to a remote MCP server, forwarded by the mcp endpoint.
export const schema = z.object({
  url: z.string().url().max(2000),
  method: z.enum(["tools/list", "tools/call"]),
  params: z.record(z.string(), z.unknown()).optional(),
  authorization: z.string().max(4096).regex(/^[^\r\n]*$/, "Invalid token format.").optional(),
});

export type InputType = z.infer<typeof schema>;
export type OutputType = { result: unknown };

export class McpRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "McpRequestError";
    this.status = status;
  }
}

export const postMcp = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await fetch(`/_api/mcp`, {
    method: "POST",
    body: superjson.stringify(validatedInput),
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!result.ok) {
    let message = "MCP request failed.";
    try { message = superjson.parse<{ error: string }>(await result.text()).error; } catch { /* keep default */ }
    throw new McpRequestError(message, result.status);
  }
  return superjson.parse<OutputType>(await result.text());
};

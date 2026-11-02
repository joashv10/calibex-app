import Anthropic from "@anthropic-ai/sdk";
import { pageUrls } from "./supplements.ts";

// A web-searched lookup, server-only: one prompt, a strict record tool, and the URLs the
// search really returned (so a source link can be checked, never taken on trust). Same
// recipe as mealReader.ts: web_search_20260209 (plus web_fetch_20260209), the fallback beta,
// pause_turn resumed, and a rejected request retried without fetch, then without strict (search stays). Key is server-side only.
const client = new Anthropic({
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined,
});
const SEARCH: Anthropic.Beta.BetaWebSearchTool20260209 = { type: "web_search_20260209", name: "web_search", max_uses: 4, allowed_callers: ["direct"] };
// Opens the product page itself, so the label is read from the page and not from a search snippet.
const FETCH: Anthropic.Beta.BetaWebFetchTool20260209 = { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, allowed_callers: ["direct"] };

export type Looked = { input: unknown; urls: string[] };

export async function searchAndRecord(prompt: string, record: { name: string; description: string; schema: object }): Promise<Looked | "refused" | null> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: [{ type: "text", text: prompt }] }];
  const tool = (strict: boolean): Anthropic.Beta.BetaTool => ({ name: record.name, description: record.description, strict, input_schema: record.schema as Anthropic.Beta.BetaTool.InputSchema });
  const urls: string[] = [];
  const ask = async (strict: boolean, fetch: boolean) => {
    const r = await client.beta.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 6000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      tools: fetch ? [SEARCH, FETCH, tool(strict)] : [SEARCH, tool(strict)],
      tool_choice: { type: "auto" },
      messages,
    });
    urls.push(...pageUrls(r.content));
    return r;
  };
  const run = async (strict: boolean, fetch: boolean) => {
    let r: Anthropic.Beta.BetaMessage | null = null;
    // A long server-side search loop can pause; resume it (three calls at most).
    for (let i = 0; i < 3; i++) {
      r = await ask(strict, fetch);
      if (r.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: r.content });
    }
    return r;
  };
  let strict = true;
  let fetch = true;
  let r: Anthropic.Beta.BetaMessage | null = null;
  // Not knowing which part a 400 objects to, drop the fetch first, then strict; the search always stays.
  const tries: [boolean, boolean][] = [[true, true], [true, false], [false, false]];
  for (const [n, [st, fe]] of tries.entries()) {
    try { messages.splice(1); urls.length = 0; strict = st; fetch = fe; r = await run(st, fe); break; } catch (e) {
      if (!(e instanceof Anthropic.BadRequestError) || n === tries.length - 1) throw e;
      console.error(`web lookup: request rejected (strict ${st}, fetch ${fe}), retrying:`, e.message);
    }
  }
  if (!r || r.stop_reason === "refusal") return "refused";
  const recorded = (m: Anthropic.Beta.BetaMessage) => m.content.find((b) => b.type === "tool_use" && b.name === record.name);
  let call = recorded(r);
  if (!call && r.stop_reason === "end_turn") {
    // It answered in prose instead of recording: ask once more (a forced tool_choice is rejected on Sonnet 5.5, so the message steers it).
    messages.push({ role: "assistant", content: r.content }, { role: "user", content: `Record it now with ${record.name}.` });
    r = await ask(strict, fetch);
    if (r.stop_reason === "refusal") return "refused";
    call = recorded(r);
  }
  if (!call || call.type !== "tool_use") return null;
  return { input: call.input, urls };
}

// LLM provider abstraction. AnthropicProvider runs a manual tool-use loop with
// Claude; RulesProvider is a deterministic fallback used when no key is set.
// New providers (e.g. OpenAI) implement AgentProvider.

import Anthropic from "@anthropic-ai/sdk";
import { withUser } from "@/server/db";
import type { ToolContext, ToolSpec } from "./tools";

export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
  error?: string;
}

export interface AgentRunInput {
  system: string;
  prompt: string;
  tools: ToolSpec[];
  ctx: ToolContext;
}

export interface AgentRunResult {
  text: string;
  toolCalls: ToolCallRecord[];
  generator: string;
  stopReason: string | null;
}

export interface AgentProvider {
  id: string;
  available(): boolean;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

export async function execTool(tools: ToolSpec[], ctx: ToolContext, name: string, input: Record<string, unknown>): Promise<ToolCallRecord> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { name, input, output: null, error: `Ferramenta desconhecida: ${name}` };
  try {
    return { name, input, output: await withUser(ctx.userId, (tx) => tool.run({ tx, profile: ctx.profile }, input)) };
  } catch (e) {
    return { name, input, output: null, error: (e as Error).message };
  }
}

const MAX_TURNS = 8;

export const anthropicProvider: AgentProvider = {
  id: "anthropic",
  available: () => !!process.env.ANTHROPIC_API_KEY && (process.env.AI_PROVIDER ?? "anthropic") === "anthropic",
  async run({ system, prompt, tools, ctx }) {
    const client = new Anthropic();
    const model = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
    const toolDefs: Anthropic.Beta.BetaTool[] = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
    const calls: ToolCallRecord[] = [];
    let stopReason: string | null = null;
    let servedBy = model;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system,
        tools: toolDefs,
        messages,
      });
      stopReason = response.stop_reason;
      servedBy = response.model;
      if (response.stop_reason === "refusal") {
        return { text: "O modelo recusou esta solicitação. Nenhuma recomendação foi gerada.", toolCalls: calls, generator: `anthropic:${servedBy}`, stopReason };
      }
      // Append the full content (including thinking blocks) unchanged.
      messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason !== "tool_use") {
        const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
        return { text, toolCalls: calls, generator: `anthropic:${servedBy}`, stopReason };
      }
      const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      const results = await Promise.all(uses.map((u) => execTool(tools, ctx, u.name, (u.input ?? {}) as Record<string, unknown>)));
      calls.push(...results);
      messages.push({
        role: "user",
        content: uses.map((u, i) => ({
          type: "tool_result" as const,
          tool_use_id: u.id,
          content: JSON.stringify(results[i].error ? { error: results[i].error } : results[i].output),
          is_error: !!results[i].error,
        })),
      });
    }
    return { text: "O agente atingiu o limite de etapas sem concluir a análise.", toolCalls: calls, generator: `anthropic:${servedBy}`, stopReason };
  },
};

export function pickProvider(): AgentProvider | null {
  return anthropicProvider.available() ? anthropicProvider : null;
}

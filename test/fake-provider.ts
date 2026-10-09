/** In-process provider for terminal QA. Never contacts a network or uses credentials. */
import { appendFileSync } from "node:fs";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  const requestLog = process.env.PI_SIDE_TEST_LOG;
  if (!requestLog) throw new Error("PI_SIDE_TEST_LOG required");
  let requests = 0;
  pi.registerProvider("side-test", {
    name: "Side Test", baseUrl: "http://localhost.invalid", apiKey: "test-only", api: "side-test-api",
    streamSimple(model, context) {
      appendFileSync(requestLog, JSON.stringify(context) + "\n");
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: "assistant", content: [{ type: "text", text: `SIDE_REPLY_${++requests}` }],
        api: model.api, model: model.id, provider: model.provider, stopReason: "stop", timestamp: Date.now(),
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      queueMicrotask(() => { stream.push({ type: "done", reason: "stop", message }); stream.end(message); });
      return stream;
    },
    models: [{ id: "fake", name: "Fake", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 4096 }],
  });
}

#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import process from "node:process";
import { runTurn } from "@zer-agent/agent-core";
import { DeepSeekProvider } from "@zer-agent/llm-core";
import { TerminalUi } from "@zer-agent/tui";
import { loadAppConfig, readDeepSeekApiKey } from "./config.js";
import { getFinalAssistantMessage } from "./conversation.js";
import { AppLogger } from "./logger.js";
import { loadAgentsInstructions } from "./project-context.js";
import { SessionStore, type StoredSession } from "./session-store.js";
import { createBuiltInTools, describeAvailableTools } from "./tools.js";

async function main() {
  const cwd = process.cwd();
  const config = loadAppConfig(cwd);
  mkdirSync(config.sessionDir, { recursive: true });
  mkdirSync(config.logDir, { recursive: true });

  const ui = new TerminalUi();
  const store = new SessionStore(config.sessionDir);
  const logger = new AppLogger(config.logDir);
  const provider = new DeepSeekProvider({
    apiKey: readDeepSeekApiKey(),
    baseUrl: config.deepSeekBaseUrl,
    defaultModel: config.model
  });

  let session = store.create(config.model, cwd);
  let model = config.model;
  const tools = createBuiltInTools({ cwd, config });
  const toolInventoryPrompt = describeAvailableTools(tools);
  logger.info("app.start", {
    cwd,
    model,
    sessionId: session.id,
    toolNames: tools.map((tool) => tool.name)
  });

  ui.renderBanner(session.id, model);

  try {
    for (;;) {
      const input = (await ui.prompt()).trim();
      if (!input) {
        continue;
      }

      if (input === "/exit" || input === "/quit") {
        break;
      }

      const commandHandled = await handleCommand(input, {
        cwd,
        model,
        session,
        store,
        setModel(nextModel) {
          model = nextModel;
        },
        setSession(nextSession) {
          session = nextSession;
        },
        ui
      });

      if (commandHandled) {
        continue;
      }

      session.messages.push({ role: "user", content: input });
      logger.info("turn.start", {
        sessionId: session.id,
        model,
        input
      });
      ui.beginTurn();
      try {
        const systemPrompt = [config.systemPrompt, config.shellContext, toolInventoryPrompt, loadAgentsInstructions(cwd)].filter(Boolean).join("\n\n");
        const result = await runTurn({
          provider,
          model,
          systemPrompt,
          messages: session.messages,
          tools,
          continueOnUnknownTool: true,
          onEvent(event) {
            logger.info("turn.event", {
              sessionId: session.id,
              type: event.type,
              toolName: "toolName" in event ? event.toolName : undefined,
              message: "message" in event ? event.message.content : undefined,
              error: "error" in event ? event.error.message : undefined
            });
            ui.renderTurnProgress(event);
          }
        });
        session.messages = result.messages;
        session.model = model;
        store.save(session);
        ui.endTurn();
        const finalAssistantMessage = getFinalAssistantMessage(result.messages);
        if (finalAssistantMessage) {
          ui.renderAssistantMessage(finalAssistantMessage.content);
        }
        logger.info("turn.success", {
          sessionId: session.id,
          messageCount: session.messages.length
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        session.messages.pop();
        ui.endTurn();
        logger.error("turn.failure", {
          sessionId: session.id,
          model,
          input,
          error: message
        });
        ui.warn(`Turn failed and was not saved: ${message}`);
      }
    }
  } finally {
    ui.close();
  }
}

type CommandContext = {
  cwd: string;
  model: string;
  session: StoredSession;
  store: SessionStore;
  setModel: (model: string) => void;
  setSession: (session: StoredSession) => void;
  ui: TerminalUi;
};

async function handleCommand(input: string, context: CommandContext): Promise<boolean> {
  if (!input.startsWith("/")) {
    return false;
  }

  const [command, ...rest] = input.split(/\s+/);
  switch (command) {
    case "/help":
      context.ui.info("Commands: /help /new /resume <id> /model <name> /session /tools /logs /quit");
      return true;
    case "/new":
      {
        const nextSession = context.store.create(context.model, context.cwd);
        context.setSession(nextSession);
        context.ui.info(`Started session ${nextSession.id}`);
      }
      return true;
    case "/resume": {
      const sessionId = rest[0];
      if (!sessionId) {
        const sessions = context.store.list().slice(0, 10);
        context.ui.info(sessions.map((session) => `${session.id} ${session.updatedAt} ${session.model}`).join("\n") || "No sessions found.");
        return true;
      }
      const loaded = context.store.load(sessionId);
      context.setSession(loaded);
      context.setModel(loaded.model);
      context.ui.info(`Resumed session ${loaded.id}`);
      return true;
    }
    case "/logs":
      context.ui.info(`Log file: ${new AppLogger(loadAppConfig(context.cwd).logDir).getCurrentLogPath()}`);
      return true;
    case "/model": {
      const nextModel = rest[0];
      if (!nextModel) {
        context.ui.info(`Current model: ${context.model}`);
        return true;
      }
      context.setModel(nextModel);
      context.session.model = nextModel;
      context.store.save(context.session);
      context.ui.info(`Model set to ${nextModel}`);
      return true;
    }
    case "/session":
      context.ui.info(`Session ${context.session.id} | model=${context.model} | cwd=${context.cwd}`);
      return true;
    case "/tools":
      context.ui.info(describeAvailableTools(createBuiltInTools({
        cwd: context.cwd,
        config: loadAppConfig(context.cwd)
      })));
      return true;
    default:
      context.ui.info(`Unknown command: ${command}`);
      return true;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

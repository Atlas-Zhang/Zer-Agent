#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { runTurn, type AgentTool, type ToolResult } from "@zer-agent/agent-core";
import type { LlmProvider } from "@zer-agent/llm-core";
import { TerminalUi } from "@zer-agent/tui";
import { loadAppConfig, type PermissionDecision, type ProviderId } from "./config.js";
import { compactSessionIfNeeded, formatSessionSummaries } from "./compaction.js";
import { getFinalAssistantMessage, repairConversationHistory } from "./conversation.js";
import { AppLogger } from "./logger.js";
import { loadAgentsInstructions } from "./project-context.js";
import { createProvider, listProviderIds } from "./provider-registry.js";
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

  let session = store.findLatestForCwd(cwd) ?? store.create(config.model, cwd, config.provider);
  session = repairAndPersistSessionIfNeeded(session, store, logger);
  let model = session.model;
  let providerId = normalizeProviderId(session.provider, config.provider);
  let provider = createProvider(config, providerId, model);
  const tools = createBuiltInTools({ cwd, config });
  const startupMode = session.messages.length > 0 ? "resumed" : "new";
  logger.info("app.start", {
    cwd,
    model,
    provider: providerId,
    sessionId: session.id,
    toolNames: tools.map((tool) => tool.name),
    maxIterations: config.maxIterations,
    startupMode
  });

  ui.setHistory(store.getUserHistory(session));
  ui.renderBanner(session.id, `${providerId}/${model}`, `${startupMode} | ${session.mode}`);

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
        provider,
        providerId,
        session,
        store,
        setModel(nextModel) {
          model = nextModel;
          provider = createProvider(config, providerId, model);
        },
        setProvider(nextProviderId) {
          providerId = nextProviderId;
          provider = createProvider(config, providerId, model);
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
      if (!session.title) {
        session.title = input.slice(0, 60);
      }
      session.messages = repairConversationHistory(session.messages);
      logger.info("turn.start", {
        sessionId: session.id,
        provider: providerId,
        model,
        input
      });
      ui.beginTurn();
      try {
        const compacted = await compactSessionIfNeeded(session, provider, model, config);
        if (compacted.compacted) {
          store.save(session);
          logger.info("session.compacted", {
            sessionId: session.id,
            reason: compacted.reason
          });
        }
        const activeTools = filterToolsForMode(tools, session.mode);
        const toolInventoryPrompt = describeAvailableTools(activeTools);
        const systemPrompt = [
          config.systemPrompt,
          session.mode === "plan" ? "Current mode: plan. Do not mutate files or run shell commands. Produce analysis and implementation plans only." : "Current mode: build. You may use available tools subject to permissions.",
          config.shellContext,
          formatSessionSummaries(session),
          toolInventoryPrompt,
          loadAgentsInstructions(cwd)
        ].filter(Boolean).join("\n\n");
        const result = await runTurn({
          provider,
          model,
          systemPrompt,
          messages: session.messages,
          tools: activeTools,
          maxIterations: config.maxIterations,
          continueOnUnknownTool: true,
          authorizeToolCall(tool, args) {
            return authorizeToolCall(tool, args, session, config.permissionDefault, ui);
          },
          onEvent(event) {
            logger.info("turn.event", {
              sessionId: session.id,
              type: event.type,
              toolName: "toolName" in event ? event.toolName : undefined,
              message: "message" in event ? event.message.content : undefined,
              error: "error" in event ? event.error.message : undefined
            });
            if (event.type === "tool-result" && !event.result.isError) {
              recordMutationSnapshot(session, event.result);
            }
            ui.renderTurnProgress(event);
          }
        });
        session.messages = repairConversationHistory(result.messages);
        session.model = model;
        store.recordTurn(session, result.usage);
        ui.setHistory(store.getUserHistory(session));
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
  provider: LlmProvider;
  providerId: ProviderId;
  session: StoredSession;
  store: SessionStore;
  setModel: (model: string) => void;
  setProvider: (providerId: ProviderId) => void;
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
      context.ui.info("Commands: /help /new /resume <id> /model <name> /provider <id> /mode <plan|build> /compact /sessions /fork [id] /delete <id> /export <id> <path> /import <path> /permissions /undo /session /tools /logs /verbose /quit");
      return true;
    case "/new":
      {
        const nextSession = context.store.create(context.model, context.cwd, context.providerId);
        context.setSession(nextSession);
        context.ui.setHistory(context.store.getUserHistory(nextSession));
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
      const repaired = repairAndPersistSessionIfNeeded(loaded, context.store);
      context.setSession(repaired);
      context.setModel(repaired.model);
      context.setProvider(normalizeProviderId(repaired.provider, context.providerId));
      context.ui.setHistory(context.store.getUserHistory(repaired));
      context.ui.info(`Resumed session ${repaired.id}`);
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
    case "/provider": {
      const nextProvider = rest[0];
      if (!nextProvider) {
        context.ui.info(`Current provider: ${context.providerId}. Available: ${listProviderIds().join(", ")}`);
        return true;
      }
      if (!isProviderId(nextProvider)) {
        context.ui.info(`Unknown provider: ${nextProvider}. Available: ${listProviderIds().join(", ")}`);
        return true;
      }
      context.setProvider(nextProvider);
      context.session.provider = nextProvider;
      context.store.save(context.session);
      context.ui.info(`Provider set to ${nextProvider}`);
      return true;
    }
    case "/permissions":
      context.ui.info(formatPermissionSummary(loadAppConfig(context.cwd).permissionDefault));
      return true;
    case "/mode": {
      const nextMode = rest[0];
      if (!nextMode) {
        context.ui.info(`Current mode: ${context.session.mode}`);
        return true;
      }
      if (nextMode !== "plan" && nextMode !== "build") {
        context.ui.info("Usage: /mode plan|build");
        return true;
      }
      context.session.mode = nextMode;
      context.store.save(context.session);
      context.ui.info(`Mode set to ${nextMode}`);
      return true;
    }
    case "/compact": {
      const config = loadAppConfig(context.cwd);
      const result = await compactSessionIfNeeded(context.session, context.provider, context.model, config, true);
      if (result.compacted) {
        context.store.save(context.session);
      }
      context.ui.info(`Compaction: ${result.reason}`);
      return true;
    }
    case "/sessions":
      context.ui.info(formatSessionList(context.store.list()));
      return true;
    case "/fork": {
      const source = rest[0] ? context.store.load(rest[0]) : context.session;
      const forked = context.store.fork(source);
      context.setSession(forked);
      context.setModel(forked.model);
      context.setProvider(normalizeProviderId(forked.provider, context.providerId));
      context.ui.setHistory(context.store.getUserHistory(forked));
      context.ui.info(`Forked session ${source.id} -> ${forked.id}`);
      return true;
    }
    case "/delete": {
      const sessionId = rest[0];
      if (!sessionId) {
        context.ui.info("Usage: /delete <session-id>");
        return true;
      }
      if (sessionId === context.session.id) {
        context.ui.info("Refusing to delete the active session. Resume or create another session first.");
        return true;
      }
      context.ui.info(context.store.delete(sessionId) ? `Deleted session ${sessionId}` : `Session not found: ${sessionId}`);
      return true;
    }
    case "/export": {
      const [sessionId, outputPath] = rest;
      if (!sessionId || !outputPath) {
        context.ui.info("Usage: /export <session-id> <path>");
        return true;
      }
      const loaded = context.store.load(sessionId);
      const targetPath = resolve(context.cwd, outputPath);
      writeFileSync(targetPath, JSON.stringify(loaded, null, 2), "utf8");
      context.ui.info(`Exported session ${sessionId} to ${targetPath}`);
      return true;
    }
    case "/import": {
      const inputPath = rest[0];
      if (!inputPath) {
        context.ui.info("Usage: /import <path>");
        return true;
      }
      const imported = context.store.import(JSON.parse(readFileSync(resolve(context.cwd, inputPath), "utf8")) as StoredSession);
      context.ui.info(`Imported session as ${imported.id}`);
      return true;
    }
    case "/undo":
      context.ui.info(undoLastSnapshot(context.session, context.store));
      return true;
    case "/session":
      context.ui.info(formatSessionSummary(context.session, context.model, context.providerId, context.cwd));
      return true;
    case "/tools":
      context.ui.info(describeAvailableTools(createBuiltInTools({
        cwd: context.cwd,
        config: loadAppConfig(context.cwd)
      }).filter((tool) => context.session.mode === "build" || (!tool.mutatesFileSystem && tool.permissionCategory !== "shell"))));
      return true;
    case "/verbose": {
      const enabled = context.ui.toggleVerbose();
      context.ui.info(`Verbose mode ${enabled ? "enabled" : "disabled"}.`);
      return true;
    }
    default:
      context.ui.info(`Unknown command: ${command}`);
      return true;
  }
}

function formatSessionSummary(session: StoredSession, model: string, providerId: ProviderId, cwd: string): string {
  const tokenSummary = session.metrics.totalTokens > 0
    ? `${session.metrics.totalTokens} (in=${session.metrics.inputTokens}, out=${session.metrics.outputTokens})`
    : (session.messages.length > 0 ? "untracked for this older session" : "0 (in=0, out=0)");

  return [
    `Session ${session.id}`,
    `provider=${providerId}`,
    `model=${model}`,
    `mode=${session.mode}`,
    `title=${session.title ?? "(untitled)"}`,
    `cwd=${cwd}`,
    `turns=${session.metrics.turnCount}`,
    `messages=${session.messages.length}`,
    `tokens=${tokenSummary}`,
    `updated=${session.updatedAt}`
  ].join(" | ");
}

function formatSessionList(sessions: StoredSession[]): string {
  if (sessions.length === 0) {
    return "No sessions found.";
  }

  return sessions
    .slice(0, 20)
    .map((session) => [
      session.id,
      session.updatedAt,
      session.provider,
      session.model,
      session.mode,
      `${session.metrics.turnCount} turns`,
      session.title ?? "(untitled)"
    ].join(" | "))
    .join("\n");
}

function filterToolsForMode(tools: AgentTool[], mode: StoredSession["mode"]): AgentTool[] {
  if (mode === "build") {
    return tools;
  }

  return tools.filter((tool) => !tool.mutatesFileSystem && tool.permissionCategory !== "shell");
}

function normalizeProviderId(value: string, fallback: ProviderId): ProviderId {
  return isProviderId(value) ? value : fallback;
}

function isProviderId(value: string): value is ProviderId {
  return value === "deepseek" || value === "openai-compatible";
}

async function authorizeToolCall(
  tool: AgentTool,
  args: Record<string, unknown>,
  session: StoredSession,
  defaultDecision: PermissionDecision,
  ui: TerminalUi
): Promise<ToolResult | undefined> {
  const decision = resolvePermissionDecision(tool, defaultDecision);
  if (decision === "allow") {
    return undefined;
  }

  if (decision === "deny" || !process.stdin.isTTY) {
    return {
      content: `Permission denied for tool ${tool.name}.`,
      isError: true,
      details: {
        permission: "deny",
        category: tool.permissionCategory ?? "read"
      }
    };
  }

  const preview = tool.preview ? await tool.preview(args) : undefined;
  const previewText = preview?.content ? `\n\n${preview.content}` : "";
  const approved = await ui.confirm(`Run ${tool.name} (${tool.permissionCategory ?? "read"})?${previewText}`);
  session.permissionDecisions[`${tool.name}:${JSON.stringify(args)}`] = approved ? "allow" : "deny";
  if (approved) {
    return undefined;
  }

  return {
    content: `User denied tool ${tool.name}.`,
    isError: true,
    details: {
      permission: "deny",
      category: tool.permissionCategory ?? "read"
    }
  };
}

function resolvePermissionDecision(tool: AgentTool, defaultDecision: PermissionDecision): PermissionDecision {
  const category = tool.permissionCategory ?? "read";
  if (category === "read" || category === "git") {
    return "allow";
  }

  return defaultDecision;
}

function recordMutationSnapshot(session: StoredSession, result: ToolResult): void {
  const details = result.details;
  if (!details || typeof details.path !== "string" || typeof details.before !== "string" || typeof details.after !== "string") {
    return;
  }

  if (details.before === details.after) {
    return;
  }

  session.snapshots.push({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    path: details.path,
    existedBefore: typeof details.existedBefore === "boolean" ? details.existedBefore : true,
    before: details.before,
    after: details.after
  });
}

function undoLastSnapshot(session: StoredSession, store: SessionStore): string {
  const snapshot = session.snapshots.pop();
  if (!snapshot) {
    return "No Zer-Agent file mutation snapshot is available to undo.";
  }

  if (snapshot.existedBefore === false) {
    if (existsSync(snapshot.path)) {
      unlinkSync(snapshot.path);
    }
  } else {
    writeFileSync(snapshot.path, snapshot.before, "utf8");
  }

  store.save(session);
  return `Undid last file mutation: ${snapshot.path}`;
}

function formatPermissionSummary(defaultDecision: PermissionDecision): string {
  return [
    `Default risky-tool permission: ${defaultDecision}`,
    "Auto-allowed: read, git",
    "Risky categories: write, shell, network",
    "Set ZER_AGENT_PERMISSION_DEFAULT=allow|ask|deny to change default behavior."
  ].join("\n");
}

function repairAndPersistSessionIfNeeded(
  session: StoredSession,
  store: SessionStore,
  logger?: AppLogger
): StoredSession {
  const originalMessagesJson = JSON.stringify(session.messages);
  const repairedMessages = repairConversationHistory(session.messages);
  if (JSON.stringify(repairedMessages) !== originalMessagesJson) {
    const removedMessages = session.messages.length - repairedMessages.length;
    session.messages = repairedMessages;
    store.save(session);
    logger?.warn("session.repaired", {
      sessionId: session.id,
      removedMessages
    });
  }

  return session;
}


main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

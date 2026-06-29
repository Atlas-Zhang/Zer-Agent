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
import {
  formatModelCatalog,
  loadAgentProfiles,
  loadCustomCommands,
  renderCustomCommand,
  type AgentProfile,
  type CustomCommand
} from "./customization.js";
import { createLoggedProvider } from "./llm-logging.js";
import { AppLogger } from "./logger.js";
import { loadAgentsInstructions } from "./project-context.js";
import { createProvider, listProviderIds } from "./provider-registry.js";
import { SessionStore, type StoredSession } from "./session-store.js";
import { createBuiltInTools, describeAvailableTools, executeShellCommand } from "./tools.js";

async function main() {
  const cwd = process.cwd();
  const config = loadAppConfig(cwd);
  mkdirSync(config.sessionDir, { recursive: true });
  mkdirSync(config.logDir, { recursive: true });

  const ui = new TerminalUi();
  const store = new SessionStore(config.sessionDir);
  const logger = new AppLogger(config.logDir);
  const customCommands = loadCustomCommands(cwd);
  const agentProfiles = loadAgentProfiles(cwd);

  let session = store.findLatestForCwd(cwd) ?? store.create(config.model, cwd, config.provider, "build", config.permissionDefault);
  session = repairAndPersistSessionIfNeeded(session, store, logger);
  let model = session.model;
  let providerId = normalizeProviderId(session.provider, config.provider);
  const buildProvider = () => createLoggedProvider(createProvider(config, providerId, model), logger, () => ({
    sessionId: session.id,
    providerId,
    cwd
  }));
  let provider = buildProvider();
  let activeAbortController: AbortController | undefined;
  const tools = createBuiltInTools({
    cwd,
    config,
    getAbortSignal: () => activeAbortController?.signal
  });
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
  syncPromptStatus(ui, session, providerId, model, cwd);
  ui.renderBanner(session.id, `${providerId}/${model}`, `${startupMode} | ${session.mode}`);

  try {
    for (;;) {
      syncPromptStatus(ui, session, providerId, model, cwd);
      let input = (await ui.prompt()).trim();
      if (!input) {
        continue;
      }

      logger.info("user.input", {
        sessionId: session.id,
        provider: providerId,
        model,
        mode: session.mode,
        inputKind: classifyUserInput(input),
        input
      });

      if (input === "/exit" || input === "/quit") {
        logger.info("app.exit.requested", {
          sessionId: session.id,
          input
        });
        break;
      }

      if (input.startsWith("!")) {
        await handleShellShortcut(input, {
          cwd,
          model,
          providerId,
          session,
          store,
          ui,
          logger
        });
        continue;
      }

      const customCommandInput = resolveCustomCommandInput(input, customCommands, cwd, session.id);
      if (customCommandInput) {
        logger.info("custom_command.expanded", {
          sessionId: session.id,
          command: customCommandInput.commandName,
          input: customCommandInput.argument
        });
        input = customCommandInput.prompt;
      } else if (input.startsWith("/run ")) {
        ui.warn("Usage: /run <custom-command> [input]. No matching command was found.");
        continue;
      }

      if (input === "/review") {
        input = buildReviewPrompt(await readGitDiff(cwd));
      }

      const commandHandled = await handleCommand(input, {
        cwd,
        config,
        model,
        provider,
        providerId,
        agentProfiles,
        customCommands,
        session,
        store,
        setModel(nextModel) {
          const previousModel = model;
          model = nextModel;
          provider = buildProvider();
          syncPromptStatus(ui, session, providerId, model, cwd);
          logger.info("session.model_changed", {
            sessionId: session.id,
            previousModel,
            model
          });
        },
        setProvider(nextProviderId) {
          const previousProvider = providerId;
          providerId = nextProviderId;
          provider = buildProvider();
          syncPromptStatus(ui, session, providerId, model, cwd);
          logger.info("session.provider_changed", {
            sessionId: session.id,
            previousProvider,
            provider: providerId
          });
        },
        setSession(nextSession) {
          const previousSessionId = session.id;
          session = nextSession;
          syncPromptStatus(ui, session, providerId, model, cwd);
          logger.info("session.changed", {
            previousSessionId,
            sessionId: session.id,
            model: session.model,
            provider: session.provider,
            mode: session.mode,
            title: session.title
          });
        },
        ui,
        logger
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
        mode: session.mode,
        input,
        turnIndex: session.metrics.turnCount + 1,
        messageCountBefore: session.messages.length
      });
      activeAbortController = new AbortController();
      let partialMessages = [...session.messages];
      ui.beginTurn(() => {
        if (!activeAbortController?.signal.aborted) {
          activeAbortController?.abort();
          ui.warn("Interrupted. Partial context was saved; send a follow-up like 'continue' to resume.");
        }
      });
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
          resolveAgentInstructions(agentProfiles, session.agentProfile),
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
          signal: activeAbortController.signal,
          onMessagesChanged(messages) {
            partialMessages = repairConversationHistory(messages);
          },
          continueOnUnknownTool: true,
          authorizeToolCall(tool, args) {
            return authorizeAgentToolCall(tool, args, session, resolveSessionPermissionDefault(session, config.permissionDefault), ui);
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
        syncPromptStatus(ui, session, providerId, model, cwd);
        ui.endTurn();
        const finalAssistantMessage = getFinalAssistantMessage(result.messages);
        if (finalAssistantMessage) {
          ui.renderAssistantMessage(finalAssistantMessage.content);
        }
        logger.info("turn.success", {
          sessionId: session.id,
          provider: providerId,
          model,
          usage: result.usage,
          sessionMetrics: session.metrics,
          messageCount: session.messages.length
        });
        logger.info("turn.metrics", {
          sessionId: session.id,
          provider: providerId,
          model,
          turnUsage: result.usage,
          sessionMetrics: session.metrics
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        ui.endTurn();
        if (isAbortError(error) || activeAbortController.signal.aborted) {
          const interruptedMessages = partialMessages.length > 0 ? partialMessages : session.messages;
          session.messages = repairConversationHistory([
            ...interruptedMessages,
            {
              role: "assistant",
              content: "Interrupted by user. I saved the partial context; send a follow-up such as 'continue' to resume from here."
            }
          ]);
          store.save(session);
          ui.setHistory(store.getUserHistory(session));
          syncPromptStatus(ui, session, providerId, model, cwd);
          logger.warn("turn.interrupted", {
            sessionId: session.id,
            provider: providerId,
            model,
            input,
            sessionMetrics: session.metrics,
            messageCount: session.messages.length
          });
          continue;
        }

        session.messages.pop();
        logger.error("turn.failure", {
          sessionId: session.id,
          provider: providerId,
          model,
          mode: session.mode,
          input,
          messageCountBefore: session.messages.length + 1,
          error: message
        });
        ui.warn(`Turn failed and was not saved: ${message}`);
      } finally {
        activeAbortController = undefined;
      }
    }
  } finally {
    ui.close();
    await logger.flush();
  }
}

type CommandContext = {
  cwd: string;
  config: ReturnType<typeof loadAppConfig>;
  model: string;
  provider: LlmProvider;
  providerId: ProviderId;
  agentProfiles: AgentProfile[];
  customCommands: CustomCommand[];
  session: StoredSession;
  store: SessionStore;
  setModel: (model: string) => void;
  setProvider: (providerId: ProviderId) => void;
  setSession: (session: StoredSession) => void;
  ui: TerminalUi;
  logger: AppLogger;
};

type ShellShortcutContext = {
  cwd: string;
  model: string;
  providerId: ProviderId;
  session: StoredSession;
  store: SessionStore;
  ui: TerminalUi;
  logger: AppLogger;
};

async function handleShellShortcut(input: string, context: ShellShortcutContext): Promise<void> {
  const command = input.slice(1).trim();
  if (!command) {
    context.ui.warn("Usage: !<shell command>");
    return;
  }

  context.logger.info("shell.shortcut.start", {
    sessionId: context.session.id,
    provider: context.providerId,
    model: context.model,
    command
  });

  try {
    const result = await executeShellCommand(context.cwd, command);
    const content = formatShellShortcutResult(command, result.content);
    context.session.messages.push({ role: "user", content: input });
    context.session.messages.push({ role: "assistant", content });
    context.session.model = context.model;
    context.store.recordTurn(context.session);
    context.ui.setHistory(context.store.getUserHistory(context.session));
    syncPromptStatus(context.ui, context.session, context.providerId, context.model, context.cwd);
    context.ui.renderAssistantMessage(content);
    context.logger.info("shell.shortcut.success", {
      sessionId: context.session.id,
      provider: context.providerId,
      model: context.model,
      command,
      sessionMetrics: context.session.metrics
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    context.ui.warn(`Shell command failed: ${message}`);
    context.logger.error("shell.shortcut.failure", {
      sessionId: context.session.id,
      provider: context.providerId,
      model: context.model,
      command,
      error: message
    });
  }
}

async function handleCommand(input: string, context: CommandContext): Promise<boolean> {
  if (!input.startsWith("/")) {
    return false;
  }

  const [command, ...rest] = input.split(/\s+/);
  context.logger.info("command.input", {
    sessionId: context.session.id,
    provider: context.providerId,
    model: context.model,
    mode: context.session.mode,
    command,
    args: rest,
    raw: input
  });
  switch (command) {
    case "/help":
      context.ui.info("Commands: /help /new /resume <id> /model <name> /models /provider <id> /agent [name] /run <command> [input] /diff /review /mode <plan|build> /compact /clear /sessions /fork [id] /delete <id> /export <id> <path> /import <path> /permissions [ask|allow|deny] /undo /session /tools /logs /verbose /quit");
      return true;
    case "/new":
      {
        const previousSessionId = context.session.id;
        const nextSession = context.store.create(
          context.model,
          context.cwd,
          context.providerId,
          "build",
          resolveSessionPermissionDefault(context.session, loadAppConfig(context.cwd).permissionDefault)
        );
        context.setSession(nextSession);
        context.ui.setHistory(context.store.getUserHistory(nextSession));
        context.ui.info(`Started session ${nextSession.id}`);
        context.logger.info("session.new", {
          previousSessionId,
          sessionId: nextSession.id,
          provider: context.providerId,
          model: context.model
        });
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
      const previousSessionId = context.session.id;
      context.setSession(repaired);
      context.setModel(repaired.model);
      context.setProvider(normalizeProviderId(repaired.provider, context.providerId));
      context.ui.setHistory(context.store.getUserHistory(repaired));
      context.ui.info(`Resumed session ${repaired.id}`);
      context.logger.info("session.resume", {
        previousSessionId,
        sessionId: repaired.id,
        provider: repaired.provider,
        model: repaired.model,
        mode: repaired.mode,
        title: repaired.title
      });
      return true;
    }
    case "/logs":
      context.ui.info(`Log file: ${context.logger.getCurrentLogPath()}`);
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
    case "/models":
      context.ui.info(formatModelCatalog(context.config, context.model));
      return true;
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
      {
        const nextPermission = rest[0];
        const configDefault = loadAppConfig(context.cwd).permissionDefault;
        if (!nextPermission) {
          context.ui.info(formatPermissionSummary(resolveSessionPermissionDefault(context.session, configDefault), configDefault));
          return true;
        }
        if (!isPermissionDecision(nextPermission)) {
          context.ui.info("Usage: /permissions ask|allow|deny");
          return true;
        }
        const previousPermission = resolveSessionPermissionDefault(context.session, configDefault);
        context.session.permissionDefault = nextPermission;
        context.store.save(context.session);
        context.ui.info(`Default risky-tool permission set to ${nextPermission}`);
        context.logger.info("session.permission_changed", {
          sessionId: context.session.id,
          previousPermission,
          permissionDefault: nextPermission
        });
      }
      return true;
    case "/agent": {
      const nextAgentName = rest[0];
      if (!nextAgentName) {
        context.ui.info(formatAgentProfiles(context.agentProfiles, context.session.agentProfile));
        return true;
      }
      const profile = context.agentProfiles.find((entry) => entry.name === nextAgentName);
      if (!profile) {
        context.ui.info(`Unknown agent: ${nextAgentName}\n\n${formatAgentProfiles(context.agentProfiles, context.session.agentProfile)}`);
        return true;
      }
      const previousAgent = context.session.agentProfile;
      context.session.agentProfile = profile.name;
      if (profile.mode) {
        context.session.mode = profile.mode;
      }
      if (profile.permissionDefault) {
        context.session.permissionDefault = profile.permissionDefault;
      }
      context.store.save(context.session);
      context.ui.info(`Agent set to ${profile.name}${profile.mode ? ` (mode=${profile.mode})` : ""}`);
      context.logger.info("session.agent_changed", {
        sessionId: context.session.id,
        previousAgent,
        agentProfile: profile.name,
        mode: context.session.mode
      });
      return true;
    }
    case "/run":
      context.ui.info(formatCustomCommands(context.customCommands));
      return true;
    case "/diff":
      context.ui.info(await readGitDiff(context.cwd));
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
      const previousMode = context.session.mode;
      context.session.mode = nextMode;
      context.store.save(context.session);
      context.ui.info(`Mode set to ${nextMode}`);
      context.logger.info("session.mode_changed", {
        sessionId: context.session.id,
        previousMode,
        mode: nextMode
      });
      return true;
    }
    case "/compact": {
      const config = loadAppConfig(context.cwd);
      context.logger.info("session.compact.requested", {
        sessionId: context.session.id,
        messageCount: context.session.messages.length,
        force: true
      });
      const result = await compactSessionIfNeeded(context.session, context.provider, context.model, config, true);
      if (result.compacted) {
        context.store.save(context.session);
      }
      context.ui.info(`Compaction: ${result.reason}`);
      context.logger.info("session.compact.completed", {
        sessionId: context.session.id,
        compacted: result.compacted,
        reason: result.reason,
        summaryCount: context.session.summaries.length,
        messageCount: context.session.messages.length
      });
      return true;
    }
    case "/clear":
      clearSessionContext(context.session);
      context.store.save(context.session);
      context.ui.setHistory([]);
      context.ui.info(`Cleared context for session ${context.session.id}`);
      context.logger.info("session.cleared", {
        sessionId: context.session.id
      });
      return true;
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
      context.logger.info("session.fork", {
        sourceSessionId: source.id,
        sessionId: forked.id
      });
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
      const deleted = context.store.delete(sessionId);
      context.ui.info(deleted ? `Deleted session ${sessionId}` : `Session not found: ${sessionId}`);
      context.logger.info("session.delete", {
        sessionId,
        deleted
      });
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
      context.logger.info("session.export", {
        sessionId,
        targetPath
      });
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
      context.logger.info("session.import", {
        sessionId: imported.id,
        inputPath
      });
      return true;
    }
    case "/undo":
      {
        const undoMessage = undoLastSnapshot(context.session, context.store);
        context.ui.info(undoMessage);
        context.logger.info("session.undo", {
          sessionId: context.session.id,
          message: undoMessage
        });
      }
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
      context.logger.info("ui.verbose_changed", {
        sessionId: context.session.id,
        enabled
      });
      return true;
    }
    default:
      context.ui.info(`Unknown command: ${command}`);
      context.logger.warn("command.unknown", {
        sessionId: context.session.id,
        command,
        raw: input
      });
      return true;
  }
}

function classifyUserInput(input: string): "command" | "shell" | "chat" {
  if (input.startsWith("/")) {
    return "command";
  }

  if (input.startsWith("!")) {
    return "shell";
  }

  return "chat";
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
    `agent=${session.agentProfile ?? "default"}`,
    `permissions=${session.permissionDefault ?? "config"}`,
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

function syncPromptStatus(
  ui: TerminalUi,
  session: StoredSession,
  providerId: ProviderId,
  model: string,
  cwd: string
): void {
  ui.setPromptStatus({
    sessionId: session.id,
    provider: providerId,
    model,
    mode: session.mode,
    cwd,
    title: session.title,
    turns: session.metrics.turnCount,
    tokens: session.metrics.totalTokens
  });
}

async function authorizeAgentToolCall(
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

function formatPermissionSummary(defaultDecision: PermissionDecision, configDefault: PermissionDecision): string {
  return [
    `Default risky-tool permission: ${defaultDecision}`,
    `Config default: ${configDefault}`,
    "Auto-allowed: read, git",
    "Risky categories: write, shell, network",
    "Use /permissions ask|allow|deny to change this session.",
    "Set ZER_AGENT_PERMISSION_DEFAULT=allow|ask|deny to change the config default."
  ].join("\n");
}

function resolveCustomCommandInput(
  input: string,
  commands: CustomCommand[],
  cwd: string,
  sessionId: string
): { commandName: string; argument: string; prompt: string } | undefined {
  const match = input.match(/^\/(?:(run)\s+)?([A-Za-z0-9_-]+)(?:\s+(.*))?$/);
  if (!match) {
    return undefined;
  }

  const commandName = match[2] ?? "";
  const command = commands.find((entry) => entry.name === commandName);
  if (!command) {
    return undefined;
  }

  const argument = match[3] ?? "";
  return {
    commandName,
    argument,
    prompt: renderCustomCommand(command, argument, cwd, sessionId)
  };
}

function resolveAgentInstructions(profiles: AgentProfile[], activeName: string | undefined): string | undefined {
  const profile = profiles.find((entry) => entry.name === activeName);
  return profile ? `Active agent profile: ${profile.name}\n${profile.instructions}` : undefined;
}

function formatAgentProfiles(profiles: AgentProfile[], activeName: string | undefined): string {
  if (profiles.length === 0) {
    return "No agent profiles found.";
  }

  return profiles
    .map((profile) => `${profile.name === activeName ? "*" : " "} ${profile.name}: ${profile.description}`)
    .join("\n");
}

function formatCustomCommands(commands: CustomCommand[]): string {
  if (commands.length === 0) {
    return "No custom commands found. Add Markdown files under .zer-agent/commands.";
  }

  return commands
    .map((command) => `/${command.name}: ${command.description ?? "Custom command"}`)
    .join("\n");
}

async function readGitDiff(cwd: string): Promise<string> {
  const separator = process.platform === "win32" ? ";" : "&&";
  const result = await executeShellCommand(cwd, `git diff --stat ${separator} git diff -- .`);
  return result.content;
}

function buildReviewPrompt(diff: string): string {
  if (!diff.trim() || diff.trim() === "(no output)") {
    return "No working tree diff is available to review.";
  }

  return [
    "Review the current working tree diff. Focus on bugs, regressions, missing tests, and risky behavior.",
    "",
    "```diff",
    diff,
    "```"
  ].join("\n");
}

function resolveSessionPermissionDefault(session: StoredSession, configDefault: PermissionDecision): PermissionDecision {
  return session.permissionDefault ?? configDefault;
}

function isPermissionDecision(value: string): value is PermissionDecision {
  return value === "allow" || value === "ask" || value === "deny";
}

function formatShellShortcutResult(command: string, output: string): string {
  return [
    `Shell command completed: \`${command}\``,
    "",
    "```text",
    truncateShellOutput(output),
    "```"
  ].join("\n");
}

function truncateShellOutput(output: string): string {
  const maxLength = 6000;
  if (output.length <= maxLength) {
    return output;
  }

  return `${output.slice(0, maxLength).trimEnd()}\n\n[truncated]`;
}

function clearSessionContext(session: StoredSession): void {
  session.messages = [];
  session.summaries = [];
  session.snapshots = [];
  session.permissionDecisions = {};
  session.title = undefined;
  session.metrics = {
    turnCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
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

import { ConsiliumClient, DebateEvent } from "../api/client";
import { ContextManager } from "../utils/context-manager";
import { loadConfig, getCachedPreferences } from "../utils/config";
import { createStreamHandlers } from "../utils/stream-renderer";
import { DecisionLog } from "../utils/decision-extractor";
import { DebateMode, getDefaultMode } from "../utils/debate-modes";
import { OutputFormat } from "../utils/output-formatter";
import { type ScanManifest, type ScannedFile } from "../utils/project-scanner";
const MAX_CONTEXT_CHARS = 80_000;

export interface DebateRecord {
  topic: string;
  goldenPrompt?: string;
  timestamp: string;
}

export interface ChatSessionData {
  id: string;
  name: string;
  conversationId?: string;
  debates: DebateRecord[];
  contextFilePaths: string[];
  contextImagePaths: string[];
  models: string[];
  mode: DebateMode;
  decisions: any;
  createdAt: string;
  updatedAt: string;
  contextManifest?: ScanManifest;
}

export class ChatSession {
  readonly client: ConsiliumClient;
  readonly contextManager: ContextManager;
  models: string[];
  mode: DebateMode;
  outputFormat: OutputFormat;
  lastGoldenPrompt: string | undefined;
  debates: DebateRecord[];
  decisionLog: DecisionLog;
  id: string | undefined;
  name: string;
  conversationId: string | undefined;
  contextFilePaths: string[];
  contextImagePaths: string[];
  projectFiles: ScannedFile[] | undefined;
  contextManifest: ScanManifest | undefined;
  createdAt: string;
  updatedAt: string;

  constructor(client: ConsiliumClient, contextManager: ContextManager) {
    this.client = client;
    this.contextManager = contextManager;
    const config = loadConfig();
    const configModels = (config as { models?: string[] }).models;
    const prefs = getCachedPreferences();
    this.models =
      Array.isArray(configModels) && configModels.length > 0
        ? configModels
        : (prefs?.defaultAgents ?? []);
    this.mode = (prefs?.defaultMode as DebateMode) || getDefaultMode();
    this.outputFormat = "text";
    this.lastGoldenPrompt = undefined;
    this.debates = [];
    this.decisionLog = new DecisionLog();
    this.id = undefined;
    this.name = "";
    this.conversationId = undefined;
    this.contextFilePaths = [];
    this.contextImagePaths = [];
    this.projectFiles = undefined;
    this.contextManifest = undefined;
    this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  reset(): void {
    this.debates = [];
    this.id = undefined;
    this.name = "";
    this.conversationId = undefined;
    this.lastGoldenPrompt = undefined;
    this.decisionLog = new DecisionLog();
    this.contextFilePaths = [];
    this.contextImagePaths = [];
    this.contextManager.clear();
    this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  private buildFollowUpContext(): string {
    const previous = this.debates.filter((d) => d.goldenPrompt);
    if (previous.length === 0) return "";

    const included: string[] = [];
    let usedChars = 0;
    let firstIncludedIdx = previous.length;

    for (let i = previous.length - 1; i >= 0; i--) {
      const d = previous[i];
      if (!d) continue;
      const block = `--- Turn ${i + 1}: ${d.topic} ---\n${d.goldenPrompt ?? ""}\n`;
      if (usedChars + block.length > MAX_CONTEXT_CHARS) break;
      included.unshift(block);
      usedChars += block.length;
      firstIncludedIdx = i;
    }

    const parts: string[] = ["=== CONVERSATION HISTORY ===\n"];

    if (firstIncludedIdx > 0) {
      const older = previous.slice(0, firstIncludedIdx);
      parts.push(`[Earlier turns - topics only]\n`);
      for (let i = 0; i < older.length; i++) {
        const turn = older[i];
        if (!turn) continue;
        parts.push(`  Turn ${i + 1}: ${turn.topic}`);
      }
      parts.push("");
    }

    parts.push(...included);
    parts.push("=== END CONVERSATION HISTORY ===\n");
    return parts.join("\n");
  }

  private buildEffectiveTopic(
    userInput: string,
    followUp: string,
    context: string,
    decisionContext: string,
  ): string {
    if (!followUp && !context && !decisionContext) return userInput;
    const parts: string[] = [];
    if (decisionContext) parts.push(decisionContext);
    if (followUp) parts.push(followUp);
    if (context) parts.push(context);
    parts.push(`QUESTION: ${userInput}`);
    return parts.join("\n\n");
  }

  async debate(userInput: string): Promise<void> {
    const context = this.contextManager.buildContext();
    const followUp = this.buildFollowUpContext();
    const decisionContext = this.decisionLog.getContext();

    const effectiveTopic = this.buildEffectiveTopic(
      userInput,
      followUp,
      context,
      decisionContext,
    );

    const files =
      this.contextManager.getFiles().length > 0
        ? this.contextManager.getFilesWithContent()
        : undefined;
    const images =
      this.contextManager.getImages().length > 0
        ? this.contextManager.getImages()
        : undefined;

    const projectFiles = this.projectFiles?.length
      ? this.projectFiles.map((f) => ({
          path: f.path,
          content: f.content,
          category: f.category,
        }))
      : undefined;

    const debate = await this.client.createDebate({
      topic: effectiveTopic,
      models: this.models,
      mode: this.mode,
      conversationId: this.conversationId,
      files,
      images,
      projectFiles,
      debateSource: "cli",
    });

    let goldenPrompt = "";
    const handleEvent = createStreamHandlers({
      topic: userInput,
      onComplete: () => {},
    });

    await this.client.streamDebate(debate.id, (event: DebateEvent) => {
      if (event.type === "consensus" && event.text) {
        goldenPrompt = event.text;
        this.lastGoldenPrompt = event.text;
      }
      handleEvent(event);
    });

    if (!this.conversationId) {
      this.conversationId = debate.id;
    }

    const now = new Date().toISOString();
    const debateIndex = this.debates.length;
    this.debates.push({ topic: userInput, goldenPrompt, timestamp: now });
    this.updatedAt = now;

    if (goldenPrompt) {
      this.decisionLog.addFromSynthesis(goldenPrompt, userInput, debateIndex);
    }

    if (!this.name && this.debates.length === 1) {
      this.name =
        userInput.length > 50 ? userInput.substring(0, 50) + "..." : userInput;
    }
  }

  toJSON(): ChatSessionData {
    const now = new Date().toISOString();
    return {
      id: this.id || `session-${Date.now()}`,
      name: this.name,
      conversationId: this.conversationId,
      debates: this.debates,
      contextFilePaths: [...this.contextFilePaths],
      contextImagePaths: [...this.contextImagePaths],
      models: this.models,
      mode: this.mode,
      decisions: this.decisionLog.toJSON(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt || now,
      contextManifest: this.contextManifest,
    };
  }

  static fromJSON(
    data: ChatSessionData,
    client: ConsiliumClient,
    contextManager: ContextManager,
  ): ChatSession {
    const session = new ChatSession(client, contextManager);
    session.id = data.id;
    session.name = data.name || "";
    session.conversationId = data.conversationId;
    session.debates = data.debates || [];
    session.models = data.models || [];
    session.mode = data.mode || getDefaultMode();
    session.contextFilePaths = data.contextFilePaths || [];
    session.contextImagePaths = data.contextImagePaths || [];
    if (data.decisions) {
      session.decisionLog = DecisionLog.fromJSON(data.decisions);
    }
    session.createdAt = data.createdAt || new Date().toISOString();
    session.updatedAt =
      data.updatedAt || data.createdAt || new Date().toISOString();
    session.contextManifest = data.contextManifest;
    const last = session.debates.at(-1);
    if (last?.goldenPrompt) {
      session.lastGoldenPrompt = last.goldenPrompt;
    }
    return session;
  }
}

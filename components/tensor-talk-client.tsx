"use client";

import {
  AlertTriangleIcon,
  BookOpenIcon,
  BrainCircuitIcon,
  ExternalLinkIcon,
  FileTextIcon,
  Globe2Icon,
  LibraryIcon,
  LoaderCircleIcon,
  MoonIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react";
import Image from "next/image";
import { useTheme } from "next-themes";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { sendChatMessage } from "@/lib/chat-client";
import type {
  ChatResponse,
  ChatStage,
  ChatTrace,
  Evidence,
  RetrievalMode,
  WebMode,
} from "@/lib/chat";
import {
  deleteThread,
  listThreads,
  saveThread,
  type StoredThread,
  type StoredTurn,
} from "@/lib/thread-store";
import { cn } from "@/lib/utils";

type PanelTab = "evidence" | "trace";

const EMPTY_STAGES: ChatStage[] = [
  { id: "planning", label: "Planning route", status: "pending" },
  { id: "handbook", label: "Retrieving handbook evidence", status: "pending" },
  { id: "web", label: "Searching official UM/FSKTM web", status: "pending" },
  { id: "trust", label: "Checking source trust", status: "pending" },
  { id: "generation", label: "Generating answer", status: "pending" },
  { id: "grounding", label: "Verifying grounding", status: "pending" },
  { id: "repair", label: "Repairing answer", status: "pending" },
];

export function TensorTalkClient() {
  const [message, setMessage] = useState("");
  const [retrievalMode, setRetrievalMode] =
    useState<RetrievalMode>("semantic");
  const [webMode, setWebMode] = useState<WebMode>("auto");
  const [threads, setThreads] = useState<StoredThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [selectedTurnId, setSelectedTurnId] = useState<string>("");
  const [openEvidenceIds, setOpenEvidenceIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<PanelTab>("evidence");
  const [pendingTurnId, setPendingTurnId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contextDetailsOpen, setContextDetailsOpen] = useState(false);
  const questionInputRef = useRef<HTMLTextAreaElement>(null);
  const latestAnswerEndRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme, setTheme } = useTheme();

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? threads[0],
    [threads, activeThreadId],
  );
  const selectedTurn =
    activeThread?.turns.find((turn) => turn.id === selectedTurnId) ??
    activeThread?.turns.at(-1);
  const latestTurn = activeThread?.turns.at(-1);
  const isPending = Boolean(pendingTurnId);
  const isDark = resolvedTheme === "dark";
  const latestModels = latestTurn?.models ?? [];
  const activeContext = selectedTurn?.context ?? latestTurn?.context;

  useEffect(() => {
    let mounted = true;

    listThreads()
      .then((storedThreads) => {
        if (!mounted) {
          return;
        }

        const initialThreads =
          storedThreads.length > 0 ? storedThreads : [createThread()];
        setThreads(initialThreads);
        setActiveThreadId(initialThreads[0].id);
        setSelectedTurnId(
          initialThreads[0].selectedTurnId ??
            initialThreads[0].turns.at(-1)?.id ??
            "",
        );
      })
      .catch(() => {
        if (!mounted) {
          return;
        }

        const initialThread = createThread();
        setThreads([initialThread]);
        setActiveThreadId(initialThread.id);
        setLoadError("Thread history is unavailable in this browser session.");
      });

    return () => {
      mounted = false;
    };
  }, []);

  function updateActiveThread(
    updater: (thread: StoredThread) => StoredThread,
    options: { persist?: boolean } = {},
  ) {
    let nextActiveThread: StoredThread | null = null;
    const shouldPersist = options.persist ?? true;

    setThreads((current) => {
      const nextThreads = current.map((thread) => {
        if (thread.id !== activeThreadId) {
          return thread;
        }

        nextActiveThread = {
          ...updater(thread),
          updatedAt: Date.now(),
        };

        return nextActiveThread;
      });

      return nextThreads.sort((left, right) => right.updatedAt - left.updatedAt);
    });

    if (shouldPersist) {
      queueMicrotask(() => {
        if (nextActiveThread) {
          void saveThread(nextActiveThread);
        }
      });
    }
  }

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const question = message.trim();

    if (isPending) {
      return;
    }

    if (!activeThread) {
      questionInputRef.current?.focus();
      return;
    }

    if (!question) {
      questionInputRef.current?.focus();
      return;
    }

    setMessage("");
    await sendQuestion(question, { retrievalMode, webMode });
  }

  async function sendQuestion(
    question: string,
    settings: { retrievalMode: RetrievalMode; webMode: WebMode },
    retryTurnId?: string,
  ) {
    if (!activeThread) {
      return;
    }

    const turnId = retryTurnId ?? crypto.randomUUID();
    const draftTurn = createDraftTurn(turnId, question, settings);
    setPendingTurnId(turnId);
    setSelectedTurnId(turnId);
    setActiveTab("evidence");

    updateActiveThread((thread) => ({
      ...thread,
      selectedTurnId: turnId,
      turns: retryTurnId
        ? thread.turns.map((turn) => (turn.id === retryTurnId ? draftTurn : turn))
        : [...thread.turns, draftTurn],
    }));

    try {
      const response = await sendChatMessage(
        {
          message: question,
          retrievalMode: settings.retrievalMode,
          webMode: settings.webMode,
          history: buildHistoryForRequest(activeThread, retryTurnId),
        },
        (partial) => {
          updateTurn(
            turnId,
            {
              ...partial,
              streaming: true,
            },
            { persist: false },
          );
        },
        (stage) => {
          updateTurnStage(turnId, stage, { persist: false });
        },
      );

      updateTurn(turnId, {
        ...response,
        streaming: false,
        error: undefined,
      });
      setPendingTurnId(null);
      window.requestAnimationFrame(() => {
        latestAnswerEndRef.current?.scrollIntoView({
          block: "end",
          behavior: "smooth",
        });
      });
      maybeGenerateThreadTitle(question, response);
    } catch (error) {
      updateTurn(turnId, {
        streaming: false,
        error: getErrorMessage(error),
      });
      setPendingTurnId(null);
    }
  }

  function updateTurn(
    turnId: string,
    partial: Partial<StoredTurn>,
    options?: { persist?: boolean },
  ) {
    updateActiveThread(
      (thread) => ({
        ...thread,
        selectedTurnId: turnId,
        turns: thread.turns.map((turn) =>
          turn.id === turnId ? { ...turn, ...partial } : turn,
        ),
      }),
      options,
    );
  }

  function updateTurnStage(
    turnId: string,
    stage: ChatStage,
    options?: { persist?: boolean },
  ) {
    updateActiveThread(
      (thread) => ({
        ...thread,
        selectedTurnId: turnId,
        turns: thread.turns.map((turn) => {
          if (turn.id !== turnId) {
            return turn;
          }

          const stages = turn.stages?.length ? turn.stages : EMPTY_STAGES;

          return {
            ...turn,
            stages: stages.map((item) => (item.id === stage.id ? stage : item)),
          };
        }),
      }),
      options,
    );
  }

  function startNewThread() {
    const thread = createThread();

    setThreads((current) => [thread, ...current]);
    setActiveThreadId(thread.id);
    setSelectedTurnId("");
    setOpenEvidenceIds([]);
    setMessage("");
    void saveThread(thread);
  }

  function selectThread(threadId: string) {
    const thread = threads.find((item) => item.id === threadId);

    setActiveThreadId(threadId);
    setSelectedTurnId(thread?.selectedTurnId ?? thread?.turns.at(-1)?.id ?? "");
    setOpenEvidenceIds([]);
  }

  function removeThread(threadId: string) {
    const remaining = threads.filter((thread) => thread.id !== threadId);
    const nextThreads = remaining.length > 0 ? remaining : [createThread()];

    setThreads(nextThreads);
    void deleteThread(threadId);

    if (threadId === activeThreadId) {
      setActiveThreadId(nextThreads[0].id);
      setSelectedTurnId(nextThreads[0].selectedTurnId ?? "");
      void saveThread(nextThreads[0]);
    }
  }

  function retryTurn(turn: StoredTurn) {
    if (isPending) {
      return;
    }

    void sendQuestion(turn.question, turn.settings, turn.id);
  }

  function handleQuestionKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function selectTurnEvidence(turn: StoredTurn, evidenceId?: string) {
    setSelectedTurnId(turn.id);
    setActiveTab("evidence");
    setOpenEvidenceIds(
      evidenceId
        ? [evidenceId]
        : turn.evidence.length > 0
          ? [turn.evidence[0].kb_id]
          : [],
    );
  }

  async function maybeGenerateThreadTitle(
    question: string,
    response: ChatResponse,
  ) {
    const thread = threads.find((item) => item.id === activeThreadId);

    if (!thread || thread.turns.length > 0 || thread.title !== "New chat") {
      return;
    }

    try {
      const titleResponse = await fetch("/api/thread-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer: response.answer }),
      });
      const body = (await titleResponse.json().catch(() => null)) as {
        title?: string;
      } | null;
      const title = body?.title?.trim();

      if (!title) {
        return;
      }

      updateActiveThread((current) => ({
        ...current,
        title,
      }));
    } catch {
      updateActiveThread((current) => ({
        ...current,
        title: fallbackTitle(question),
      }));
    }
  }

  return (
    <main className="h-dvh min-h-0 overflow-hidden bg-muted/30 text-foreground">
      <div
        className={cn(
          "mx-auto grid h-full min-h-0 max-w-[1440px] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden p-4 lg:grid-rows-none",
          sidebarCollapsed
            ? "lg:grid-cols-[72px_minmax(0,1fr)_380px]"
            : "lg:grid-cols-[280px_minmax(0,1fr)_380px]",
        )}
      >
        <Card className="max-h-[calc(100dvh-2rem)] max-lg:sticky max-lg:top-0 max-lg:z-20 max-lg:py-3 lg:h-[calc(100dvh-2rem)]">
          <CardHeader
            className={cn(
              "max-lg:px-3",
              sidebarCollapsed && "items-center px-2",
            )}
          >
            <div
              className={cn(
                "flex gap-3 max-lg:items-center max-lg:justify-between",
                sidebarCollapsed
                  ? "flex-col items-center"
                  : "items-start justify-between",
              )}
            >
              <div
                className={cn(
                  "flex min-w-0 items-center gap-3",
                  sidebarCollapsed && "justify-center",
                )}
              >
                <div className="flex size-12 shrink-0 items-center justify-center">
                  <Image
                    src="/um-mark-transparent.png"
                    alt=""
                    width={48}
                    height={48}
                    priority
                    className="size-10 object-contain"
                  />
                </div>
                <div className={cn("min-w-0", sidebarCollapsed && "hidden")}>
                  <CardTitle>TensorTalk</CardTitle>
                  <CardDescription>UM FSKTM handbook</CardDescription>
                </div>
              </div>
              <div
                className={cn(
                  "flex shrink-0 gap-2",
                  sidebarCollapsed && "flex-col",
                )}
              >
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="hidden lg:inline-flex"
                  aria-label={
                    sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
                  }
                  title={
                    sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
                  }
                  onClick={() => setSidebarCollapsed((current) => !current)}
                >
                  {sidebarCollapsed ? (
                    <PanelLeftOpenIcon />
                  ) : (
                    <PanelLeftCloseIcon />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Toggle color theme"
                  onClick={() => setTheme(isDark ? "light" : "dark")}
                >
                  <SunIcon className="hidden dark:block" />
                  <MoonIcon className="dark:hidden" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent
            className={cn(
              "flex flex-col gap-4 max-lg:px-3 max-lg:pb-3",
              sidebarCollapsed && "items-center px-2",
            )}
          >
            <Button
              type="button"
              className={cn("w-full", sidebarCollapsed && "size-9 px-0")}
              variant="default"
              onClick={startNewThread}
              aria-label="New chat"
              title="New chat"
            >
              <PlusIcon data-icon="inline-start" />
              <span className={cn(sidebarCollapsed && "hidden")}>New chat</span>
            </Button>

            <Separator />

            <section
              className={cn(
                "min-h-0 flex-1 flex-col gap-2 max-lg:hidden",
                sidebarCollapsed ? "hidden" : "flex",
              )}
            >
              <p className="text-xs font-medium text-muted-foreground">
                Threads
              </p>
              {loadError ? (
                <p className="rounded-md border px-2 py-1.5 text-xs text-muted-foreground">
                  {loadError}
                </p>
              ) : null}
              <ScrollArea className="h-[calc(100dvh-16rem)]">
                <div className="flex flex-col gap-1 pr-3">
                  {threads.map((thread) => (
                    <div
                      key={thread.id}
                      className="group flex min-w-0 items-center gap-1"
                    >
                      <Button
                        type="button"
                        variant={
                          thread.id === activeThread?.id ? "secondary" : "ghost"
                        }
                        className="min-w-0 flex-1 justify-start"
                        onClick={() => selectThread(thread.id)}
                      >
                        <FileTextIcon data-icon="inline-start" />
                        <span className="truncate">{thread.title}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 opacity-0 group-hover:opacity-100"
                        aria-label={`Delete ${thread.title}`}
                        title="Delete thread"
                        onClick={() => removeThread(thread.id)}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </section>
          </CardContent>
        </Card>

        <section className="flex min-h-0 flex-col gap-3 overflow-hidden lg:h-[calc(100dvh-2rem)]">
          <Card size="sm" className="min-h-0 flex-1">
            <CardHeader className="pb-0">
              <CardTitle>Conversation</CardTitle>
              <CardDescription>
                Select any answer to inspect its Evidence and Trace.
              </CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 flex-1">
              <ScrollArea className="h-full min-h-0">
                <div className="flex min-w-0 flex-col gap-4 py-1 pr-6 pl-4">
                  {!activeThread?.turns.length ? (
                    <Empty className="min-h-56 border">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <BrainCircuitIcon />
                        </EmptyMedia>
                        <EmptyTitle>Start with a handbook question.</EmptyTitle>
                        <EmptyDescription>
                          TensorTalk can answer from local RAG, official web
                          evidence, or the model depending on your controls.
                        </EmptyDescription>
                      </EmptyHeader>
                      <EmptyContent>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => questionInputRef.current?.focus()}
                        >
                          <SearchIcon data-icon="inline-start" />
                          Ask a question
                        </Button>
                      </EmptyContent>
                    </Empty>
                  ) : null}

                  {activeThread?.turns.map((turn) => (
                    <article
                      key={turn.id}
                      className="flex min-w-0 flex-col gap-3"
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedTurnId(turn.id)}
                        className={cn(
                          "ml-auto box-border max-w-[78%] rounded-lg border bg-secondary px-3 py-2 text-left text-sm [overflow-wrap:anywhere]",
                          selectedTurn?.id === turn.id &&
                            "ring-2 ring-ring/30",
                        )}
                      >
                        {turn.question}
                      </button>
                      <div
                        className={cn(
                          "box-border w-full max-w-[88%] rounded-lg border bg-card p-4",
                          selectedTurn?.id === turn.id &&
                            "ring-2 ring-ring/30",
                        )}
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-sm font-semibold">Answer</h2>
                            {turn.grounding?.repaired ? (
                              <Badge variant="secondary">Repaired</Badge>
                            ) : null}
                            {turn.grounding &&
                            !turn.grounding.passed &&
                            !turn.streaming ? (
                              <Badge variant="outline">Needs review</Badge>
                            ) : null}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label="Retry answer"
                            title="Retry answer"
                            disabled={isPending}
                            onClick={() => retryTurn(turn)}
                          >
                            <RotateCcwIcon className="size-4" />
                          </Button>
                        </div>

                        {turn.thinking ? (
                          <ThinkingBlock
                            thinking={turn.thinking}
                            open={Boolean(turn.streaming)}
                          />
                        ) : null}

                        {turn.streaming && !turn.answer ? (
                          <TracingSteps stages={turn.stages ?? EMPTY_STAGES} />
                        ) : null}

                        {turn.error ? (
                          <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-muted-foreground">
                            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                            <span>{turn.error}</span>
                          </div>
                        ) : null}

                        <p className="text-sm leading-6 [overflow-wrap:anywhere]">
                          {formatAnswerForDisplay(turn.answer) ||
                            (turn.streaming
                              ? "Waiting for streamed response..."
                              : "")}
                        </p>

                        {turn.streaming && turn.answer ? (
                          <TracingSteps compact stages={turn.stages ?? EMPTY_STAGES} />
                        ) : null}

                        <EvidenceLinks
                          evidence={turn.evidence}
                          onSelectEvidence={(evidenceId) =>
                            selectTurnEvidence(turn, evidenceId)
                          }
                        />

                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">
                            {getRetrievalLabel(turn.settings.retrievalMode)}
                          </Badge>
                          <Badge variant="outline">
                            {getWebLabel(turn.settings.webMode)}
                          </Badge>
                          {turn.grounding ? (
                            <Badge variant="secondary">
                              Grounding{" "}
                              {turn.grounding.groundingScore.toFixed(2)}
                            </Badge>
                          ) : null}
                        </div>

                        <div
                          ref={
                            turn.id === latestTurn?.id
                              ? latestAnswerEndRef
                              : undefined
                          }
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {selectedTurn ? (
            <Card size="sm" className="min-h-0 shrink-0 lg:hidden">
              <CardContent className="flex min-h-0 flex-col gap-2">
                <div className="grid grid-cols-2 rounded-md border p-1">
                  <Button
                    type="button"
                    variant={activeTab === "evidence" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setActiveTab("evidence")}
                  >
                    <FileTextIcon data-icon="inline-start" />
                    Evidence
                  </Button>
                  <Button
                    type="button"
                    variant={activeTab === "trace" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setActiveTab("trace")}
                  >
                    <LibraryIcon data-icon="inline-start" />
                    Trace
                  </Button>
                </div>

                {activeTab === "evidence" ? (
                  <EvidencePanel
                    compact
                    evidence={selectedTurn.evidence}
                    openEvidenceIds={openEvidenceIds}
                    onOpenEvidenceChange={setOpenEvidenceIds}
                    pending={Boolean(selectedTurn.streaming)}
                  />
                ) : (
                  <TracePanel compact turn={selectedTurn} />
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card size="sm" className="shrink-0">
            <CardContent className="pb-0">
              <form onSubmit={submitQuestion}>
                <FieldGroup>
                  <Field>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <FieldLabel htmlFor="question">Question</FieldLabel>
                      <span className="text-xs text-muted-foreground">
                        {getRetrievalLabel(retrievalMode)} with{" "}
                        {getWebLabel(webMode)}
                      </span>
                    </div>
                    <InputGroup className="min-h-20 items-stretch">
                      <InputGroupTextarea
                        id="question"
                        ref={questionInputRef}
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        onKeyDown={handleQuestionKeyDown}
                        placeholder="Ask about rules, facilities, contacts, or official pages."
                        disabled={isPending}
                      />
                      <InputGroupAddon align="block-end" className="border-t">
                        <div className="flex w-full flex-col gap-1">
                          <div className="flex w-full flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap gap-2">
                              <Select
                                items={[
                                  { label: "Semantic", value: "semantic" },
                                  { label: "Lexical", value: "lexical" },
                                  { label: "No RAG", value: "none" },
                                ]}
                                value={retrievalMode}
                                onValueChange={(value) => {
                                  if (
                                    value === "semantic" ||
                                    value === "lexical" ||
                                    value === "none"
                                  ) {
                                    setRetrievalMode(value);
                                  }
                                }}
                                disabled={isPending}
                              >
                                <SelectTrigger
                                  aria-label="Retrieval mode"
                                  size="sm"
                                  className="min-w-32 shrink-0"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent align="start">
                                  <SelectGroup>
                                    <SelectItem value="semantic">Semantic</SelectItem>
                                    <SelectItem value="lexical">Lexical</SelectItem>
                                    <SelectItem value="none">No RAG</SelectItem>
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                              <Select
                                items={[
                                  { label: "Web Auto", value: "auto" },
                                  { label: "Web On", value: "on" },
                                  { label: "Web Off", value: "off" },
                                ]}
                                value={webMode}
                                onValueChange={(value) => {
                                  if (
                                    value === "auto" ||
                                    value === "on" ||
                                    value === "off"
                                  ) {
                                    setWebMode(value);
                                  }
                                }}
                                disabled={isPending}
                              >
                                <SelectTrigger
                                  aria-label="Web search mode"
                                  size="sm"
                                  className="min-w-32 shrink-0"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent align="start">
                                  <SelectGroup>
                                    <SelectItem value="auto">Web Auto</SelectItem>
                                    <SelectItem value="on">Web On</SelectItem>
                                    <SelectItem value="off">Web Off</SelectItem>
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            </div>
                            <InputGroupButton
                              type="submit"
                              variant="default"
                              size="sm"
                              className="ml-auto shrink-0"
                              disabled={isPending}
                            >
                              {isPending ? (
                                <Spinner data-icon="inline-start" />
                              ) : (
                                <SendIcon data-icon="inline-start" />
                              )}
                              Ask
                            </InputGroupButton>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <ContextIndicator
                              context={activeContext}
                              open={contextDetailsOpen}
                              onToggle={() =>
                                setContextDetailsOpen((current) => !current)
                              }
                            />
                            {retrievalMode === "none" && webMode === "off" ? (
                              <Badge variant="outline">Model-only</Badge>
                            ) : null}
                            {latestModels.map((model) => (
                              <Badge
                                key={`${model.role}-${model.name}`}
                                variant="outline"
                              >
                                {getModelLabel(model)}
                              </Badge>
                            ))}
                          </div>
                          {selectedTurn?.error ? (
                            <FieldDescription className="text-xs">
                              {selectedTurn.error}
                            </FieldDescription>
                          ) : null}
                        </div>
                      </InputGroupAddon>
                    </InputGroup>
                  </Field>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        </section>

        <Card className="hidden max-h-[calc(100dvh-2rem)] lg:flex lg:h-[calc(100dvh-2rem)]">
          <CardHeader>
            <CardTitle>{activeTab === "evidence" ? "Evidence" : "Trace"}</CardTitle>
            <CardDescription>
              {selectedTurn
                ? "Details for the selected message."
                : "Select a message to inspect its support."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-col gap-3">
            <div className="grid grid-cols-2 rounded-md border p-1">
              <Button
                type="button"
                variant={activeTab === "evidence" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("evidence")}
              >
                <FileTextIcon data-icon="inline-start" />
                Evidence
              </Button>
              <Button
                type="button"
                variant={activeTab === "trace" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("trace")}
              >
                <LibraryIcon data-icon="inline-start" />
                Trace
              </Button>
            </div>

            {activeTab === "evidence" ? (
              <EvidencePanel
                evidence={selectedTurn?.evidence ?? []}
                openEvidenceIds={openEvidenceIds}
                onOpenEvidenceChange={setOpenEvidenceIds}
                pending={Boolean(selectedTurn?.streaming)}
              />
            ) : (
              <TracePanel turn={selectedTurn} />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function TracingSteps({
  stages,
  compact = false,
}: {
  stages: ChatStage[];
  compact?: boolean;
}) {
  const visibleStages = compact
    ? stages.filter((stage) => stage.status !== "pending")
    : stages;

  return (
    <div className="mb-4 rounded-md border bg-muted/30 px-3 py-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <LoaderCircleIcon className="size-4 animate-spin" />
        Tracing steps
      </div>
      <ol className="relative flex flex-col gap-2 before:absolute before:top-3 before:bottom-3 before:left-[7px] before:w-px before:bg-border">
        {visibleStages.map((stage) => (
          <li key={stage.id} className="relative flex gap-3 pl-6">
            <span
              className={cn(
                "absolute top-1 left-0 z-10 flex size-3.5 items-center justify-center rounded-full border bg-background",
                stage.status === "active" && "border-primary",
                stage.status === "complete" && "border-primary bg-primary",
                stage.status === "error" && "border-destructive bg-destructive",
              )}
            >
              {stage.status === "active" ? (
                <span className="size-2 animate-pulse rounded-full bg-primary" />
              ) : null}
            </span>
            <div
              className={cn(
                "min-w-0 flex-1 rounded-md px-2 py-1.5",
                stage.status === "active" && "bg-background shadow-sm",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {stage.label}
                </span>
                <Badge variant="outline">{stage.status}</Badge>
              </div>
              {stage.detail ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {stage.detail}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ThinkingBlock({
  thinking,
  open,
}: {
  thinking: string;
  open: boolean;
}) {
  return (
    <details
      open={open}
      className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-sm"
    >
      <summary className="flex cursor-pointer items-center gap-2 font-medium text-muted-foreground">
        <BrainCircuitIcon className="size-4" />
        Model thinking
      </summary>
      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 font-sans text-muted-foreground [overflow-wrap:anywhere]">
        {thinking}
      </pre>
    </details>
  );
}

function ContextIndicator({
  context,
  open,
  onToggle,
}: {
  context?: NonNullable<ChatResponse["context"]>;
  open: boolean;
  onToggle: () => void;
}) {
  if (!context) {
    return null;
  }

  const usage = context.estimatedContextUsagePercent;
  const remaining = Math.max(
    0,
    context.maxContextTokens -
      context.reservedOutputTokens -
      context.estimatedInputTokens,
  );
  const warning = usage >= 85 || context.contextTruncated;
  const title = [
    `Context used: ${usage}%`,
    `Input: ${context.estimatedInputTokens} tokens`,
    `Remaining input budget: ${remaining} tokens`,
    `Reserved output: ${context.reservedOutputTokens} tokens`,
    `Included history: ${context.includedHistoryCount}`,
    `Omitted history: ${context.omittedHistoryCount}`,
    context.contextTruncated ? "Older context was omitted." : "No history omitted.",
  ].join("\n");

  return (
    <div className="relative">
      <button
        type="button"
        title={title}
        aria-label="Context usage"
        onClick={onToggle}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          warning && "border-destructive/40 text-destructive",
        )}
      >
        <span
          aria-hidden="true"
          className="grid size-4 place-items-center rounded-full"
          style={{
            background: `conic-gradient(currentColor ${usage * 3.6}deg, var(--muted) 0deg)`,
          }}
        >
          <span className="size-2 rounded-full bg-card" />
        </span>
        Context {usage}%
      </button>
      {open ? (
        <div className="absolute bottom-8 left-0 z-30 w-64 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-md">
          <dl className="grid gap-1">
            <ContextMetric label="Used" value={`${usage}%`} />
            <ContextMetric
              label="Input"
              value={`${context.estimatedInputTokens} tokens`}
            />
            <ContextMetric
              label="Reserved"
              value={`${context.reservedOutputTokens} tokens`}
            />
            <ContextMetric label="Remaining" value={`${remaining} tokens`} />
            <ContextMetric
              label="History"
              value={`${context.includedHistoryCount} in, ${context.omittedHistoryCount} omitted`}
            />
          </dl>
          {context.contextTruncated ? (
            <p className="mt-2 text-destructive">
              Older context was omitted to stay under 4096 tokens.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ContextMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="[overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function EvidenceLinks({
  evidence,
  onSelectEvidence,
}: {
  evidence: Evidence[];
  onSelectEvidence: (evidenceId: string) => void;
}) {
  if (evidence.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Evidence links"
      className="mt-3 flex flex-wrap items-center gap-2"
    >
      <span className="text-xs font-medium text-muted-foreground">
        Evidence
      </span>
      {evidence.map((item, index) => {
        const label = getEvidenceLabel(item, index);
        const title = getEvidenceTitle(item, label);

        return (
          <button
            key={item.kb_id}
            type="button"
            title={title}
            aria-label={title}
            onClick={() => onSelectEvidence(item.kb_id)}
            className="inline-flex h-6 max-w-full items-center gap-1 rounded-full border px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {item.sourceType === "web" ? (
              <Globe2Icon className="size-3 shrink-0" />
            ) : (
              <FileTextIcon className="size-3 shrink-0" />
            )}
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function EvidencePanel({
  evidence,
  openEvidenceIds,
  onOpenEvidenceChange,
  pending,
  compact = false,
}: {
  evidence: Evidence[];
  openEvidenceIds: string[];
  onOpenEvidenceChange: (openEvidenceIds: string[]) => void;
  pending: boolean;
  compact?: boolean;
}) {
  if (pending && evidence.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (evidence.length === 0) {
    return (
      <Empty className={cn("border", compact ? "min-h-28" : "min-h-72")}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookOpenIcon />
          </EmptyMedia>
          <EmptyTitle>No evidence selected.</EmptyTitle>
          <EmptyDescription>
            Model-only turns and failed web searches may not have accepted
            evidence.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ScrollArea className={compact ? "h-36" : "h-[calc(100dvh-13rem)]"}>
      <Accordion
        key={evidence[0]?.kb_id}
        className="pr-3"
        multiple
        value={openEvidenceIds}
        onValueChange={(nextOpenEvidenceIds) =>
          onOpenEvidenceChange(nextOpenEvidenceIds.slice(-1))
        }
      >
        {evidence.map((item) => (
          <AccordionItem
            key={item.kb_id}
            id={getEvidenceId(item.kb_id)}
            value={item.kb_id}
            className="scroll-mt-4 rounded-lg target:bg-muted/40"
          >
            <AccordionTrigger>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate">{getEvidenceLabel(item, 0)}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {getEvidenceMeta(item)}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {item.sourceType === "web" ? (
                      <Globe2Icon data-icon="inline-start" />
                    ) : (
                      <FileTextIcon data-icon="inline-start" />
                    )}
                    {item.sourceType === "web" ? "Official web" : "Handbook"}
                  </Badge>
                  {item.supportBand ? (
                    <Badge variant="secondary">{item.supportBand}</Badge>
                  ) : null}
                  {item.subsection ? (
                    <Badge variant="secondary">{item.subsection}</Badge>
                  ) : null}
                </div>
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline [overflow-wrap:anywhere]"
                  >
                    {item.url}
                    <ExternalLinkIcon className="size-3" />
                  </a>
                ) : null}
                <p className="text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                  {item.source_text ?? item.snippet}
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </ScrollArea>
  );
}

function TracePanel({
  turn,
  compact = false,
}: {
  turn?: StoredTurn;
  compact?: boolean;
}) {
  if (!turn?.trace) {
    return (
      <Empty className={cn("border", compact ? "min-h-28" : "min-h-72")}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LibraryIcon />
          </EmptyMedia>
          <EmptyTitle>No trace yet.</EmptyTitle>
          <EmptyDescription>
            Trace appears after a turn starts routing and retrieval.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const trace = turn.trace;

  return (
    <ScrollArea className={compact ? "h-36" : "h-[calc(100dvh-13rem)]"}>
      <div className="flex flex-col gap-4 pr-3">
        <TraceSummary trace={trace} />
        <TracingSteps stages={turn.stages ?? trace.stages ?? EMPTY_STAGES} />
        {trace.planner ? (
          <section className="rounded-md border p-3">
            <h3 className="mb-2 text-sm font-semibold">Planner</h3>
            <dl className="grid gap-2 text-sm">
              <TraceRow label="Decision" value={trace.planner.needWeb ? "Web" : "No web"} />
              <TraceRow label="Source" value={trace.planner.source} />
              <TraceRow label="Reason" value={trace.planner.reason} />
              <TraceRow
                label="Queries"
                value={trace.planner.searchQueries.join(" | ") || "none"}
              />
            </dl>
          </section>
        ) : null}
        <TraceUrlList title="Searched URLs" urls={trace.searchedUrls} />
        <TraceEvidenceList title="Accepted evidence" evidence={trace.acceptedEvidence} />
        <RejectedEvidenceList rejected={trace.rejectedEvidence} />
        {trace.grounding ? (
          <section className="rounded-md border p-3">
            <h3 className="mb-2 text-sm font-semibold">Grounding</h3>
            <dl className="grid gap-2 text-sm">
              <TraceRow
                label="Score"
                value={trace.grounding.groundingScore.toFixed(2)}
              />
              <TraceRow label="Band" value={trace.grounding.supportBand} />
              <TraceRow label="Reason" value={trace.grounding.reason} />
              <TraceRow
                label="Unsupported"
                value={
                  trace.grounding.unsupportedFacts.join(", ") || "none"
                }
              />
            </dl>
          </section>
        ) : null}
      </div>
    </ScrollArea>
  );
}

function TraceSummary({ trace }: { trace: ChatTrace }) {
  return (
    <section className="rounded-md border p-3">
      <h3 className="mb-2 text-sm font-semibold">Route</h3>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{getRetrievalLabel(trace.route.retrievalMode)}</Badge>
        <Badge variant="outline">{getWebLabel(trace.route.webMode)}</Badge>
        <Badge variant="secondary">
          {trace.route.modelOnly ? "Model-only" : "Grounded"}
        </Badge>
        {trace.route.fallbackRoute ? (
          <Badge variant="outline">{trace.route.fallbackRoute}</Badge>
        ) : null}
      </div>
    </section>
  );
}

function TraceUrlList({ title, urls }: { title: string; urls: string[] }) {
  if (urls.length === 0) {
    return null;
  }

  return (
    <section className="rounded-md border p-3">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="flex flex-col gap-2">
        {urls.map((url) => (
          <span
            key={url}
            className="text-sm text-muted-foreground [overflow-wrap:anywhere]"
          >
            {url}
          </span>
        ))}
      </div>
    </section>
  );
}

function TraceEvidenceList({
  title,
  evidence,
}: {
  title: string;
  evidence: Evidence[];
}) {
  if (evidence.length === 0) {
    return null;
  }

  return (
    <section className="rounded-md border p-3">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="flex flex-col gap-2">
        {evidence.map((item, index) => (
          <div key={item.kb_id} className="text-sm text-muted-foreground">
            {index + 1}. {getEvidenceLabel(item, index)}{" "}
            {item.supportScore !== undefined
              ? `(${item.supportScore.toFixed(2)})`
              : ""}
          </div>
        ))}
      </div>
    </section>
  );
}

function RejectedEvidenceList({
  rejected,
}: {
  rejected: NonNullable<ChatTrace["rejectedEvidence"]>;
}) {
  if (rejected.length === 0) {
    return null;
  }

  return (
    <section className="rounded-md border p-3">
      <h3 className="mb-2 text-sm font-semibold">Rejected evidence</h3>
      <div className="flex flex-col gap-2">
        {rejected.map((item) => (
          <div key={`${item.reason}-${item.url}`} className="text-sm">
            <div className="font-medium">{item.title ?? item.domain ?? item.url}</div>
            <span className="text-muted-foreground [overflow-wrap:anywhere]">
              {item.url}
            </span>
            <div className="text-xs text-muted-foreground">
              Rejected: {item.reason}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TraceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="[overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function createThread(): StoredThread {
  const now = Date.now();

  return {
    id: crypto.randomUUID(),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    turns: [],
  };
}

function createDraftTurn(
  id: string,
  question: string,
  settings: { retrievalMode: RetrievalMode; webMode: WebMode },
): StoredTurn {
  return {
    id,
    question,
    answer: "",
    evidence: [],
    mode: "streaming",
    retrievalMode: settings.retrievalMode,
    webMode: settings.webMode,
    settings,
    streaming: true,
    stages: EMPTY_STAGES,
  };
}

function buildHistoryForRequest(
  thread: StoredThread,
  retryTurnId?: string,
) {
  const retryIndex = retryTurnId
    ? thread.turns.findIndex((turn) => turn.id === retryTurnId)
    : -1;
  const turns =
    retryIndex >= 0 ? thread.turns.slice(0, retryIndex) : thread.turns;

  return turns
    .filter((turn) => !turn.streaming && !turn.error && turn.answer.trim())
    .map((turn) => ({
      question: turn.question,
      answer: turn.answer,
    }))
    .slice(-24);
}

function formatAnswerForDisplay(answer: string) {
  const withoutLeadingSource = answer
    .trim()
    .replace(/^(?:Handbook|Source|Evidence)\s*\([^)]*\)\s*[:,]?\s*/i, "")
    .trim();

  if (!withoutLeadingSource) {
    return answer.trim();
  }

  return withoutLeadingSource.replace(
    /^are:\s*/i,
    "The relevant handbook points are: ",
  );
}

function getEvidenceId(kbId: string) {
  return `evidence-${kbId}`;
}

function getEvidenceLabel(item: Evidence, index: number) {
  return (
    item.title ??
    item.section ??
    item.subsection ??
    item.source_doc ??
    `Source ${index + 1}`
  );
}

function getEvidenceTitle(item: Evidence, label: string) {
  const pageText = item.pages?.length ? `, page ${item.pages.join(", ")}` : "";

  return `View ${label}${pageText} in the evidence panel`;
}

function getEvidenceMeta(item: Evidence) {
  if (item.sourceType === "web") {
    return `${item.domain ?? "official web"}${
      item.sourceKind === "pdf" ? ", PDF" : ""
    }`;
  }

  return `${item.source_doc ?? "UM Handbook"}${
    item.pages?.length ? `, page ${item.pages.join(", ")}` : ""
  }`;
}

function getModelLabel(model: NonNullable<ChatResponse["models"]>[number]) {
  return `${model.role === "embedding" ? "Embedding" : "Chat"}: ${model.name}`;
}

function getRetrievalLabel(mode?: RetrievalMode) {
  if (mode === "none") {
    return "No RAG";
  }

  return mode === "lexical" ? "Lexical" : "Semantic";
}

function getWebLabel(mode?: WebMode) {
  if (mode === "on") {
    return "Web On";
  }

  if (mode === "off") {
    return "Web Off";
  }

  return "Web Auto";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Chat request failed.";
}

function fallbackTitle(question: string) {
  return question.replace(/\s+/g, " ").trim().slice(0, 52) || "New chat";
}

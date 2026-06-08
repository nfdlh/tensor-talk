"use client";

import {
  AlertTriangleIcon,
  BookOpenIcon,
  BrainCircuitIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  Globe2Icon,
  LibraryIcon,
  LoaderCircleIcon,
  MicIcon,
  MoonIcon,
  NetworkIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
  SquareIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  FormEvent,
  KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { sendChatMessage } from "@/lib/chat-client";
import type {
  ChatResponse,
  ChatStage,
  ChatTrace,
  Evidence,
  HarnessMode,
  RetrievalMode,
  ThinkingMode,
  WebMode,
  WebTrustMode,
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
type RagRetrievalMode = Exclude<RetrievalMode, "none">;

const EMPTY_STAGES: ChatStage[] = [
  { id: "planning", label: "Planning route", status: "pending" },
  { id: "handbook", label: "Retrieving handbook evidence", status: "pending" },
  { id: "web", label: "Searching official UM/FSKTM web", status: "pending" },
  { id: "trust", label: "Checking source trust", status: "pending" },
  { id: "generation", label: "Generating answer", status: "pending" },
  { id: "grounding", label: "Verifying grounding", status: "pending" },
  { id: "repair", label: "Repairing answer", status: "pending" },
];

const COPY_FEEDBACK_MS = 1600;
const CLIENT_MAX_CONTEXT_TOKENS = 8192;
const CLIENT_DEFAULT_OUTPUT_TOKENS = 640;
const CLIENT_MORE_OUTPUT_TOKENS = 1024;
const ENABLE_EXPERIMENTAL_QWEN_RETRIEVAL =
  process.env.NEXT_PUBLIC_ENABLE_EXPERIMENTAL_QWEN_RETRIEVAL === "true";
const VOICE_INPUT_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

type VoiceStatus = "idle" | "recording" | "transcribing";

export function TensorTalkClient() {
  const [message, setMessage] = useState("");
  const [ragEnabled, setRagEnabled] = useState(true);
  const [retrievalMode, setRetrievalMode] =
    useState<RagRetrievalMode>("semantic");
  const [webMode, setWebMode] = useState<WebMode>("auto");
  const [webTrustMode, setWebTrustMode] = useState<WebTrustMode>("broad");
  const [harnessMode, setHarnessMode] = useState<HarnessMode>("tensortalk");
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>("limited");
  const [threads, setThreads] = useState<StoredThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [selectedTurnId, setSelectedTurnId] = useState<string>("");
  const [openEvidenceIds, setOpenEvidenceIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<PanelTab>("evidence");
  const [pendingTurnId, setPendingTurnId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const [contextDetailsOpen, setContextDetailsOpen] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copiedMessageKey, setCopiedMessageKey] = useState<string>("");
  const questionInputRef = useRef<HTMLTextAreaElement>(null);
  const latestAnswerEndRef = useRef<HTMLDivElement>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStatusRef = useRef<VoiceStatus>("idle");
  const voiceStopRequestedRef = useRef(false);
  const voiceStartedByKeyboardRef = useRef(false);
  const copyFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
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
  const voiceBlocked =
    voiceStatus === "transcribing" ||
    (isPending && voiceStatus !== "recording");
  const composerContext = createDraftContextMetadata(
    message,
    thinkingMode,
    activeThread,
  );

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

  useEffect(() => {
    return () => {
      activeRequestRef.current?.abort();
      stopRecordingTracks(mediaRecorderRef.current);

      if (copyFeedbackTimeoutRef.current) {
        clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    voiceStatusRef.current = voiceStatus;
  }, [voiceStatus]);

  useEffect(() => {
    function handleFnKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Fn" || event.repeat || isPending) {
        return;
      }

      event.preventDefault();
      voiceStartedByKeyboardRef.current = true;
      void startVoiceInput();
    }

    function handleFnKeyUp(event: globalThis.KeyboardEvent) {
      if (event.key !== "Fn" || !voiceStartedByKeyboardRef.current) {
        return;
      }

      event.preventDefault();
      voiceStartedByKeyboardRef.current = false;
      stopVoiceInput();
    }

    window.addEventListener("keydown", handleFnKeyDown);
    window.addEventListener("keyup", handleFnKeyUp);

    return () => {
      window.removeEventListener("keydown", handleFnKeyDown);
      window.removeEventListener("keyup", handleFnKeyUp);
    };
  });

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

      return nextThreads.sort(
        (left, right) => right.updatedAt - left.updatedAt,
      );
    });

    if (shouldPersist) {
      queueMicrotask(() => {
        if (nextActiveThread) {
          void saveThread(nextActiveThread).catch(() => {
            toast.error("Could not save thread.");
          });
        }
      });
    }
  }

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isPending) {
      stopCurrentResponse();
      return;
    }

    const question = message.trim();

    if (!activeThread) {
      questionInputRef.current?.focus();
      return;
    }

    if (!question) {
      questionInputRef.current?.focus();
      return;
    }

    setMessage("");
    const effectiveRetrievalMode: RetrievalMode = ragEnabled
      ? retrievalMode
      : "none";

    await sendQuestion(question, {
      retrievalMode: effectiveRetrievalMode,
      webMode,
      webTrustMode,
      harnessMode,
      thinkingMode,
    });
  }

  async function sendQuestion(
    question: string,
    settings: {
      retrievalMode: RetrievalMode;
      webMode: WebMode;
      webTrustMode?: WebTrustMode;
      harnessMode?: HarnessMode;
      thinkingMode?: ThinkingMode;
    },
    retryTurnId?: string,
  ) {
    if (!activeThread) {
      return;
    }

    const requestSettings = {
      ...settings,
      webTrustMode: settings.webTrustMode ?? "broad",
    };
    const turnId = retryTurnId ?? crypto.randomUUID();
    const draftTurn = createDraftTurn(turnId, question, requestSettings);
    const abortController = new AbortController();
    activeRequestRef.current = abortController;
    setPendingTurnId(turnId);
    setSelectedTurnId(turnId);
    setActiveTab("evidence");

    updateActiveThread((thread) => ({
      ...thread,
      selectedTurnId: turnId,
      turns: retryTurnId
        ? thread.turns.map((turn) =>
            turn.id === retryTurnId ? draftTurn : turn,
          )
        : [...thread.turns, draftTurn],
    }));

    if (
      !retryTurnId &&
      activeThread.turns.length === 0 &&
      activeThread.title === "New chat"
    ) {
      void maybeGenerateThreadTitle(question, activeThread.id);
    }

    try {
      const response = await sendChatMessage(
        {
          message: question,
          retrievalMode: requestSettings.retrievalMode,
          webMode: requestSettings.webMode,
          webTrustMode: requestSettings.webTrustMode,
          harnessMode: requestSettings.harnessMode ?? "tensortalk",
          thinkingMode: requestSettings.thinkingMode ?? "limited",
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
        { signal: abortController.signal },
      );

      updateTurn(turnId, {
        ...response,
        streaming: false,
        error: undefined,
      });
      setPendingTurnId(null);
      if (retryTurnId) {
        toast.success("Answer retried.");
      }
      window.requestAnimationFrame(() => {
        latestAnswerEndRef.current?.scrollIntoView({
          block: "end",
          behavior: "smooth",
        });
      });
    } catch (error) {
      if (isAbortError(error)) {
        updateTurn(turnId, {
          streaming: false,
          error: "Response stopped.",
        });
        setPendingTurnId(null);
        toast.success("Answer stopped.");
        return;
      }

      const errorMessage = getErrorMessage(error);

      updateTurn(turnId, {
        streaming: false,
        error: errorMessage,
      });
      setPendingTurnId(null);
      toast.error(retryTurnId ? "Retry failed." : "Answer failed.", {
        description: errorMessage,
      });
    } finally {
      if (activeRequestRef.current === abortController) {
        activeRequestRef.current = null;
      }
    }
  }

  function stopCurrentResponse() {
    activeRequestRef.current?.abort();
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
    const latestThread = threads[0];

    if (latestThread && latestThread.turns.length === 0) {
      setActiveThreadId(latestThread.id);
      setSelectedTurnId("");
      setOpenEvidenceIds([]);
      setMessage("");
      return;
    }

    const thread = createThread();

    setThreads((current) => [thread, ...current]);
    setActiveThreadId(thread.id);
    setSelectedTurnId("");
    setOpenEvidenceIds([]);
    setMessage("");
    void saveThread(thread)
      .then(() => {
        toast.success("New chat created.");
      })
      .catch(() => {
        toast.error("Could not save new chat.");
      });
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
    const persistenceTasks: Array<Promise<void>> = [deleteThread(threadId)];

    setThreads(nextThreads);

    if (threadId === activeThreadId) {
      setActiveThreadId(nextThreads[0].id);
      setSelectedTurnId(nextThreads[0].selectedTurnId ?? "");
      persistenceTasks.push(saveThread(nextThreads[0]));
    }

    void Promise.all(persistenceTasks)
      .then(() => {
        toast.success("Thread deleted.");
      })
      .catch(() => {
        toast.error("Could not delete thread.");
      });
  }

  function removeAllThreads() {
    if (threads.length === 0) {
      return;
    }

    const confirmed = window.confirm("Delete all threads?");

    if (!confirmed) {
      return;
    }

    const thread = createThread();
    const deletedThreadIds = threads.map((item) => item.id);

    setThreads([thread]);
    setActiveThreadId(thread.id);
    setSelectedTurnId("");
    setOpenEvidenceIds([]);
    setMessage("");

    void Promise.all([
      ...deletedThreadIds.map((threadId) => deleteThread(threadId)),
      saveThread(thread),
    ])
      .then(() => {
        toast.success("All threads deleted.");
      })
      .catch(() => {
        toast.error("Could not delete all threads.");
      });
  }

  async function startVoiceInput() {
    if (voiceStatusRef.current !== "idle" || isPending) {
      return;
    }

    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      toast.error("Voice input is not available in this browser.");
      return;
    }

    voiceStopRequestedRef.current = false;
    voiceStatusRef.current = "recording";
    setVoiceStatus("recording");

    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedVoiceMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        stopRecordingTracks(recorder);
        mediaRecorderRef.current = null;
        audioChunksRef.current = [];
        voiceStatusRef.current = "idle";
        setVoiceStatus("idle");
        toast.error("Voice input stopped unexpectedly.");
      };
      recorder.onstop = () => {
        const chunks = audioChunksRef.current;
        const audio = new Blob(chunks, {
          type: recorder.mimeType || "audio/webm",
        });

        stopRecordingTracks(recorder);
        mediaRecorderRef.current = null;
        audioChunksRef.current = [];

        if (audio.size === 0) {
          voiceStatusRef.current = "idle";
          setVoiceStatus("idle");
          return;
        }

        void transcribeVoiceInput(audio);
      };

      recorder.start();

      if (voiceStopRequestedRef.current) {
        setVoiceStatus("transcribing");
        recorder.stop();
      }
    } catch (error) {
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
      voiceStatusRef.current = "idle";
      setVoiceStatus("idle");
      toast.error(
        error instanceof Error && error.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : "Could not start voice input.",
      );
    }
  }

  function stopVoiceInput() {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state === "inactive") {
      if (voiceStatusRef.current === "recording") {
        voiceStopRequestedRef.current = true;
      }
      return;
    }

    voiceStopRequestedRef.current = true;
    voiceStatusRef.current = "transcribing";
    setVoiceStatus("transcribing");
    recorder.stop();
  }

  async function transcribeVoiceInput(audio: Blob) {
    try {
      const formData = new FormData();

      formData.append(
        "audio",
        audio,
        `question.${getAudioFileExtension(audio.type)}`,
      );

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });
      const body = (await response.json().catch(() => null)) as {
        text?: string;
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(body?.error ?? "Could not transcribe voice input.");
      }

      const transcript = body?.text?.trim() ?? "";

      if (!transcript) {
        throw new Error("Voice input was empty.");
      }

      setMessage((current) =>
        current.trim() ? `${current.trimEnd()} ${transcript}` : transcript,
      );
      questionInputRef.current?.focus();
      toast.success("Voice added to question.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not transcribe voice input.",
      );
    } finally {
      voiceStatusRef.current = "idle";
      setVoiceStatus("idle");
    }
  }

  function retryTurn(turn: StoredTurn) {
    if (isPending) {
      return;
    }

    void sendQuestion(turn.question, turn.settings, turn.id);
  }

  async function copyMessageText(text: string, key: string) {
    const trimmed = text.trim();

    if (!trimmed) {
      return;
    }

    try {
      await writeClipboardText(trimmed);
      setCopiedMessageKey(key);

      if (copyFeedbackTimeoutRef.current) {
        clearTimeout(copyFeedbackTimeoutRef.current);
      }

      copyFeedbackTimeoutRef.current = setTimeout(() => {
        setCopiedMessageKey("");
      }, COPY_FEEDBACK_MS);
      toast.success(
        key.startsWith("question-") ? "Question copied." : "Answer copied.",
      );
    } catch {
      setCopiedMessageKey("");
      toast.error("Copy failed.", {
        description: "The browser did not allow clipboard access.",
      });
    }
  }

  function handleQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isPending) {
      return;
    }

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

  function handleQuestionBubbleKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    turnId: string,
  ) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    setSelectedTurnId(turnId);
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

  function updateThreadTitle(threadId: string, title: string) {
    let nextThread: StoredThread | null = null;

    setThreads((current) => {
      const nextThreads = current.map((thread) => {
        if (thread.id !== threadId || thread.title !== "New chat") {
          return thread;
        }

        nextThread = {
          ...thread,
          title,
          updatedAt: Date.now(),
        };

        return nextThread;
      });

      return nextThreads.sort(
        (left, right) => right.updatedAt - left.updatedAt,
      );
    });

    queueMicrotask(() => {
      if (nextThread) {
        void saveThread(nextThread).catch(() => {
          toast.error("Could not save thread title.");
        });
      }
    });
  }

  async function maybeGenerateThreadTitle(question: string, threadId: string) {
    const thread = threads.find((item) => item.id === threadId);

    if (!thread || thread.turns.length > 0 || thread.title !== "New chat") {
      return;
    }

    try {
      const titleResponse = await fetch("/api/thread-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const body = (await titleResponse.json().catch(() => null)) as {
        title?: string;
      } | null;
      const title = body?.title?.trim();

      if (!title) {
        return;
      }

      updateThreadTitle(threadId, title);
    } catch {
      updateThreadTitle(threadId, fallbackTitle(question));
    }
  }

  return (
    <main className="h-dvh min-h-0 overflow-hidden bg-muted/30 text-foreground">
      <div
        className={cn(
          "mx-auto grid h-full min-h-0 max-w-[1440px] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden p-4 lg:grid-rows-none",
          sidebarCollapsed
            ? detailsCollapsed
              ? "lg:grid-cols-[72px_minmax(0,1fr)_56px]"
              : "lg:grid-cols-[72px_minmax(0,1fr)_380px]"
            : detailsCollapsed
              ? "lg:grid-cols-[280px_minmax(0,1fr)_56px]"
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
              "flex min-h-0 flex-1 flex-col gap-4 max-lg:px-3 max-lg:pb-3",
              sidebarCollapsed && "items-center px-2",
            )}
          >
            <Button
              type="button"
              className={cn(!sidebarCollapsed && "w-full")}
              variant="default"
              size={sidebarCollapsed ? "icon-lg" : "default"}
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
              <div className="group/thread-heading flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Threads
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 opacity-0 transition-opacity group-hover/thread-heading:opacity-100 focus-visible:opacity-100"
                  aria-label="Delete all threads"
                  title="Delete all threads"
                  onClick={removeAllThreads}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
              {loadError ? (
                <p className="rounded-md border px-2 py-1.5 text-xs text-muted-foreground">
                  {loadError}
                </p>
              ) : null}
              <ScrollArea className="min-h-0 flex-1">
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

            <div
              className={cn(
                "mt-auto flex flex-col gap-3",
                sidebarCollapsed ? "items-center" : "w-full",
              )}
            >
              <Button
                type="button"
                variant="outline"
                size={sidebarCollapsed ? "icon-lg" : "default"}
                className={cn(!sidebarCollapsed && "w-full justify-start")}
                nativeButton={false}
                aria-label="Visualize Vector"
                title="Visualize Vector"
                render={<Link href="/embeddings" />}
              >
                <NetworkIcon data-icon="inline-start" />
                <span className={cn(sidebarCollapsed && "hidden")}>
                  Visualize Vector
                </span>
              </Button>
            </div>
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
                      <div className="group/question ml-auto flex max-w-[78%] items-start gap-1">
                        <MessageCopyButton
                          copied={copiedMessageKey === `question-${turn.id}`}
                          label="Copy question"
                          onCopy={() =>
                            void copyMessageText(
                              turn.question,
                              `question-${turn.id}`,
                            )
                          }
                          className="mt-0.5 opacity-0 group-hover/question:opacity-100"
                        />
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedTurnId(turn.id)}
                          onKeyDown={(event) =>
                            handleQuestionBubbleKeyDown(event, turn.id)
                          }
                          className={cn(
                            "box-border min-w-0 flex-1 cursor-text select-text rounded-lg border bg-secondary px-3 py-2 text-left text-sm [overflow-wrap:anywhere] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                            selectedTurn?.id === turn.id &&
                              "ring-2 ring-ring/30",
                          )}
                        >
                          {turn.question}
                        </div>
                      </div>
                      <div
                        className={cn(
                          "group/answer box-border w-full max-w-[88%] rounded-lg border bg-card p-4",
                          selectedTurn?.id === turn.id && "ring-2 ring-ring/30",
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
                          <div className="flex shrink-0 items-center gap-1">
                            <MessageCopyButton
                              copied={copiedMessageKey === `answer-${turn.id}`}
                              disabled={!turn.answer.trim()}
                              label="Copy answer"
                              onCopy={() =>
                                void copyMessageText(
                                  formatAnswerForDisplay(turn.answer),
                                  `answer-${turn.id}`,
                                )
                              }
                              className="opacity-0 group-hover/answer:opacity-100"
                            />
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

                        <AnswerMarkdown
                          content={
                            formatAnswerForDisplay(turn.answer) ||
                            (turn.streaming
                              ? "Waiting for streamed response..."
                              : "")
                          }
                        />

                        {turn.streaming && turn.answer ? (
                          <TracingSteps
                            compact
                            stages={turn.stages ?? EMPTY_STAGES}
                          />
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

          <div className="shrink-0 px-1 pb-1">
            <Card size="sm">
              <CardContent className="pb-3">
                <form onSubmit={submitQuestion}>
                  <FieldGroup>
                    <Field>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <FieldLabel htmlFor="question">Question</FieldLabel>
                      </div>
                      <InputGroup className="min-h-28 items-stretch">
                        <div className="relative flex w-full">
                          <InputGroupTextarea
                            id="question"
                            ref={questionInputRef}
                            value={message}
                            onChange={(event) => setMessage(event.target.value)}
                            onKeyDown={handleQuestionKeyDown}
                            placeholder="Ask about rules, facilities, contacts, or official pages."
                            className={cn(
                              "min-h-24 pb-12",
                              composerContext ? "pr-36" : "pr-24",
                            )}
                          />
                          {voiceStatus !== "idle" ? (
                            <div
                              aria-live="polite"
                              className="pointer-events-none absolute bottom-3 left-3 z-10 inline-flex h-8 items-center gap-1.5 rounded-full border bg-background/95 px-2.5 text-xs font-medium text-muted-foreground shadow-sm"
                            >
                              {voiceStatus === "recording" ? (
                                <MicIcon className="size-3.5 animate-pulse text-destructive" />
                              ) : (
                                <LoaderCircleIcon className="size-3.5 animate-spin" />
                              )}
                              <span>
                                {voiceStatus === "recording"
                                  ? "Listening..."
                                  : "Transcribing..."}
                              </span>
                            </div>
                          ) : null}
                          <div className="absolute right-3 bottom-3 z-10 flex items-center gap-2">
                            <ContextIndicator
                              context={composerContext}
                              open={contextDetailsOpen}
                              onOpenChange={setContextDetailsOpen}
                            />
                            <InputGroupButton
                              type="button"
                              variant="outline"
                              size="icon-sm"
                              className={cn(
                                "size-9 rounded-full bg-background/95 p-0 shadow-sm",
                                voiceStatus === "recording" &&
                                  "border-destructive text-destructive",
                              )}
                              aria-label={
                                voiceStatus === "recording"
                                  ? "Stop and transcribe voice"
                                  : voiceStatus === "transcribing"
                                    ? "Transcribing voice"
                                    : "Start voice input"
                              }
                              title={
                                voiceStatus === "recording"
                                  ? "Stop and transcribe voice"
                                  : voiceStatus === "transcribing"
                                    ? "Transcribing voice"
                                    : "Start voice input"
                              }
                              disabled={voiceBlocked}
                              onClick={() => {
                                if (voiceStatus === "recording") {
                                  stopVoiceInput();
                                  return;
                                }

                                if (voiceBlocked) {
                                  return;
                                }

                                void startVoiceInput();
                              }}
                            >
                              {voiceStatus === "transcribing" ? (
                                <LoaderCircleIcon className="size-4 animate-spin" />
                              ) : (
                                <MicIcon
                                  className={cn(
                                    "size-4",
                                    voiceStatus === "recording" &&
                                      "animate-pulse",
                                  )}
                                />
                              )}
                            </InputGroupButton>
                            <InputGroupButton
                              type={isPending ? "button" : "submit"}
                              variant="default"
                              size="icon-sm"
                              className={cn(
                                "size-9 rounded-full p-0 shadow-sm",
                                isPending &&
                                  "bg-foreground text-background hover:bg-foreground/90",
                              )}
                              aria-label={isPending ? "Stop response" : "Ask"}
                              title={isPending ? "Stop response" : "Ask"}
                              onClick={
                                isPending ? stopCurrentResponse : undefined
                              }
                            >
                              {isPending ? (
                                <SquareIcon className="size-3 fill-current" />
                              ) : (
                                <SendIcon className="size-4" />
                              )}
                            </InputGroupButton>
                          </div>
                        </div>
                        <InputGroupAddon align="block-end" className="border-t">
                          <div className="flex w-full flex-col gap-1">
                            <div className="flex w-full flex-wrap items-center gap-2">
                              <Select
                                items={[
                                  {
                                    label: "Semantic (BGE)",
                                    value: "semantic",
                                  },
                                  { label: "Lexical", value: "lexical" },
                                  ...(ENABLE_EXPERIMENTAL_QWEN_RETRIEVAL
                                    ? [
                                        {
                                          label: "Semantic (Qwen3 8B)",
                                          value: "semantic-qwen",
                                        },
                                      ]
                                    : []),
                                ]}
                                value={retrievalMode}
                                onValueChange={(value) => {
                                  if (
                                    value === "semantic" ||
                                    (ENABLE_EXPERIMENTAL_QWEN_RETRIEVAL &&
                                      value === "semantic-qwen") ||
                                    value === "lexical"
                                  ) {
                                    setRetrievalMode(value);
                                  }
                                }}
                              >
                                <SelectTrigger
                                  aria-label="Retrieval mode"
                                  size="sm"
                                  className="min-w-32 shrink-0"
                                >
                                  <span
                                    data-slot="select-value"
                                    className="flex flex-1 items-center gap-1.5 text-left"
                                  >
                                    {ragEnabled
                                      ? getRetrievalLabel(retrievalMode)
                                      : "No RAG"}
                                  </span>
                                </SelectTrigger>
                                <SelectContent
                                  align="start"
                                  className="min-w-72"
                                >
                                  <div
                                    className="flex items-center justify-between gap-4 px-2 py-2 text-sm"
                                    onClick={(event) => event.stopPropagation()}
                                    onPointerDown={(event) =>
                                      event.stopPropagation()
                                    }
                                  >
                                    <span>R.A.G</span>
                                    <Switch
                                      id="rag-toggle"
                                      size="sm"
                                      checked={ragEnabled}
                                      onCheckedChange={setRagEnabled}
                                      aria-label="Enable RAG"
                                    />
                                  </div>
                                  <SelectSeparator />
                                  <SelectGroup>
                                    <SelectItem
                                      value="semantic"
                                      disabled={!ragEnabled}
                                    >
                                      Semantic (BGE)
                                    </SelectItem>
                                    <SelectItem
                                      value="lexical"
                                      disabled={!ragEnabled}
                                    >
                                      Lexical
                                    </SelectItem>
                                  </SelectGroup>
                                  {ENABLE_EXPERIMENTAL_QWEN_RETRIEVAL ? (
                                    <>
                                      <SelectSeparator />
                                      <SelectGroup>
                                        <SelectItem
                                          value="semantic-qwen"
                                          className="pr-12"
                                          disabled={!ragEnabled}
                                        >
                                          <span>Semantic (Qwen3 8B)</span>
                                          <Badge
                                            variant="secondary"
                                            className="h-5 shrink-0 px-1.5 text-[10px]"
                                          >
                                            EXP
                                          </Badge>
                                        </SelectItem>
                                      </SelectGroup>
                                    </>
                                  ) : null}
                                </SelectContent>
                              </Select>
                              <RouteSettingsCombobox
                                webMode={webMode}
                                webTrustMode={webTrustMode}
                                harnessMode={harnessMode}
                                thinkingMode={thinkingMode}
                                disabled={false}
                                onWebModeChange={setWebMode}
                                onWebTrustModeChange={setWebTrustMode}
                                onHarnessModeChange={setHarnessMode}
                                onThinkingModeChange={setThinkingMode}
                              />
                            </div>
                          </div>
                        </InputGroupAddon>
                      </InputGroup>
                    </Field>
                  </FieldGroup>
                </form>
              </CardContent>
            </Card>
          </div>
        </section>

        <Card className="hidden max-h-[calc(100dvh-2rem)] lg:flex lg:h-[calc(100dvh-2rem)]">
          {detailsCollapsed ? (
            <CardContent className="flex h-full flex-col items-center gap-2 px-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Expand details sidebar"
                title="Expand details sidebar"
                onClick={() => setDetailsCollapsed(false)}
              >
                <PanelRightOpenIcon />
              </Button>
              <Separator className="my-1 w-8" />
              <Button
                type="button"
                variant={activeTab === "evidence" ? "secondary" : "ghost"}
                size="icon"
                aria-label="Evidence"
                title="Evidence"
                onClick={() => setActiveTab("evidence")}
              >
                <FileTextIcon className="size-4" />
              </Button>
              <Button
                type="button"
                variant={activeTab === "trace" ? "secondary" : "ghost"}
                size="icon"
                aria-label="Trace"
                title="Trace"
                onClick={() => setActiveTab("trace")}
              >
                <LibraryIcon className="size-4" />
              </Button>
            </CardContent>
          ) : (
            <>
              <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <div className="min-w-0">
                  <CardTitle>
                    {activeTab === "evidence" ? "Evidence" : "Trace"}
                  </CardTitle>
                  <CardDescription>
                    {selectedTurn
                      ? "Details for the selected message."
                      : "Select a message to inspect its support."}
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Collapse details sidebar"
                  title="Collapse details sidebar"
                  onClick={() => setDetailsCollapsed(true)}
                >
                  <PanelRightCloseIcon />
                </Button>
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
            </>
          )}
        </Card>
      </div>
    </main>
  );
}

function MessageCopyButton({
  copied,
  disabled = false,
  label,
  onCopy,
  className,
}: {
  copied: boolean;
  disabled?: boolean;
  label: string;
  onCopy: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "size-8 shrink-0 transition-opacity focus-visible:opacity-100",
        copied && "opacity-100",
        className,
      )}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      disabled={disabled}
      onClick={onCopy}
    >
      {copied ? (
        <CheckIcon className="size-4" />
      ) : (
        <CopyIcon className="size-4" />
      )}
    </Button>
  );
}

function AnswerMarkdown({ content }: { content: string }) {
  return (
    <div className="space-y-3 text-sm leading-6 [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h3 className="text-base leading-6 font-semibold">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="text-base leading-6 font-semibold">{children}</h3>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm leading-6 font-semibold">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm leading-6 font-semibold">{children}</h4>
          ),
          p: ({ children }) => <p>{children}</p>,
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">
              {children}
            </strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline underline-offset-4"
            >
              {children}
            </a>
          ),
          img: ({ alt, src }) => (
            <span className="rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">
              Image:{" "}
              {alt || (typeof src === "string" ? src : "") || "not displayed"}
            </span>
          ),
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-1">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-5">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full border-collapse text-left text-xs">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b bg-muted/50 px-2 py-1.5 font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-t px-2 py-1.5 align-top">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function RouteSettingsCombobox({
  webMode,
  webTrustMode,
  harnessMode,
  thinkingMode,
  disabled,
  onWebModeChange,
  onWebTrustModeChange,
  onHarnessModeChange,
  onThinkingModeChange,
}: {
  webMode: WebMode;
  webTrustMode: WebTrustMode;
  harnessMode: HarnessMode;
  thinkingMode: ThinkingMode;
  disabled: boolean;
  onWebModeChange: (mode: WebMode) => void;
  onWebTrustModeChange: (mode: WebTrustMode) => void;
  onHarnessModeChange: (mode: HarnessMode) => void;
  onThinkingModeChange: (mode: ThinkingMode) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-w-44 justify-between"
            disabled={disabled}
            aria-label="Route controls"
          />
        }
      >
        <span className="truncate">
          Route: {getWebLabel(webMode)}, {getWebTrustShortLabel(webTrustMode)}
        </span>
        <ChevronDownIcon data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <PopoverHeader className="px-2 pt-1 pb-2">
          <PopoverTitle>Route</PopoverTitle>
          <PopoverDescription>
            Web search, harness model, and thinking budget for this answer.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex flex-col gap-1">
          <RouteOptionGroup
            title="Web"
            icon={<Globe2Icon className="size-4" />}
            options={[
              { label: "Web Auto", value: "auto" },
              { label: "Web On", value: "on" },
              { label: "Web Off", value: "off" },
            ]}
            value={webMode}
            onChange={(value) => onWebModeChange(value as WebMode)}
          />
          <Separator className="my-1" />
          <RouteOptionGroup
            title="Trust"
            icon={<Globe2Icon className="size-4" />}
            options={[
              { label: "Broad UM", value: "broad" },
              { label: "Strict list", value: "strict" },
            ]}
            value={webTrustMode}
            onChange={(value) => onWebTrustModeChange(value as WebTrustMode)}
          />
          <Separator className="my-1" />
          <RouteOptionGroup
            title="Harness"
            icon={<BrainCircuitIcon className="size-4" />}
            options={[
              { label: "TensorTalk", value: "tensortalk" },
              { label: "OpenRouter Qwen", value: "openrouter" },
            ]}
            value={harnessMode}
            onChange={(value) => onHarnessModeChange(value as HarnessMode)}
          />
          <Separator className="my-1" />
          <RouteOptionGroup
            title="Thinking"
            icon={<BrainCircuitIcon className="size-4" />}
            options={[
              { label: "Off", value: "off" },
              { label: "Limited", value: "limited" },
              { label: "More", value: "more" },
            ]}
            value={thinkingMode}
            onChange={(value) => onThinkingModeChange(value as ThinkingMode)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RouteOptionGroup({
  title,
  icon,
  options,
  value,
  onChange,
}: {
  title: string;
  icon: ReactNode;
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
        {icon}
        {title}
      </div>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md px-2 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            option.value === value && "bg-muted font-medium text-foreground",
          )}
        >
          <span>{option.label}</span>
          {option.value === value ? <CheckIcon className="size-4" /> : null}
        </button>
      ))}
    </section>
  );
}

function ContextIndicator({
  context,
  open,
  onOpenChange,
}: {
  context?: NonNullable<ChatResponse["context"]>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
    context.contextTruncated
      ? "Older context was omitted."
      : "No history omitted.",
  ].join("\n");

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title={title}
            aria-label="Context usage"
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-full border bg-background/95 px-2 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              warning && "border-destructive/40 text-destructive",
            )}
          />
        }
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
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-64 p-3 text-xs"
      >
        <PopoverHeader className="gap-0.5">
          <PopoverTitle>Context Window</PopoverTitle>
          <PopoverDescription>
            Token budget used by the next answer.
          </PopoverDescription>
        </PopoverHeader>
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
          <p className="text-destructive">
            Older context was omitted to stay under 8192 tokens.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
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
  const hasError = visibleStages.some((stage) => stage.status === "error");
  const hasIncomplete = visibleStages.some(
    (stage) => stage.status === "active" || stage.status === "pending",
  );

  return (
    <div className="mb-4 rounded-md border bg-muted/30 px-3 py-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        {hasError ? (
          <AlertTriangleIcon className="size-4 text-destructive" />
        ) : hasIncomplete ? (
          <LoaderCircleIcon className="size-4 animate-spin" />
        ) : (
          <CheckIcon className="size-4 text-primary" />
        )}
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
      className="group/details mb-4 rounded-md border bg-muted/40 px-3 py-2 text-sm"
    >
      <summary className="flex cursor-pointer items-center gap-2 font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
        <BrainCircuitIcon className="size-4" />
        Model thinking
        <ChevronDownIcon className="ml-auto size-4 transition-transform group-open/details:rotate-180" />
      </summary>
      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 font-sans text-muted-foreground [overflow-wrap:anywhere]">
        {thinking}
      </pre>
    </details>
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
              <TraceRow
                label="Decision"
                value={trace.planner.needWeb ? "Web" : "No web"}
              />
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
        <TraceEvidenceList
          title="Accepted evidence"
          evidence={trace.acceptedEvidence}
        />
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
                value={trace.grounding.unsupportedFacts.join(", ") || "none"}
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
        <Badge variant="outline">
          {getRetrievalLabel(trace.route.retrievalMode)}
        </Badge>
        <Badge variant="outline">{getWebLabel(trace.route.webMode)}</Badge>
        <Badge variant="outline">
          {getWebTrustLabel(trace.route.webTrustMode)}
        </Badge>
        <Badge variant="outline">
          {getHarnessLabel(trace.route.harnessMode)}
        </Badge>
        <Badge variant="outline">
          Thinking {getThinkingLabel(trace.route.thinkingMode)}
        </Badge>
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
            <div className="font-medium">
              {item.title ?? item.domain ?? item.url}
            </div>
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
  settings: {
    retrievalMode: RetrievalMode;
    webMode: WebMode;
    webTrustMode?: WebTrustMode;
    harnessMode?: HarnessMode;
    thinkingMode?: ThinkingMode;
  },
): StoredTurn {
  const normalizedSettings = {
    ...settings,
    webTrustMode: settings.webTrustMode ?? "broad",
    harnessMode: settings.harnessMode ?? "tensortalk",
    thinkingMode: settings.thinkingMode ?? "limited",
  };

  return {
    id,
    question,
    answer: "",
    evidence: [],
    mode: "streaming",
    retrievalMode: normalizedSettings.retrievalMode,
    webMode: normalizedSettings.webMode,
    webTrustMode: normalizedSettings.webTrustMode,
    harnessMode: normalizedSettings.harnessMode,
    thinkingMode: normalizedSettings.thinkingMode,
    settings: normalizedSettings,
    streaming: true,
    stages: EMPTY_STAGES,
  };
}

function createDraftContextMetadata(
  message: string,
  thinkingMode: ThinkingMode,
  thread?: StoredThread,
): NonNullable<ChatResponse["context"]> {
  const reservedOutputTokens =
    thinkingMode === "more"
      ? CLIENT_MORE_OUTPUT_TOKENS
      : CLIENT_DEFAULT_OUTPUT_TOKENS;
  const history = thread ? buildHistoryForRequest(thread) : [];
  const historyTokenEstimate = history.reduce(
    (total, turn) =>
      total +
      Math.ceil(turn.question.slice(0, 280).length / 4) +
      Math.ceil(stripThinkingForContext(turn.answer).slice(0, 700).length / 4),
    0,
  );
  const estimatedInputTokens =
    Math.ceil(message.trim().length / 4) + historyTokenEstimate;

  return {
    maxContextTokens: CLIENT_MAX_CONTEXT_TOKENS,
    reservedOutputTokens,
    estimatedInputTokens,
    estimatedContextUsagePercent: Math.min(
      100,
      Math.round(
        ((estimatedInputTokens + reservedOutputTokens) /
          CLIENT_MAX_CONTEXT_TOKENS) *
          100,
      ),
    ),
    includedHistoryCount: history.length,
    omittedHistoryCount: 0,
    contextTruncated: false,
  };
}

function stripThinkingForContext(answer: string) {
  return answer.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
}

function buildHistoryForRequest(thread: StoredThread, retryTurnId?: string) {
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

function getRetrievalLabel(mode?: RetrievalMode) {
  if (mode === "none") {
    return "No RAG";
  }

  if (mode === "lexical") {
    return "Lexical";
  }

  return mode === "semantic-qwen" ? "Semantic (Qwen3 8B)" : "Semantic (BGE)";
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

function getWebTrustLabel(mode?: WebTrustMode) {
  return mode === "strict" ? "Strict source trust" : "Broad UM source trust";
}

function getWebTrustShortLabel(mode?: WebTrustMode) {
  return mode === "strict" ? "Strict trust" : "Broad UM";
}

function getHarnessLabel(mode?: HarnessMode) {
  return mode === "openrouter"
    ? "OpenRouter Qwen harness"
    : "TensorTalk harness";
}

function getThinkingLabel(mode?: ThinkingMode) {
  if (mode === "off") {
    return "Off";
  }

  if (mode === "more") {
    return "More";
  }

  return "Limited";
}

function getSupportedVoiceMimeType() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) {
    return "";
  }

  return (
    VOICE_INPUT_MIME_TYPES.find((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    ) ?? ""
  );
}

function getAudioFileExtension(mimeType: string) {
  const cleanMime = mimeType.split(";")[0]?.toLowerCase();

  if (cleanMime === "audio/mpeg") {
    return "mp3";
  }

  if (cleanMime === "audio/mp4") {
    return "m4a";
  }

  return cleanMime?.replace("audio/", "") || "webm";
}

function stopRecordingTracks(recorder: MediaRecorder | null) {
  recorder?.stream.getTracks().forEach((track) => {
    track.stop();
  });
}

async function writeClipboardText(text: string) {
  if (copyTextWithSelection(text)) {
    return;
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error("Copy command was rejected.");
    }
  }

  throw new Error("Copy command was rejected.");
}

function copyTextWithSelection(text: string) {
  const textarea = document.createElement("textarea");
  const activeElement = document.activeElement;

  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);

    if (activeElement instanceof HTMLElement) {
      activeElement.focus();
    }
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Chat request failed.";
}

function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function fallbackTitle(question: string) {
  return question.replace(/\s+/g, " ").trim().slice(0, 52) || "New chat";
}

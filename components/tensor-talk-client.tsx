"use client";

import { useMutation } from "@tanstack/react-query";
import {
  BookOpenIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  FileTextIcon,
  LibraryIcon,
  MessageSquareTextIcon,
  MoonIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SearchIcon,
  SendIcon,
  SunIcon,
} from "lucide-react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { FormEvent, useRef, useState } from "react";

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
import type { ChatResponse, Evidence, RetrievalMode } from "@/lib/chat";
import { cn } from "@/lib/utils";

type ChatTurn = ChatResponse & {
  id: number;
  question: string;
  streaming?: boolean;
};

type ChatMutationVariables = {
  message: string;
  turnId: number;
  retrievalMode: RetrievalMode;
};

const QUICK_PROMPTS = [
  "What are the faculty objectives?",
  "What is industrial training?",
  "What are thesis submission requirements?",
  "What are the programme requirements for Master in Data Science?",
];

const SOURCE_AREAS = [
  "General handbook",
  "Undergraduate rules",
  "Postgraduate guidance",
  "Industrial training",
];

export function TensorTalkClient() {
  const [message, setMessage] = useState("");
  const [retrievalMode, setRetrievalMode] =
    useState<RetrievalMode>("semantic");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [openEvidenceIds, setOpenEvidenceIds] = useState<string[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const questionInputRef = useRef<HTMLTextAreaElement>(null);
  const latestAnswerEndRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme, setTheme } = useTheme();

  const latestTurn = turns.at(-1);
  const chatMutation = useMutation({
    mutationFn: ({
      message,
      retrievalMode,
      turnId,
    }: ChatMutationVariables) => {
      return sendChatMessage({ message, retrievalMode }, (partial) => {
        if (partial.evidence) {
          setOpenEvidenceIds((current) =>
            current.length > 0 || !partial.evidence?.[0]?.kb_id
              ? current
              : [partial.evidence[0].kb_id],
          );
        }

        setTurns((current) =>
          current.map((turn) =>
            turn.id === turnId ? { ...turn, ...partial } : turn,
          ),
        );
      });
    },
    onSuccess: (data, variables) => {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === variables.turnId
            ? { ...turn, ...data, streaming: false }
            : turn,
        ),
      );
      window.requestAnimationFrame(() => {
        latestAnswerEndRef.current?.scrollIntoView({
          block: "end",
          behavior: "smooth",
        });
      });
    },
    onError: (_error, variables) => {
      setTurns((current) =>
        current.filter((turn) => turn.id !== variables.turnId),
      );
    },
  });

  const isDark = resolvedTheme === "dark";

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const question = message.trim();
    if (chatMutation.isPending) {
      return;
    }

    if (!question) {
      questionInputRef.current?.focus();
      return;
    }

    const turnId = Date.now();

    setOpenEvidenceIds([]);
    setTurns((current) => [
      ...current,
      {
        id: turnId,
        question,
        answer: "",
        evidence: [],
        mode: "streaming",
        retrievalMode,
        streaming: true,
      },
    ]);
    setMessage("");
    chatMutation.mutate({ message: question, retrievalMode, turnId });
  }

  function selectPrompt(prompt: string) {
    setMessage(prompt);
  }

  return (
    <main className="min-h-dvh bg-muted/30 text-foreground">
      <div
        className={cn(
          "mx-auto grid min-h-dvh max-w-[1440px] grid-cols-1 gap-4 p-4",
          sidebarCollapsed
            ? "lg:grid-cols-[72px_minmax(0,1fr)_360px]"
            : "lg:grid-cols-[260px_minmax(0,1fr)_360px]",
        )}
      >
        <Card className="lg:min-h-[calc(100dvh-2rem)]">
          <CardHeader className={cn(sidebarCollapsed && "items-center px-2")}>
            <div
              className={cn(
                "flex gap-3",
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
          {sidebarCollapsed ? (
            <CardContent className="flex flex-col items-center gap-4 px-2">
              <Badge
                variant="success"
                className="size-8 justify-center px-0"
                title="Knowledge base ready"
                aria-label="Knowledge base ready"
              >
                <CheckCircle2Icon />
              </Badge>

              <Separator />

              <div className="flex flex-col gap-2">
                {SOURCE_AREAS.map((area) => (
                  <div
                    key={area}
                    title={area}
                    aria-label={area}
                    className="flex size-9 items-center justify-center rounded-md text-muted-foreground"
                  >
                    <LibraryIcon className="size-4" />
                  </div>
                ))}
              </div>

              <Separator />

              <div className="flex flex-col gap-2">
                {QUICK_PROMPTS.map((prompt) => (
                  <Button
                    key={prompt}
                    type="button"
                    variant="outline"
                    size="icon"
                    title={prompt}
                    aria-label={prompt}
                    onClick={() => selectPrompt(prompt)}
                  >
                    <MessageSquareTextIcon />
                  </Button>
                ))}
              </div>
            </CardContent>
          ) : (
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-wrap gap-2">
                <Badge variant="success">
                  <CheckCircle2Icon data-icon="inline-start" />
                  Knowledge base ready
                </Badge>
                <Badge variant="secondary">
                  {retrievalMode === "semantic"
                    ? "Semantic vectors"
                    : "Fast lexical"}
                </Badge>
              </div>

              <Separator />

              <section className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Sources
                </p>
                <div className="flex flex-col gap-1">
                  {SOURCE_AREAS.map((area) => (
                    <div
                      key={area}
                      className="flex min-h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground"
                    >
                      <LibraryIcon className="size-4" />
                      {area}
                    </div>
                  ))}
                </div>
              </section>

              <Separator />

              <section className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Quick prompts
                </p>
                <div className="flex flex-col gap-2">
                  {QUICK_PROMPTS.map((prompt) => (
                    <Button
                      key={prompt}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                      onClick={() => selectPrompt(prompt)}
                    >
                      <MessageSquareTextIcon data-icon="inline-start" />
                      {prompt}
                    </Button>
                  ))}
                </div>
              </section>
            </CardContent>
          )}
        </Card>

        <section className="flex min-h-[calc(100dvh-2rem)] flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Ask the handbook</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitQuestion}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="question">Question</FieldLabel>
                    <InputGroup className="min-h-32 items-stretch">
                      <InputGroupTextarea
                        id="question"
                        ref={questionInputRef}
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        placeholder="Ask about programme requirements, academic rules, facilities, thesis submission, or industrial training."
                        disabled={chatMutation.isPending}
                      />
                      <InputGroupAddon align="block-end" className="border-t">
                        <div className="flex w-full flex-col gap-2">
                          <div className="flex w-full items-center justify-between gap-2">
                            <Select
                              items={[
                                {
                                  label: "Semantic vectors",
                                  value: "semantic",
                                },
                                { label: "Fast lexical", value: "lexical" },
                              ]}
                              value={retrievalMode}
                              onValueChange={(value) => {
                                if (
                                  value === "semantic" ||
                                  value === "lexical"
                                ) {
                                  setRetrievalMode(value);
                                }
                              }}
                              disabled={chatMutation.isPending}
                            >
                              <SelectTrigger
                                aria-label="Retrieval mode"
                                size="sm"
                                className="min-w-36 shrink-0"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent align="start">
                                <SelectGroup>
                                  <SelectItem value="semantic">
                                    Semantic vectors
                                  </SelectItem>
                                  <SelectItem value="lexical">
                                    Fast lexical
                                  </SelectItem>
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                            <InputGroupButton
                              type="submit"
                              variant="default"
                              size="sm"
                              disabled={chatMutation.isPending}
                            >
                              {chatMutation.isPending ? (
                                <Spinner data-icon="inline-start" />
                              ) : (
                                <SendIcon data-icon="inline-start" />
                              )}
                              Ask
                            </InputGroupButton>
                          </div>
                          <FieldDescription className="text-xs">
                            {chatMutation.isError
                              ? getErrorMessage(chatMutation.error)
                              : "Answers are constrained to handbook evidence."}
                          </FieldDescription>
                        </div>
                      </InputGroupAddon>
                    </InputGroup>
                  </Field>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>

          <Card className="min-h-0 flex-1">
            <CardHeader>
              <CardTitle>Conversation</CardTitle>
              <CardDescription>
                New messages appear at the bottom like a chat.
              </CardDescription>
            </CardHeader>
            <CardContent className="min-h-0">
              <ScrollArea className="h-[calc(100dvh-25rem)] min-h-80">
                <div className="flex min-w-0 flex-col gap-4 py-1 pr-6 pl-4">
                  {turns.length === 0 && !chatMutation.isPending ? (
                    <Empty className="min-h-72 border">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <BrainCircuitIcon />
                        </EmptyMedia>
                        <EmptyTitle>Start with a handbook question.</EmptyTitle>
                        <EmptyDescription>
                          TensorTalk retrieves relevant sections before it
                          writes an answer.
                        </EmptyDescription>
                      </EmptyHeader>
                      <EmptyContent>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => selectPrompt(QUICK_PROMPTS[0])}
                        >
                          <SearchIcon data-icon="inline-start" />
                          Try a sample question
                        </Button>
                      </EmptyContent>
                    </Empty>
                  ) : null}

                  {turns.map((turn) => (
                    <article
                      key={turn.id}
                      className="flex min-w-0 flex-col gap-3"
                    >
                      <div className="ml-auto box-border max-w-[78%] rounded-lg border bg-secondary px-3 py-2 text-sm [overflow-wrap:anywhere]">
                        {turn.question}
                      </div>
                      <Card size="sm" className="box-border w-full max-w-[88%]">
                        <CardHeader>
                          <CardTitle>Answer</CardTitle>
                        </CardHeader>
                        <CardContent>
                          {turn.thinking ? (
                            <ThinkingBlock
                              thinking={turn.thinking}
                              open={Boolean(turn.streaming)}
                            />
                          ) : null}
                          <p className="text-sm leading-6 [overflow-wrap:anywhere]">
                            {formatAnswerForDisplay(turn.answer) ||
                              "Waiting for streamed response..."}
                          </p>
                          {turn.id === latestTurn?.id ? (
                            <EvidenceLinks
                              evidence={turn.evidence}
                              onSelectEvidence={(kbId) =>
                                setOpenEvidenceIds([kbId])
                              }
                            />
                          ) : null}
                          {turn.retrievalMode ? (
                            <p className="mt-3 text-xs text-muted-foreground">
                              Retrieval:{" "}
                              {turn.retrievalMode === "semantic"
                                ? "Semantic vectors"
                                : "Fast lexical"}
                            </p>
                          ) : null}
                          <div
                            ref={
                              turn.id === latestTurn?.id
                                ? latestAnswerEndRef
                                : undefined
                            }
                          />
                        </CardContent>
                      </Card>
                    </article>
                  ))}
                  {chatMutation.isPending &&
                  !latestTurn?.answer &&
                  !latestTurn?.thinking ? (
                    <PendingTurn />
                  ) : null}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </section>

        <Card className="lg:min-h-[calc(100dvh-2rem)]">
          <CardHeader>
            <CardTitle>Evidence</CardTitle>
            <CardDescription>
              Retrieved handbook sections for the latest answer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EvidencePanel
              evidence={latestTurn?.evidence ?? []}
              openEvidenceIds={openEvidenceIds}
              onOpenEvidenceChange={setOpenEvidenceIds}
              pending={chatMutation.isPending}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function PendingTurn() {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Spinner />
          Retrieving evidence
        </CardTitle>
        <CardDescription>
          Searching the handbook knowledge base before answering.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
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

function EvidenceLinks({
  evidence,
  onSelectEvidence,
}: {
  evidence: Evidence[];
  onSelectEvidence: (kbId: string) => void;
}) {
  if (evidence.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Evidence links"
      className="mb-3 flex flex-wrap items-center gap-2"
    >
      <span className="text-xs font-medium text-muted-foreground">
        Evidence
      </span>
      {evidence.map((item, index) => {
        const label = getEvidenceLabel(item, index);
        const title = getEvidenceTitle(item, label);

        return (
          <a
            key={item.kb_id}
            href={`#${getEvidenceId(item.kb_id)}`}
            title={title}
            aria-label={title}
            onClick={() => {
              onSelectEvidence(item.kb_id);
              scrollToEvidence(item.kb_id);
            }}
            className="inline-flex h-6 max-w-full items-center gap-1 rounded-full border px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <FileTextIcon className="size-3 shrink-0" />
            <span className="truncate">{label}</span>
          </a>
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
}: {
  evidence: Evidence[];
  openEvidenceIds: string[];
  onOpenEvidenceChange: (openEvidenceIds: string[]) => void;
  pending: boolean;
}) {
  if (pending) {
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
      <Empty className="min-h-72 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookOpenIcon />
          </EmptyMedia>
          <EmptyTitle>No evidence selected.</EmptyTitle>
          <EmptyDescription>
            Ask a question to see the matching handbook sections and page
            references.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ScrollArea className="h-[calc(100dvh-11rem)]">
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
                <span className="truncate">
                  {item.section ?? "Handbook evidence"}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {item.source_doc ?? "UM Handbook"}
                  {item.pages?.length ? `, page ${item.pages.join(", ")}` : ""}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    <FileTextIcon data-icon="inline-start" />
                    {item.scope_label ?? "handbook"}
                  </Badge>
                  {item.subsection ? (
                    <Badge variant="secondary">{item.subsection}</Badge>
                  ) : null}
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  {item.source_text}
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </ScrollArea>
  );
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
    item.section ?? item.subsection ?? item.source_doc ?? `Source ${index + 1}`
  );
}

function getEvidenceTitle(item: Evidence, label: string) {
  const pageText = item.pages?.length ? `, page ${item.pages.join(", ")}` : "";

  return `View ${label}${pageText} in the evidence panel`;
}

function scrollToEvidence(kbId: string) {
  window.requestAnimationFrame(() => {
    document
      .getElementById(getEvidenceId(kbId))
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function getErrorMessage(error: Error | null) {
  return error?.message ?? "Chat request failed.";
}

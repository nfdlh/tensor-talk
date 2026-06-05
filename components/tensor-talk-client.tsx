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
  SearchIcon,
  SendIcon,
  SunIcon,
} from "lucide-react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { FormEvent, useState } from "react";

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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { sendChatMessage } from "@/lib/chat-client";
import type { ChatResponse, Evidence } from "@/lib/chat";

type ChatTurn = ChatResponse & {
  id: number;
  question: string;
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
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const { resolvedTheme, setTheme } = useTheme();

  const latestTurn = turns[0];
  const chatMutation = useMutation({
    mutationFn: sendChatMessage,
    onSuccess: (data, variables) => {
      setTurns((current) => [
        {
          ...data,
          id: Date.now(),
          question: variables.message,
        },
        ...current,
      ]);
      setMessage("");
    },
  });

  const isDark = resolvedTheme === "dark";

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const question = message.trim();
    if (!question || chatMutation.isPending) {
      return;
    }

    chatMutation.mutate({ message: question });
  }

  function selectPrompt(prompt: string) {
    setMessage(prompt);
  }

  return (
    <main className="min-h-dvh bg-muted/30 text-foreground">
      <div className="mx-auto grid min-h-dvh max-w-[1440px] grid-cols-1 gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)_360px]">
        <Card className="lg:min-h-[calc(100dvh-2rem)]">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white">
                  <Image
                    src="/tensor-talk-mark.png"
                    alt=""
                    width={48}
                    height={48}
                    priority
                    className="size-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <CardTitle>TensorTalk</CardTitle>
                  <CardDescription>UM FSKTM handbook</CardDescription>
                </div>
              </div>
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
            <div className="mt-3 w-fit rounded-lg border bg-white px-3 py-2">
              <Image
                src="/um-logo.png"
                alt="Universiti Malaya"
                width={165}
                height={58}
                className="h-auto w-[165px]"
              />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              <Badge variant="success">
                <CheckCircle2Icon data-icon="inline-start" />
                Knowledge base ready
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
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        placeholder="Ask about programme requirements, academic rules, facilities, thesis submission, or industrial training."
                        disabled={chatMutation.isPending}
                      />
                      <InputGroupAddon align="block-end" className="border-t">
                        <div className="flex w-full items-center justify-between gap-2">
                          <FieldDescription>
                            {chatMutation.isError
                              ? getErrorMessage(chatMutation.error)
                              : "Answers are constrained to handbook evidence."}
                          </FieldDescription>
                          <InputGroupButton
                            type="submit"
                            variant="default"
                            size="sm"
                            disabled={!message.trim() || chatMutation.isPending}
                          >
                            {chatMutation.isPending ? (
                              <Spinner data-icon="inline-start" />
                            ) : (
                              <SendIcon data-icon="inline-start" />
                            )}
                            Ask
                          </InputGroupButton>
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
                Latest answers stay at the top for quick comparison.
              </CardDescription>
            </CardHeader>
            <CardContent className="min-h-0">
              <ScrollArea className="h-[calc(100dvh-25rem)] min-h-80">
                <div className="flex flex-col gap-3 pr-3">
                  {chatMutation.isPending ? <PendingTurn /> : null}
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
                    <article key={turn.id} className="flex flex-col gap-3">
                      <div className="ml-auto max-w-[82%] rounded-lg border bg-secondary px-3 py-2 text-sm">
                        {turn.question}
                      </div>
                      <Card size="sm" className="max-w-[92%]">
                        <CardHeader>
                          <CardTitle>Answer</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm leading-6">{turn.answer}</p>
                        </CardContent>
                      </Card>
                    </article>
                  ))}
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

function EvidencePanel({
  evidence,
  pending,
}: {
  evidence: Evidence[];
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
        defaultValue={evidence[0]?.kb_id ? [evidence[0].kb_id] : undefined}
      >
        {evidence.map((item) => (
          <AccordionItem key={item.kb_id} value={item.kb_id}>
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

function getErrorMessage(error: Error | null) {
  return error?.message ?? "Chat request failed.";
}

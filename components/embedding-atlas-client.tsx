"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  DatabaseIcon,
  FilterIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SearchIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  EmbeddingAtlasPayload,
  EmbeddingAtlasPoint,
} from "@/lib/embedding-atlas-data";

const EmbeddingAtlasView = dynamic(
  () =>
    import("@/components/embedding-atlas-view").then(
      (module) => module.EmbeddingAtlasView,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <LoaderCircleIcon className="mr-2 size-4 animate-spin" />
        Loading Apple Embedding Atlas
      </div>
    ),
  },
);

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; payload: EmbeddingAtlasPayload };

export function EmbeddingAtlasClient() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [mapMode, setMapMode] = useState<"density" | "points">("density");
  const [viewKey, setViewKey] = useState(0);
  const [activePointId, setActivePointId] = useState<number | null>(null);
  const [size, setSize] = useState({ width: 900, height: 620 });
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    let mounted = true;

    fetch("/api/embedding-atlas")
      .then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body?.error ?? "Unable to load embeddings.");
        }

        return body as EmbeddingAtlasPayload;
      })
      .then((payload) => {
        if (mounted) {
          setState({ status: "ready", payload });
        }
      })
      .catch((error) => {
        if (mounted) {
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Unable to load embeddings.",
          });
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;

      setSize({
        width: Math.max(320, Math.floor(rect.width)),
        height: Math.max(420, Math.floor(rect.height)),
      });
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const payload = state.status === "ready" ? state.payload : null;
  const visiblePoints = useMemo(() => {
    if (!payload) {
      return [];
    }

    return payload.points.filter((point) => {
      const scopeMatches =
        scopeFilter === "all" || point.scopeLabel === scopeFilter;
      const sectionMatches =
        sectionFilter === "all" || point.section === sectionFilter;

      return scopeMatches && sectionMatches;
    });
  }, [payload, scopeFilter, sectionFilter]);
  const popularSections = useMemo(() => {
    if (!payload) {
      return [];
    }

    const counts = new Map<string, number>();

    for (const point of payload.points) {
      counts.set(point.section, (counts.get(point.section) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 7);
  }, [payload]);
  const activePoint = useMemo(() => {
    if (activePointId === null) {
      return null;
    }

    return visiblePoints.find((point) => point.id === activePointId) ?? null;
  }, [activePointId, visiblePoints]);
  const searchResults = useMemo(() => {
    if (!payload) {
      return [];
    }

    const normalized = query.trim().toLowerCase();
    const source = visiblePoints.length > 0 ? visiblePoints : payload.points;

    if (!normalized) {
      return source.slice(0, 8);
    }

    return source
      .filter((point) =>
        [
          point.title,
          point.scopeLabel,
          point.sourceDoc,
          point.section,
          point.subsection,
          point.text,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalized),
      )
      .slice(0, 8);
  }, [payload, query, visiblePoints]);

  function clearFilters() {
    setQuery("");
    setScopeFilter("all");
    setSectionFilter("all");
    setActivePointId(null);
  }

  function resetMap() {
    setActivePointId(null);
    setViewKey((current) => current + 1);
  }

  return (
    <main className="grid h-dvh grid-rows-[auto_1fr] overflow-hidden bg-background text-foreground">
      <header className="flex min-h-16 items-center justify-between gap-4 border-b px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href="/" />}
          >
            <ArrowLeftIcon />
            <span className="sr-only">Back to chat</span>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">
              TensorTalk Embedding Atlas
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              Visual map of the local UM handbook vector index
            </p>
          </div>
        </div>
        {payload ? (
          <div className="hidden items-center gap-2 sm:flex">
            <Badge variant="outline">{payload.meta.pointCount} chunks</Badge>
            <Badge variant="outline">{payload.meta.dimension}D</Badge>
            <Badge variant="outline">{visiblePoints.length} visible</Badge>
          </div>
        ) : null}
      </header>

      <section className="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div ref={containerRef} className="min-h-0 p-3 sm:p-4">
          {state.status === "loading" ? (
            <div className="flex h-full items-center justify-center rounded-lg border bg-muted/20 text-sm text-muted-foreground">
              <LoaderCircleIcon className="mr-2 size-4 animate-spin" />
              Projecting handbook embeddings
            </div>
          ) : null}

          {state.status === "error" ? (
            <div className="flex h-full items-center justify-center rounded-lg border bg-muted/20 p-6">
              <div className="max-w-lg text-center">
                <AlertTriangleIcon className="mx-auto mb-3 size-6 text-destructive" />
                <h2 className="text-sm font-medium">
                  The embedding map could not load.
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {state.message}
                </p>
              </div>
            </div>
          ) : null}

          {payload && visiblePoints.length > 0 ? (
            <EmbeddingAtlasView
              payload={payload}
              points={visiblePoints}
              width={size.width}
              height={size.height}
              colorScheme={resolvedTheme === "dark" ? "dark" : "light"}
              mode={mapMode}
              viewKey={viewKey}
              onActivePoint={setActivePointId}
            />
          ) : null}

          {payload && visiblePoints.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-lg border bg-muted/20 p-6">
              <div className="max-w-sm text-center">
                <FilterIcon className="mx-auto mb-3 size-6 text-muted-foreground" />
                <h2 className="text-sm font-medium">No chunks match.</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Clear the current scope or section filter to bring the map
                  back.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="min-h-0 overflow-y-auto border-t p-3 sm:p-4 lg:border-t-0 lg:border-l">
          <div className="space-y-3">
            <Card size="sm">
              <CardHeader>
                <CardTitle>Explore</CardTitle>
                <CardDescription>
                  Filter clusters, switch map mode, or reset the view.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {payload ? (
                  <>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant={mapMode === "density" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setMapMode("density")}
                      >
                        <FilterIcon />
                        Contours
                      </Button>
                      <Button
                        type="button"
                        variant={mapMode === "points" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setMapMode("points")}
                      >
                        Dots
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label="Reset map view"
                        title="Reset map view"
                        onClick={resetMap}
                      >
                        <RotateCcwIcon />
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">
                        Scope
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant={scopeFilter === "all" ? "default" : "outline"}
                          size="xs"
                          onClick={() => setScopeFilter("all")}
                        >
                          All
                        </Button>
                        {payload.categories.map((category) => (
                          <Button
                            key={category.name}
                            type="button"
                            variant={
                              scopeFilter === category.name
                                ? "default"
                                : "outline"
                            }
                            size="xs"
                            onClick={() => setScopeFilter(category.name)}
                          >
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: category.color }}
                            />
                            {category.name}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">
                        Section jumps
                      </div>
                      <div className="grid gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSectionFilter("all")}
                          className="flex items-center justify-between rounded-lg border bg-background px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                        >
                          <span>All sections</span>
                          <span className="text-muted-foreground">
                            {payload.points.length}
                          </span>
                        </button>
                        {popularSections.map(([section, count]) => (
                          <button
                            key={section}
                            type="button"
                            onClick={() => setSectionFilter(section)}
                            className="flex items-center justify-between gap-2 rounded-lg border bg-background px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted data-[active=true]:border-foreground"
                            data-active={sectionFilter === section}
                          >
                            <span className="line-clamp-1">{section}</span>
                            <span className="text-muted-foreground">{count}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border bg-muted/30 p-2 text-xs text-muted-foreground">
                      Showing {visiblePoints.length} of {payload.points.length}{" "}
                      chunks. Nearby points mean similar embedding meaning.
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={clearFilters}
                    >
                      Clear filters
                    </Button>
                  </>
                ) : (
                  <div className="space-y-2">
                    <div className="h-4 w-2/3 rounded bg-muted" />
                    <div className="h-4 w-5/6 rounded bg-muted" />
                    <div className="h-4 w-3/4 rounded bg-muted" />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>Index</CardTitle>
                <CardDescription>
                  Existing semantic RAG vectors from SQLite.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {payload ? (
                  <>
                    <MetricRow label="Model" value={payload.meta.embeddingModel} />
                    <MetricRow label="Projection" value={payload.meta.projection} />
                    <MetricRow label="Built" value={formatBuiltAt(payload.meta.builtAt)} />
                    <MetricRow label="Source" value={payload.meta.sourceFile} />
                    <div className="flex flex-wrap gap-2 pt-1">
                      {payload.categories.map((category) => (
                        <span
                          key={category.name}
                          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                        >
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: category.color }}
                          />
                          {category.name} ({category.count})
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <div className="h-4 w-2/3 rounded bg-muted" />
                    <div className="h-4 w-5/6 rounded bg-muted" />
                    <div className="h-4 w-3/4 rounded bg-muted" />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>Inspect</CardTitle>
                <CardDescription>
                  Hover or click a point, or search the chunk metadata.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search title, section, source..."
                    className="pl-8"
                  />
                </div>

                {activePoint ? <PointPreview point={activePoint} /> : null}

                <div className="space-y-2">
                  {searchResults.map((point) => (
                    <button
                      key={point.id}
                      type="button"
                      onClick={() => setActivePointId(point.id)}
                      className="w-full rounded-lg border bg-background p-2 text-left text-xs transition-colors hover:bg-muted"
                    >
                      <div className="line-clamp-1 font-medium">{point.title}</div>
                      <div className="mt-1 line-clamp-1 text-muted-foreground">
                        {point.scopeLabel} / {point.section}
                      </div>
                    </button>
                  ))}
                  {payload && searchResults.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                      No matching chunks in the current filter.
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </div>
        </aside>
      </section>
    </main>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 text-xs">
      <div className="flex items-center gap-1 text-muted-foreground">
        <DatabaseIcon className="size-3" />
        {label}
      </div>
      <div className="break-words font-medium">{value}</div>
    </div>
  );
}

function PointPreview({ point }: { point: EmbeddingAtlasPoint }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-xs">
      <div className="font-medium">{point.title}</div>
      <div className="mt-1 text-muted-foreground">
        {point.sourceDoc} / {point.scopeLabel}
      </div>
      <div className="mt-2 text-muted-foreground">
        {point.section}
        {point.subsection ? ` / ${point.subsection}` : ""}
      </div>
      <p className="mt-2 line-clamp-6">{point.text}</p>
    </div>
  );
}

function formatBuiltAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

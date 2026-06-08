"use client";

import { EmbeddingView, type DataPoint } from "embedding-atlas/react";
import { useCallback, useMemo, useState } from "react";

import type { EmbeddingAtlasPayload } from "@/lib/embedding-atlas-data";

type EmbeddingAtlasViewProps = {
  payload: EmbeddingAtlasPayload;
  points: EmbeddingAtlasPayload["points"];
  height: number;
  width: number;
  colorScheme: "light" | "dark";
  mode: "density" | "points";
  viewKey: number;
  onActivePoint: (pointId: number | null) => void;
};

export function EmbeddingAtlasView({
  payload,
  points,
  height,
  width,
  colorScheme,
  mode,
  viewKey,
  onActivePoint,
}: EmbeddingAtlasViewProps) {
  const [tooltip, setTooltip] = useState<DataPoint | null>(null);
  const [selection, setSelection] = useState<DataPoint[] | null>(null);
  const [cursor, setCursor] = useState({ x: 16, y: 16 });

  const data = useMemo(
    () => ({
      x: new Float32Array(points.map((point) => point.x)),
      y: new Float32Array(points.map((point) => point.y)),
      category: new Uint8Array(points.map((point) => point.category)),
    }),
    [points],
  );
  const pointsById = useMemo(
    () => new Map(points.map((point) => [point.id, point])),
    [points],
  );

  const querySelection = useCallback(
    async (x: number, y: number, unitDistance: number) => {
      if (points.length === 0) {
        return null;
      }

      let closest = points[0];
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const point of points) {
        const distance = Math.hypot(point.x - x, point.y - y);

        if (distance < closestDistance) {
          closest = point;
          closestDistance = distance;
        }
      }

      if (!closest || closestDistance > unitDistance * 18) {
        return null;
      }

      return {
        x: closest.x,
        y: closest.y,
        category: closest.category,
        identifier: closest.id,
        text: closest.title,
        fields: {
          scope: closest.scopeLabel,
          section: closest.section,
          source: closest.sourceDoc,
        },
      };
    },
    [points],
  );

  function handleTooltipChange(nextTooltip: DataPoint | null) {
    setTooltip(nextTooltip);
    onActivePoint(pointId(nextTooltip));
  }

  function handleSelectionChange(nextSelection: DataPoint[] | null) {
    setSelection(nextSelection);
    onActivePoint(pointId(nextSelection?.[0] ?? null));
  }

  const activePoint =
    pointsById.get(pointId(selection?.[0] ?? tooltip) ?? Number.NaN) ?? null;

  return (
    <div
      className="relative h-full overflow-hidden rounded-lg border bg-background"
      onMouseLeave={() => {
        setTooltip(null);
        onActivePoint(pointId(selection?.[0]));
      }}
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();

        setCursor({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      }}
    >
      <EmbeddingView
        key={viewKey}
        data={data}
        width={width}
        height={height}
        categoryColors={payload.categories.map((category) => category.color)}
        labels={payload.labels}
        tooltip={tooltip}
        selection={selection}
        querySelection={querySelection}
        onTooltip={handleTooltipChange}
        onSelection={handleSelectionChange}
        config={{
          colorScheme,
          mode,
          minimumDensity: 0,
          pointSize: 3,
          autoLabelEnabled: false,
        }}
        theme={{
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          statusBar: true,
          brandingLink: null,
          clusterLabelColor: colorScheme === "dark" ? "#ffffff" : "#020617",
          clusterLabelOutlineColor:
            colorScheme === "dark" ? "#000000" : "#ffffff",
          clusterLabelOpacity: 1,
          statusBarBackgroundColor:
            colorScheme === "dark" ? "#020617" : "#ffffff",
          statusBarTextColor: colorScheme === "dark" ? "#cbd5e1" : "#475569",
        }}
      />
      {activePoint ? (
        <div
          className="pointer-events-none absolute z-10 max-w-72 rounded-md border bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
          style={{
            left: Math.min(cursor.x + 14, Math.max(14, width - 300)),
            top: Math.min(cursor.y + 14, Math.max(14, height - 120)),
          }}
        >
          <div className="line-clamp-2 font-medium text-foreground">
            {activePoint.title}
          </div>
          <div className="mt-1 line-clamp-1 text-muted-foreground">
            {activePoint.scopeLabel} / {activePoint.section}
          </div>
        </div>
      ) : null}
      {activePoint ? (
        <div className="pointer-events-none absolute right-3 bottom-3 max-w-sm rounded-lg border bg-background/95 p-3 text-xs shadow-lg backdrop-blur">
          <div className="font-medium text-foreground">{activePoint.title}</div>
          <div className="mt-1 text-muted-foreground">
            {activePoint.scopeLabel} / {activePoint.section}
          </div>
          <div className="mt-2 line-clamp-4 text-muted-foreground">
            {activePoint.text}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function pointId(point: DataPoint | null | undefined) {
  return typeof point?.identifier === "number" ? point.identifier : null;
}

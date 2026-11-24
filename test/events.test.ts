import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summarizeEvents } from "../src/k8s/events.ts";

// Real output captured from the cluster: 44 events for the shop namespace (frontend, checkout, payments, recommender).
const eventList = JSON.parse(readFileSync(new URL("./fixtures/events-shop.json", import.meta.url), "utf8"));

/** A minimal raw event, for tests that need a specific shape. */
const rawEvent = (over: Record<string, unknown>) => ({
  type: "Normal",
  reason: "Started",
  message: "Started container",
  count: 1,
  lastTimestamp: "2026-01-01T00:00:00Z",
  eventTime: null,
  involvedObject: { kind: "Pod", name: "p", namespace: "shop" },
  ...over,
});

describe("summarizeEvents", () => {
  it("keeps only type, reason, object, message, count and lastSeen for each event", () => {
    const summary = summarizeEvents(eventList);

    expect(summary.length).toBeGreaterThan(0);
    for (const e of summary) {
      expect(Object.keys(e).sort()).toEqual(["count", "lastSeen", "message", "object", "reason", "type"]);
      expect(Object.keys(e.object).sort()).toEqual(["kind", "name"]);
    }
  });

  it("reads the right facts: a scheduling warning for checkout", () => {
    const e = summarizeEvents(eventList).find(
      (x) => x.reason === "FailedScheduling" && x.object.name.startsWith("checkout-"),
    );

    expect(e).toMatchObject({ type: "Warning", object: { kind: "Pod" }, count: 1 });
  });

  it("keeps the cause of an image pull failure (payments): the missing tag", () => {
    const e = summarizeEvents(eventList).find((x) => x.reason === "Failed" && x.message.includes("alpne"));

    expect(e).toMatchObject({ type: "Warning", object: { kind: "Pod" } });
    expect(e?.object.name.startsWith("payments-")).toBe(true);
  });

  it("sorts oldest first, so the newest event is last", () => {
    const times = summarizeEvents(eventList).map((e) => Date.parse(e.lastSeen as string));

    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("uses eventTime when lastTimestamp is missing, and still sorts correctly", () => {
    const summary = summarizeEvents({
      items: [
        rawEvent({ message: "newer", lastTimestamp: null, eventTime: "2026-01-01T00:00:10Z" }),
        rawEvent({ message: "older", lastTimestamp: "2026-01-01T00:00:05Z" }),
      ],
    });

    expect(summary.map((e) => e.message)).toEqual(["older", "newer"]);
    expect(summary[1]?.lastSeen).toBe("2026-01-01T00:00:10Z");
  });

  it("shortens a very long message", () => {
    const [e] = summarizeEvents({ items: [rawEvent({ message: "x".repeat(5000) })] });

    expect((e?.message ?? "").length).toBeLessThanOrEqual(1000);
  });

  it("returns at most the 50 newest events", () => {
    const items = Array.from({ length: 300 }, (_, i) =>
      rawEvent({ message: `event ${i}`, lastTimestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }),
    );

    const summary = summarizeEvents({ items });

    expect(summary.length).toBeLessThanOrEqual(50);
    expect(summary.at(-1)?.message).toBe("event 299"); // the newest is kept, and is last
    expect(summary.map((e) => e.message)).not.toContain("event 0"); // the oldest is dropped
  });

  it("treats an event with no time at all as the oldest: it is placed first", () => {
    const summary = summarizeEvents({
      items: [
        rawEvent({ message: "dated 10", lastTimestamp: "2026-01-01T00:00:10Z" }),
        rawEvent({ message: "no time", lastTimestamp: null, eventTime: null }),
        rawEvent({ message: "dated 05", lastTimestamp: "2026-01-01T00:00:05Z" }),
      ],
    });

    expect(summary.map((e) => e.message)).toEqual(["no time", "dated 05", "dated 10"]);
    expect(summary[0]?.lastSeen).toBeNull();
  });

  it("drops an event with no time before any event that has one, when over the cap", () => {
    const dated = Array.from({ length: 50 }, (_, i) =>
      rawEvent({ message: `dated ${i}`, lastTimestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }),
    );
    const noTime = rawEvent({ message: "no time", lastTimestamp: null, eventTime: null });

    const summary = summarizeEvents({ items: [noTime, ...dated] });

    expect(summary).toHaveLength(50);
    expect(summary.map((e) => e.message)).not.toContain("no time");
  });

  it("prefers series.lastObservedTime over lastTimestamp for a repeated event", () => {
    const [e] = summarizeEvents({
      items: [
        rawEvent({
          lastTimestamp: "2026-01-01T00:00:05Z",
          series: { lastObservedTime: "2026-01-01T00:00:30Z" },
        }),
      ],
    });

    expect(e?.lastSeen).toBe("2026-01-01T00:00:30Z");
  });
});

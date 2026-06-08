import type {
  ChatResponse,
  ChatStage,
  HarnessMode,
  RetrievalMode,
  ThinkingMode,
  WebMode,
  WebTrustMode,
} from "@/lib/chat";

export type StoredTurn = ChatResponse & {
  id: string;
  question: string;
  streaming?: boolean;
  error?: string;
  stages?: ChatStage[];
  settings: {
    retrievalMode: RetrievalMode;
    webMode: WebMode;
    webTrustMode?: WebTrustMode;
    harnessMode?: HarnessMode;
    thinkingMode?: ThinkingMode;
  };
};

export type StoredThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  selectedTurnId?: string;
  turns: StoredTurn[];
};

const DB_NAME = "tensortalk_threads";
const DB_VERSION = 1;
const THREAD_STORE = "threads";
const LEGACY_INTERRUPTED_RESPONSE_ERROR =
  "Response was interrupted before completion.";
const RECOVERED_INTERRUPTED_RESPONSE_ERROR =
  "Answer did not finish before the page was closed or refreshed.";

export async function listThreads() {
  const db = await openThreadDb();

  return new Promise<StoredThread[]>((resolve, reject) => {
    const request = db
      .transaction(THREAD_STORE, "readonly")
      .objectStore(THREAD_STORE)
      .getAll();

    request.onsuccess = () => {
      resolve(
        (request.result as StoredThread[])
          .map(normalizeThread)
          .sort((left, right) => right.updatedAt - left.updatedAt),
      );
    };
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

export async function saveThread(thread: StoredThread) {
  const db = await openThreadDb();

  return new Promise<void>((resolve, reject) => {
    const request = db
      .transaction(THREAD_STORE, "readwrite")
      .objectStore(THREAD_STORE)
      .put(compactThread(thread));

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

export async function deleteThread(threadId: string) {
  const db = await openThreadDb();

  return new Promise<void>((resolve, reject) => {
    const request = db
      .transaction(THREAD_STORE, "readwrite")
      .objectStore(THREAD_STORE)
      .delete(threadId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

function openThreadDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(THREAD_STORE)) {
        db.createObjectStore(THREAD_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function normalizeThread(thread: StoredThread): StoredThread {
  return {
    ...thread,
    turns: thread.turns.map((turn) => ({
      ...turn,
      error:
        turn.error === LEGACY_INTERRUPTED_RESPONSE_ERROR
          ? RECOVERED_INTERRUPTED_RESPONSE_ERROR
          : turn.error,
    })),
  };
}

function compactThread(thread: StoredThread): StoredThread {
  return {
    ...thread,
    turns: thread.turns.map((turn) => ({
      ...turn,
      streaming: false,
      error: turn.streaming
        ? (turn.error ?? RECOVERED_INTERRUPTED_RESPONSE_ERROR)
        : turn.error,
      evidence: turn.evidence.map((item) => ({
        ...item,
        source_text: item.source_text?.slice(0, 1200),
      })),
      trace: turn.trace
        ? {
            ...turn.trace,
            acceptedEvidence: turn.trace.acceptedEvidence.map((item) => ({
              ...item,
              source_text: item.source_text?.slice(0, 1200),
            })),
          }
        : undefined,
    })),
  };
}

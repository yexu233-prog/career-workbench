import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveStatus } from "@career-workbench/domain";
import { RevisionConflictError } from "@career-workbench/database";
import { storageErrorMessage } from "../services/user-errors";

interface RevisionedDraft {
  revision: number;
}

export interface AutosavedDraft<T> {
  draft: T;
  updateDraft: (updater: (current: T) => T) => void;
  savedRevision: number;
  acceptSavedRevision: (revision: number) => void;
  status: SaveStatus;
  errorMessage: string;
  flush: () => Promise<void>;
}

export function useAutosavedDraft<T extends RevisionedDraft>(
  source: T,
  save: (draft: T, expectedRevision: number) => Promise<T>,
  onStatusChange?: (status: SaveStatus) => void
): AutosavedDraft<T> {
  const [draft, setDraft] = useState(source);
  const [savedRevision, setSavedRevision] = useState(source.revision);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const draftRef = useRef(source);
  const revisionRef = useRef(source.revision);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const blockedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  const statusCallbackRef = useRef(onStatusChange);

  saveRef.current = save;
  statusCallbackRef.current = onStatusChange;

  const publishStatus = useCallback((nextStatus: SaveStatus) => {
    setStatus(nextStatus);
    statusCallbackRef.current?.(nextStatus);
  }, []);

  const persist = useCallback(async (): Promise<void> => {
    if (!dirtyRef.current || savingRef.current || blockedRef.current) return;
    savingRef.current = true;
    dirtyRef.current = false;
    publishStatus("saving");
    try {
      const saved = await saveRef.current(draftRef.current, revisionRef.current);
      revisionRef.current = saved.revision;
      setSavedRevision(saved.revision);
      setErrorMessage("");
      publishStatus(dirtyRef.current ? "saving" : "saved");
    } catch (error) {
      dirtyRef.current = true;
      if (error instanceof RevisionConflictError) {
        blockedRef.current = true;
        setErrorMessage("内容已在其他窗口修改，请重新打开此页面后继续。");
        publishStatus("conflict");
      } else {
        setErrorMessage(storageErrorMessage(error));
        publishStatus("failed");
      }
    } finally {
      savingRef.current = false;
      if (dirtyRef.current && !blockedRef.current) {
        timerRef.current = setTimeout(() => void persist(), 600);
      }
    }
  }, [publishStatus]);

  const updateDraft = useCallback((updater: (current: T) => T) => {
    setDraft((current) => {
      const next = updater(current);
      draftRef.current = next;
      return next;
    });
    dirtyRef.current = true;
    blockedRef.current = false;
    setErrorMessage("");
    publishStatus("saving");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void persist(), 600);
  }, [persist, publishStatus]);

  const acceptSavedRevision = useCallback((revision: number) => {
    revisionRef.current = revision;
    setSavedRevision(revision);
  }, []);

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") void persist();
    };
    document.addEventListener("visibilitychange", flushWhenHidden);
    window.addEventListener("blur", persist);
    return () => {
      document.removeEventListener("visibilitychange", flushWhenHidden);
      window.removeEventListener("blur", persist);
      if (timerRef.current) clearTimeout(timerRef.current);
      void persist();
    };
  }, [persist]);

  return { draft, updateDraft, savedRevision, acceptSavedRevision, status, errorMessage, flush: persist };
}


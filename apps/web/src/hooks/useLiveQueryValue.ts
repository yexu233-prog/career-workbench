import { useEffect, useState, type DependencyList } from "react";
import { liveQuery } from "@career-workbench/database";

export interface LiveQueryState<T> {
  value: T | undefined;
  loading: boolean;
  error: Error | undefined;
}

export function useLiveQueryValue<T>(query: () => Promise<T> | T, dependencies: DependencyList): LiveQueryState<T> {
  const [state, setState] = useState<LiveQueryState<T>>({ value: undefined, loading: true, error: undefined });

  useEffect(() => {
    setState((current) => ({ ...current, loading: true, error: undefined }));
    const subscription = liveQuery(query).subscribe({
      next: (value) => setState({ value, loading: false, error: undefined }),
      error: (error: unknown) => setState({
        value: undefined,
        loading: false,
        error: error instanceof Error ? error : new Error("读取本机数据失败")
      })
    });
    return () => subscription.unsubscribe();
  }, dependencies);

  return state;
}


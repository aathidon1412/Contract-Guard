import { useEffect, useMemo, useState } from "react";

import { getAIStatus } from "../api/aiApi";

interface AIStatusState {
  available: boolean;
  model: string;
  modelLoaded: boolean;
  loading: boolean;
  url: string;
  backendReachable: boolean;
  statusMessage: "Ready" | "Offline" | "Model not loaded" | "Checking..." | "API server unreachable";
}

const DEFAULT_MODEL = "qwen2.5-coder:32b";
const DEFAULT_URL = "http://localhost:11434";

export const useAIStatus = (): AIStatusState => {
  const [available, setAvailable] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [url, setUrl] = useState(DEFAULT_URL);
  const [loading, setLoading] = useState(true);
  const [backendReachable, setBackendReachable] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const fetchStatus = async () => {
      try {
        const status = await getAIStatus();
        if (!isMounted) {
          return;
        }

        setAvailable(status.available);
        setModelLoaded(status.modelLoaded);
        setModel(status.model || DEFAULT_MODEL);
        setUrl(status.url || DEFAULT_URL);
        setBackendReachable(true);
      } catch {
        if (!isMounted) {
          return;
        }

        setAvailable(false);
        setModelLoaded(false);
        setBackendReachable(false);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void fetchStatus();
    const intervalId = window.setInterval(() => {
      void fetchStatus();
    }, 30000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const statusMessage = useMemo<AIStatusState["statusMessage"]>(() => {
    if (loading) {
      return "Checking...";
    }

    if (!backendReachable) {
      return "API server unreachable";
    }

    if (!available) {
      return "Offline";
    }

    if (!modelLoaded) {
      return "Model not loaded";
    }

    return "Ready";
  }, [available, backendReachable, loading, modelLoaded]);

  return {
    available,
    model,
    modelLoaded,
    loading,
    url,
    backendReachable,
    statusMessage,
  };
};

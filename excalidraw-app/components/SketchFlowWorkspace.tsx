import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  base64ToString,
  decode,
  encode,
  stringToBase64,
} from "@excalidraw/excalidraw/data/encode";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { exportToBlob, MIME_TYPES } from "@excalidraw/utils/export";

import "./SketchFlowWorkspace.scss";

type SketchFlowComment = {
  id: string;
  text: string;
  createdAt: number;
};

type SketchFlowScene = {
  id: string;
  name: string;
  collection: string;
  createdAt: number;
  updatedAt: number;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
  comments?: SketchFlowComment[];
};

type SceneDraft = Omit<SketchFlowScene, "id" | "createdAt" | "updatedAt">;

const DB_NAME = "sketchflow-workspace";
const DB_VERSION = 1;
const SCENE_STORE = "scenes";
const ACTIVE_SCENE_KEY = "sketchflow-workspace-active-scene";
const DEFAULT_COLLECTION = "Personal";
const SHARE_PARAM = "sf_scene";
const READONLY_PARAM = "sf_readonly";
const PRESENTATION_PARAM = "sf_present";

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SCENE_STORE)) {
        const store = db.createObjectStore(SCENE_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
        store.createIndex("collection", "collection");
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

const runStore = async <T,>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
) => {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(SCENE_STORE, mode);
    const request = callback(transaction.objectStore(SCENE_STORE));

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
};

const listScenes = async () => {
  const scenes = await runStore<SketchFlowScene[]>("readonly", (store) =>
    store.getAll(),
  );
  return scenes.sort((a, b) => b.updatedAt - a.updatedAt);
};

const getScene = (id: string) =>
  runStore<SketchFlowScene | undefined>("readonly", (store) => store.get(id));

const putScene = (scene: SketchFlowScene) =>
  runStore<IDBValidKey>("readwrite", (store) => store.put(scene));

const deleteScene = (id: string) =>
  runStore<undefined>("readwrite", (store) => store.delete(id));

const createId = () =>
  `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const toUrlSafeBase64 = (base64: string) =>
  base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const fromUrlSafeBase64 = (base64url: string) =>
  base64url
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), "=");

const encodeSceneForUrl = (scene: SceneDraft) => {
  const encoded = encode({
    text: JSON.stringify({ version: 1, scene }),
  });
  return toUrlSafeBase64(stringToBase64(JSON.stringify(encoded)));
};

const decodeSceneFromUrl = (payload: string): SceneDraft => {
  const encoded = JSON.parse(base64ToString(fromUrlSafeBase64(payload)));
  return JSON.parse(decode(encoded)).scene;
};

const copyText = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
};

const getSceneDraft = (api: ExcalidrawImperativeAPI): SceneDraft => ({
  name: api.getName() || "Untitled scene",
  collection: DEFAULT_COLLECTION,
  elements: [...api.getSceneElementsIncludingDeleted()],
  appState: {
    ...api.getAppState(),
    collaborators: undefined,
    openDialog: null,
    isLoading: false,
    errorMessage: null,
  },
  files: api.getFiles(),
});

export const SketchFlowWorkspace = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [scenes, setScenes] = useState<SketchFlowScene[]>([]);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_SCENE_KEY),
  );
  const [collectionFilter, setCollectionFilter] = useState("All");
  const [searchText, setSearchText] = useState("");
  const [status, setStatus] = useState("Workspace ready");
  const [toastMessage, setToastMessage] = useState("");
  const autosaveTimerRef = useRef<number | null>(null);
  const loadedSharedSceneRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);
  const isReadonlyLink = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get(READONLY_PARAM) === "1";
  }, []);

  const notify = useCallback(
    (message: string) => {
      setStatus(message);
      setToastMessage(message);
      excalidrawAPI.setToast({ message });

      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setToastMessage("");
      }, 2200);
    },
    [excalidrawAPI],
  );

  const refreshScenes = useCallback(async () => {
    setScenes(await listScenes());
  }, []);

  useEffect(() => {
    refreshScenes().catch((error) => {
      console.error(error);
      setStatus("Workspace could not load");
    });
  }, [refreshScenes]);

  useEffect(() => {
    if (!isReadonlyLink) {
      return;
    }

    const enforceReadonly = () => {
      const appState = excalidrawAPI.getAppState();
      excalidrawAPI.updateScene({
        appState: {
          viewModeEnabled: true,
          activeTool: {
            ...appState.activeTool,
            type: "selection",
            locked: false,
          },
        } as any,
      });
    };

    enforceReadonly();
    return excalidrawAPI.onStateChange(
      (appState) => ({
        activeToolType: appState.activeTool.type,
        viewModeEnabled: appState.viewModeEnabled,
      }),
      (state) => {
        if (!state.viewModeEnabled || state.activeToolType !== "selection") {
          enforceReadonly();
        }
      },
    );
  }, [excalidrawAPI, isReadonlyLink]);

  useEffect(() => {
    if (loadedSharedSceneRef.current) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const sharedScene = params.get(SHARE_PARAM);
    if (!sharedScene) {
      return;
    }

    loadedSharedSceneRef.current = true;
    try {
      const scene = decodeSceneFromUrl(sharedScene);
      excalidrawAPI.resetScene();
      excalidrawAPI.addFiles(Object.values(scene.files) as any);
      excalidrawAPI.updateScene({
        elements: scene.elements as any,
        appState: {
          ...scene.appState,
          name: scene.name,
          viewModeEnabled:
            params.get(READONLY_PARAM) === "1" ||
            params.get(PRESENTATION_PARAM) === "1",
          zenModeEnabled: params.get(PRESENTATION_PARAM) === "1",
          frameRendering:
            params.get(PRESENTATION_PARAM) === "1"
              ? {
                  enabled: true,
                  outline: true,
                  name: true,
                  clip: true,
                }
              : scene.appState.frameRendering,
          openDialog: null,
          isLoading: false,
        } as any,
      });
      excalidrawAPI.history.clear();
      setStatus(
        params.get(PRESENTATION_PARAM) === "1"
          ? "Opened presentation link"
          : params.get(READONLY_PARAM) === "1"
          ? "Opened readonly shared scene"
          : "Opened shared scene",
      );
    } catch (error) {
      console.error(error);
      setStatus("Shared scene link could not open");
    }
  }, [excalidrawAPI]);

  const saveScene = useCallback(
    async (options?: { duplicate?: boolean; collection?: string }) => {
      const now = Date.now();
      const existing =
        !options?.duplicate && activeSceneId
          ? await getScene(activeSceneId)
          : undefined;
      const draft = getSceneDraft(excalidrawAPI);
      const scene: SketchFlowScene = {
        ...draft,
        collection:
          options?.collection || existing?.collection || draft.collection,
        id: existing?.id || createId(),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        comments: existing?.comments || [],
      };

      await putScene(scene);
      localStorage.setItem(ACTIVE_SCENE_KEY, scene.id);
      setActiveSceneId(scene.id);
      setStatus(`Saved ${scene.name}`);
      await refreshScenes();
      return scene;
    },
    [activeSceneId, excalidrawAPI, refreshScenes],
  );

  useEffect(() => {
    if (isReadonlyLink) {
      return;
    }

    const unsubscribe = excalidrawAPI.onChange(() => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
      autosaveTimerRef.current = window.setTimeout(() => {
        saveScene().catch((error) => {
          console.error(error);
          setStatus("Autosave failed");
        });
      }, 1500);
    });

    return () => {
      unsubscribe();
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [excalidrawAPI, saveScene]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const openScene = async (id: string) => {
    const scene = await getScene(id);
    if (!scene) {
      setStatus("Scene was not found");
      return;
    }

    excalidrawAPI.resetScene();
    excalidrawAPI.addFiles(Object.values(scene.files) as any);
    excalidrawAPI.updateScene({
      elements: scene.elements as any,
      appState: {
        ...scene.appState,
        name: scene.name,
        openDialog: null,
        isLoading: false,
      } as any,
    });
    excalidrawAPI.history.clear();
    localStorage.setItem(ACTIVE_SCENE_KEY, scene.id);
    setActiveSceneId(scene.id);
    setIsOpen(false);
    setStatus(`Opened ${scene.name}`);
  };

  const removeScene = async (id: string) => {
    await deleteScene(id);
    if (activeSceneId === id) {
      localStorage.removeItem(ACTIVE_SCENE_KEY);
      setActiveSceneId(null);
    }
    await refreshScenes();
    setStatus("Scene deleted");
  };

  const renameScene = async (scene: SketchFlowScene) => {
    const nextName = window.prompt("Scene name", scene.name)?.trim();
    if (!nextName) {
      return;
    }
    await putScene({ ...scene, name: nextName, updatedAt: Date.now() });
    await refreshScenes();
    setStatus("Scene renamed");
  };

  const moveScene = async (scene: SketchFlowScene) => {
    const nextCollection = window
      .prompt("Collection", scene.collection || DEFAULT_COLLECTION)
      ?.trim();
    if (!nextCollection) {
      return;
    }
    await putScene({
      ...scene,
      collection: nextCollection,
      updatedAt: Date.now(),
    });
    await refreshScenes();
    setStatus("Collection updated");
  };

  const addComment = async (scene: SketchFlowScene) => {
    const text = window.prompt("Comment")?.trim();
    if (!text) {
      return;
    }
    await putScene({
      ...scene,
      comments: [
        ...(scene.comments || []),
        { id: createId(), text, createdAt: Date.now() },
      ],
      updatedAt: Date.now(),
    });
    await refreshScenes();
    setStatus("Comment added");
  };

  const copyReadonlyLink = async () => {
    const draft = getSceneDraft(excalidrawAPI);
    const payload = encodeSceneForUrl(draft);
    const url = `${window.location.origin}${window.location.pathname}?${READONLY_PARAM}=1&${SHARE_PARAM}=${payload}`;
    await copyText(url);
    notify(
      url.length > 7500
        ? "Readonly link copied, but this scene may be too large for some browsers"
        : "Readonly link copied",
    );
  };

  const copyEditableLink = async () => {
    const draft = getSceneDraft(excalidrawAPI);
    const payload = encodeSceneForUrl(draft);
    const url = `${window.location.origin}${window.location.pathname}?${SHARE_PARAM}=${payload}`;
    await copyText(url);
    notify(
      url.length > 7500
        ? "Editable link copied, but this scene may be too large for some browsers"
        : "Editable link copied",
    );
  };

  const copyPresentationLink = async () => {
    const draft = getSceneDraft(excalidrawAPI);
    const payload = encodeSceneForUrl(draft);
    const url = `${window.location.origin}${window.location.pathname}?${READONLY_PARAM}=1&${PRESENTATION_PARAM}=1&${SHARE_PARAM}=${payload}`;
    await copyText(url);
    notify(
      url.length > 7500
        ? "Presentation link copied, but this scene may be too large for some browsers"
        : "Presentation link copied",
    );
  };

  const copyEmbedCode = async () => {
    const draft = getSceneDraft(excalidrawAPI);
    const payload = encodeSceneForUrl(draft);
    const url = `${window.location.origin}${window.location.pathname}?${READONLY_PARAM}=1&${SHARE_PARAM}=${payload}`;
    await copyText(
      `<iframe src="${url}" width="100%" height="600" style="border:0;" title="SketchFlow scene"></iframe>`,
    );
    notify("Embed code copied");
  };

  const startPresentationMode = () => {
    excalidrawAPI.updateScene({
      appState: {
        viewModeEnabled: true,
        zenModeEnabled: true,
        frameRendering: {
          enabled: true,
          outline: true,
          name: true,
          clip: true,
        },
      } as any,
    });
    setStatus("Presentation view enabled");
  };

  const printToPdf = async () => {
    const draft = getSceneDraft(excalidrawAPI);
    setIsOpen(false);
    setStatus("Preparing PDF print view");

    try {
      const blob = await exportToBlob({
        elements: draft.elements as any,
        appState: {
          ...draft.appState,
          exportBackground: true,
          viewModeEnabled: true,
        } as any,
        files: draft.files as any,
        mimeType: MIME_TYPES.png,
        exportPadding: 32,
        maxWidthOrHeight: 2600,
      });
      const objectUrl = URL.createObjectURL(blob);
      const printWindow = window.open("", "_blank");

      if (!printWindow) {
        URL.revokeObjectURL(objectUrl);
        notify("Popup blocked. Allow popups to print PDF.");
        return;
      }

      printWindow.document.write(`<!doctype html>
<html>
<head>
  <title>${draft.name}</title>
  <style>
    html,
    body {
      margin: 0;
      min-height: 100%;
      background: #fff;
    }
    body {
      display: grid;
      place-items: center;
    }
    img {
      display: block;
      max-width: 100%;
      max-height: 100vh;
      object-fit: contain;
    }
    @page {
      margin: 12mm;
    }
  </style>
</head>
<body>
  <img src="${objectUrl}" alt="${draft.name.replace(/"/g, "&quot;")}" />
  <script>
    const image = document.querySelector("img");
    image.addEventListener("load", () => {
      window.focus();
      window.print();
    });
  </script>
</body>
</html>`);
      printWindow.document.close();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      notify("PDF print view opened");
    } catch (error) {
      console.error(error);
      notify("PDF print view failed");
    }
  };

  const collections = useMemo(
    () => ["All", ...Array.from(new Set(scenes.map((scene) => scene.collection)))],
    [scenes],
  );
  const visibleScenes = scenes.filter((scene) => {
    const matchesCollection =
      collectionFilter === "All" || scene.collection === collectionFilter;
    const needle = searchText.trim().toLowerCase();
    const matchesSearch =
      !needle ||
      scene.name.toLowerCase().includes(needle) ||
      scene.collection.toLowerCase().includes(needle) ||
      (scene.comments || []).some((comment) =>
        comment.text.toLowerCase().includes(needle),
      );

    return matchesCollection && matchesSearch;
  });

  return (
    <>
      <button
        className="SketchFlowWorkspace__trigger"
        type="button"
        onClick={() => setIsOpen(true)}
      >
        Workspace
      </button>
      <div className="SketchFlowWorkspace__status">{status}</div>
      {toastMessage && (
        <div className="SketchFlowWorkspace__toast" role="status">
          {toastMessage}
        </div>
      )}
      {isOpen && (
        <div className="SketchFlowWorkspace" role="dialog" aria-modal="true">
          <div className="SketchFlowWorkspace__panel">
            <header className="SketchFlowWorkspace__header">
              <div>
                <h2>SketchFlow Workspace</h2>
                <p>{scenes.length} saved scenes</p>
              </div>
              <button type="button" onClick={() => setIsOpen(false)}>
                Close
              </button>
            </header>
            <div className="SketchFlowWorkspace__toolbar">
              <button type="button" onClick={() => saveScene()}>
                Save current scene
              </button>
              <button type="button" onClick={() => saveScene({ duplicate: true })}>
                Duplicate to workspace
              </button>
              <button type="button" onClick={copyEditableLink}>
                Copy editable link
              </button>
              <button type="button" onClick={copyReadonlyLink}>
                Copy readonly link
              </button>
              <button type="button" onClick={copyPresentationLink}>
                Copy presentation link
              </button>
              <button type="button" onClick={copyEmbedCode}>
                Copy embed code
              </button>
              <button type="button" onClick={startPresentationMode}>
                Presentation view
              </button>
              <button type="button" onClick={printToPdf}>
                Print / PDF
              </button>
            </div>
            <div className="SketchFlowWorkspace__filters">
              <input
                type="search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search scenes, collections, comments"
              />
              <select
                value={collectionFilter}
                onChange={(event) => setCollectionFilter(event.target.value)}
              >
                {collections.map((collection) => (
                  <option key={collection} value={collection}>
                    {collection}
                  </option>
                ))}
              </select>
            </div>
            <div className="SketchFlowWorkspace__list">
              {visibleScenes.length === 0 && (
                <div className="SketchFlowWorkspace__empty">
                  No saved scenes in this collection.
                </div>
              )}
              {visibleScenes.map((scene) => (
                <article
                  className="SketchFlowWorkspace__scene"
                  key={scene.id}
                  data-active={scene.id === activeSceneId}
                >
                  <div>
                    <h3>{scene.name}</h3>
                    <p>
                      {scene.collection} -{" "}
                      {new Date(scene.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="SketchFlowWorkspace__actions">
                    <button type="button" onClick={() => openScene(scene.id)}>
                      Open
                    </button>
                    <button type="button" onClick={() => renameScene(scene)}>
                      Rename
                    </button>
                    <button type="button" onClick={() => moveScene(scene)}>
                      Collection
                    </button>
                    <button type="button" onClick={() => addComment(scene)}>
                      Comment
                    </button>
                    <button
                      type="button"
                      onClick={() => removeScene(scene.id)}
                    >
                      Delete
                    </button>
                  </div>
                  {(scene.comments || []).length > 0 && (
                    <div className="SketchFlowWorkspace__comments">
                      {(scene.comments || []).slice(-2).map((comment) => (
                        <p key={comment.id}>{comment.text}</p>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

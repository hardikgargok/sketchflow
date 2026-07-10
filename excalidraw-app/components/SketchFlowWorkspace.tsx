import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import "./SketchFlowWorkspace.scss";

type SketchFlowScene = {
  id: string;
  name: string;
  collection: string;
  createdAt: number;
  updatedAt: number;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

type SceneDraft = Omit<SketchFlowScene, "id" | "createdAt" | "updatedAt">;

const DB_NAME = "sketchflow-workspace";
const DB_VERSION = 1;
const SCENE_STORE = "scenes";
const ACTIVE_SCENE_KEY = "sketchflow-workspace-active-scene";
const DEFAULT_COLLECTION = "Personal";

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
  const [status, setStatus] = useState("Workspace ready");
  const autosaveTimerRef = useRef<number | null>(null);

  const refreshScenes = useCallback(async () => {
    setScenes(await listScenes());
  }, []);

  useEffect(() => {
    refreshScenes().catch((error) => {
      console.error(error);
      setStatus("Workspace could not load");
    });
  }, [refreshScenes]);

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
      };

      await putScene(scene);
      localStorage.setItem(ACTIVE_SCENE_KEY, scene.id);
      setActiveSceneId(scene.id);
      setStatus(`Saved ${scene.name}`);
      await refreshScenes();
    },
    [activeSceneId, excalidrawAPI, refreshScenes],
  );

  useEffect(() => {
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

  const collections = useMemo(
    () => ["All", ...Array.from(new Set(scenes.map((scene) => scene.collection)))],
    [scenes],
  );
  const visibleScenes =
    collectionFilter === "All"
      ? scenes
      : scenes.filter((scene) => scene.collection === collectionFilter);

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
                    <button
                      type="button"
                      onClick={() => removeScene(scene.id)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

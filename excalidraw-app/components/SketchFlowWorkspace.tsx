import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  base64ToString,
  decode,
  encode,
  stringToBase64,
} from "@excalidraw/excalidraw/data/encode";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { convertToExcalidrawElements } from "@excalidraw/element";
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

const WORKSPACE_BACKUP_VERSION = 1;

type SketchFlowTemplate = {
  id: string;
  name: string;
  collection: string;
  description: string;
  elements: any[];
};

type VoteState = {
  active: boolean;
  revealed: boolean;
  limit: number;
  votes: Record<string, number>;
};

const TEMPLATE_STROKE = "#1e1e1e";
const TEMPLATE_FILL = "#f1f3f5";

const createTemplateText = (
  text: string,
  x: number,
  y: number,
  fontSize = 24,
) => ({
  type: "text",
  x,
  y,
  text,
  fontSize,
  strokeColor: "#1d1458",
});

const templates: SketchFlowTemplate[] = [
  {
    id: "brainstorm",
    name: "Brainstorm Board",
    collection: "Templates",
    description: "Idea zones, voting lane, and decision area.",
    elements: [
      { type: "frame", id: "brainstorm-frame", x: -80, y: -80, width: 1180, height: 720, name: "Brainstorm", children: [] },
      createTemplateText("Brainstorm", 0, 0, 36),
      ...["Ideas", "Questions", "Risks", "Decisions"].flatMap((title, index) => {
        const x = 0 + index * 260;
        return [
          {
            type: "rectangle",
            id: `brainstorm-box-${index}`,
            x,
            y: 90,
            width: 220,
            height: 420,
            backgroundColor: ["#fff3bf", "#d0ebff", "#ffd8a8", "#d3f9d8"][index],
            fillStyle: "solid",
            strokeColor: TEMPLATE_STROKE,
          },
          createTemplateText(title, x + 24, 118, 22),
        ];
      }),
      createTemplateText("Vote on the strongest ideas, then move winners to Decisions.", 0, 570, 20),
    ],
  },
  {
    id: "kanban",
    name: "Kanban Board",
    collection: "Templates",
    description: "To do, doing, review, and done workflow.",
    elements: [
      { type: "frame", id: "kanban-frame", x: -80, y: -80, width: 1180, height: 720, name: "Kanban", children: [] },
      createTemplateText("Kanban", 0, 0, 36),
      ...["To do", "Doing", "Review", "Done"].flatMap((title, index) => {
        const x = 0 + index * 260;
        return [
          {
            type: "rectangle",
            id: `kanban-col-${index}`,
            x,
            y: 90,
            width: 220,
            height: 470,
            backgroundColor: TEMPLATE_FILL,
            fillStyle: "solid",
            strokeColor: TEMPLATE_STROKE,
          },
          createTemplateText(title, x + 24, 118, 22),
          {
            type: "rectangle",
            x: x + 24,
            y: 175,
            width: 172,
            height: 74,
            backgroundColor: "#fff3bf",
            fillStyle: "solid",
            strokeColor: "#e67700",
            label: { text: "Task" },
          },
        ];
      }),
    ],
  },
  {
    id: "retrospective",
    name: "Retrospective",
    collection: "Templates",
    description: "What worked, what was hard, and actions.",
    elements: [
      { type: "frame", id: "retro-frame", x: -80, y: -80, width: 1020, height: 690, name: "Retro", children: [] },
      createTemplateText("Retrospective", 0, 0, 36),
      ...["Went well", "Could improve", "Action items"].flatMap((title, index) => {
        const x = 0 + index * 300;
        return [
          {
            type: "rectangle",
            id: `retro-box-${index}`,
            x,
            y: 100,
            width: 260,
            height: 420,
            backgroundColor: ["#d3f9d8", "#ffe3e3", "#d0ebff"][index],
            fillStyle: "solid",
            strokeColor: TEMPLATE_STROKE,
          },
          createTemplateText(title, x + 24, 130, 23),
        ];
      }),
    ],
  },
  {
    id: "lesson",
    name: "Lesson Plan",
    collection: "Templates",
    description: "Objective, notes, activity, and homework.",
    elements: [
      { type: "frame", id: "lesson-frame", x: -80, y: -80, width: 1080, height: 720, name: "Lesson Plan", children: [] },
      createTemplateText("Lesson Plan", 0, 0, 36),
      { type: "rectangle", x: 0, y: 90, width: 920, height: 90, backgroundColor: "#d0ebff", fillStyle: "solid", label: { text: "Learning objective" } },
      { type: "rectangle", x: 0, y: 220, width: 440, height: 300, backgroundColor: "#fff3bf", fillStyle: "solid", label: { text: "Teacher notes" } },
      { type: "rectangle", x: 480, y: 220, width: 440, height: 300, backgroundColor: "#d3f9d8", fillStyle: "solid", label: { text: "Student activity" } },
      { type: "rectangle", x: 0, y: 560, width: 920, height: 90, backgroundColor: "#ffe3e3", fillStyle: "solid", label: { text: "Homework / follow up" } },
    ],
  },
  {
    id: "wireframe",
    name: "Landing Wireframe",
    collection: "Templates",
    description: "Hero, feature cards, and CTA layout.",
    elements: [
      { type: "frame", id: "wireframe-frame", x: -80, y: -80, width: 1060, height: 780, name: "Wireframe", children: [] },
      createTemplateText("Landing Page Wireframe", 0, 0, 34),
      { type: "rectangle", x: 0, y: 80, width: 900, height: 90, backgroundColor: "#f8f9fa", fillStyle: "solid", label: { text: "Navigation" } },
      { type: "rectangle", x: 0, y: 210, width: 900, height: 190, backgroundColor: "#e7f5ff", fillStyle: "solid", label: { text: "Hero headline + CTA" } },
      ...[0, 1, 2].map((index) => ({
        type: "rectangle",
        x: index * 310,
        y: 440,
        width: 280,
        height: 160,
        backgroundColor: "#f1f3f5",
        fillStyle: "solid",
        label: { text: `Feature ${index + 1}` },
      })),
    ],
  },
  {
    id: "meeting",
    name: "Meeting Agenda",
    collection: "Templates",
    description: "Agenda, notes, decisions, and owners.",
    elements: [
      { type: "frame", id: "meeting-frame", x: -80, y: -80, width: 1080, height: 700, name: "Meeting", children: [] },
      createTemplateText("Meeting Agenda", 0, 0, 36),
      { type: "rectangle", x: 0, y: 90, width: 300, height: 450, backgroundColor: "#fff3bf", fillStyle: "solid", label: { text: "Agenda" } },
      { type: "rectangle", x: 340, y: 90, width: 300, height: 450, backgroundColor: "#f8f9fa", fillStyle: "solid", label: { text: "Notes" } },
      { type: "rectangle", x: 680, y: 90, width: 300, height: 210, backgroundColor: "#d3f9d8", fillStyle: "solid", label: { text: "Decisions" } },
      { type: "rectangle", x: 680, y: 330, width: 300, height: 210, backgroundColor: "#d0ebff", fillStyle: "solid", label: { text: "Owners" } },
    ],
  },
];

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
  const [timerSeconds, setTimerSeconds] = useState(300);
  const [timerRunning, setTimerRunning] = useState(false);
  const [voteState, setVoteState] = useState<VoteState>({
    active: false,
    revealed: false,
    limit: 3,
    votes: {},
  });
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const autosaveTimerRef = useRef<number | null>(null);
  const loadedSharedSceneRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    if (!timerRunning) {
      return;
    }

    const interval = window.setInterval(() => {
      setTimerSeconds((seconds) => {
        if (seconds <= 1) {
          window.clearInterval(interval);
          setTimerRunning(false);
          notify("Timer finished");
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [notify, timerRunning]);

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

  const applyTemplate = async (template: SketchFlowTemplate) => {
    const elements = convertToExcalidrawElements(template.elements, {
      regenerateIds: true,
    });

    excalidrawAPI.resetScene();
    excalidrawAPI.updateScene({
      elements,
      appState: {
        name: template.name,
        viewBackgroundColor: "#ffffff",
        openDialog: null,
        isLoading: false,
      } as any,
    });
    excalidrawAPI.history.clear();
    setActiveSceneId(null);
    localStorage.removeItem(ACTIVE_SCENE_KEY);
    setStatus(`Loaded ${template.name}`);
    notify(`${template.name} template loaded`);
  };

  const exportWorkspaceBackup = async () => {
    const backup = {
      version: WORKSPACE_BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      app: "SketchFlow",
      scenes: await listScenes(),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sketchflow-workspace-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify("Workspace backup downloaded");
  };

  const importWorkspaceBackup = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const backup = JSON.parse(await file.text());
      if (!Array.isArray(backup.scenes)) {
        throw new Error("Invalid SketchFlow backup");
      }

      for (const scene of backup.scenes as SketchFlowScene[]) {
        await putScene({
          ...scene,
          id: scene.id || createId(),
          createdAt: scene.createdAt || Date.now(),
          updatedAt: Date.now(),
          collection: scene.collection || DEFAULT_COLLECTION,
          comments: scene.comments || [],
        });
      }

      await refreshScenes();
      notify(`Imported ${backup.scenes.length} scenes`);
    } catch (error) {
      console.error(error);
      notify("Backup import failed");
    }
  };

  const setTimerMinutes = (minutes: number) => {
    setTimerRunning(false);
    setTimerSeconds(minutes * 60);
  };

  const resetVoting = () => {
    setVoteState({
      active: false,
      revealed: false,
      limit: voteState.limit,
      votes: {},
    });
    notify("Voting reset");
  };

  const startVoting = () => {
    setVoteState({
      active: true,
      revealed: false,
      limit: voteState.limit,
      votes: {},
    });
    notify("Voting started");
  };

  const revealVoting = () => {
    setVoteState((state) => ({
      ...state,
      active: false,
      revealed: true,
    }));
    notify("Voting revealed");
  };

  const addVote = (sceneId: string) => {
    setVoteState((state) => {
      const usedVotes = Object.values(state.votes).reduce(
        (total, count) => total + count,
        0,
      );
      if (!state.active || usedVotes >= state.limit) {
        notify(
          state.active ? "Vote limit reached" : "Start voting before voting",
        );
        return state;
      }

      return {
        ...state,
        votes: {
          ...state.votes,
          [sceneId]: (state.votes[sceneId] || 0) + 1,
        },
      };
    });
  };

  const frames = useMemo(
    () =>
      excalidrawAPI
        .getSceneElements()
        .filter((element: any) => element.type === "frame" && !element.isDeleted),
    [excalidrawAPI, scenes, activeSceneId, status],
  );

  const focusFrame = (index: number) => {
    if (frames.length === 0) {
      notify("No frames found for slides");
      return;
    }

    const nextIndex = (index + frames.length) % frames.length;
    const frame = frames[nextIndex] as any;
    setCurrentFrameIndex(nextIndex);
    excalidrawAPI.updateScene({
      appState: {
        viewModeEnabled: true,
        zenModeEnabled: true,
        frameToHighlight: frame,
        scrollX: -frame.x + 120,
        scrollY: -frame.y + 90,
        zoom: { value: 1 },
      } as any,
    });
    notify(`Slide ${nextIndex + 1} of ${frames.length}`);
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
  const formattedTimer = `${Math.floor(timerSeconds / 60)
    .toString()
    .padStart(2, "0")}:${(timerSeconds % 60).toString().padStart(2, "0")}`;
  const usedVotes = Object.values(voteState.votes).reduce(
    (total, count) => total + count,
    0,
  );

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
            {isReadonlyLink && (
              <div className="SketchFlowWorkspace__banner">
                Readonly link active. Editing tools are locked for viewers.
              </div>
            )}
            <section className="SketchFlowWorkspace__section">
              <div className="SketchFlowWorkspace__sectionTitle">
                <h3>Templates</h3>
                <p>Start from a ready board.</p>
              </div>
              <div className="SketchFlowWorkspace__templates">
                {templates.map((template) => (
                  <button
                    className="SketchFlowWorkspace__template"
                    key={template.id}
                    type="button"
                    onClick={() => applyTemplate(template)}
                  >
                    <strong>{template.name}</strong>
                    <span>{template.description}</span>
                  </button>
                ))}
              </div>
            </section>
            <section className="SketchFlowWorkspace__section">
              <div className="SketchFlowWorkspace__sectionTitle">
                <h3>Meeting Tools</h3>
                <p>Timer, voting, and slide controls.</p>
              </div>
              <div className="SketchFlowWorkspace__meeting">
                <div className="SketchFlowWorkspace__timer">
                  <strong>{formattedTimer}</strong>
                  <button type="button" onClick={() => setTimerRunning(true)}>
                    Start
                  </button>
                  <button type="button" onClick={() => setTimerRunning(false)}>
                    Pause
                  </button>
                  <button type="button" onClick={() => setTimerMinutes(5)}>
                    5m
                  </button>
                  <button type="button" onClick={() => setTimerMinutes(15)}>
                    15m
                  </button>
                  <button type="button" onClick={() => setTimerMinutes(30)}>
                    30m
                  </button>
                </div>
                <div className="SketchFlowWorkspace__timer">
                  <strong>
                    Votes {usedVotes}/{voteState.limit}
                  </strong>
                  <button type="button" onClick={startVoting}>
                    Start voting
                  </button>
                  <button type="button" onClick={revealVoting}>
                    Reveal
                  </button>
                  <button type="button" onClick={resetVoting}>
                    Reset
                  </button>
                  <select
                    value={voteState.limit}
                    onChange={(event) =>
                      setVoteState((state) => ({
                        ...state,
                        limit: Number(event.target.value),
                      }))
                    }
                  >
                    {[1, 2, 3, 5, 10].map((limit) => (
                      <option key={limit} value={limit}>
                        {limit} votes
                      </option>
                    ))}
                  </select>
                </div>
                <div className="SketchFlowWorkspace__timer">
                  <strong>{frames.length} slides</strong>
                  <button type="button" onClick={() => focusFrame(0)}>
                    First slide
                  </button>
                  <button
                    type="button"
                    onClick={() => focusFrame(currentFrameIndex - 1)}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => focusFrame(currentFrameIndex + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
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
              <button type="button" onClick={exportWorkspaceBackup}>
                Export backup
              </button>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
              >
                Import backup
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json"
                hidden
                onChange={importWorkspaceBackup}
              />
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
                    <button type="button" onClick={() => addVote(scene.id)}>
                      Vote
                      {voteState.revealed && voteState.votes[scene.id]
                        ? ` (${voteState.votes[scene.id]})`
                        : ""}
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

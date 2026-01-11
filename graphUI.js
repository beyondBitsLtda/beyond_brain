import { getSupabaseClient } from "./supabaseClient.js";
import { clearSession } from "./sessionStore.js";
import { getCurrentTheme } from "./themeManager.js";
import { createGraphNoteWindow } from "./graphNoteWindow.js";
import { createActionPopover } from "./ui/actionPopover.js";
import { createConfirmModal } from "./ui/confirmModal.js";
import { createRelationModal } from "./ui/relationModal.js";
import { createRelationWeightModal } from "./ui/relationWeightModal.js";
import { clearDeleteBySubjectState } from "./state/deleteBySubjectState.js";
import { listRelationsForNote } from "./commands/rels.js";
import { ensureNoteIdeaColumns, ensureRelationWeightColumn } from "./schemaUtils.js";

const LABEL_LIMIT = 24;
const DEPTH_MIN = 1;
const DEPTH_MAX = 2;
const WEIGHT_MIN = 1;
const WEIGHT_MAX = 5;
const IDEA_LEVEL_MIN = 1;
const IDEA_LEVEL_MAX = 3;

const EDGE_WEIGHT_STYLES = {
  1: { width: 1.2, opacity: 0.55, glow: 0 },
  2: { width: 2, opacity: 0.65, glow: 0 },
  3: { width: 3, opacity: 0.8, glow: 6 },
  4: { width: 4, opacity: 0.9, glow: 10 },
  5: { width: 5, opacity: 1, glow: 14 },
};

function shortLabel(text = "") {
  const trimmed = text.trim();
  if (trimmed.length <= LABEL_LIMIT) return trimmed;
  return `${trimmed.slice(0, LABEL_LIMIT - 1)}…`;
}

function parseDepth(value) {
  if (!value) return DEPTH_MIN;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return DEPTH_MIN;
  return Math.min(Math.max(parsed, DEPTH_MIN), DEPTH_MAX);
}

function clampWeight(value) {
  if (!Number.isFinite(value)) return WEIGHT_MIN;
  return Math.min(Math.max(value, WEIGHT_MIN), WEIGHT_MAX);
}

function clampIdeaLevel(value) {
  if (!Number.isFinite(value)) return IDEA_LEVEL_MIN;
  return Math.min(Math.max(value, IDEA_LEVEL_MIN), IDEA_LEVEL_MAX);
}

function buildSubgraph(noteId, depth, relations) {
  const allowed = new Set([noteId]);
  let frontier = new Set([noteId]);

  for (let level = 0; level < depth; level += 1) {
    const nextFrontier = new Set();
    relations.forEach((rel) => {
      const from = rel.from_note_id;
      const to = rel.to_note_id;
      if (frontier.has(from)) {
        nextFrontier.add(to);
      }
      if (frontier.has(to)) {
        nextFrontier.add(from);
      }
    });
    nextFrontier.forEach((id) => allowed.add(id));
    frontier = nextFrontier;
  }

  return allowed;
}

function mapElements(notes, relations, allowedIds) {
  const noteSet = new Set(allowedIds ?? notes.map((note) => note.id));
  const nodes = notes
    .filter((note) => noteSet.has(note.id))
    .map((note) => ({
      data: {
        id: note.id,
        label: `${note.is_idea ? "★ " : ""}${shortLabel(note.subject)}`,
        subject: note.subject ?? "",
        moment: note.moment ?? "",
        created_at: note.created_at ?? "",
        is_idea: Boolean(note.is_idea),
        idea_level: note.is_idea ? clampIdeaLevel(Number(note.idea_level ?? 1)) : null,
      },
    }));

  const edges = relations
    .filter((rel) => noteSet.has(rel.from_note_id) && noteSet.has(rel.to_note_id))
    .map((rel) => ({
      data: {
        id: `${rel.from_note_id}-${rel.to_note_id}-${rel.type}`,
        source: rel.from_note_id,
        target: rel.to_note_id,
        type: rel.type ?? "related",
        from_note_id: rel.from_note_id,
        to_note_id: rel.to_note_id,
        rel_id: rel.id ?? null,
        weight: clampWeight(Number(rel.weight ?? 1)),
      },
    }));

  return { nodes, edges };
}

export function createGraphUI(bus, focusManager) {
  const overlay = document.getElementById("graph-overlay");
  const canvas = document.getElementById("graph-canvas");
  const emptyState = document.getElementById("graph-empty");
  const detailEmpty = document.getElementById("graph-detail-empty");
  const detailList = document.getElementById("graph-detail-list");
  const detailId = document.getElementById("graph-detail-id");
  const detailSubject = document.getElementById("graph-detail-subject");
  const detailMoment = document.getElementById("graph-detail-moment");
  const detailCreated = document.getElementById("graph-detail-created");
  const noteWindow = createGraphNoteWindow(overlay);
  const actionPopover = createActionPopover();
  const confirmModal = createConfirmModal(document.body);
  const relationModal = createRelationModal(overlay);
  const relationWeightModal = createRelationWeightModal(overlay);
  const connectToast = createGraphToast(overlay);

  let cy = null;
  let isOpen = false;
  let lastOptions = { focusNoteId: null, depth: DEPTH_MIN };
  let edgePulseFrame = null;
  let edgePulseStart = null;
  let noteBodies = new Map();
  let noteSubjects = new Map();
  let relationCache = [];
  let relationIdColumnAvailable = null;
  let relationCreatedAtAvailable = null;
  let connectMode = {
    active: false,
    fromNoteId: null,
    fromSubject: "",
  };

  function createGraphToast(container) {
    const toast = document.createElement("div");
    toast.className = "graph-toast";
    toast.hidden = true;
    container.appendChild(toast);

    return {
      show(message) {
        toast.textContent = message;
        toast.hidden = false;
      },
      hide() {
        toast.hidden = true;
        toast.textContent = "";
      },
    };
  }

  function getThemeTokens() {
    const styles = getComputedStyle(document.documentElement);
    return {
      bg: styles.getPropertyValue("--bg").trim() || "#000",
      fg: styles.getPropertyValue("--fg").trim() || "#0f0",
      border: styles.getPropertyValue("--border").trim() || "#0f0",
      accent: styles.getPropertyValue("--accent").trim() || "#0f0",
      edgeColor: styles.getPropertyValue("--edge-color").trim() || "#0f0",
      edgeStrongColor: styles.getPropertyValue("--edge-strong-color").trim() || "#0f0",
      edgeGlowColor: styles.getPropertyValue("--edge-glow-color").trim() || "rgba(0,255,0,0.4)",
      ideaBorderColor: styles.getPropertyValue("--idea-border-color").trim() || "#0f0",
      ideaGlowColor: styles.getPropertyValue("--idea-glow-color").trim() || "rgba(0,255,0,0.35)",
      ideaBadgeColor: styles.getPropertyValue("--idea-badge-color").trim() || "#0f0",
    };
  }

  function isSteveTheme() {
    return getCurrentTheme() === "steve";
  }

  function getEdgeStyle({ edgeColor, edgeStrongColor, edgeGlowColor }) {
    if (isSteveTheme()) {
      return {
        width: EDGE_WEIGHT_STYLES[2].width,
        "line-color": edgeStrongColor || edgeColor,
        "target-arrow-shape": "triangle",
        "target-arrow-color": edgeStrongColor || edgeColor,
        "curve-style": "bezier",
        opacity: 0.75,
        "shadow-blur": EDGE_WEIGHT_STYLES[3].glow,
        "shadow-color": edgeGlowColor,
        "shadow-opacity": 0.8,
      };
    }

    return {
      width: EDGE_WEIGHT_STYLES[1].width,
      "line-color": edgeColor,
      "target-arrow-shape": "triangle",
      "target-arrow-color": edgeColor,
      "curve-style": "bezier",
    };
  }

  function stopSteveEdgePulse() {
    if (edgePulseFrame) {
      cancelAnimationFrame(edgePulseFrame);
      edgePulseFrame = null;
    }
    edgePulseStart = null;
  }

  function shouldPulseSteveEdges() {
    return isOpen && cy && isSteveTheme();
  }

  function startSteveEdgePulse() {
    stopSteveEdgePulse();
    if (!cy) return;

    const edges = cy.edges();
    const minOpacity = 0.6;
    const maxOpacity = 0.9;
    const minShadow = 4;
    const maxShadow = 16;
    const speed = 0.6;

    const tick = (timestamp) => {
      if (!shouldPulseSteveEdges()) {
        stopSteveEdgePulse();
        return;
      }
      if (!edgePulseStart) edgePulseStart = timestamp;
      const elapsed = (timestamp - edgePulseStart) / 1000;
      const wave = (Math.sin(elapsed * Math.PI * 2 * speed) + 1) / 2;
      const glowWave = (Math.sin(elapsed * Math.PI * 2 * speed + Math.PI / 2) + 1) / 2;
      const opacity = minOpacity + (maxOpacity - minOpacity) * glowWave;

      edges.forEach((edge) => {
        const weight = clampWeight(Number(edge.data("weight") ?? 1));
        const base = EDGE_WEIGHT_STYLES[weight] ?? EDGE_WEIGHT_STYLES[1];
        const width = base.width + wave * 0.8;
        const shadowBlur = Math.max(base.glow, minShadow + (maxShadow - minShadow) * glowWave);
        edge.style({ width, opacity, "shadow-blur": shadowBlur });
      });
      edgePulseFrame = requestAnimationFrame(tick);
    };

    edgePulseFrame = requestAnimationFrame(tick);
  }

  function updateSteveEdgePulse() {
    if (shouldPulseSteveEdges()) {
      startSteveEdgePulse();
      return;
    }
    stopSteveEdgePulse();
  }

  function buildGraphStyles(tokens) {
    const {
      bg,
      fg,
      border,
      accent,
      edgeColor,
      edgeStrongColor,
      edgeGlowColor,
      ideaBorderColor,
      ideaGlowColor,
      ideaBadgeColor,
    } = tokens;

    const edgeBase = getEdgeStyle({ edgeColor, edgeStrongColor, edgeGlowColor });
    const edgeWeightSelectors = Object.entries(EDGE_WEIGHT_STYLES).map(
      ([weightKey, config]) => {
        const weight = Number(weightKey);
        const isStrong = weight >= 4;
        const shadowBlur = weight >= 5 ? config.glow : isStrong ? config.glow : 0;
        return {
          selector: `edge[weight = ${weight}]`,
          style: {
            width: config.width,
            opacity: config.opacity,
            "line-color": isStrong ? edgeStrongColor : edgeColor,
            "target-arrow-color": isStrong ? edgeStrongColor : edgeColor,
            ...(shadowBlur
              ? {
                  "shadow-blur": shadowBlur,
                  "shadow-color": edgeGlowColor,
                  "shadow-opacity": 0.8,
                }
              : {}),
          },
        };
      }
    );

    return [
      {
        selector: "node",
        style: {
          "background-color": bg,
          "border-color": border,
          "border-width": 1,
          color: fg,
          label: "data(label)",
          "font-size": 10,
          "text-wrap": "wrap",
          "text-max-width": 80,
        },
      },
      {
        selector: "edge",
        style: edgeBase,
      },
      {
        selector: "node[is_idea]",
        style: {
          "border-color": ideaBorderColor,
          "shadow-color": ideaGlowColor,
          "shadow-opacity": 0.5,
        },
      },
      {
        selector: "node[is_idea][idea_level = 1]",
        style: {
          "border-width": 2,
          width: 32,
          height: 32,
          "shadow-blur": 6,
          color: ideaBadgeColor || fg,
        },
      },
      {
        selector: "node[is_idea][idea_level = 2]",
        style: {
          "border-width": 3,
          width: 36,
          height: 36,
          "shadow-blur": 10,
          color: ideaBadgeColor || fg,
        },
      },
      {
        selector: "node[is_idea][idea_level = 3]",
        style: {
          "border-width": 4,
          width: 40,
          height: 40,
          "shadow-blur": 14,
          color: ideaBadgeColor || fg,
        },
      },
      {
        selector: "node:selected",
        style: {
          "background-color": accent,
          color: bg,
        },
      },
      {
        selector: "node.connect-source",
        style: {
          "border-color": accent,
          "border-width": 3,
          "shadow-blur": 10,
          "shadow-color": accent,
          "shadow-opacity": 0.6,
        },
      },
      ...edgeWeightSelectors,
    ];
  }

  function applyGraphTheme() {
    if (!cy) return;
    cy.style(buildGraphStyles(getThemeTokens()));
    updateSteveEdgePulse();
  }

  overlay.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".graph-panel")) {
      setTimeout(() => bus.emit("input:focus"), 0);
    }
  });

  function openActionPopoverAtEvent(key, event, items, title) {
    const { clientX = 0, clientY = 0 } = event?.originalEvent ?? event ?? {};
    const terminalRect = document.querySelector(".terminal")?.getBoundingClientRect();
    const x = terminalRect ? clientX - terminalRect.left : clientX;
    const y = terminalRect ? clientY - terminalRect.top : clientY;
    actionPopover.toggle(key, { x, y, items, title });
  }

  function showDetails(data) {
    detailId.textContent = data.id ?? "";
    detailSubject.textContent = data.subject ?? "";
    detailMoment.textContent = data.moment ?? "";
    detailCreated.textContent = data.created_at ?? "";
    detailEmpty.hidden = true;
    detailList.hidden = false;
  }

  function clearDetails() {
    detailId.textContent = "";
    detailSubject.textContent = "";
    detailMoment.textContent = "";
    detailCreated.textContent = "";
    detailList.hidden = true;
    detailEmpty.hidden = false;
  }

  function findRelationInfo(data) {
    if (!data) return null;
    if (data.rel_id) {
      return relationCache.find((rel) => rel.id === data.rel_id) ?? null;
    }
    return (
      relationCache.find(
        (rel) =>
          rel.from_note_id === data.from_note_id &&
          rel.to_note_id === data.to_note_id &&
          (data.type ? rel.type === data.type : true)
      ) ?? null
    );
  }

  async function showRelationDetails(data) {
    const relInfo = findRelationInfo(data);
    const fromSubject = await resolveNoteSubject(data.from_note_id, data.from_note_id);
    const toSubject = await resolveNoteSubject(data.to_note_id, data.to_note_id);
    const createdAt = relInfo?.created_at ? ` | ${relInfo.created_at}` : "";
    const type = data.type ?? relInfo?.type ?? "related";
    const weight = clampWeight(Number(relInfo?.weight ?? data.weight ?? 1));
    bus.emit(
      "output:append",
      `Relação: (${type}) ${fromSubject} -> ${toSubject} | peso ${weight}${createdAt}`
    );
  }

  function ensureCytoscape() {
    if (cy) return cy;
    if (!window.cytoscape) {
      bus.emit("output:append", "Cytoscape.js não carregado.");
      return null;
    }
    cy = window.cytoscape({
      container: canvas,
      elements: [],
      style: buildGraphStyles(getThemeTokens()),
      layout: { name: "cose", animate: false },
    });

    cy.on("tap", "node", (event) => {
      const data = event.target.data();
      if (connectMode.active) {
        handleConnectTarget(data);
        return;
      }
      const isIdea = Boolean(data.is_idea);
      openActionPopoverAtEvent(
        `node:${data.id}`,
        event,
        [
          {
            label: "Ver nota",
            action: () => {
              showDetails(data);
              noteWindow.open(noteBodies.get(data.id) ?? "");
            },
          },
          {
            label: "Criar relação...",
            action: () => {
              startConnectMode({ fromNoteId: data.id, fromSubject: data.subject ?? "" });
            },
          },
          {
            label: "Consultar relações",
            action: () => {
              listRelationsForNote(bus, data.id);
            },
          },
          {
            label: isIdea ? "Remover ideia" : "Marcar como ideia",
            action: () => {
              updateNoteIdeaStatus({
                noteId: data.id,
                isIdea: !isIdea,
                ideaLevel: clampIdeaLevel(Number(data.idea_level ?? 1)),
              });
            },
          },
          {
            label: "Ajustar nível (1..3)",
            action: () => {
              openActionPopoverAtEvent(
                `node:${data.id}:idea-level`,
                event,
                [1, 2, 3].map((level) => ({
                  label: `Nível ${level}`,
                  action: () => {
                    updateNoteIdeaStatus({
                      noteId: data.id,
                      isIdea: true,
                      ideaLevel: level,
                    });
                  },
                })),
                "Nível da ideia"
              );
            },
          },
          {
            label: "Deletar nota",
            danger: true,
            action: () => {
              confirmDeleteNote(data);
            },
          },
        ],
        data.subject ?? "Nota"
      );
    });

    cy.on("tap", "edge", (event) => {
      const data = event.target.data();
      openActionPopoverAtEvent(
        `edge:${data.id}`,
        event,
        [
          {
            label: "Ver relação",
            action: () => {
              showRelationDetails(data);
            },
          },
          {
            label: "Ajustar peso (1..5)",
            action: () => {
              openRelationWeightModal({
                relationData: data,
                currentWeight: clampWeight(Number(data.weight ?? 1)),
              });
            },
          },
          {
            label: "Reforçar (+1)",
            action: () => {
              reinforceRelationWeight(data);
            },
          },
          {
            label: "Deletar relação",
            danger: true,
            action: () => {
              confirmDeleteRelation(data, event.target);
            },
          },
        ],
        data.type ? `Relação: ${data.type}` : "Relação"
      );
    });

    cy.on("tap", (event) => {
      if (event.target === cy) {
        clearDetails();
      }
    });

    updateSteveEdgePulse();
    return cy;
  }

  bus.on("theme:change", () => {
    applyGraphTheme();
  });

  async function getAuthenticatedUser(client) {
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) {
      clearSession();
      bus.emit("output:append", "Você precisa estar logado para usar este comando.");
      return null;
    }
    return data.user;
  }

  async function ensureRelationIdColumn(client, userId) {
    if (relationIdColumnAvailable !== null) {
      return relationIdColumnAvailable;
    }
    const { error } = await client
      .from("note_relations")
      .select("id")
      .eq("user_id", userId)
      .limit(1);
    if (error) {
      relationIdColumnAvailable = false;
      return false;
    }
    relationIdColumnAvailable = true;
    return true;
  }

  async function ensureRelationCreatedAtColumn(client, userId) {
    if (relationCreatedAtAvailable !== null) {
      return relationCreatedAtAvailable;
    }
    const { error } = await client
      .from("note_relations")
      .select("created_at")
      .eq("user_id", userId)
      .limit(1);
    if (error) {
      relationCreatedAtAvailable = false;
      return false;
    }
    relationCreatedAtAvailable = true;
    return true;
  }

  async function loadGraph(options = {}) {
    if (!isOpen) return;
    const fallbackFocus = focusManager?.getFocusNoteId?.() ?? null;
    let focusNoteId = lastOptions.focusNoteId;
    if (Object.prototype.hasOwnProperty.call(options, "focusNoteId")) {
      focusNoteId = options.focusNoteId;
    } else if (fallbackFocus) {
      focusNoteId = fallbackFocus;
    }
    const depth = parseDepth(options.depth ?? lastOptions.depth);
    lastOptions = { focusNoteId, depth };

    const clientResponse = getSupabaseClient();
    if (clientResponse.error || !clientResponse.client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(clientResponse.client);
    if (!user) return;

    const [hasRelationId, hasRelationCreatedAt, hasRelationWeight, hasNoteIdea] =
      await Promise.all([
        ensureRelationIdColumn(clientResponse.client, user.id),
        ensureRelationCreatedAtColumn(clientResponse.client, user.id),
        ensureRelationWeightColumn({
          client: clientResponse.client,
          userId: user.id,
          bus,
        }),
        ensureNoteIdeaColumns({ client: clientResponse.client, userId: user.id, bus }),
      ]);
    const relationSelectFields = [
      hasRelationId ? "id" : null,
      "from_note_id",
      "to_note_id",
      "type",
      hasRelationWeight ? "weight" : null,
      hasRelationCreatedAt ? "created_at" : null,
    ]
      .filter(Boolean)
      .join(",");
    const noteSelectFields = [
      "id",
      "subject",
      "moment",
      "created_at",
      "body",
      hasNoteIdea ? "is_idea" : null,
      hasNoteIdea ? "idea_level" : null,
    ]
      .filter(Boolean)
      .join(",");

    const [notesResponse, relsResponse] = await Promise.all([
      clientResponse.client
        .from("notes")
        .select(noteSelectFields)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      clientResponse.client
        .from("note_relations")
        .select(relationSelectFields)
        .eq("user_id", user.id),
    ]);

    if (notesResponse.error) {
      bus.emit("output:append", `Erro ao carregar notas: ${notesResponse.error.message}`);
      return;
    }
    if (relsResponse.error) {
      bus.emit("output:append", `Erro ao carregar relações na note_relations: ${relsResponse.error.message}`);
      return;
    }

    const notes = notesResponse.data ?? [];
    const relations = relsResponse.data ?? [];
    noteBodies = new Map(notes.map((note) => [note.id, note.body ?? ""]));
    noteSubjects = new Map(notes.map((note) => [note.id, note.subject ?? ""]));
    relationCache = relations;

    if (notes.length === 0) {
      emptyState.hidden = false;
      clearDetails();
      if (cy) {
        cy.elements().remove();
      }
      return;
    }

    emptyState.hidden = true;
    if (focusNoteId && !notes.some((note) => note.id === focusNoteId)) {
      bus.emit("output:append", "Nota não encontrada no grafo.");
    }
    const allowed = focusNoteId ? buildSubgraph(focusNoteId, depth, relations) : null;

    const elements = mapElements(notes, relations, allowed);
    const instance = ensureCytoscape();
    if (!instance) return;

    instance.elements().remove();
    instance.add([...elements.nodes, ...elements.edges]);
    instance.layout({ name: "cose", animate: false }).run();

    clearDetails();

    if (focusNoteId) {
      const target = instance.getElementById(focusNoteId);
      if (target && target.length > 0) {
        target.select();
        instance.center(target);
      }
    } else {
      instance.fit();
    }
  }

  function openGraph(options = {}) {
    overlay.hidden = false;
    isOpen = true;
    bus.emit("input:focus");
    loadGraph(options);
    updateSteveEdgePulse();
  }

  function closeGraph() {
    overlay.hidden = true;
    isOpen = false;
    noteWindow.close();
    stopSteveEdgePulse();
    cancelConnectMode();
  }

  function toggleGraph() {
    if (isOpen) {
      closeGraph();
      return;
    }
    lastOptions = { focusNoteId: focusManager?.getFocusNoteId?.() ?? null, depth: DEPTH_MIN };
    openGraph(lastOptions);
  }

  bus.on("graph:toggle", () => toggleGraph());
  bus.on("graph:open", (options = {}) => {
    openGraph(options);
  });
  bus.on("graph:refresh", () => loadGraph());
  bus.on("focus:changed", () => {
    if (!isOpen) return;
    loadGraph({ focusNoteId: focusManager?.getFocusNoteId?.() ?? null });
  });

  bus.on("connect:start", ({ fromNoteId, fromSubject } = {}) => {
    if (!fromNoteId) return;
    if (!isOpen) {
      openGraph(lastOptions);
    }
    startConnectMode({ fromNoteId, fromSubject });
  });

  bus.on("connect:cancel", () => {
    cancelConnectMode();
  });

  bus.on("input:escape", () => {
    if (connectMode.active) {
      cancelConnectMode();
    }
  });

  function startConnectMode({ fromNoteId, fromSubject }) {
    connectMode = {
      active: true,
      fromNoteId,
      fromSubject: fromSubject ?? "",
    };
    setConnectHighlight(fromNoteId, true);
    connectToast.show("Clique no nó destino. ESC cancela.");
  }

  function cancelConnectMode() {
    if (!connectMode.active) return;
    setConnectHighlight(connectMode.fromNoteId, false);
    connectMode = { active: false, fromNoteId: null, fromSubject: "" };
    connectToast.hide();
    relationModal.close();
    bus.emit("output:append", "Modo de conexão cancelado.");
  }

  function finishConnectMode() {
    if (!connectMode.active) return;
    setConnectHighlight(connectMode.fromNoteId, false);
    connectMode = { active: false, fromNoteId: null, fromSubject: "" };
    connectToast.hide();
  }

  function setConnectHighlight(noteId, enabled) {
    if (!noteId || !cy) return;
    const node = cy.getElementById(noteId);
    if (!node || node.length === 0) return;
    if (enabled) {
      node.addClass("connect-source");
    } else {
      node.removeClass("connect-source");
    }
  }

  async function resolveNoteSubject(noteId, fallback = "") {
    if (noteSubjects.has(noteId)) {
      return noteSubjects.get(noteId) || fallback;
    }
    const clientResponse = getSupabaseClient();
    if (clientResponse.error || !clientResponse.client) {
      return fallback;
    }
    const user = await getAuthenticatedUser(clientResponse.client);
    if (!user) return fallback;
    const { data, error } = await clientResponse.client
      .from("notes")
      .select("subject")
      .eq("id", noteId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return fallback;
    const subject = data?.subject ?? fallback;
    noteSubjects.set(noteId, subject);
    return subject;
  }

  function showInvalidRelationModal() {
    confirmModal.open({
      title: "Conexão inválida",
      message: "Não é permitido ligar a nota a ela mesma.",
      confirmLabel: "Ok",
      cancelLabel: "Fechar",
      onConfirm: () => {
        confirmModal.close();
      },
      onCancel: () => {
        confirmModal.close();
      },
    });
  }

  async function handleConnectTarget(targetData) {
    if (!connectMode.active) return;
    if (!targetData?.id) return;
    if (connectMode.fromNoteId === targetData.id) {
      showInvalidRelationModal();
      return;
    }
    const fromSubject =
      connectMode.fromSubject ||
      (await resolveNoteSubject(connectMode.fromNoteId, "(sem assunto)"));
    const toSubject = await resolveNoteSubject(targetData.id, targetData.subject ?? "(sem assunto)");
    relationModal.open({
      fromNote: { id: connectMode.fromNoteId, subject: fromSubject },
      toNote: { id: targetData.id, subject: toSubject },
      defaultType: "related",
      onConfirm: async (type) => {
        if (connectMode.fromNoteId === targetData.id) {
          return { errorMessage: "Não é permitido ligar a nota a ela mesma." };
        }
        const result = await createRelation({
          fromId: connectMode.fromNoteId,
          toId: targetData.id,
          type,
        });
        if (result.ok) {
          finishConnectMode();
          return true;
        }
        return { errorMessage: result.errorMessage };
      },
      onCancel: () => {
        cancelConnectMode();
      },
    });
  }

  function addRelationEdge({ fromId, toId, type, weight = WEIGHT_MIN }) {
    if (!cy) return;
    const edgeId = `${fromId}-${toId}-${type}`;
    if (cy.getElementById(edgeId).length > 0) return;
    cy.add({
      data: {
        id: edgeId,
        source: fromId,
        target: toId,
        type,
        from_note_id: fromId,
        to_note_id: toId,
        weight: clampWeight(Number(weight ?? WEIGHT_MIN)),
      },
    });
  }

  async function createRelation({ fromId, toId, type }) {
    const clientResponse = getSupabaseClient();
    if (clientResponse.error || !clientResponse.client) {
      return {
        ok: false,
        errorMessage: "Supabase não configurado. Use auth --register ou auth para autenticar.",
      };
    }

    const user = await getAuthenticatedUser(clientResponse.client);
    if (!user) {
      return {
        ok: false,
        errorMessage: "Você precisa estar logado para usar este comando.",
      };
    }

    if (fromId === toId) {
      return {
        ok: false,
        errorMessage: "Não é permitido criar relação da nota com ela mesma.",
      };
    }

    const { data: existing, error: existingError } = await clientResponse.client
      .from("note_relations")
      .select("from_note_id")
      .eq("from_note_id", fromId)
      .eq("to_note_id", toId)
      .eq("type", type)
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      return {
        ok: false,
        errorMessage: `Erro ao verificar relação na note_relations: ${existingError.message}`,
      };
    }

    if (existing) {
      return { ok: false, errorMessage: "Essa relação já existe." };
    }

    const { error: insertError } = await clientResponse.client
      .from("note_relations")
      .insert({
        from_note_id: fromId,
        to_note_id: toId,
        type,
        user_id: user.id,
      });

    if (insertError) {
      if (insertError.code === "23505") {
        return { ok: false, errorMessage: "Essa relação já existe." };
      }
      return {
        ok: false,
        errorMessage: `Erro ao criar relação na note_relations: ${insertError.message}`,
      };
    }

    bus.emit("output:append", `Relação criada: (${type}) ${fromId} -> ${toId}`);
    addRelationEdge({ fromId, toId, type, weight: WEIGHT_MIN });
    relationCache = [
      ...relationCache,
      { from_note_id: fromId, to_note_id: toId, type, weight: WEIGHT_MIN },
    ];
    return { ok: true };
  }

  async function updateNoteIdeaStatus({ noteId, isIdea, ideaLevel }) {
    if (!noteId) return;
    const clientResponse = getSupabaseClient();
    if (clientResponse.error || !clientResponse.client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(clientResponse.client);
    if (!user) return;

    const hasIdeaColumns = await ensureNoteIdeaColumns({
      client: clientResponse.client,
      userId: user.id,
      bus,
    });
    if (!hasIdeaColumns) {
      bus.emit("output:append", "Não foi possível atualizar ideias sem as colunas de ideia.");
      return;
    }

    const level = clampIdeaLevel(Number(ideaLevel ?? 1));
    const updates = isIdea
      ? {
          is_idea: true,
          idea_level: level,
          idea_source: "manual",
          idea_marked_at: new Date().toISOString(),
        }
      : {
          is_idea: false,
          idea_source: null,
          idea_marked_at: null,
        };

    const { data, error } = await clientResponse.client
      .from("notes")
      .update(updates)
      .eq("id", noteId)
      .eq("user_id", user.id)
      .select("id,is_idea,idea_level");

    if (error) {
      bus.emit("output:append", `Erro ao atualizar ideia: ${error.message}`);
      return;
    }

    if (!data || data.length === 0) {
      bus.emit("output:append", "Nenhuma nota encontrada para atualizar.");
      return;
    }

    bus.emit(
      "output:append",
      isIdea ? `Nota ${noteId} marcada como ideia.` : `Nota ${noteId} removida de ideias.`
    );
    bus.emit("graph:refresh");
  }

  function updateRelationCacheWeight(relData, weight) {
    relationCache = relationCache.map((rel) => {
      if (relData.rel_id && rel.id) {
        if (rel.id === relData.rel_id) {
          return { ...rel, weight };
        }
        return rel;
      }
      if (
        rel.from_note_id === relData.from_note_id &&
        rel.to_note_id === relData.to_note_id &&
        (relData.type ? rel.type === relData.type : true)
      ) {
        return { ...rel, weight };
      }
      return rel;
    });
  }

  function updateEdgeWeight(relData, weight) {
    if (!cy) return;
    const edgeId = `${relData.from_note_id}-${relData.to_note_id}-${relData.type ?? "related"}`;
    const edge = cy.getElementById(edgeId);
    if (edge && edge.length > 0) {
      edge.data("weight", weight);
    }
  }

  async function updateRelationWeight(relData, weight) {
    const clientResponse = getSupabaseClient();
    if (clientResponse.error || !clientResponse.client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return { ok: false };
    }

    const user = await getAuthenticatedUser(clientResponse.client);
    if (!user) return { ok: false };

    const hasWeight = await ensureRelationWeightColumn({
      client: clientResponse.client,
      userId: user.id,
      bus,
    });
    if (!hasWeight) {
      bus.emit("output:append", "Não foi possível ajustar peso sem a coluna weight.");
      return { ok: false };
    }

    const normalizedWeight = clampWeight(Number(weight));
    let query = clientResponse.client
      .from("note_relations")
      .update({ weight: normalizedWeight })
      .eq("user_id", user.id);
    if (relData.rel_id) {
      query = query.eq("id", relData.rel_id);
    } else {
      query = query
        .eq("from_note_id", relData.from_note_id)
        .eq("to_note_id", relData.to_note_id);
      if (relData.type) {
        query = query.eq("type", relData.type);
      }
    }

    const { data, error } = await query.select("from_note_id,to_note_id,type,weight");
    if (error) {
      bus.emit("output:append", `Erro ao ajustar peso: ${error.message}`);
      return { ok: false };
    }
    if (!data || data.length === 0) {
      bus.emit("output:append", "Nenhuma relação encontrada para atualizar.");
      return { ok: false };
    }

    data.forEach((rel) => {
      updateRelationCacheWeight(rel, normalizedWeight);
      updateEdgeWeight(rel, normalizedWeight);
    });

    bus.emit("output:append", `Peso atualizado para ${normalizedWeight}.`);
    return { ok: true };
  }

  function openRelationWeightModal({ relationData, currentWeight }) {
    relationWeightModal.open({
      currentWeight,
      onSelect: async (weight) => {
        const result = await updateRelationWeight(relationData, weight);
        if (!result.ok) {
          return { errorMessage: "Não foi possível atualizar o peso." };
        }
        return true;
      },
      onCancel: () => {},
    });
  }

  async function reinforceRelationWeight(relData) {
    const relInfo = findRelationInfo(relData);
    const current = clampWeight(Number(relInfo?.weight ?? relData.weight ?? WEIGHT_MIN));
    const nextWeight = clampWeight(current + 1);
    await updateRelationWeight(relData, nextWeight);
  }

  function confirmDeleteNote(data) {
    if (!data?.id) return;
    clearDeleteBySubjectState();
    const subject = data.subject ?? "(sem assunto)";
    const createdAt = data.created_at ? `Criada em ${data.created_at}` : "";
    confirmModal.open({
      title: "Deletar nota?",
      message: subject,
      detail: createdAt,
      confirmLabel: "Sim, deletar",
      cancelLabel: "Não",
      danger: true,
      onConfirm: async () => {
        const clientResponse = getSupabaseClient();
        if (clientResponse.error || !clientResponse.client) {
          const message = "Supabase não configurado. Use auth --register ou auth para autenticar.";
          confirmModal.setError(message);
          bus.emit("output:append", message);
          return false;
        }
        const user = await getAuthenticatedUser(clientResponse.client);
        if (!user) return false;
        const { data: deleted, error } = await clientResponse.client
          .from("notes")
          .delete()
          .eq("id", data.id)
          .eq("user_id", user.id)
          .select("id");
        if (error) {
          confirmModal.setError(`Erro ao deletar nota: ${error.message}`);
          return false;
        }
        if (!deleted || deleted.length === 0) {
          confirmModal.setError("Nenhuma nota encontrada para deletar.");
          return false;
        }
        const node = cy?.getElementById(data.id);
        if (node && node.length > 0) {
          cy.remove(node.connectedEdges());
          cy.remove(node);
        }
        if (detailId.textContent === data.id) {
          clearDetails();
        }
        bus.emit("output:append", `Nota ${data.id} removida.`);
        confirmModal.close();
        return true;
      },
    });
  }

  function removeRelationFromCache(data) {
    relationCache = relationCache.filter((rel) => {
      if (data.rel_id && rel.id) {
        return rel.id !== data.rel_id;
      }
      if (data.type) {
        return !(
          rel.from_note_id === data.from_note_id &&
          rel.to_note_id === data.to_note_id &&
          rel.type === data.type
        );
      }
      return !(
        rel.from_note_id === data.from_note_id &&
        rel.to_note_id === data.to_note_id
      );
    });
  }

  function confirmDeleteRelation(data, edge) {
    if (!data?.from_note_id || !data?.to_note_id) return;
    clearDeleteBySubjectState();
    confirmModal.open({
      title: "Deletar relação?",
      message: `(${data.type ?? "related"}) ${data.from_note_id} → ${data.to_note_id}`,
      confirmLabel: "Sim, deletar",
      cancelLabel: "Não",
      danger: true,
      onConfirm: async () => {
        const clientResponse = getSupabaseClient();
        if (clientResponse.error || !clientResponse.client) {
          const message = "Supabase não configurado. Use auth --register ou auth para autenticar.";
          confirmModal.setError(message);
          bus.emit("output:append", message);
          return false;
        }
        const user = await getAuthenticatedUser(clientResponse.client);
        if (!user) return false;

        let query = clientResponse.client.from("note_relations").delete().eq("user_id", user.id);
        if (data.rel_id) {
          query = query.eq("id", data.rel_id);
        } else {
          query = query.eq("from_note_id", data.from_note_id).eq("to_note_id", data.to_note_id);
          if (data.type) {
            query = query.eq("type", data.type);
          }
        }

        const { data: deleted, error } = await query.select("from_note_id");
        if (error) {
          confirmModal.setError(`Erro ao remover relação na note_relations: ${error.message}`);
          return false;
        }
        if (!deleted || deleted.length === 0) {
          confirmModal.setError("Nenhuma relação encontrada para remover.");
          return false;
        }
        const edgeElement = edge ?? cy?.getElementById(data.id);
        if (edgeElement && edgeElement.length > 0) {
          cy.remove(edgeElement);
        }
        removeRelationFromCache(data);
        bus.emit("output:append", `Relação removida (${deleted.length}).`);
        return true;
      },
    });
  }

  return { toggleGraph, openGraph, closeGraph, loadGraph };
}

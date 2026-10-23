"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  compareChronologically,
  LANE_IDS,
  yearOf,
  type AtlasAction,
  type AtlasNode,
  type AtlasPlace,
  type Belief,
  type Era,
  type Lane,
  type Place,
  type Theme,
} from "@/lib/atlas-types";
import {
  startListening,
  VoiceInputError,
  type ListenSession,
} from "@/lib/speech-recognition";
import { useTheme } from "@/lib/theme";
import { interpretUtterance, type VoiceCommand } from "@/lib/voice-intent";
import AskPanel from "./AskPanel";
import type { CameraRequest, PlaceGroup } from "./AtlasMap";
import EraTour from "./EraTour";
import KpiReadout from "./KpiReadout";
import MythPanel from "./MythPanel";
import NodeEvidence from "./NodeEvidence";
import NodePlayButton from "./NodePlayButton";
import ThemeToggle from "./ThemeToggle";
import VoiceToolbar from "./VoiceToolbar";
import { useAskAtlas } from "./useAskAtlas";
import { useNarration } from "./useNarration";

export type { AtlasNode, Lane, Place };

// MapLibre touches window at import time, so the map is a client-only chunk.
const AtlasMap = dynamic(() => import("./AtlasMap"), {
  ssr: false,
  loading: () => (
    <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">
      Loading globe
    </p>
  ),
});

const LANE_COLORS: Record<Theme, Record<Lane, string>> = {
  dark: {
    capability: "#d97757",
    funding: "#788c5d",
    policy: "#6a9bcc",
    research: "#e8e6dc",
    people: "#b0aea5",
    community: "#c28fb0",
    critic: "#e0645c",
  },
  light: {
    capability: "#c4623f",
    funding: "#5f7a42",
    policy: "#3f739f",
    research: "#8c8573",
    people: "#6b6a64",
    community: "#9b5f87",
    critic: "#b23a32",
  },
};

const NOTICE_VISIBLE_MS = 8000;
const LISTENING_HINT = "Listening. Ask a question, or say next, previous, tour, stop.";

const failureNotices: Record<VoiceInputError["failure"], string> = {
  unsupported: "Voice input is not supported in this browser.",
  denied: "Microphone access is blocked. Allow it in the browser to use voice.",
  "no-speech": "Nothing was heard. Try again.",
  cancelled: "",
  failed: "Voice input failed. Try again.",
};

type SidebarTab = "timeline" | "myth";

type AtlasProps = {
  nodes: AtlasNode[];
  places: AtlasPlace[];
  beliefs: Belief[];
  eras: Era[];
  // Rendered on the server (the QR code is an SVG built at build time) and slotted into the header.
  quizLink: ReactNode;
};

export default function Atlas({ nodes, places, beliefs, eras, quizLink }: AtlasProps) {
  const [theme, toggleTheme] = useTheme();
  const laneColor = LANE_COLORS[theme];

  const years = useMemo(() => {
    const allYears = nodes.map(yearOf);
    const firstYear = Math.min(...allYears);
    const lastYear = Math.max(...allYears);
    return Array.from(
      { length: lastYear - firstYear + 1 },
      (_, offset) => firstYear + offset,
    );
  }, [nodes]);

  // A lane with no nodes gets no toggle, so "community" appears only once it has verified items.
  const presentLanes = useMemo(
    () => LANE_IDS.filter((lane) => nodes.some((node) => node.lane === lane)),
    [nodes],
  );

  const [selectedYear, setSelectedYear] = useState(years[years.length - 1]);
  const [activeLanes, setActiveLanes] = useState<Record<Lane, boolean>>(
    () => Object.fromEntries(LANE_IDS.map((lane) => [lane, true])) as Record<Lane, boolean>,
  );
  const [showPlaces, setShowPlaces] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("timeline");
  const [highlightedBeliefId, setHighlightedBeliefId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [cameraRequest, setCameraRequest] = useState<CameraRequest | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [notice, setNotice] = useState("");
  const [isEraPickerOpen, setIsEraPickerOpen] = useState(false);
  const [activeEraId, setActiveEraId] = useState<string | null>(null);

  const cameraRequestCountRef = useRef(0);
  const listenSessionRef = useRef<ListenSession | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const timelineRef = useRef<HTMLElement>(null);

  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  // Critic nodes grouped by the event they target, oldest first so the debate reads as it unfolded.
  const criticsByTargetId = useMemo(() => {
    const grouped = new Map<string, AtlasNode[]>();
    for (const node of [...nodes].sort(compareChronologically)) {
      if (node.lane !== "critic" || !node.target_id) continue;
      grouped.set(node.target_id, [...(grouped.get(node.target_id) ?? []), node]);
    }
    return grouped;
  }, [nodes]);
  const beliefsById = useMemo(
    () => new Map(beliefs.map((belief) => [belief.id, belief])),
    [beliefs],
  );
  const placesById = useMemo(
    () => new Map(places.map((place) => [place.id, place])),
    [places],
  );

  const nodesUpToYear = useMemo(
    () => nodes.filter((node) => yearOf(node) <= selectedYear),
    [nodes, selectedYear],
  );

  const visibleNodes = useMemo(
    () =>
      nodesUpToYear
        .filter((node) => activeLanes[node.lane])
        .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
    [nodesUpToYear, activeLanes],
  );

  // Voice history, next and previous walk every node in the enabled lanes, not only those the
  // year cursor currently shows: the cursor follows the narration, so it never limits it.
  const laneActiveChronological = useMemo(
    () => nodes.filter((node) => activeLanes[node.lane]).sort(compareChronologically),
    [nodes, activeLanes],
  );

  const placeGroups = useMemo(() => {
    const groupsByPlaceName = new Map<string, PlaceGroup>();
    for (const node of visibleNodes) {
      if (!node.place) continue;
      const group = groupsByPlaceName.get(node.place.name);
      if (group) group.nodes.push(node);
      else groupsByPlaceName.set(node.place.name, { place: node.place, nodes: [node] });
    }
    return Array.from(groupsByPlaceName.values());
  }, [visibleNodes]);

  const totalPlaceCount = useMemo(
    () =>
      new Set(nodes.flatMap((node) => (node.place ? [node.place.name] : []))).size + places.length,
    [nodes, places],
  );

  const laneCounts = useMemo(() => {
    const counts = Object.fromEntries(LANE_IDS.map((lane) => [lane, 0])) as Record<Lane, number>;
    for (const node of nodesUpToYear) counts[node.lane] += 1;
    return counts;
  }, [nodesUpToYear]);

  // A selection that the filters have hidden is treated as no selection.
  const selectedNode = visibleNodes.find((node) => node.id === selectedNodeId) ?? null;

  const requestCamera = useCallback((target: CameraRequest["target"]) => {
    cameraRequestCountRef.current += 1;
    setCameraRequest({ requestId: cameraRequestCountRef.current, target });
  }, []);

  const clearNotice = useCallback(() => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = null;
    setNotice("");
  }, []);

  const showNotice = useCallback(
    (message: string) => {
      clearNotice();
      setNotice(message);
      noticeTimerRef.current = window.setTimeout(() => setNotice(""), NOTICE_VISIBLE_MS);
    },
    [clearNotice],
  );

  // The one selection path: the map, the year cursor and the sidebar all follow the selected
  // event. Clicks, the voice agent and history mode all end up here.
  const focusNode = useCallback(
    (node: AtlasNode, options: { revealTimeline?: boolean } = {}) => {
      clearNotice();
      setSelectedYear(yearOf(node));
      setActiveLanes((current) => (current[node.lane] ? current : { ...current, [node.lane]: true }));
      setSelectedNodeId(node.id);
      // History steps leave the sidebar tab alone so reading the myth check is not interrupted.
      if (options.revealTimeline ?? true) setSidebarTab("timeline");
      if (node.place) {
        requestCamera({ kind: "place", place: node.place });
      } else {
        showNotice("The source names no place for this event, so the view stays where it is.");
      }
    },
    [clearNotice, requestCamera, showNotice],
  );

  const handleTourStep = useCallback(
    (nodeId: string) => {
      const node = nodesById.get(nodeId);
      if (node) focusNode(node, { revealTimeline: false });
    },
    [nodesById, focusNode],
  );

  const narration = useNarration({ onTourStep: handleTourStep });
  const { playback, tour } = narration;

  // History mode: narrate the chosen event, then continue chronologically; every step moves the
  // cursor, the sidebar highlight and the camera through focusNode.
  const startHistory = useCallback(
    (fromId?: string) => {
      const startNode = fromId ? nodesById.get(fromId) : undefined;
      const lanes =
        startNode && !activeLanes[startNode.lane] ? { ...activeLanes, [startNode.lane]: true } : activeLanes;
      const ordered = nodes.filter((node) => lanes[node.lane]).sort(compareChronologically);
      const startIndex = startNode ? Math.max(0, ordered.findIndex((node) => node.id === startNode.id)) : 0;
      const queue = ordered.slice(startIndex).map((node) => node.id);
      if (queue.length === 0) return;
      clearNotice();
      setSidebarTab("timeline");
      setActiveEraId(null);
      setIsEraPickerOpen(false);
      narration.startTour(queue);
    },
    [nodes, nodesById, activeLanes, clearNotice, narration],
  );

  // An era tour is the same narrated walk as history mode, over the era's own stops: every
  // stop moves the year cursor, camera and sidebar highlight through focusNode.
  const startEraTour = useCallback(
    (eraId: string) => {
      const era = eras.find((candidate) => candidate.id === eraId);
      if (!era) return;
      const stopIds = era.stops.filter((id) => nodesById.has(id));
      if (stopIds.length === 0) return;
      clearNotice();
      setSidebarTab("timeline");
      setIsEraPickerOpen(false);
      setActiveEraId(era.id);
      narration.unlockAudioForLaterPlayback();
      narration.startTour(stopIds);
    },
    [eras, nodesById, clearNotice, narration],
  );

  const stopEraTour = useCallback(() => {
    narration.stop();
  }, [narration]);

  const toggleEraPicker = () => {
    if (activeEraId !== null) {
      // A finished era is still on screen; the Tour button then means "pick another".
      narration.stop();
      setActiveEraId(null);
      setIsEraPickerOpen(true);
      return;
    }
    setIsEraPickerOpen((open) => !open);
  };

  const closeEraTour = useCallback(() => {
    narration.stop();
    setActiveEraId(null);
    setIsEraPickerOpen(false);
  }, [narration]);

  const changeYear = useCallback(
    (year: number) => {
      narration.endTour();
      setSelectedYear(year);
    },
    [narration],
  );

  const handleAction = useCallback(
    (action: AtlasAction) => {
      if (action.name === "set_year") {
        changeYear(action.year);
      } else if (action.name === "set_lanes") {
        narration.endTour();
        setActiveLanes(
          Object.fromEntries(LANE_IDS.map((lane) => [lane, action.lanes.includes(lane)])) as Record<
            Lane,
            boolean
          >,
        );
      } else if (action.name === "select_event") {
        const node = nodesById.get(action.id);
        if (node) focusNode(node);
      } else if (action.name === "play_event") {
        const node = nodesById.get(action.id);
        if (node) {
          focusNode(node);
          narration.playNode(node.id);
        }
      } else {
        startHistory(action.fromId);
      }
    },
    [changeYear, narration, nodesById, focusNode, startHistory],
  );

  const askAtlas = useAskAtlas({ onAction: handleAction });

  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
      listenSessionRef.current?.cancel();
    },
    [],
  );

  // On large screens the sidebar is its own scroll area; on a phone the page scrolls and the
  // map must stay in view, so only a genuinely scrollable sidebar is moved.
  useEffect(() => {
    if (!selectedNodeId || sidebarTab !== "timeline") return;
    const container = timelineRef.current;
    const row = container?.querySelector<HTMLElement>(
      `[data-node-id="${CSS.escape(selectedNodeId)}"]`,
    );
    if (!container || !row || container.scrollHeight <= container.clientHeight) return;

    const rowOffsetInContainer =
      row.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    const centered = rowOffsetInContainer - (container.clientHeight - row.offsetHeight) / 2;
    container.scrollTo({
      top: Math.max(0, centered),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [selectedNodeId, sidebarTab]);

  // Both tabs share one scroll area, so a switch starts from the top instead of wherever the other tab was left.
  const showTab = (tab: SidebarTab) => {
    if (timelineRef.current) timelineRef.current.scrollTop = 0;
    setSidebarTab(tab);
  };

  const toggleLane = (lane: Lane) => {
    narration.endTour();
    setActiveLanes((current) => ({ ...current, [lane]: !current[lane] }));
  };

  const handlePlayNode = (nodeId: string) => {
    const node = nodesById.get(nodeId);
    if (!node) return;
    if (playback.nodeId !== nodeId) focusNode(node);
    narration.togglePlayNode(nodeId);
  };

  // Clicking an event, on the map or in the sidebar, starts history mode from it.
  const handleMarkerSelect = (placeName: string) => {
    const newestNodeAtPlace = placeGroups.find((group) => group.place.name === placeName)
      ?.nodes[0];
    if (newestNodeAtPlace) startHistory(newestNodeAtPlace.id);
  };

  const stepThroughNodes = (direction: 1 | -1) => {
    if (laneActiveChronological.length === 0) return;
    const anchorId = playback.nodeId ?? selectedNode?.id ?? null;
    const anchorIndex = laneActiveChronological.findIndex((node) => node.id === anchorId);
    const targetIndex =
      anchorIndex === -1
        ? direction > 0
          ? 0
          : laneActiveChronological.length - 1
        : anchorIndex + direction;

    const target = laneActiveChronological[targetIndex];
    if (!target) {
      showNotice(direction > 0 ? "That is the newest node." : "That is the oldest node.");
      return;
    }
    focusNode(target);
    narration.playNode(target.id);
  };

  const runVoiceCommand = (command: VoiceCommand) => {
    if (command === "stop") {
      narration.stop();
      askAtlas.stop();
      showNotice("Stopped.");
    } else if (command === "tour") {
      startHistory();
    } else if (tour.isActive) {
      if (command === "next") narration.skipForward();
      else narration.skipBack();
    } else {
      stepThroughNodes(command === "next" ? 1 : -1);
    }
  };

  // Anything that is not one of the four fast-path commands is a question for the agent.
  const handleUtterance = (transcript: string, endOfSpeechAt: number) => {
    const intent = interpretUtterance(transcript, nodes);
    if (intent.kind === "command") {
      runVoiceCommand(intent.command);
    } else {
      narration.pauseNarration();
      void askAtlas.ask(transcript, endOfSpeechAt);
    }
  };

  const handleToggleListening = () => {
    if (isListening) {
      listenSessionRef.current?.cancel();
      return;
    }

    // The tap that opens the mic is the user gesture that lets narration and speech start later.
    narration.unlockAudioForLaterPlayback();
    askAtlas.prepareSpeech();
    askAtlas.stop();
    const wasPlaying = playback.status === "playing";
    // Narration would otherwise be picked up by the microphone.
    narration.pauseNarration();
    const resumeNarration = () => {
      if (wasPlaying) narration.togglePause();
    };

    setIsListening(true);
    const session = startListening();
    listenSessionRef.current = session;

    session.result
      .then(({ text }) => {
        handleUtterance(text, performance.now());
      })
      .catch((error: unknown) => {
        const failure = error instanceof VoiceInputError ? error.failure : "failed";
        const message = failureNotices[failure];
        if (message) showNotice(message);
        resumeNarration();
      })
      .finally(() => {
        if (listenSessionRef.current === session) {
          listenSessionRef.current = null;
          setIsListening(false);
        }
      });
  };

  const handleTypedQuestion = (question: string) => {
    narration.pauseNarration();
    void askAtlas.ask(question, performance.now());
  };

  const chips = useMemo(
    () =>
      askAtlas.state.cited.flatMap((id) => {
        const node = nodesById.get(id);
        if (node) return [{ id, label: node.title }];
        const belief = beliefsById.get(id);
        if (belief) return [{ id, label: `Myth check: ${belief.belief}` }];
        const place = placesById.get(id);
        if (place) return [{ id, label: place.name }];
        return [];
      }),
    [askAtlas.state.cited, nodesById, beliefsById, placesById],
  );

  const handleChipClick = (id: string) => {
    const node = nodesById.get(id);
    if (node) {
      focusNode(node);
      return;
    }
    if (beliefsById.has(id)) {
      setHighlightedBeliefId(id);
      showTab("myth");
      return;
    }
    const place = placesById.get(id);
    if (place) requestCamera({ kind: "place", place: { name: place.name, lat: place.lat, lon: place.lon } });
  };

  const playingNode = playback.nodeId ? nodesById.get(playback.nodeId) : undefined;
  const nowPlayingCaption =
    playingNode && playback.status !== "idle"
      ? `${tour.isActive ? `History ${tour.position} of ${tour.total}. ` : ""}${
          playback.status === "paused" ? "Paused" : "Now playing"
        }: ${playingNode.date}, ${playingNode.title}`
      : "";
  const statusMessage = isListening
    ? LISTENING_HINT
    : notice || narration.audioProblem || nowPlayingCaption;

  const tabClassName = (tab: SidebarTab) =>
    `flex-1 px-3 py-2.5 text-sm transition-colors ${
      sidebarTab === tab
        ? "border-b-2 border-accent text-ink"
        : "border-b-2 border-transparent text-muted hover:text-ink"
    }`;

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-hair px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
          Claude Atlas
        </h1>
        <div className="flex items-center gap-4">
          <p className="font-mono text-xs text-muted" aria-live="polite">
            <span className="text-ink">{nodes.length}</span> nodes
            <span aria-hidden> · </span>
            <span className="text-ink">{totalPlaceCount}</span> places
            <span aria-hidden> · </span>
            showing <span className="text-ink">{visibleNodes.length}</span>
          </p>
          {quizLink}
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[13rem_minmax(0,1fr)_24rem] lg:grid-rows-[minmax(0,1fr)_auto]">
        <nav
          aria-label="Lanes"
          className="order-2 flex flex-wrap gap-2 border-b border-hair p-4 lg:order-none lg:col-start-1 lg:row-start-1 lg:flex-col lg:flex-nowrap lg:border-b-0 lg:border-r"
        >
          <p className="hidden font-mono text-[11px] uppercase tracking-widest text-muted lg:block">
            Lanes
          </p>
          {presentLanes.map((id) => {
            const isOn = activeLanes[id];
            const color = laneColor[id];
            return (
              <button
                key={id}
                type="button"
                aria-pressed={isOn}
                onClick={() => toggleLane(id)}
                className={`flex items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-sm capitalize transition-colors hover:bg-ink/5 lg:w-full ${
                  isOn
                    ? "border-hair text-ink"
                    : "border-transparent text-muted opacity-60"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full border"
                    style={{
                      borderColor: color,
                      backgroundColor: isOn ? color : "transparent",
                    }}
                  />
                  {id}
                </span>
                <span className="font-mono text-xs text-muted">
                  {laneCounts[id]}
                </span>
              </button>
            );
          })}
          {places.length > 0 && (
            <>
              <p className="mt-2 hidden font-mono text-[11px] uppercase tracking-widest text-muted lg:block">
                Layers
              </p>
              <button
                type="button"
                aria-pressed={showPlaces}
                onClick={() => setShowPlaces((current) => !current)}
                className={`flex items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-ink/5 lg:w-full ${
                  showPlaces ? "border-hair text-ink" : "border-transparent text-muted opacity-60"
                }`}
              >
                Offices and communities
                <span className="font-mono text-xs text-muted">{places.length}</span>
              </button>
            </>
          )}
        </nav>

        <section
          aria-label="Globe"
          className="order-1 flex flex-col lg:order-none lg:col-start-2 lg:row-start-1 lg:min-h-0"
        >
          <VoiceToolbar
            canStartTour={laneActiveChronological.length > 0}
            isTourActive={tour.isActive}
            tourPosition={tour.position}
            tourTotal={tour.total}
            isNarrationPaused={playback.status === "paused"}
            isListening={isListening}
            statusMessage={statusMessage}
            onStartTour={() => startHistory()}
            onOpenEraTour={toggleEraPicker}
            isEraTourOpen={isEraPickerOpen || activeEraId !== null}
            onTogglePause={narration.togglePause}
            onSkip={narration.skipForward}
            onStopTour={narration.stop}
            onToggleListening={handleToggleListening}
          />
          <EraTour
            eras={eras}
            nodesById={nodesById}
            isPickerOpen={isEraPickerOpen}
            activeEraId={activeEraId}
            isWalking={tour.isActive && activeEraId !== null}
            stopPosition={tour.position}
            stopTotal={tour.total}
            onPickEra={startEraTour}
            onPrevious={narration.skipBack}
            onNext={narration.skipForward}
            onStop={stopEraTour}
            onClose={closeEraTour}
            onChipClick={focusNode}
          />
          <AskPanel
            state={askAtlas.state}
            displayedAnswer={askAtlas.displayedAnswer}
            chips={chips}
            isSpeaking={askAtlas.isSpeaking}
            isListening={isListening}
            onSubmit={(question) => {
              askAtlas.prepareSpeech();
              handleTypedQuestion(question);
            }}
            onStop={askAtlas.stop}
            onChipClick={handleChipClick}
          />
          <div className="relative h-[56dvh] min-h-[22rem] lg:h-auto lg:min-h-0 lg:flex-1">
            <AtlasMap
              theme={theme}
              placeGroups={placeGroups}
              places={places}
              showPlaces={showPlaces}
              openPlaceName={selectedNode?.place?.name ?? null}
              selectedNodeId={selectedNode?.id ?? null}
              playingNodeId={playback.nodeId}
              playbackStatus={playback.status}
              cameraRequest={cameraRequest}
              onMarkerSelect={handleMarkerSelect}
              onPopupClosed={() => setSelectedNodeId(null)}
              onPlayNode={handlePlayNode}
            />
          </div>
          <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-hair px-3 py-2 text-[11px] text-muted sm:px-4">
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="flex items-center gap-2">
                <span aria-hidden className="size-2 rounded-full bg-accent" />
                event, place named in a source title ({placeGroups.length} shown)
              </span>
              {places.length > 0 && (
                <>
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="size-2 rounded-full border-2 border-sky" />
                    office
                  </span>
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="size-2 rounded-full bg-moss" />
                    community
                  </span>
                </>
              )}
            </span>
            <span>Drag to rotate. Scroll or pinch to zoom.</span>
          </p>
        </section>

        <section
          ref={timelineRef}
          aria-label="Timeline and myth check"
          className="order-4 border-t border-hair lg:order-none lg:col-start-3 lg:row-start-1 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0"
        >
          <div role="tablist" className="sticky top-0 z-10 flex border-b border-hair bg-canvas">
            <button
              type="button"
              role="tab"
              id="tab-timeline"
              aria-selected={sidebarTab === "timeline"}
              aria-controls="panel-timeline"
              onClick={() => showTab("timeline")}
              className={tabClassName("timeline")}
            >
              Timeline
            </button>
            <button
              type="button"
              role="tab"
              id="tab-myth"
              aria-selected={sidebarTab === "myth"}
              aria-controls="panel-myth"
              onClick={() => showTab("myth")}
              className={tabClassName("myth")}
            >
              Myth vs source
              <span className="ml-1.5 font-mono text-xs text-accent">{beliefs.length}</span>
            </button>
          </div>

          <div id="panel-timeline" role="tabpanel" aria-labelledby="tab-timeline" hidden={sidebarTab !== "timeline"}>
            {visibleNodes.length === 0 ? (
              <p className="p-4 text-sm text-muted">
                No nodes match the current lane and year filters.
              </p>
            ) : (
              <ol>
                {visibleNodes.map((node) => {
                  const isSelected = node.id === selectedNode?.id;
                  return (
                    <li
                      key={node.id}
                      data-node-id={node.id}
                      data-selected={isSelected || undefined}
                      className={`border-b border-hair last:border-b-0 data-[selected]:bg-ink/5 data-[selected]:shadow-[inset_2px_0_0_0_var(--accent)] ${
                        node.lane === "critic" ? "bg-[var(--critic)]/[0.06]" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => startHistory(node.id)}
                        aria-current={isSelected ? "true" : undefined}
                        className="block w-full px-4 pb-1 pt-3 text-left"
                      >
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted">
                          <time dateTime={node.date}>{node.date}</time>
                          <span
                            className="rounded-full border px-2 py-0.5 text-[11px] capitalize"
                            style={{
                              color: laneColor[node.lane],
                              borderColor: `${laneColor[node.lane]}66`,
                            }}
                          >
                            {node.lane}
                          </span>
                          {node.place && (
                            <span className="flex items-center gap-1">
                              <span
                                aria-hidden
                                className="size-1.5 rounded-full bg-accent"
                              />
                              {node.place.name}
                            </span>
                          )}
                        </span>
                        <span className="mt-1.5 block text-[15px] leading-snug">
                          {node.title}
                        </span>
                      </button>
                      <NodeEvidence
                        node={node}
                        isSelected={isSelected}
                        targetNode={nodesById.get(node.target_id ?? node.responds_to ?? "")}
                        criticsOfThisNode={criticsByTargetId.get(node.id) ?? []}
                        onFocusNode={focusNode}
                      />
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-3 pt-1.5 text-xs text-muted">
                        <NodePlayButton
                          nodeTitle={node.title}
                          status={playback.nodeId === node.id ? playback.status : "idle"}
                          onClick={() => handlePlayNode(node.id)}
                        />
                        <a
                          href={node.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent underline-offset-2 hover:underline"
                        >
                          {node.lane === "critic" ? "critic source" : "source"}
                        </a>
                        {node.anthropic_url && (
                          <a
                            href={node.anthropic_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent underline-offset-2 hover:underline"
                          >
                            Anthropic document
                          </a>
                        )}
                        <span>retrieved {node.retrieved_at.slice(0, 10)}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div id="panel-myth" role="tabpanel" aria-labelledby="tab-myth" hidden={sidebarTab !== "myth"}>
            <MythPanel beliefs={beliefs} highlightedBeliefId={highlightedBeliefId} />
          </div>
        </section>

        <div className="order-3 border-t border-hair px-4 py-3 sm:px-6 lg:order-none lg:col-span-3 lg:col-start-1 lg:row-start-2">
          <KpiReadout year={selectedYear} nodesUpToYear={nodesUpToYear} onFocusNode={focusNode} />
          <div className="mx-auto max-w-3xl">
            <label
              htmlFor="year-scrubber"
              className="flex items-baseline justify-between font-mono text-xs text-muted"
            >
              <span>Show nodes up to year</span>
              <span className="text-sm text-ink">{selectedYear}</span>
            </label>
            <input
              id="year-scrubber"
              type="range"
              className="scrubber mt-2"
              min={years[0]}
              max={years[years.length - 1]}
              step={1}
              value={selectedYear}
              onChange={(event) => changeYear(Number(event.target.value))}
            />
            <div className="mt-1 flex justify-between px-1 font-mono text-[11px] text-muted">
              {years.map((year) => (
                <button
                  key={year}
                  type="button"
                  onClick={() => changeYear(year)}
                  className={year === selectedYear ? "text-accent" : "hover:text-ink"}
                >
                  {year}
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-hair px-4 py-3 text-xs text-muted sm:px-6">
        Independent community project by AI Safety Morocco. Not affiliated with
        Anthropic. Every item links to its source.
      </footer>
    </div>
  );
}

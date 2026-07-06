"""
animation_planner.py
=====================
Deterministic, rule-based slide-transition planner. No prior art in the
codebase originally — kept intentionally simple: no LLM call, no persisted
state, just a pure function, now extended with a richer transition vocabulary
and content-aware defaults (architecture/process/roadmap layouts, hero
images, and flagged key-stat/quote scenes each get a more fitting transition
than a generic fade).

Scope note: python-pptx has no high-level animation API, so this module's
primary, real-world consumer is the video pipeline's ffmpeg composition step
(services/video_composer.py's crossfade construction, and video_pipeline_
local.py's existing Ken-Burns motion pass) — a `transition_type` +
`duration_seconds` pair per slide boundary maps onto ffmpeg's `xfade` filter
selection and the per-slide motion style. A best-effort PPTX-side transition
(raw slide-transition XML) is a bonus, not the primary deliverable.
"""
from __future__ import annotations

from dataclasses import dataclass

# Every transition type this planner can select. Consumed by:
#   - video_pipeline_local.py's Ken-Burns motion pass (zoom -> stronger
#     push-in scale; reveal/progressive_diagram -> a slower pan)
#   - FFmpegComposer's crossfade-at-boundaries mechanism (fade/wipe/push map
#     directly onto ffmpeg xfade transition names; highlight/morph/zoom/
#     reveal/progressive_diagram fall back to that composer's closest
#     supported xfade equivalent when it doesn't have a named match)
VALID_TRANSITIONS = frozenset(
    {"cut", "fade", "push", "wipe", "zoom", "highlight", "morph", "reveal", "progressive_diagram"}
)


@dataclass
class SlideTransition:
    from_scene: int
    to_scene: int
    transition_type: str  # one of VALID_TRANSITIONS
    duration_seconds: float


# A "continuation" transition (same topic, e.g. two bullet slides in a row)
# should feel quick and unobtrusive; a "new topic" boundary (e.g. moving from
# problem statement to solution) deserves a slightly longer, more deliberate
# transition so the story's structure is felt, not just seen.
_HINT_TO_TRANSITION = {
    "continuation": ("cut", 0.0),
    "new_topic": ("fade", 0.6),
    "section_break": ("push", 0.8),
    "climax": ("wipe", 0.9),      # e.g. entering the "solution"/"proof" scene
    "closing": ("fade", 1.0),
}
_DEFAULT_TRANSITION = ("fade", 0.5)

# Layouts whose content benefits from a step-reveal treatment rather than a
# flat fade — the audience follows an architecture/process/roadmap slide
# better when it builds in rather than appearing all at once.
_PROGRESSIVE_LAYOUTS = frozenset({"architecture", "process", "roadmap", "timeline"})


def _transition_for_scene(scene: dict, hint: str) -> tuple[str, float]:
    """Content-aware override, checked before the plain transition_hint
    lookup: a scene's own layout/hero_image/is_key_moment flags (when
    present — all optional, all additive) take priority over the generic
    hint-based table."""
    layout = str(scene.get("layout", "") or "").strip().lower()
    if layout in _PROGRESSIVE_LAYOUTS:
        return ("progressive_diagram", 1.1)
    if scene.get("hero_image"):
        return ("zoom", 1.0)
    if scene.get("is_key_moment") or scene.get("is_key_stat"):
        return ("highlight", 0.7)
    return _HINT_TO_TRANSITION.get(hint, _DEFAULT_TRANSITION)


def plan_transitions(scenes: list[dict]) -> list[SlideTransition]:
    """scenes: list of dicts with at least `scene_number` (int); optional
    `transition_hint` (one of _HINT_TO_TRANSITION's keys), `layout` (a
    pptx_builder layout key — triggers progressive_diagram for architecture/
    process/roadmap/timeline), `hero_image` (triggers zoom), and
    `is_key_moment`/`is_key_stat` (triggers highlight). All optional —
    scenes with none of these still get the original hint-based fade/push/
    wipe/cut behavior, unchanged. Returns one SlideTransition per adjacent
    scene boundary (len(scenes) - 1 entries)."""
    transitions: list[SlideTransition] = []
    for i in range(len(scenes) - 1):
        current = scenes[i]
        nxt = scenes[i + 1]
        hint = str(nxt.get("transition_hint", "") or "").strip().lower()
        transition_type, duration = _transition_for_scene(nxt, hint)
        transitions.append(
            SlideTransition(
                from_scene=current.get("scene_number", i),
                to_scene=nxt.get("scene_number", i + 1),
                transition_type=transition_type,
                duration_seconds=duration,
            )
        )
    return transitions
